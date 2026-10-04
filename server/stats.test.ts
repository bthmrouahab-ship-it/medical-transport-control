import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, legacyTrips, matchesFilter, summarizeTrips, tripsFromSystem, type TripStat } from "../shared/stats";
import type { HistorySummary } from "../shared/history";
import type { ClinicAppointment, Vehicle, VehicleRequest } from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

const fleet: Pick<Vehicle, "plate" | "kind">[] = [
  { plate: "111", kind: "سيدان" }, { plate: "222", kind: "سيدان" }, { plate: "333", kind: "احتياجات خاصة" }, { plate: "444", kind: "باص" },
];
const appointment = (id: string, date: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hamad-general", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: date, appointmentAt: "09:00", kind: "عادي", assistance: [], status: "مكتملة", ...extra,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, direction: "ذهاب" | "عودة", vehiclePlate?: string) => ({
  id, appointmentId, direction, status: vehiclePlate ? "وصلت الوجهة" : "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:00",
  ...(vehiclePlate ? { vehiclePlate, driver: `سائق ${vehiclePlate}`, notificationSentAt: `${appointmentId}T08:10:00` } : {}),
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
