import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { arrivalsOn, estimateTravelMinutes, isRushHour, pickupDetails, tripPhase, vehicleAvailability } from "../shared/trips";
import type { ClinicAppointment, VehicleRequest } from "../shared/transport";

const hgh = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "hgh")!;
const alkhor = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "alkhor")!;
// الجمعة 11 صباحًا: خارج الذروة
const quiet = new Date(2026, 8, 25, 11, 0);
// الأحد 7:30 صباحًا: ذروة
const rush = new Date(2026, 8, 27, 7, 30);

const appointment: ClinicAppointment = {
  id: "APT-1", patientName: "مريض", clinic: "Hamad General Hospital", buildingNumber: "17", apartmentNumber: "3", mobile: "55555555",
  appointmentDate: "2026-09-27", appointmentAt: "08:00", hospitalId: "hgh", kind: "عادي", assistance: [], status: "تم استلام المريض",
};
const pickedUp: VehicleRequest = {
  id: "REQ-1", appointmentId: "APT-1", vehiclePlate: "943438", driver: "خرم", direction: "ذهاب", status: "تم استلام المريض",
  notificationMethod: "whatsapp", createdAt: "07:00",
};

describe("trip arrival estimate", () => {
  it("grows with distance, rush hour, and extra patients, rounded to 5 minutes", () => {
    const near = estimateTravelMinutes(ORIGIN, hgh, quiet);
    const far = estimateTravelMinutes(ORIGIN, alkhor, quiet);
    expect(near % 5).toBe(0);
    expect(far).toBeGreaterThan(near);
    expect(isRushHour(rush)).toBe(true);
    expect(isRushHour(quiet)).toBe(false);
    expect(estimateTravelMinutes(ORIGIN, hgh, rush)).toBeGreaterThanOrEqual(near);
    expect(estimateTravelMinutes(ORIGIN, hgh, quiet, { extraStops: 2, special: true })).toBe(near + 15);
  });

  it("records the destination and arrival time when the patient is picked up", () => {
    const details = pickupDetails(pickedUp, appointment, DEFAULT_HOSPITALS, quiet);
    expect(details.destLat).toBeCloseTo(hgh.lat, 5);
    const minutes = (Date.parse(details.etaAt!) - quiet.getTime()) / 60000;
    expect(minutes).toBe(estimateTravelMinutes(ORIGIN, hgh, quiet));
    // العودة إلى المجمع
    expect(pickupDetails({ direction: "عودة" }, appointment, DEFAULT_HOSPITALS, quiet).destLat).toBeCloseTo(ORIGIN.lat, 5);
    // وجهة غير معروفة: مدة ثابتة بلا إحداثيات
    const unknown = pickupDetails(pickedUp, { ...appointment, clinic: "الجامعة", hospitalId: undefined, category: "غير طبية" }, DEFAULT_HOSPITALS, quiet);
    expect(unknown.destLat).toBeUndefined();
  });

  it("frees the car at the estimated time without GPS, but waits for GPS arrival when tracked", () => {
    const trip: VehicleRequest = { ...pickedUp, ...pickupDetails(pickedUp, appointment, DEFAULT_HOSPITALS, quiet) };
    const before = new Date(quiet.getTime() + 5 * 60000);
    const after = new Date(Date.parse(trip.etaAt!) + 60000);
    expect(tripPhase(trip, before).kind).toBe("toDestination");
    expect(vehicleAvailability("943438", [trip], before).busy).toBe(true);
    expect(tripPhase(trip, after)).toMatchObject({ kind: "arrived", source: "estimate" });
    expect(vehicleAvailability("943438", [trip], after).busy).toBe(false);
    // مع GPS: تبقى جارية (متأخرة) حتى يكتشف الخادم الوصول
    expect(tripPhase(trip, after, true)).toMatchObject({ kind: "toDestination", late: true, tracking: true });
    expect(tripPhase({ ...trip, status: "وصلت الوجهة", arrivedAt: after.toISOString(), arrivalSource: "gps" }, after, true)).toMatchObject({ kind: "arrived", source: "gps" });
    // طلب قديم بلا وقت متوقع لا يحجز السيارة
    expect(vehicleAvailability("943438", [pickedUp], before).busy).toBe(false);
  });

  it("lists today's arrivals newest first, without legacy requests or trips still on the road", () => {
    const trip: VehicleRequest = { ...pickedUp, ...pickupDetails(pickedUp, appointment, DEFAULT_HOSPITALS, quiet) };
    const eta = new Date(Date.parse(trip.etaAt!));
    const later = new Date(eta.getTime() + 30 * 60000);
    const gps: VehicleRequest = { ...trip, id: "REQ-2", status: "وصلت الوجهة", arrivedAt: new Date(eta.getTime() - 5 * 60000).toISOString(), arrivalSource: "gps" };
    const estimated = { ...trip, id: "REQ-3" };
    const date = "2026-09-25";
    expect(arrivalsOn(date, [pickedUp, gps, estimated], later).map((item) => [item.request.id, item.source])).toEqual([["REQ-3", "estimate"], ["REQ-2", "gps"]]);
    // السيارة المتابَعة بـ GPS لا تُعتبر واصلة تقديريًا قبل مهلة التأخر
    expect(arrivalsOn(date, [estimated], later, () => true)).toEqual([]);
    expect(arrivalsOn("2026-09-26", [gps, estimated], later)).toEqual([]);
  });
});
