import { describe, expect, it } from "vitest";
import {
  buildDriverMessage,
  buildTripGroups,
  migrateAppointment,
  migrateRequest,
  planDispatch,
  requestPersons,
  seatsFor,
  tripPersons,
  vehicleRestriction,
  type AssistanceNeed,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "../shared/transport";

const at = (hour: number, minute = 0) => new Date(2026, 8, 29, hour, minute);
const car = (plate: string, kind: Vehicle["kind"] = "سيدان", extra: Partial<Vehicle> = {}): Vehicle => ({ plate, driver: plate, phone: "1", kind, available: true, ...extra });
const guest = (id: string, time: string, assistance: AssistanceNeed[] = [], extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "The Cuban Hospital", hospitalId: "cuban", buildingNumber: "26", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-09-29", appointmentAt: time, kind: "عادي", assistance, status: "تم طلب السيارة", ...extra,
});
const ask = (appointment: ClinicAppointment, extra: Partial<VehicleRequest> = {}): VehicleRequest => ({
  id: `R-${appointment.id}`, appointmentId: appointment.id, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "", ...extra,
});
const ESCORT: AssistanceNeed = "يحتاج مرافق";
const NURSE: AssistanceNeed = "يحتاج Nurse";

describe("persons in the car", () => {
  it("counts the escort and the nurse as persons", () => {
    expect(tripPersons(guest("A", "10:00"))).toBe(1);
    expect(tripPersons(guest("A", "10:00", [ESCORT]))).toBe(2);
    expect(tripPersons(guest("A", "10:00", [NURSE]))).toBe(2);
    expect(tripPersons(guest("A", "10:00", [ESCORT, NURSE, "كرسي متحرك"]))).toBe(3);
  });

  it("counts the nurse alone on her own return, and the guest's return without her", () => {
    const appointment = guest("A", "10:00", [ESCORT, NURSE]);
    const nurse = ask(appointment, { id: "R-N", direction: "عودة", nurseOnly: true });
    const back = ask(appointment, { id: "R-B", direction: "عودة" });
    expect(tripPersons(appointment, nurse)).toBe(1);
    expect(requestPersons(back, appointment, [nurse, back])).toBe(2);
    expect(requestPersons(back, appointment, [back])).toBe(3);
    // يبقى nurseOnly بعد التوحيد
    expect(migrateRequest({ ...nurse })?.nurseOnly).toBe(true);
    expect(migrateRequest({ ...back })?.nurseOnly).toBeUndefined();
  });

  it("groups by persons: a guest with an escort fills a car with one more guest", () => {
    const items = (list: ClinicAppointment[]) => list.map((appointment) => ({ appointment, direction: "ذهاب" as const }));
    const escorted = guest("E", "10:00", [ESCORT]);
    expect(buildTripGroups(items([escorted, guest("B", "10:05"), guest("C", "10:10")]))[0]).toMatchObject({ persons: 3 });
    expect(buildTripGroups(items([escorted, guest("B", "10:05"), guest("C", "10:10")]))[0].appointmentIds).toHaveLength(2);
    // ضيفان مع مرافقين (4 أشخاص) لا يُجمعان في سيارة، ويُجمعان إن كان باص متاح
    const twoEscorted = items([escorted, guest("F", "10:05", [ESCORT])]);
    expect(buildTripGroups(twoEscorted)).toHaveLength(0);
    expect(buildTripGroups(twoEscorted, undefined, seatsFor([car("BUS", "باص")], { now: at(10) }))).toEqual([expect.objectContaining({ persons: 4 })]);
  });

  it("always accepts one guest with companions, but limits groups by seats", () => {
    const special = guest("W", "10:00", [ESCORT, NURSE], { kind: "احتياجات خاصة" });
    const van = car("VAN", "احتياجات خاصة");
    expect(vehicleRestriction(van, { appointments: [special] }, { now: at(10) })).toBeNull();
    expect(vehicleRestriction(van, { appointments: [special, guest("X", "10:00", [], { kind: "احتياجات خاصة" })] }, { now: at(10) })).toBe("ضيف احتياجات خاصة واحد فقط في السيارة");
    expect(vehicleRestriction(car("A"), { appointments: [guest("A", "10:00", [ESCORT]), guest("B", "10:00", [ESCORT])] }, { now: at(10) })).toBe("تتسع لـ 3 أشخاص فقط (أو 4 بطاقتها الكاملة)");
  });

  it("splits a bus group across cars by persons when the bus is taken", () => {
    // 4 ضيوف إلى المدرسة أولًا (أكثر من السيدان): يأخذون الباص
    const school = ["S1", "S2", "S3", "S4"].map((id) => guest(id, "09:50", [], { clinic: "المدرسة", hospitalId: undefined, category: "غير طبية" }));
    const university = ["U1", "U2", "U3"].map((id) => guest(id, "10:00", [ESCORT], { clinic: "الجامعة", hospitalId: undefined, category: "غير طبية" }));
    const trips = [...school, ...university].map((appointment) => ({ appointment, request: ask(appointment) }));
    const plan = planDispatch(trips, [car("BUS", "باص"), car("A"), car("B"), car("C")], new Map(), undefined, undefined, { now: at(9, 30) });
    const bus = plan.assignments.find((item) => item.vehicle.plate === "BUS");
    expect(bus?.requestIds).toEqual(["R-S1", "R-S2", "R-S3", "R-S4"]);
    // ضيوف الجامعة مع مرافقيهم (6 أشخاص): سيارة لكل ضيف ومرافقه
    const cars = plan.assignments.filter((item) => item.vehicle.plate !== "BUS");
    expect(cars.map((item) => item.persons)).toEqual([2, 2, 2]);
    expect(plan.waiting).toEqual([]);
  });

  it("tells the driver the persons and the nurse-only return", () => {
    const appointment = guest("A", "10:00", [ESCORT, NURSE]);
    const message = buildDriverMessage([{ appointment, request: ask(appointment) }], { plate: "976004", driver: "رامش" });
    expect(message).toContain("عدد الأشخاص: 3");
    expect(message).toContain("Persons: 3");
    const nurse = buildDriverMessage([{ appointment, request: ask(appointment, { direction: "عودة", nurseOnly: true }) }], { plate: "976004", driver: "رامش" });
    expect(nurse).toContain("الراكب: الـ Nurse مرافقة الضيف ضيف A (عودة الـ Nurse فقط)");
    expect(nurse).toContain("Nurse return only");
    // عودة الـ Nurse فقط: شخص واحد
    expect(nurse).toContain("السيارة: 976004\nعدد الأشخاص: 1");
    expect(nurse).toContain("Vehicle: 976004\nPersons: 1");
  });

  it("always tells the driver the number of persons, and the total in a grouped trip", () => {
    // الضيف وحده: شخص واحد
    const alone = guest("A", "10:00");
    const single = buildDriverMessage([{ appointment: alone, request: ask(alone) }], { plate: "111", driver: "علي" });
    expect(single).toContain("السيارة: 111\nعدد الأشخاص: 1");
    expect(single).toContain("Vehicle: 111\nPersons: 1");
    // رحلة مجمّعة: ضيف وحده وضيف مع مرافقه = 3 أشخاص، وعدد كل ضيف تحته
    const withEscort = guest("B", "10:10", [ESCORT]);
    const group = buildDriverMessage([{ appointment: alone, request: ask(alone) }, { appointment: withEscort, request: ask(withEscort) }], { plate: "111", driver: "علي" });
    expect(group).toContain("السيارة: 111\nمجموع الأشخاص في السيارة: 3");
    expect(group).toContain("Total persons in the car: 3");
    expect(group.split("—————")[0].match(/عدد الأشخاص: \d/g)).toEqual(["عدد الأشخاص: 1", "عدد الأشخاص: 2"]);
  });

  it("keeps the self-return record when appointments are normalized", () => {
    const stored = { ...guest("A", "10:00"), status: "مكتملة", returnedSelf: true, returnedSelfBy: "مشرف المبنى 17", returnedSelfAt: "2026-09-29T09:00:00.000Z" };
    expect(migrateAppointment(stored)).toMatchObject({ returnedSelf: true, returnedSelfBy: "مشرف المبنى 17" });
    expect(migrateAppointment(guest("B", "10:00"))?.returnedSelf).toBeUndefined();
  });
});
