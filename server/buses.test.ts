import { describe, expect, it } from "vitest";
import {
  assignVehicleForTrips,
  buildTripGroups,
  planDispatch,
  reservedSoonWarning,
  seatsFor,
  suggestJoinDispatched,
  vehicleRestriction,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "../shared/transport";

// الثلاثاء 29-09-2026: الذروة 13:00–16:00
const at = (hour: number, minute = 0, day = 29) => new Date(2026, 8, day, hour, minute);
const car = (plate: string, kind: Vehicle["kind"] = "سيدان", extra: Partial<Vehicle> = {}): Vehicle => ({ plate, driver: plate, phone: "1", kind, available: true, ...extra });
const guest = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "مركز الثمامة الصحي", hospitalId: "thumama-hc", buildingNumber: "26", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-09-29", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة", ...extra,
});
const outing = (id: string, time: string, place = "الجامعة") => guest(id, time, { clinic: place, hospitalId: undefined, category: "غير طبية" });
const ask = (appointment: ClinicAppointment, extra: Partial<VehicleRequest> = {}): VehicleRequest => ({
  id: `R-${appointment.id}`, appointmentId: appointment.id, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "", ...extra,
});

const shuttle = car("SH", "باص", { busRole: "shuttle" });
const outings = car("NM", "باص", { busRole: "nonMedical" });
const bus = car("BUS", "باص");

describe("buses", () => {
  it("are available at any hour, including early morning", () => {
    const trip = { appointments: [guest("A", "10:00", { clinic: "مستشفى الوكرة", hospitalId: "wakra" })] };
    expect(vehicleRestriction(bus, trip, { now: at(7, 30) })).toBeNull();
    expect(vehicleRestriction(bus, trip, { now: at(6) })).toBeNull();
  });

  it("carry 14 guests, a car 3 (4 at full capacity), and special needs need an equipped vehicle", () => {
    const four = { appointments: ["A", "B", "C", "D"].map((id) => guest(id, "10:00")) };
    expect(vehicleRestriction(car("A"), four, { now: at(10) })).toBe("تتسع لـ 3 أشخاص فقط (أو 4 بطاقتها الكاملة)");
    expect(vehicleRestriction(bus, four, { now: at(10) })).toBeNull();
    const fifteen = { appointments: Array.from({ length: 15 }, (_, index) => guest(`G${index}`, "10:00")) };
    expect(vehicleRestriction(bus, fifteen, { now: at(10) })).toBe("تتسع لـ 14 شخصًا فقط");
    expect(vehicleRestriction(bus, { appointments: [guest("W", "10:00", { kind: "احتياجات خاصة" })] }, { now: at(10) })).toBe("تحتاج سيارة احتياجات خاصة");
  });

  it("keep the complex shuttle inside, except Al Thumama at rush hour", () => {
    const thumama = { appointments: [guest("A", "14:30")] };
    expect(vehicleRestriction(shuttle, thumama, { now: at(14) })).toBeNull();
    expect(vehicleRestriction(shuttle, { appointments: [guest("A", "14:30"), guest("B", "14:40")] }, { now: at(14) })).toBeNull();
    // خارج الذروة، أو الجمعة، أو وجهة أخرى، أو نقل بين موعدين: يبقى داخل المجمع
    expect(vehicleRestriction(shuttle, thumama, { now: at(11) })).toBe("باص المجمع: مستشفى الثمامة وقت الذروة فقط");
    expect(vehicleRestriction(shuttle, thumama, { now: new Date(2026, 9, 2, 14) })).not.toBeNull(); // الجمعة
    expect(vehicleRestriction(shuttle, { appointments: [guest("B", "14:30", { clinic: "مستشفى الوكرة", hospitalId: "wakra" })] }, { now: at(14) })).not.toBeNull();
    expect(vehicleRestriction(shuttle, { ...thumama, transfer: true }, { now: at(14) })).not.toBeNull();
    // ولا يُقترح للرحلة العادية إن وُجدت سيارة أخرى
    expect(assignVehicleForTrips([shuttle, car("A")], thumama.appointments, new Map([["A", 5]]), undefined, { now: at(14) })?.plate).toBe("A");
    expect(assignVehicleForTrips([shuttle], thumama.appointments, new Map(), undefined, { now: at(14) })?.plate).toBe("SH");
  });

  it("never send the university bus in its reserved times: all day unless the fleet supervisor sets them", () => {
    const medical = { appointments: [guest("A", "10:00", { clinic: "مستشفى الوكرة", hospitalId: "wakra" })] };
    const trip = { appointments: [outing("U", "10:00")] };
    // افتراضيًا: لا رحلات طبية ولا غير طبية
    expect(vehicleRestriction(outings, medical, { now: at(10) })).toBe("في خدمة الجامعة");
    expect(vehicleRestriction(outings, trip, { now: at(10) })).toBe("في خدمة الجامعة");
    expect(assignVehicleForTrips([outings], trip.appointments, new Map(), undefined, { now: at(10) })).toBeNull();
    // أوقات يحددها مشرف السيارات: الأحد إلى الخميس 7:00–9:30 و13:00–15:00
    const schedules = { nonMedical: { days: [0, 1, 2, 3, 4], runs: [{ from: 7 * 60, to: 9 * 60 + 30 }, { from: 13 * 60, to: 15 * 60 }] } };
    expect(vehicleRestriction(outings, trip, { now: at(13, 30), schedules })).toBe("في رحلة الجامعة حتى 15:00");
    expect(vehicleRestriction(outings, medical, { now: at(13, 30), schedules })).toBe("في رحلة الجامعة حتى 15:00");
    // خارج أوقاته باص عادي: للرحلات الطبية وغير الطبية
    expect(vehicleRestriction(outings, medical, { now: at(10), schedules })).toBeNull();
    expect(vehicleRestriction(outings, trip, { now: at(10), schedules })).toBeNull();
    expect(vehicleRestriction(outings, trip, { now: new Date(2026, 9, 2, 13, 30), schedules })).toBeNull(); // الجمعة
    // قبل وقته بساعة: آخر خيار ولو كان أقل رحلات، مع تنبيه لمشرف السيارات
    expect(assignVehicleForTrips([outings, car("A")], medical.appointments, new Map([["A", 5]]), undefined, { now: at(12, 15), schedules })?.plate).toBe("A");
    expect(reservedSoonWarning(outings, at(12, 15), schedules)).toBe("باص الجامعة · يخرج 13:00");
    expect(assignVehicleForTrips([outings, car("A")], medical.appointments, new Map([["A", 5]]), undefined, { now: at(10), schedules })?.plate).toBe("NM");
  });

  it("never dispatch the clinic bus", () => {
    const clinicBus = car("CL", "باص", { busRole: "clinic" });
    expect(vehicleRestriction(clinicBus, { appointments: [guest("A", "10:00")] }, { now: at(10) })).toBe("في خدمة العيادة");
    expect(vehicleRestriction(clinicBus, { appointments: [outing("U", "10:00")] }, { now: at(10) })).toBe("في خدمة العيادة");
    expect(assignVehicleForTrips([clinicBus], [outing("U", "10:00")], new Map(), undefined, { now: at(10) })).toBeNull();
    // ولا يُحسب في مقاعد الجمع
    const items = ["U1", "U2", "U3", "U4"].map((id) => ({ appointment: outing(id, "10:00"), direction: "ذهاب" as const }));
    expect(buildTripGroups(items, undefined, seatsFor([clinicBus, car("A")], { now: at(10) })).map((group) => group.appointmentIds.length)).toEqual([3]);
  });

  it("group up to 14 passengers when a suitable bus is free", () => {
    const five = ["U1", "U2", "U3", "U4", "U5"].map((id, index) => outing(id, `10:${String(index * 5).padStart(2, "0")}`));
    const items = five.map((appointment) => ({ appointment, direction: "ذهاب" as const }));
    // باص متاح: رحلة واحدة لخمسة
    expect(buildTripGroups(items, undefined, seatsFor([bus, car("A")], { now: at(10) })).map((group) => group.appointmentIds.length)).toEqual([5]);
    // الباص متاح صباحًا أيضًا
    expect(buildTripGroups(items, undefined, seatsFor([bus], { now: at(8) })).map((group) => group.appointmentIds.length)).toEqual([5]);
    // بلا باص (أو باص الجامعة في وقته): 3 ثم 2
    expect(buildTripGroups(items, undefined, seatsFor([car("A")], { now: at(10) })).map((group) => group.appointmentIds.length)).toEqual([3, 2]);
    expect(buildTripGroups(items, undefined, seatsFor([outings, car("A")], { now: at(10) })).map((group) => group.appointmentIds.length)).toEqual([3, 2]);
  });

  it("sends the shuttle with Al Thumama guests at rush hour, and cars otherwise", () => {
    const five = ["T1", "T2", "T3", "T4", "T5"].map((id, index) => guest(id, `14:${String(index * 5).padStart(2, "0")}`));
    const trips = five.map((appointment) => ({ appointment, request: ask(appointment) }));
    const rush = planDispatch(trips, [shuttle, car("A"), car("B")], new Map(), undefined, undefined, { now: at(13, 30) });
    expect(rush.assignments.map((item) => [item.vehicle.plate, item.requestIds.length])).toEqual([["SH", 5]]);
    const quiet = planDispatch(trips, [shuttle, car("A"), car("B")], new Map(), undefined, undefined, { now: at(11) });
    expect(quiet.assignments.map((item) => [item.vehicle.plate, item.requestIds.length]).sort()).toEqual([["A", 3], ["B", 2]]);
  });

  it("splits a big group across cars when its bus was taken", () => {
    const university = ["U1", "U2", "U3", "U4", "U5"].map((id) => outing(id, "10:00"));
    const school = ["S1", "S2", "S3", "S4", "S5"].map((id) => outing(id, "10:00", "المدرسة"));
    const trips = [...university, ...school].map((appointment) => ({ appointment, request: ask(appointment) }));
    const plan = planDispatch(trips, [bus, car("A"), car("B")], new Map(), undefined, undefined, { now: at(9, 30) });
    const sizes = plan.assignments.map((item) => [item.vehicle.plate, item.requestIds.length]);
    expect(sizes).toContainEqual(["BUS", 5]);
    expect(sizes.filter(([plate]) => plate !== "BUS").map(([, size]) => size).sort()).toEqual([2, 3]);
    expect(plan.assignments.flatMap((item) => item.requestIds)).toHaveLength(10);
    expect(plan.waiting).toEqual([]);
  });

  it("lets more guests join a bus on its way than a car", () => {
    const riders = ["U1", "U2", "U3"].map((id) => outing(id, "10:00"));
    const newcomer = outing("U4", "10:05");
    const sent = (plate: string) => riders.map((appointment) => ({ appointment, request: ask(appointment, { status: "تم إرسال السيارة", vehiclePlate: plate, groupId: `G-${plate}` }) }));
    const join = (plate: string, vehicles: Vehicle[]) => suggestJoinDispatched([{ appointment: newcomer, request: ask(newcomer) }], sent(plate), undefined, vehicles, { now: at(10) });
    expect(join("BUS", [bus])).toEqual([expect.objectContaining({ plate: "BUS" })]);
    expect(join("A", [car("A")])).toEqual([]);
  });
});
