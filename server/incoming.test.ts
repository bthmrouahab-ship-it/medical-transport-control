import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";
import { incomingCars } from "../shared/trips";
import type { ClinicAppointment, VehicleRequest } from "../shared/transport";

const hospital = (id: string) => DEFAULT_HOSPITALS.find((item) => item.id === id)!;
const appointment = (id: string, hospitalId: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic: hospital(hospitalId).name, hospitalId, buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-10-05", appointmentAt: "09:00", kind: "عادي", assistance: [], status: "تم استلام المريض", ...extra,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, direction: "ذهاب" | "عودة", extra: Partial<VehicleRequest> = {}) => ({
  id, appointmentId, direction, status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:00", ...extra,
}) as VehicleRequest;

describe("a car going to the place of a return trip", () => {
  const now = new Date("2026-10-05T07:00:00.000Z");
  const appointments = [
    appointment("R", "hgh", { status: "طلب عودة" }),
    appointment("G1", "hgh"), appointment("G2", "heart"), appointment("G3", "wakra"), appointment("G4", "hgh"), appointment("G5", "hgh"),
  ];
  const back = request("RQ", "R", "عودة");
  const requests = [
    back,
    // أُرسلت إلى حمد العام (نفس المكان) ولم تستلم ضيفها بعد
    request("Q1", "G1", "ذهاب", { status: "تم إرسال السيارة", vehiclePlate: "111", driver: "سائق 1", notificationSentAt: "09:50" }),
    // استلمت ضيفها إلى مستشفى القلب (نفس المجمع الطبي، قريب) وتصل 10:20
    request("Q2", "G2", "ذهاب", { status: "تم استلام المريض", vehiclePlate: "222", driver: "سائق 2", etaAt: "2026-10-05T07:20:00.000Z" }),
    // إلى الوكرة: بعيدة
    request("Q3", "G3", "ذهاب", { status: "تم إرسال السيارة", vehiclePlate: "333", notificationSentAt: "09:50" }),
    // وصلت حمد العام بالفعل: ليست ذاهبة (يقترحها «توجيه السيارة» إن كانت متاحة خارج المجمع)
    request("Q4", "G4", "ذهاب", { status: "وصلت الوجهة", vehiclePlate: "444", arrivedAt: "2026-10-05T06:50:00.000Z" }),
    // سيارة عودة أخرى في المستشفى نفسه: ليست ذاهبة إليه
    request("Q5", "G5", "عودة", { status: "تم إرسال السيارة", vehiclePlate: "555", notificationSentAt: "09:55" }),
  ];

  it("lists the cars on their way to the same or a nearby place, nearest first", () => {
    const cars = incomingCars({ request: back, appointment: appointments[0] }, requests, appointments, DEFAULT_HOSPITALS, now);
    expect(cars.map((car) => car.plate)).toEqual(["111", "222"]);
    expect(cars[0]).toMatchObject({ distanceKm: 0, etaAt: null, driver: "سائق 1", destination: "مستشفى حمد العام" });
    expect(cars[1].distanceKm).toBeGreaterThan(0);
    expect(cars[1].distanceKm).toBeLessThanOrEqual(3);
    expect(cars[1].etaAt?.toISOString()).toBe("2026-10-05T07:20:00.000Z");
  });

  it("only for a trip that starts at a hospital", () => {
    const going = request("GQ", "G1", "ذهاب");
    expect(incomingCars({ request: going, appointment: appointments[1] }, requests, appointments, DEFAULT_HOSPITALS, now)).toEqual([]);
    // النقل بين موعدين يبدأ من مستشفى الموعد الأول
    const transfer = request("T", "G3", "ذهاب", { fromAppointmentId: "R" });
    expect(incomingCars({ request: transfer, appointment: appointments[3], from: appointments[0] }, requests, appointments, DEFAULT_HOSPITALS, now).map((car) => car.plate)).toEqual(["111", "222"]);
  });

  it("once the going car arrives it is not counted any more", () => {
    const arrived = requests.map((item) => (item.id === "Q2" ? { ...item, status: "وصلت الوجهة" as const, arrivedAt: "2026-10-05T07:18:00.000Z" } : item));
    expect(incomingCars({ request: back, appointment: appointments[0] }, arrived, appointments, DEFAULT_HOSPITALS, now).map((car) => car.plate)).toEqual(["111"]);
  });
});
