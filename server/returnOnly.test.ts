import { describe, expect, it } from "vitest";
import {
  findUnrequestedMatches,
  isReturnOnly,
  migrateAppointment,
  nextAppointmentOf,
  parseImportedAppointments,
  requestWindow,
  systemReturnMessage,
  systemTripAwaitingReturn,
  type ClinicAppointment,
  type VehicleRequest,
} from "../shared/transport";
import { neededAt } from "../shared/trips";

const appt = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: "ضيف 1", clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "4", mobile: "55500000",
  appointmentDate: "2026-10-01", appointmentAt: time, kind: "عادي", assistance: [], status: "بانتظار طلب السيارة", ...extra,
});
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);

describe("return-only request from the hospital", () => {
  it("keeps the return-only flag when appointments are normalized", () => {
    expect(migrateAppointment(appt("A", "10:00", { returnOnly: true }))).toMatchObject({ returnOnly: true });
    expect(migrateAppointment(appt("A", "10:00"))?.returnOnly).toBeUndefined();
    expect(migrateAppointment({ ...appt("A", "10:00"), returnOnly: "yes" })?.returnOnly).toBeUndefined();
    expect(isReturnOnly(appt("A", "10:00", { returnOnly: true }))).toBe(true);
    expect(isReturnOnly(appt("A", "10:00"))).toBe(false);
  });

  it("can be requested all day, while an appointment closes 30 minutes after its time", () => {
    const returnOnly = appt("A", "10:00", { returnOnly: true });
    const appointment = appt("B", "10:00");
    expect(requestWindow(returnOnly, at("2026-10-01", "22:30")).open).toBe(true);
    expect(requestWindow(returnOnly, at("2026-10-02", "00:30")).open).toBe(false);
    expect(requestWindow(appointment, at("2026-10-01", "10:29")).open).toBe(true);
    expect(requestWindow(appointment, at("2026-10-01", "10:31")).open).toBe(false);
  });

  it("is never matched with outbound trips nor offered as the next appointment", () => {
    const outbound = appt("A", "09:00", { patientName: "ضيف 2", apartmentNumber: "9", status: "تم طلب السيارة" });
    const request: VehicleRequest = { id: "R1", appointmentId: "A", direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:30" };
    const returnOnly = appt("B", "09:10", { returnOnly: true });
    const regular = appt("C", "09:15", { patientName: "ضيف 3", apartmentNumber: "2" });
    const matches = findUnrequestedMatches([outbound, returnOnly, regular], [request], undefined, at("2026-10-01", "08:40"));
    expect(matches.map((match) => match.appointment.id)).toEqual(["C"]);

    const first = appt("D", "08:00", { status: "تم استلام المريض" });
    const laterReturn = appt("E", "11:00", { returnOnly: true });
    expect(nextAppointmentOf(first, [first, laterReturn], at("2026-10-01", "09:00"))).toBeNull();
    const laterVisit = appt("F", "11:30");
    expect(nextAppointmentOf(first, [first, laterReturn, laterVisit], at("2026-10-01", "09:00"))?.id).toBe("F");
  });

  it("is needed from its return time, even when the clinic added it earlier", () => {
    const request: VehicleRequest = { id: "R1", appointmentId: "A", direction: "عودة", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:15" };
    expect(neededAt(request, appt("A", "14:00", { returnOnly: true }))).toEqual(at("2026-10-01", "14:00"));
    // عودة بعد موعد: من وقت طلبها
    expect(neededAt(request, appt("A", "07:00"))).toEqual(at("2026-10-01", "08:15"));
  });

  it("imports and exports the «عودة فقط» column", () => {
    const row = (returnOnly: string) => ({
      "اسم الضيف أو الرقم": `ضيف ${returnOnly}`, "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم المبنى": "17", "رقم الشقة": "4",
      "رقم الموبايل": "55500000", "تاريخ الموعد": "2026-10-01", "وقت الموعد": "14:00", "نوع الرحلة": "عادي", "الجنس": "ذكر", "عودة فقط": returnOnly, "سبب الحجز في نفس اليوم": "موعد جديد من المستشفى",
    });
    const result = parseImportedAppointments([row("نعم"), row("لا")], [], 1, "2026-10-01");
    expect(result.errors).toEqual([]);
    expect(result.appointments.map((appointment) => appointment.returnOnly)).toEqual([true, undefined]);
  });

  it("warns when the guest went by a complex car and the building supervisor has not requested the return", () => {
    const today = "2026-10-03";
    const guest = { guestId: "G-1", patientName: "ضيف 1", buildingNumber: "17", apartmentNumber: "4", appointmentDate: today };
    const went = appt("A", "09:00", { guestId: "G-1", appointmentDate: "2026-10-02", status: "تم استلام المريض" });
    expect(systemTripAwaitingReturn(guest, [went], today)?.id).toBe("A");
    // طُلبت عودته، أو عاد، أو لم يذهب بعد، أو ضيف آخر، أو قبل 7 أيام: لا تنبيه
    for (const other of [
      { ...went, status: "طلب عودة" as const },
      { ...went, status: "مكتملة" as const },
      { ...went, status: "تم طلب السيارة" as const },
      { ...went, guestId: "G-2" },
      { ...went, appointmentDate: "2026-09-25" },
      { ...went, appointmentDate: "2026-10-04" },
    ]) expect(systemTripAwaitingReturn(guest, [other], today)).toBeUndefined();
    // المواعيد القديمة بلا رقم الضيف: بالاسم والمبنى والشقة
    const { guestId: _id, ...unlinked } = went;
    expect(systemTripAwaitingReturn(guest, [unlinked], today)?.id).toBe("A");
    // الحالة المستعجلة في عيادة المجمع لها نتيجتها
    expect(systemTripAwaitingReturn(guest, [{ ...went, urgent: true, hospitalId: "complex-clinic" }], today)).toBeUndefined();
    expect(systemReturnMessage(went)).toContain("مشرف المبنى");
  });

  it("rejects an imported return-only row for a guest who went by a complex car", () => {
    const row = {
      "اسم الضيف أو الرقم": "ضيف 1", "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم المبنى": "17", "رقم الشقة": "4",
      "رقم الموبايل": "55500000", "تاريخ الموعد": "2026-10-01", "وقت الموعد": "14:00", "نوع الرحلة": "عادي", "الجنس": "ذكر", "عودة فقط": "نعم",
    };
    const went = appt("A", "09:00", { status: "تم استلام المريض" });
    const blocked = parseImportedAppointments([row], [went], 1, "2026-10-01");
    expect(blocked.appointments).toEqual([]);
    expect(blocked.errors[0]).toContain("يطلب عودته مشرف المبنى");
    expect(parseImportedAppointments([row], [{ ...went, status: "طلب عودة" }], 1, "2026-10-01").appointments).toHaveLength(1);
  });
});
