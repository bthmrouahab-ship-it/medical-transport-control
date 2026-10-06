import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, clockText, durationText, legacyTrips, matchesFilter, summarizeTrips, tripsFromSystem, type TripStat } from "../shared/stats";
import type { HistorySummary } from "../shared/history";
import { appointmentDateTime, type ClinicAppointment, type Vehicle, type VehicleRequest } from "../shared/transport";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { driveMinutes } from "../shared/trips";

const fleet: Pick<Vehicle, "plate" | "kind">[] = [
  { plate: "111", kind: "سيدان" }, { plate: "222", kind: "سيدان" }, { plate: "333", kind: "احتياجات خاصة" }, { plate: "444", kind: "باص" },
];
const appointment = (id: string, date: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: date, appointmentAt: "09:00", kind: "عادي", assistance: [], status: "مكتملة", ...extra,
}) as ClinicAppointment;
const at = (date: string, time: string) => appointmentDateTime({ appointmentDate: date, appointmentAt: time });
/** times: يوم الرحلة ووقت إرسال السيارة ووقت وصولها إلى الوجهة */
const request = (id: string, appointmentId: string, direction: "ذهاب" | "عودة", vehiclePlate?: string, times?: [string, string, string], extra: Partial<VehicleRequest> = {}) => ({
  id, appointmentId, direction, status: vehiclePlate ? "وصلت الوجهة" : "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:00",
  ...(vehiclePlate ? { vehiclePlate, driver: `سائق ${vehiclePlate}`, notificationSentAt: times?.[1] ?? "08:10" } : {}),
  ...(times ? { arrivedAt: at(times[0], times[2]).toISOString(), arrivalSource: "manual" } : {}),
  ...extra,
}) as VehicleRequest;

describe("working vehicles in the statistics", () => {
  const appointments = [
    appointment("A1", "2026-10-04"), appointment("A2", "2026-10-04"), appointment("A3", "2026-10-04", { kind: "احتياجات خاصة" }),
    appointment("B1", "2026-10-05"), appointment("B2", "2026-10-05"),
    // يوم قادم لم تُرسل له سيارة بعد
    appointment("C1", "2026-10-08", { status: "بانتظار طلب السيارة" }),
  ];
  const requests = [
    request("R1", "A1", "ذهاب", "111"), request("R1b", "A1", "عودة", "222"),
    request("R2", "A2", "ذهاب", "111"), request("R2b", "A2", "عودة", "111"),
    request("R3", "A3", "ذهاب", "333"),
    request("R4", "B1", "ذهاب", "444"), request("R5", "B2", "ذهاب", "111"),
  ];
  const trips = tripsFromSystem(appointments, requests, fleet, DEFAULT_HOSPITALS);

  it("the return car of an appointment counts as a working vehicle", () => {
    // رحلة لكل موعد بنفس الترتيب: A1 ذهابًا بالسيارة 111 وعودة بالسيارة 222
    expect(trips[0]).toMatchObject({ plate: "111", otherVehicles: [{ plate: "222", driver: "سائق 222", kind: "سيدان" }] });
    // نفس السيارة ذهابًا وعودة: لا تتكرر
    expect(trips[1].plate).toBe("111");
    expect(trips[1].otherVehicles).toBeUndefined();
    // الفلترة بالسيارة تشمل رحلات العودة
    expect(trips.filter((trip) => matchesFilter(trip, { ...EMPTY_FILTER, plate: "222" }, DEFAULT_HOSPITALS))).toHaveLength(1);
  });

  it("counts each vehicle once per day and in the period, with its kind", () => {
    const summary = summarizeTrips(trips);
    expect(summary.daily.map((day) => [day.date, day.vehicles])).toEqual([["2026-10-04", 3], ["2026-10-05", 2], ["2026-10-08", 0]]);
    expect(summary.workingVehicles).toEqual({
      total: 4,
      byKind: [{ kind: "سيدان", vehicles: 2 }, { kind: "احتياجات خاصة", vehicles: 1 }, { kind: "باص", vehicles: 1 }],
      // اليوم القادم بلا سيارات لا يدخل في المتوسط
      dailyAverage: 3,
      dailyMax: 3,
      roleBuses: [],
    });
    // السيارة 111: ثلاث رحلات، والسيارة 222 رحلة العودة
    expect(summary.vehicles.find((item) => item.plate === "111")?.trips).toBe(3);
    expect(summary.vehicles.find((item) => item.plate === "222")?.trips).toBe(1);
    // يوم واحد
    expect(summarizeTrips(trips.filter((trip) => trip.date === "2026-10-05")).workingVehicles?.total).toBe(2);
  });

  it("days of the old summary have no vehicle count; its vehicles join the period total", () => {
    const legacy = {
      daily: [{ date: "2026-08-01", weekday: "السبت", total: 2, completed: 2, sedan: 2, special: 0, bus: 0 }],
      vehicles: [{ plate: "111", driver: "", trips: 1 }, { plate: "900", driver: "", trips: 1 }],
      byHour: [], destinations: [], zones: [], buildings: [], avgTripMinutes: null, completedTrips: 2, unmatchedDestinations: 0,
    } as unknown as HistorySummary;
    const old: TripStat[] = legacyTrips(legacy);
    const summary = summarizeTrips([...old, ...trips], DEFAULT_HOSPITALS, legacy);
    expect(summary.daily.find((day) => day.date === "2026-08-01")?.vehicles).toBeUndefined();
    // 111 و222 و333 و444 من النظام، و900 من الملخص القديم
    expect(summary.workingVehicles?.total).toBe(5);
    expect(summary.workingVehicles?.dailyAverage).toBe(3);
  });
});

describe("working hours of the vehicles", () => {
  const hospital = DEFAULT_HOSPITALS.find((item) => item.id === "hgh")!;
  // طريق العودة الفارغة من المستشفى إلى المجمع بعد رحلة الذهاب
  const back = (date: string, time: string) => Math.ceil(driveMinutes({ lat: hospital.lat, lng: hospital.lng }, { lat: ORIGIN.lat, lng: ORIGIN.lng }, at(date, time)));
  const day = "2026-10-04";
  const appointments = [appointment("A1", day), appointment("A2", day), appointment("A3", day)];
  const requests = [
    // رحلة مجمّعة: A1 وA2 في السيارة 111 (تُحسب مرة واحدة)
    request("R1", "A1", "ذهاب", "111", [day, "08:10", "08:40"], { groupId: "G1" }),
    request("R2", "A2", "ذهاب", "111", [day, "08:10", "08:50"], { groupId: "G1" }),
    // عودة A1 بالسيارة نفسها
    request("R3", "A1", "عودة", "111", [day, "11:00", "11:30"]),
    // A3: ذهاب بالسيارة 222، والعودة ما زالت في الطريق (لا تُحسب حتى تصل)
    request("R4", "A3", "ذهاب", "222", [day, "09:00", "09:25"]),
    request("R5", "A3", "عودة", "222", undefined, { status: "تم إرسال السيارة", notificationSentAt: "12:00" }),
  ];
  const now = at(day, "12:10");
  const trips = tripsFromSystem(appointments, requests, fleet, DEFAULT_HOSPITALS, now);

  it("from sending the car until it is back at the complex, overlapping trips once", () => {
    const work = summarizeTrips(trips).workHours!;
    const first = work.vehicles.find((item) => item.plate === "111")!;
    // 08:10 حتى 08:50 + العودة إلى المجمع، ثم 11:00 حتى 11:30
    expect(first.minutes).toBe(40 + back(day, "08:50") + 30);
    expect([clockText(first.first), clockText(first.last)]).toEqual(["08:10", "11:30"]);
    expect(first).toMatchObject({ days: 1, driver: "سائق 111" });
    const second = work.vehicles.find((item) => item.plate === "222")!;
    expect(second.minutes).toBe(25 + back(day, "09:25"));
    expect(work.totalMinutes).toBe(first.minutes + second.minutes);
    expect(work.avgDayMinutes).toBe(Math.round(work.totalMinutes / 2));
    // مدة رحلة الموعد (متوسط مدة الرحلة) من رحلات النظام أيضًا
    expect(trips[0].minutes).toBe(30 + back(day, "08:40"));
  });

  it("a period adds the days of each vehicle; first and last only for one day", () => {
    const next = "2026-10-05";
    const more = tripsFromSystem([appointment("B1", next)], [request("Q1", "B1", "عودة", "111", [next, "13:00", "13:45"])], fleet, DEFAULT_HOSPITALS, now);
    const work = summarizeTrips([...trips, ...more]).workHours!;
    const vehicle = work.vehicles.find((item) => item.plate === "111")!;
    expect(vehicle.days).toBe(2);
    expect(vehicle.first).toBeNull();
    expect(work.days.filter((item) => item.plate === "111").map((item) => [item.date, clockText(item.first), clockText(item.last)])).toEqual([
      [day, "08:10", "11:30"], [next, "13:00", "13:45"],
    ]);
  });

  it("Excel rows count from the car exit to its entry; old files without exact times count the hours only", () => {
    const row = (plate: string, hour: number, minutes: number, out?: number): TripStat => ({
      date: day, hour, kind: "سيدان", hospitalId: "hgh", place: "مستشفى حمد العام", plate, driver: "سائق", building: "5", minutes, nonMedical: false,
      ...(out !== undefined ? { out, back: out + minutes } : {}),
    });
    const work = summarizeTrips([row("555", 7, 60, 7 * 60 + 15), row("555", 8, 45, 8 * 60), row("666", 9, 50)]).workHours!;
    // 07:15–08:15 و08:00–08:45 متداخلتان: 90 دقيقة
    expect(work.vehicles.find((item) => item.plate === "555")).toMatchObject({ minutes: 90, first: 7 * 60 + 15, last: 8 * 60 + 45 });
    expect(work.vehicles.find((item) => item.plate === "666")).toMatchObject({ minutes: 50, first: null, last: null });
    expect(durationText(90)).toBe("1 س 30 د");
    expect(clockText(24 * 60 + 30)).toBe("00:30 (+1)");
  });
});
