import { describe, expect, it } from "vitest";
import { canCancelClinicBus, canSendByClinicBus, cancelClinicBus, clinicBusOf, sendByClinicBus, type ClinicAppointment, type Vehicle, type VehicleRequest } from "../shared/transport";
import { appointmentOutcome } from "../shared/operations";

const appt = (id: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "4", mobile: "55500000",
  appointmentDate: "2026-10-01", appointmentAt: "09:00", kind: "عادي", assistance: [], status: "بانتظار طلب السيارة", approval: "pending", ...extra,
});
const bus = { plate: "900", driver: "سائق الباص" };
const now = new Date("2026-10-01T05:00:00Z");

describe("clinic bus", () => {
  it("finds the bus assigned to the clinic", () => {
    const vehicles = [
      { plate: "1", kind: "سيدان" },
      { plate: "2", kind: "باص", busRole: "shuttle" },
      { plate: "3", kind: "باص", busRole: "clinic" },
    ] as Vehicle[];
    expect(clinicBusOf(vehicles)?.plate).toBe("3");
    expect(clinicBusOf(vehicles.slice(0, 2))).toBeUndefined();
  });

  it("only sends medical appointments still waiting for a car", () => {
    expect(canSendByClinicBus(appt("A"), [])).toBe(true);
    expect(canSendByClinicBus(appt("A", { approval: "excluded" }), [])).toBe(false);
    expect(canSendByClinicBus(appt("A", { category: "غير طبية" }), [])).toBe(false);
    expect(canSendByClinicBus(appt("A", { returnOnly: true }), [])).toBe(false);
    expect(canSendByClinicBus(appt("A", { status: "ملغي" }), [])).toBe(false);
    const request = { id: "R1", appointmentId: "A", direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "" } as VehicleRequest;
    expect(canSendByClinicBus(appt("A"), [request])).toBe(false);
  });

  it("approves and marks the go trip done, leaving the return to the building supervisor", () => {
    const result = sendByClinicBus([appt("A"), appt("B", { approval: "approved", approvedBy: "مسؤول آخر" }), appt("C", { approval: "excluded" })], [], ["A", "B", "C"], bus, "المسؤول", false, now);
    expect(result.sent).toBe(2);
    const [a, b, c] = result.appointments;
    expect(a).toMatchObject({ status: "تم استلام المريض", approval: "approved", approvedBy: "المسؤول", clinicBus: true, clinicBusBy: "المسؤول" });
    expect(a.clinicBusReturn).toBeUndefined();
    expect(b).toMatchObject({ approvedBy: "مسؤول آخر", clinicBus: true });
    expect(c.clinicBus).toBeUndefined();
    expect(result.requests.map((r) => r.id)).toEqual(["CB-A", "CB-B"]);
    expect(result.requests[0]).toMatchObject({ direction: "ذهاب", status: "وصلت الوجهة", vehiclePlate: "900", driver: "سائق الباص", clinicBus: true });
    expect(appointmentOutcome(a, result.requests, now)).toBe("served");
  });

  it("completes the appointment when the bus also brings the guest back", () => {
    const result = sendByClinicBus([appt("A")], [], ["A"], bus, "المسؤول", true, now);
    expect(result.appointments[0]).toMatchObject({ status: "مكتملة", clinicBusReturn: true });
    expect(result.requests.map((r) => `${r.id}:${r.direction}`)).toEqual(["CB-A:ذهاب", "CB-A-R:عودة"]);
  });

  it("undoes the bus trip until the building supervisor requests a car", () => {
    const sent = sendByClinicBus([appt("A"), appt("B")], [], ["A", "B"], bus, "المسؤول", false, now);
    const other = { id: "R9", appointmentId: "B", direction: "عودة", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "" } as VehicleRequest;
    const requests = [...sent.requests, other];
    expect(canCancelClinicBus(sent.appointments[0], requests, "2026-10-01")).toBe(true);
    expect(canCancelClinicBus(sent.appointments[1], requests, "2026-10-01")).toBe(false);
    expect(canCancelClinicBus(sent.appointments[0], requests, "2026-10-02")).toBe(false);
    const undone = cancelClinicBus(sent.appointments, requests, ["A", "B"], "2026-10-01");
    expect(undone.cancelled).toBe(1);
    expect(undone.appointments[0]).toMatchObject({ status: "بانتظار طلب السيارة", approval: "approved" });
    expect(undone.appointments[0].clinicBus).toBeUndefined();
    expect(undone.requests.map((r) => r.id)).toEqual(["CB-B", "R9"]);
  });
});
