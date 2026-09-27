import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { suggestReturnRedirects, vehicleLocationState } from "../shared/trips";
import type { ClinicAppointment, Vehicle, VehicleRequest } from "../shared/transport";

const alkhor = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "alkhor")!;
const wakra = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "wakra")!;
const hgh = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "hgh")!;
// الخميس 11:00 (خارج وقت الذروة)
const arrived = new Date(2026, 8, 24, 11, 0);
const minutes = (count: number) => new Date(arrived.getTime() + count * 60000);

const appointment = (id: string, hospitalId: string, clinic: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic, hospitalId, buildingNumber: "12", apartmentNumber: "4", mobile: "55123456",
  appointmentDate: "2026-09-24", appointmentAt: "10:00", kind: "عادي", assistance: [], status: "تم استلام المريض", ...extra,
});
const outboundToKhor: VehicleRequest = {
  id: "R-OUT", appointmentId: "A-KHOR", vehiclePlate: "111", driver: "علي", direction: "ذهاب", status: "وصلت الوجهة",
  notificationMethod: "whatsapp", createdAt: "09:00", pickedUpAt: minutes(-60).toISOString(), etaAt: arrived.toISOString(),
  arrivedAt: arrived.toISOString(), arrivalSource: "gps", destLat: alkhor.lat, destLng: alkhor.lng,
};
const appointments = [appointment("A-KHOR", "alkhor", "مستشفى الخور"), appointment("A-HGH", "hgh", "مستشفى حمد العام"), appointment("A-WAKRA", "wakra", "مستشفى الوكرة")];

describe("vehicle place: on a trip, available inside or outside the complex", () => {
  it("is outside after reaching the hospital, and back inside after the drive home", () => {
    const outside = vehicleLocationState("111", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(5));
    expect(outside.kind).toBe("outside");
    if (outside.kind !== "outside") return;
    expect(outside.from).toBe("مستشفى الخور");
    expect(outside.canRedirect).toBe(true);
    const drive = (outside.backAt.getTime() - arrived.getTime()) / 60000;
    expect(drive).toBeGreaterThan(30);
    // بعد أكثر من نصف مدة العودة: لا يُوجَّه
    const halfway = vehicleLocationState("111", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(Math.ceil(drive / 2) + 1));
    expect(halfway.kind === "outside" && halfway.canRedirect).toBe(false);
    // بعد مدة العودة: داخل المجمع تقديريًا
    expect(vehicleLocationState("111", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(drive + 1)).kind).toBe("inside");
    // مع GPS قرب المجمع: داخل المجمع مباشرة
    expect(vehicleLocationState("111", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(5), { lat: ORIGIN.lat + 0.001, lng: ORIGIN.lng }).kind).toBe("inside");
    // مع GPS قطعت أكثر من نصف المسافة: خارج المجمع ولا تُوجَّه
    const near = { lat: ORIGIN.lat + (alkhor.lat - ORIGIN.lat) * 0.3, lng: ORIGIN.lng + (alkhor.lng - ORIGIN.lng) * 0.3 };
    const gpsState = vehicleLocationState("111", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(5), near);
    expect(gpsState.kind === "outside" && !gpsState.canRedirect && gpsState.source === "gps").toBe(true);
  });

  it("is on a trip while dispatched, and inside after a return trip or with no trips", () => {
    const dispatched = { ...outboundToKhor, status: "تم إرسال السيارة" as const, arrivedAt: undefined, arrivalSource: undefined };
    expect(vehicleLocationState("111", [dispatched], appointments, DEFAULT_HOSPITALS, minutes(5)).kind).toBe("trip");
    const back = { ...outboundToKhor, id: "R-BACK", direction: "عودة" as const, arrivedAt: minutes(30).toISOString() };
    expect(vehicleLocationState("111", [outboundToKhor, back], appointments, DEFAULT_HOSPITALS, minutes(31)).kind).toBe("inside");
    expect(vehicleLocationState("222", [outboundToKhor], appointments, DEFAULT_HOSPITALS, minutes(5)).kind).toBe("inside");
  });

  it("directs an outside car to the nearest guest waiting to return, only if it is closer than the complex", () => {
    const car = (plate: string, kind: Vehicle["kind"] = "سيدان"): Vehicle => ({ plate, driver: plate, phone: "1", kind, available: true });
    // السيارة 111 خرجت من الخور قبل 5 دقائق؛ و333 عادت من الوكرة للتو
    const fromWakra = { ...outboundToKhor, id: "R-W", appointmentId: "A-WAKRA", vehiclePlate: "333", destLat: wakra.lat, destLng: wakra.lng };
    const requests = [outboundToKhor, fromWakra];
    const states = new Map(["111", "222", "333"].map((plate) => [plate, vehicleLocationState(plate, requests, appointments, DEFAULT_HOSPITALS, minutes(5))]));
    const waiting = (id: string, extra: Partial<ClinicAppointment> = {}) => ({
      request: { ...outboundToKhor, id: `RET-${id}`, appointmentId: id, direction: "عودة" as const, status: "بانتظار التوزيع" as const, vehiclePlate: undefined, arrivedAt: undefined },
      appointment: { ...appointments.find((item) => item.id === id)!, ...extra },
    });
    const redirects = suggestReturnRedirects([waiting("A-KHOR"), waiting("A-HGH")], [car("111"), car("222"), car("333")], states);
    const byGuest = Object.fromEntries(redirects.map((item) => [item.appointment.id, item.vehicle.plate]));
    // ضيف الخور تأخذه السيارة التي في الخور؛ وحمد العام أقرب إلى المجمع من سيارة الوكرة فلا توجيه
    expect(byGuest).toEqual({ "A-KHOR": "111" });
    // بعد 5 دقائق من الخروج صارت على بعد بضعة كيلومترات من الخور
    expect(redirects[0].distanceKm).toBeLessThan(10);
    // ضيف احتياجات خاصة لا تُوجَّه إليه سيارة عادية
    expect(suggestReturnRedirects([waiting("A-KHOR", { kind: "احتياجات خاصة" })], [car("111")], states)).toEqual([]);
  });
});
