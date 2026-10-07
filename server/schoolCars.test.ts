import { describe, expect, it } from "vitest";
import {
  assignVehicleForTrips,
  isSchoolCar,
  mergeVehicle,
  reservedRun,
  reservedSoon,
  reservedSoonWarning,
  scheduleOf,
  scheduleText,
  validSchedule,
  vehicleRestriction,
  vehicleRoleOf,
  type ClinicAppointment,
  type RoleSchedules,
  type Vehicle,
} from "../shared/transport";
import { serviceHours, summarizeTrips, tripsFromSystem, type ServiceEvent } from "../shared/stats";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

// الأحد 04-10-2026 يوم مدارس، والجمعة 09-10-2026 ليس كذلك
const at = (hour: number, minute = 0, day = 4) => new Date(2026, 9, day, hour, minute);
const car = (plate: string, kind: Vehicle["kind"], extra: Partial<Vehicle> = {}): Vehicle => ({ plate, driver: `سائق ${plate}`, phone: "1", kind, available: true, ...extra });
const school = car("SC", "احتياجات خاصة", { busRole: "school" });
const accessible = car("AC", "احتياجات خاصة");
const special = (id: string): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-10-04", appointmentAt: "12:00", kind: "احتياجات خاصة", assistance: [], status: "تم طلب السيارة",
});
const trip = { appointments: [special("A")] };

describe("school cars (special needs vehicles reserved for the school runs)", () => {
  it("is a special needs vehicle with the school role, and other kinds lose it", () => {
    expect(isSchoolCar(school)).toBe(true);
    expect(vehicleRoleOf(school)).toBe("school");
    expect(mergeVehicle(school, { driver: "سائق آخر" }).busRole).toBe("school");
    expect(mergeVehicle(school, { kind: "سيدان" }).busRole).toBeUndefined();
    expect(mergeVehicle(car("B", "باص", { busRole: "nonMedical" }), {}).busRole).toBe("nonMedical");
  });

  it("is not sent during the school runs, Sunday to Thursday 11:00–14:00 and 17:30–19:00", () => {
    expect(reservedRun(school, at(11))?.until).toBe("14:00");
    expect(reservedRun(accessible, at(11))).toBeNull();
    expect(vehicleRestriction(school, trip, { now: at(12, 30) })).toBe("في رحلة المدارس حتى 14:00");
    expect(vehicleRestriction(school, trip, { now: at(18) })).toBe("في رحلة المدارس حتى 19:00");
    // بين الرحلتين وبعدهما وفي العطلة: متاحة
    expect(vehicleRestriction(school, trip, { now: at(14) })).toBeNull();
    expect(vehicleRestriction(school, trip, { now: at(19, 30) })).toBeNull();
    expect(vehicleRestriction(school, trip, { now: at(12, 30, 9) })).toBeNull();
    // السيارة غير المخصصة للمدارس لا تتأثر
    expect(vehicleRestriction(accessible, trip, { now: at(12, 30) })).toBeNull();
  });

  it("is the last choice shortly before its run, with a warning for the fleet supervisor", () => {
    expect(reservedSoon(school, at(10, 15))?.starts).toBe("11:00");
    expect(reservedSoon(school, at(9))).toBeNull();
    expect(reservedSoonWarning(school, at(17))).toBe("سيارة المدارس · تخرج 17:30");
    expect(reservedSoonWarning(accessible, at(17))).toBeNull();
    // قبل رحلة المدارس بساعة: السيارة المجهزة الأخرى أولًا ولو كانت أكثر رحلات
    const load = new Map([["AC", 3], ["SC", 0]]);
    expect(assignVehicleForTrips([school, accessible], trip.appointments, load, undefined, { now: at(10, 30) })?.plate).toBe("AC");
    // بعيدًا عن رحلتها: الأقل رحلات
    expect(assignVehicleForTrips([school, accessible], trip.appointments, load, undefined, { now: at(8) })?.plate).toBe("SC");
  });

  it("counts as a working vehicle on school days, with its runs in the work hours", () => {
    const day = "2026-10-04";
    const events: ServiceEvent[] = [
      { at: new Date(2026, 9, 3, 20).toISOString(), plate: "SC", kind: "احتياجات خاصة", available: true, hasDriver: true, busRole: "school", driver: "سائق SC" },
    ];
    const service = serviceHours(events, day, day, at(23));
    expect(service.days[0]).toMatchObject({ plate: "SC", busRole: "school" });
    // رحلة واحدة لسيارة أخرى حتى يكون اليوم في الإحصائيات
    const trips = tripsFromSystem([special("A")], [{
      id: "R1", appointmentId: "A", direction: "ذهاب", status: "وصلت الوجهة", notificationMethod: "whatsapp", createdAt: "09:00",
      vehiclePlate: "AC", driver: "سائق AC", notificationSentAt: "09:00", pickedUpAt: at(9, 15).toISOString(), arrivedAt: at(9, 45).toISOString(), arrivalSource: "gps",
    }], [accessible, school], DEFAULT_HOSPITALS, at(23));
    const summary = summarizeTrips(trips, DEFAULT_HOSPITALS, null, service.days);
    expect(summary.workingVehicles).toMatchObject({ total: 2, roleBuses: [{ plate: "SC", busRole: "school" }] });
    // الذهاب 11:00–14:00 والعودة 17:30–19:00: أربع ساعات ونصف
    expect(summary.workHours?.vehicles.find((item) => item.plate === "SC")).toMatchObject({ minutes: 270, first: 660, last: 1140 });
    // الجمعة: ليست يوم مدارس
    const friday = "2026-10-09";
    const fridayService = serviceHours(events, friday, friday, at(23, 0, 9));
    const fridayTrips = tripsFromSystem([{ ...special("B"), appointmentDate: friday }], [{
      id: "R2", appointmentId: "B", direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "09:00", vehiclePlate: "AC", driver: "سائق AC", notificationSentAt: "09:00",
    }], [accessible, school], DEFAULT_HOSPITALS, at(23, 0, 9));
    const fridaySummary = summarizeTrips(fridayTrips, DEFAULT_HOSPITALS, null, fridayService.days);
    expect(fridaySummary.workingVehicles).toMatchObject({ total: 1, roleBuses: [] });
  });

  it("uses the times saved by the fleet supervisor (days, runs, or all day)", () => {
    // الأحد والثلاثاء فقط 12:00–13:30
    const schedules: RoleSchedules = { school: { days: [0, 2], runs: [{ from: 12 * 60, to: 13 * 60 + 30 }] } };
    expect(scheduleText(scheduleOf(schedules, "school"))).toBe("الأحد والثلاثاء 12:00–13:30");
    expect(vehicleRestriction(school, trip, { now: at(12, 30), schedules })).toBe("في رحلة المدارس حتى 13:30");
    expect(vehicleRestriction(school, trip, { now: at(11), schedules })).toBeNull();
    expect(vehicleRestriction(school, trip, { now: at(18), schedules })).toBeNull();
    expect(vehicleRestriction(school, trip, { now: at(12, 30, 5), schedules })).toBeNull(); // الإثنين
    expect(reservedSoonWarning(school, at(11, 30), schedules)).toBe("سيارة المدارس · تخرج 12:00");
    // طوال اليوم، أو بلا أوقات
    expect(vehicleRestriction(school, trip, { now: at(8), schedules: { school: { days: [0], runs: [{ from: 0, to: 1440 }] } } })).toBe("في خدمة المدارس");
    expect(vehicleRestriction(school, trip, { now: at(12), schedules: { school: { days: [], runs: [] } } })).toBeNull();
    // أوقات غير صالحة (متداخلة أو مقلوبة): الافتراضية
    const overlapping = { days: [0], runs: [{ from: 600, to: 700 }, { from: 650, to: 800 }] };
    expect(validSchedule(overlapping)).toBe(false);
    expect(validSchedule({ days: [0, 0], runs: [] })).toBe(false);
    expect(validSchedule({ days: [1], runs: [{ from: 700, to: 600 }] })).toBe(false);
    expect(scheduleOf({ school: overlapping }, "school")).toEqual(scheduleOf(null, "school"));
    expect(scheduleText(scheduleOf(null, "school"))).toBe("من الأحد إلى الخميس 11:00–14:00 و17:30–19:00");
    expect(scheduleText(scheduleOf(null, "nonMedical"))).toBe("كل الأيام طوال اليوم");
  });

  it("counts the saved times in the work hours, and an all-day university bus as working without hours", () => {
    const day = "2026-10-04";
    const events: ServiceEvent[] = [
      { at: new Date(2026, 9, 3, 20).toISOString(), plate: "SC", kind: "احتياجات خاصة", available: true, hasDriver: true, busRole: "school", driver: "سائق SC" },
      { at: new Date(2026, 9, 3, 20).toISOString(), plate: "UB", kind: "باص", available: true, hasDriver: true, busRole: "nonMedical", driver: "سائق UB" },
    ];
    const service = serviceHours(events, day, day, at(23));
    const trips = tripsFromSystem([special("A")], [{
      id: "R1", appointmentId: "A", direction: "ذهاب", status: "وصلت الوجهة", notificationMethod: "whatsapp", createdAt: "09:00",
      vehiclePlate: "AC", driver: "سائق AC", notificationSentAt: "09:00", pickedUpAt: at(9, 15).toISOString(), arrivedAt: at(9, 45).toISOString(), arrivalSource: "gps",
    }], [accessible, school], DEFAULT_HOSPITALS, at(23));
    // الأوقات الافتراضية: باص الجامعة طوال اليوم سيارة عاملة بلا ساعات عمل
    const summary = summarizeTrips(trips, DEFAULT_HOSPITALS, null, service.days);
    expect(summary.workingVehicles?.total).toBe(3);
    expect(summary.workHours?.vehicles.find((item) => item.plate === "UB")).toBeUndefined();
    // أوقات محفوظة: المدارس 12:00–13:00، وباص الجامعة 7:00–8:30 الأحد فقط
    const schedules: RoleSchedules = {
      school: { days: [0], runs: [{ from: 12 * 60, to: 13 * 60 }] },
      nonMedical: { days: [0], runs: [{ from: 7 * 60, to: 8 * 60 + 30 }] },
    };
    const saved = summarizeTrips(trips, DEFAULT_HOSPITALS, null, service.days, schedules);
    expect(saved.workHours?.vehicles.find((item) => item.plate === "SC")).toMatchObject({ minutes: 60, first: 720, last: 780 });
    expect(saved.workHours?.vehicles.find((item) => item.plate === "UB")).toMatchObject({ minutes: 90, first: 420, last: 510 });
    // يوم ليس من أيامهما: ليستا سيارتين عاملتين
    const monday = "2026-10-05";
    const mondayTrips = tripsFromSystem([{ ...special("B"), appointmentDate: monday }], [{
      id: "R2", appointmentId: "B", direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "09:00", vehiclePlate: "AC", driver: "سائق AC", notificationSentAt: "09:00",
    }], [accessible, school], DEFAULT_HOSPITALS, at(23, 0, 5));
    const mondaySummary = summarizeTrips(mondayTrips, DEFAULT_HOSPITALS, null, serviceHours(events, monday, monday, at(23, 0, 5)).days, schedules);
    expect(mondaySummary.workingVehicles).toMatchObject({ total: 1, roleBuses: [] });
  });
});
