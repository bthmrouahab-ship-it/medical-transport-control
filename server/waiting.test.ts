import { describe, expect, it } from "vitest";
import { activeWaiting, vehicleRestriction, waitingText, type ClinicAppointment, type Vehicle, type VehicleRequest } from "../shared/transport";
import { STOPPED_MINUTES, stoppedVehicles, vehicleLocationState, type StillLocation } from "../shared/trips";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { ROUTE_SERVICE, fetchRoute } from "../shared/roads";

// بيانات مصطنعة فقط
const wakra = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "wakra")!;
const now = new Date("2026-10-01T11:00:00");
const car = (extra: Partial<Vehicle> = {}): Vehicle => ({ plate: "111", kind: "سيدان", driver: "سائق تجربة", phone: "55500001", available: true, driverId: "D-1", ...extra });
const appt = (id: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: "ضيف تجربة", clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "4", mobile: "55500000",
  appointmentDate: "2026-10-01", appointmentAt: "10:00", kind: "عادي", assistance: [], status: "تم استلام المريض", ...extra,
});
const waiting = { place: wakra.name, hospitalId: "wakra", lat: wakra.lat, lng: wakra.lng, appointmentId: "A", since: "2026-10-01T07:30:00.000Z", by: "مشرف تجربة" };
const still = (extra: Partial<StillLocation> = {}): StillLocation => ({
  plate: "111", lat: wakra.lat, lng: wakra.lng, sharing: true, updatedAt: new Date(now.getTime() - 30000).toISOString(),
  stillSince: new Date(now.getTime() - 12 * 60000).toISOString(), driver: "سائق تجربة", ...extra,
});

describe("waiting at the hospital", () => {
  it("is active only on its day", () => {
    expect(activeWaiting(car({ waiting }), now)).toMatchObject({ place: wakra.name });
    expect(activeWaiting(car({ waiting }), new Date("2026-10-02T09:00:00"))).toBeNull();
    expect(activeWaiting(car(), now)).toBeNull();
    expect(waitingText(waiting, "ضيف تجربة")).toContain(`تنتظر في ${wakra.name}`);
  });

  it("keeps the car for its guest only", () => {
    const vehicle = car({ waiting });
    expect(vehicleRestriction(vehicle, { appointments: [appt("A")] }, { now })).toBeNull();
    expect(vehicleRestriction(vehicle, { appointments: [appt("B")] }, { now })).toContain("تنتظر في");
    // بلا ضيف محدد: لا تُرسل حتى ينتهي الانتظار
    const { appointmentId: _id, ...anyone } = waiting;
    expect(vehicleRestriction(car({ waiting: anyone }), { appointments: [appt("A")] }, { now })).toContain("أنهِ الانتظار");
    // انتهى يومه
    expect(vehicleRestriction(vehicle, { appointments: [appt("B")] }, { now: new Date("2026-10-02T09:00:00") })).toBeNull();
  });

  it("stays outside the complex at its place instead of returning", () => {
    const arrived: VehicleRequest = {
      id: "R1", appointmentId: "A", vehiclePlate: "111", direction: "ذهاب", status: "وصلت الوجهة", notificationMethod: "whatsapp",
      createdAt: "08:00", arrivedAt: "2026-10-01T06:00:00.000Z", arrivalSource: "gps",
    };
    // بلا انتظار: عادت تقديريًا إلى المجمع بعد مدة القيادة
    expect(vehicleLocationState("111", [arrived], [appt("A")], DEFAULT_HOSPITALS, now).kind).toBe("inside");
    const state = vehicleLocationState("111", [arrived], [appt("A")], DEFAULT_HOSPITALS, now, null, waiting);
    expect(state).toMatchObject({ kind: "outside", from: wakra.name, position: { lat: wakra.lat, lng: wakra.lng }, canRedirect: true });
    // بالـ GPS داخل المجمع: داخل المجمع
    expect(vehicleLocationState("111", [arrived], [appt("A")], DEFAULT_HOSPITALS, now, { lat: ORIGIN.lat, lng: ORIGIN.lng }, waiting).kind).toBe("inside");
  });
});

describe("car stopped outside the complex", () => {
  it(`alerts after ${STOPPED_MINUTES} minutes without moving, near a known place`, () => {
    const [item] = stoppedVehicles([car()], [still()], DEFAULT_HOSPITALS, now);
    expect(item).toMatchObject({ minutes: 12, driver: "سائق تجربة" });
    expect(item.place?.id).toBe("wakra");
  });

  it("ignores moving, stale, inside, waiting and stopped-service cars", () => {
    expect(stoppedVehicles([car()], [still({ stillSince: new Date(now.getTime() - 9 * 60000).toISOString() })], DEFAULT_HOSPITALS, now)).toEqual([]);
    expect(stoppedVehicles([car()], [still({ updatedAt: new Date(now.getTime() - 5 * 60000).toISOString() })], DEFAULT_HOSPITALS, now)).toEqual([]);
    expect(stoppedVehicles([car()], [still({ sharing: false })], DEFAULT_HOSPITALS, now)).toEqual([]);
    expect(stoppedVehicles([car()], [still({ lat: ORIGIN.lat, lng: ORIGIN.lng })], DEFAULT_HOSPITALS, now)).toEqual([]);
    expect(stoppedVehicles([car({ waiting })], [still()], DEFAULT_HOSPITALS, now, (vehicle) => Boolean(activeWaiting(vehicle, now)))).toEqual([]);
    expect(stoppedVehicles([car({ available: false })], [still()], DEFAULT_HOSPITALS, now)).toEqual([]);
    // بعيدة عن أي مكان معروف: خارج المجمع بلا اسم مكان
    expect(stoppedVehicles([car()], [still({ lat: 25.9, lng: 51.2 })], DEFAULT_HOSPITALS, now)[0].place).toBeNull();
  });
});

describe("road route on the map", () => {
  it("asks the route service and returns the road line as lat,lng", async () => {
    let asked = "";
    const fetcher = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 12345, duration: 1260, geometry: { coordinates: [[51.5, 25.2], [51.52, 25.21], [51.55, 25.25]] } }] }));
    }) as unknown as typeof fetch;
    const route = await fetchRoute([{ lat: 25.2, lng: 51.5 }, { lat: 25.25, lng: 51.55 }], fetcher);
    expect(asked.startsWith(ROUTE_SERVICE)).toBe(true);
    expect(asked).toContain("51.500000,25.200000;51.550000,25.250000");
    expect(asked).toContain("geometries=geojson");
    expect(route).toEqual({ path: [[25.2, 51.5], [25.21, 51.52], [25.25, 51.55]], km: 12.3, minutes: 21 });
    const failing = (async () => new Response(JSON.stringify({ code: "NoRoute" }))) as unknown as typeof fetch;
    await expect(fetchRoute([{ lat: 25.2, lng: 51.5 }, { lat: 25.25, lng: 51.55 }], failing)).rejects.toThrow();
  });
});
