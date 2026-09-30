import { describe, expect, it } from "vitest";
import {
  buildTripGroups,
  joinWindow,
  planDispatch,
  seatsFor,
  suggestJoinDispatched,
  vehicleRestriction,
  vehicleSeats,
  type AssistanceNeed,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "../shared/transport";
import { RETURN_PICKUP_KM, suggestReturnPickups } from "../shared/trips";

const at = (hour: number, minute = 0) => new Date(2026, 8, 29, hour, minute);
const car = (plate: string, kind: Vehicle["kind"] = "سيدان", extra: Partial<Vehicle> = {}): Vehicle => ({ plate, driver: plate, phone: "1", kind, available: true, ...extra });
const guest = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "The Cuban Hospital", hospitalId: "cuban", buildingNumber: "26", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-09-29", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة", ...extra,
});
const special = (id: string, time: string, assistance: AssistanceNeed[] = []) => guest(id, time, { kind: "احتياجات خاصة", assistance });
const ask = (appointment: ClinicAppointment, extra: Partial<VehicleRequest> = {}): VehicleRequest => ({
  id: `R-${appointment.id}`, appointmentId: appointment.id, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "", ...extra,
});
const four = (prefix: string) => ["1", "2", "3", "4"].map((index) => guest(`${prefix}${index}`, "10:00"));

describe("seats per vehicle type", () => {
  it("a sedan carries 3, or 4 when the fleet supervisor runs it at full capacity", () => {
    expect(vehicleSeats(car("A"))).toBe(3);
    expect(vehicleSeats(car("A", "سيدان", { fullCapacity: true }))).toBe(4);
    expect(vehicleRestriction(car("A"), { appointments: four("G") }, { now: at(10) })).toBe("تتسع لـ 3 أشخاص فقط (أو 4 بطاقتها الكاملة)");
    expect(vehicleRestriction(car("A", "سيدان", { fullCapacity: true }), { appointments: four("G") }, { now: at(10) })).toBeNull();
    expect(vehicleRestriction(car("A", "سيدان", { fullCapacity: true }), { appointments: [...four("G"), guest("G5", "10:00")] }, { now: at(10) })).toBe("تتسع لـ 4 أشخاص فقط");
  });

  it("the special-needs car carries one special-needs guest and three regular persons", () => {
    const van = car("VAN", "احتياجات خاصة");
    expect(vehicleSeats(van)).toBe(4);
    expect(vehicleRestriction(van, { appointments: [special("S", "10:00"), guest("A", "10:00"), guest("B", "10:00"), guest("C", "10:00")] }, { now: at(10) })).toBeNull();
    // مع مرافقه: الضيف ومرافقه وثلاثة = 5
    expect(vehicleRestriction(van, { appointments: [special("S", "10:00", ["يحتاج مرافق"]), guest("A", "10:00"), guest("B", "10:00"), guest("C", "10:00")] }, { now: at(10) })).toBe("تتسع لـ 4 أشخاص فقط");
    expect(vehicleRestriction(van, { appointments: [special("S", "10:00"), special("T", "10:00")] }, { now: at(10) })).toBe("ضيف احتياجات خاصة واحد فقط في السيارة");
  });
});

describe("grouping with the new seats", () => {
  const items = (list: ClinicAppointment[]) => list.map((appointment) => ({ appointment, direction: "ذهاب" as const }));

  it("never groups two special-needs guests, but a special-needs guest can ride with three regular persons", () => {
    const fleet = [car("A"), car("VAN", "احتياجات خاصة")];
    const groups = buildTripGroups(items([special("S", "10:00"), special("T", "10:05"), guest("A", "10:00"), guest("B", "10:05"), guest("C", "10:10")]), undefined, seatsFor(fleet, { now: at(10) }));
    expect(groups.every((group) => group.appointmentIds.filter((id) => id === "S" || id === "T").length <= 1)).toBe(true);
    expect(groups.find((group) => group.appointmentIds.includes("S") || group.appointmentIds.includes("T"))?.persons).toBe(4);
  });

  it("regular guests are grouped by three (the special-needs car does not raise it), or four with a full-capacity sedan", () => {
    const regular = items(four("G"));
    expect(buildTripGroups(regular, undefined, seatsFor([car("A"), car("VAN", "احتياجات خاصة")], { now: at(10) })).map((group) => group.persons)).toEqual([3]);
    expect(buildTripGroups(regular, undefined, seatsFor([car("A", "سيدان", { fullCapacity: true })], { now: at(10) })).map((group) => group.persons)).toEqual([4]);
  });

  it("auto-dispatch sends a special-needs guest with three regular guests in the special-needs car", () => {
    const riders = [special("S", "10:00"), guest("A", "10:00"), guest("B", "10:05"), guest("C", "10:10")];
    const plan = planDispatch(riders.map((appointment) => ({ request: ask(appointment), appointment })), [car("VAN", "احتياجات خاصة"), car("A")], new Map(), undefined, undefined, { now: at(10) });
    expect(plan.assignments).toEqual([expect.objectContaining({ vehicle: expect.objectContaining({ plate: "VAN" }), persons: 4 })]);
  });
});

describe("joining a car that has just picked up its guest", () => {
  const first = guest("A", "10:00");
  const picked = (minutesAgo: number, extra: Partial<VehicleRequest> = {}) => ask(first, {
    status: "تم استلام المريض", vehiclePlate: "CAR", driver: "CAR", pickedUpAt: new Date(at(10, 0).getTime() - minutesAgo * 60000).toISOString(), ...extra,
  });

  it("stays open for five minutes after an outbound pickup", () => {
    expect(joinWindow(ask(first, { status: "تم إرسال السيارة", vehiclePlate: "CAR" }), at(10))).toBe(true);
    expect(joinWindow(picked(3), at(10))).toBe(new Date(at(10, 2).getTime()).toISOString());
    expect(joinWindow(picked(6), at(10))).toBe(false);
    expect(joinWindow(picked(1, { direction: "عودة" }), at(10))).toBe(false);
  });

  it("suggests joining a guest to the same hospital while the car is still at the complex", () => {
    const next = guest("B", "10:10");
    const pending = [{ request: ask(next), appointment: next }];
    const [join] = suggestJoinDispatched(pending, [{ request: picked(2), appointment: first }], undefined, [car("CAR")], { now: at(10) });
    expect(join).toMatchObject({ requestId: "R-B", plate: "CAR" });
    expect(join.openUntil).toBe(new Date(at(10, 3).getTime()).toISOString());
    expect(suggestJoinDispatched(pending, [{ request: picked(7), appointment: first }], undefined, [car("CAR")], { now: at(10) })).toEqual([]);
  });
});

describe("returning car with free seats and a return request nearby", () => {
  // الكوبي والوكرة: السيارة عائدة من الكوبي، وطلب عودة من الوكرة
  const aboard = guest("A", "09:00", { hospitalId: "wakra", clinic: "مستشفى الوكرة" });
  const riding = { request: ask(aboard, { direction: "عودة", status: "تم استلام المريض", vehiclePlate: "CAR", driver: "CAR", pickedUpAt: at(10).toISOString() }), appointment: aboard };
  const waiting = guest("B", "09:30", { hospitalId: "wakra", clinic: "مستشفى الوكرة" });
  const pending = [{ request: ask(waiting, { direction: "عودة" }), appointment: waiting }];
  const wakra = { lat: 25.1715, lng: 51.6004 };

  it("suggests the nearby return guest to the returning car by GPS", () => {
    const [pickup] = suggestReturnPickups(pending, [riding], [car("CAR")], new Map([["CAR", { lat: wakra.lat + 0.005, lng: wakra.lng }]]), undefined, { now: at(10) });
    expect(pickup).toMatchObject({ vehicle: expect.objectContaining({ plate: "CAR" }), onBoard: 1, seatsLeft: 2, memberIds: ["R-A"] });
    expect(pickup.distanceKm).toBeLessThanOrEqual(RETURN_PICKUP_KM);
  });

  it("not when the car is far, full, has no live GPS, or cannot take a special-needs guest", () => {
    const far = new Map([["CAR", { lat: 25.29, lng: 51.53 }]]);
    const near = new Map([["CAR", wakra]]);
    expect(suggestReturnPickups(pending, [riding], [car("CAR")], far, undefined, { now: at(10) })).toEqual([]);
    expect(suggestReturnPickups(pending, [riding], [car("CAR")], new Map(), undefined, { now: at(10) })).toEqual([]);
    const fullRide = { ...riding, persons: 3 };
    expect(suggestReturnPickups(pending, [fullRide], [car("CAR")], near, undefined, { now: at(10) })).toEqual([]);
    const specialWaiting = { ...waiting, kind: "احتياجات خاصة" as const };
    expect(suggestReturnPickups([{ request: ask(specialWaiting, { direction: "عودة" }), appointment: specialWaiting }], [riding], [car("CAR")], near, undefined, { now: at(10) })).toEqual([]);
    // سيارة لم تستلم ضيفها بعد ليست «عائدة»
    const notYet = { ...riding, request: { ...riding.request, status: "تم إرسال السيارة" as const } };
    expect(suggestReturnPickups(pending, [notYet], [car("CAR")], near, undefined, { now: at(10) })).toEqual([]);
  });
});
