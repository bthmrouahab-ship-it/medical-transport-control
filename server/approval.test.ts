import { describe, expect, it } from "vitest";
import { approvalOf, guestAlerts, isApproved, migrateAppointment, type ClinicAppointment } from "../shared/transport";

const appt = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: "ضيف 1", clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "4", mobile: "55500000",
  appointmentDate: "2026-10-01", appointmentAt: time, kind: "عادي", assistance: [], status: "بانتظار طلب السيارة", ...extra,
});

describe("clinic supervisor approval", () => {
  it("treats appointments from before the feature as approved", () => {
    expect(approvalOf(appt("A", "09:00"))).toBe("approved");
    expect(isApproved(appt("A", "09:00"))).toBe(true);
    expect(isApproved(appt("A", "09:00", { approval: "pending" }))).toBe(false);
    expect(isApproved(appt("A", "09:00", { approval: "excluded", excludedBy: "مسؤول", excludedAt: "2026-09-30T10:00:00Z" }))).toBe(false);
  });

  it("keeps the approval state when appointments are normalized", () => {
    expect(migrateAppointment(appt("A", "09:00", { approval: "pending" }))).toMatchObject({ approval: "pending" });
    expect(migrateAppointment(appt("A", "09:00", { approval: "approved", approvedBy: "مسؤول العيادة", approvedAt: "2026-09-30T10:00:00Z" })))
      .toMatchObject({ approval: "approved", approvedBy: "مسؤول العيادة" });
    expect(migrateAppointment(appt("A", "09:00", { approval: "excluded", excludedBy: "مسؤول العيادة", excludedAt: "2026-09-30T10:00:00Z" })))
      .toMatchObject({ approval: "excluded", excludedBy: "مسؤول العيادة" });
    expect(migrateAppointment(appt("A", "09:00"))?.approval).toBeUndefined();
  });
});

describe("guest alerts for the clinic supervisor", () => {
  it("flags two appointments of the same guest at the same time or less than 30 minutes apart", () => {
    const first = appt("A", "09:00");
    const same = appt("B", "09:00", { clinic: "The Cuban Hospital", hospitalId: "cuban" });
    const near = appt("C", "09:20", { clinic: "مستشفى حمد العام", hospitalId: "hamad" });
    expect(guestAlerts(first, [first, same, near])).toEqual([
      expect.objectContaining({ kind: "sameTime", gap: 0, other: same }),
      expect.objectContaining({ kind: "sameTime", gap: 20, other: near }),
    ]);
  });

  it("flags two appointments at the same hospital at different times", () => {
    const morning = appt("A", "09:00");
    const afternoon = appt("B", "13:00");
    expect(guestAlerts(morning, [morning, afternoon])).toEqual([expect.objectContaining({ kind: "sameHospital", gap: 240 })]);
  });

  it("ignores other guests, other days, other hospitals far apart, and cancelled or excluded appointments", () => {
    const base = appt("A", "09:00");
    const others = [
      appt("B", "09:00", { patientName: "ضيف 2" }),
      appt("C", "09:00", { appointmentDate: "2026-10-02" }),
      appt("D", "11:00", { clinic: "The Cuban Hospital", hospitalId: "cuban" }),
      appt("E", "09:10", { status: "ملغي" }),
      appt("F", "09:10", { approval: "excluded", excludedBy: "مسؤول", excludedAt: "2026-09-30T10:00:00Z" }),
    ];
    expect(guestAlerts(base, [base, ...others])).toEqual([]);
    // الموعد المستبعد نفسه بلا تنبيهات
    expect(guestAlerts(others[4], [base, ...others])).toEqual([]);
  });
});
