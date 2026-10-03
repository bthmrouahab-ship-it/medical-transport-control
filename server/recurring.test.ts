import { describe, expect, it } from "vitest";
import { RECURRING_DEFAULT_DAYS, RECURRING_MAX_DAYS, addDays, appointmentDateTime, recurringDates, stoppableSeriesTrips, type ClinicAppointment, type VehicleRequest } from "../shared/transport";
import { neededAt, requestedAt } from "../shared/trips";

const trip = (id: string, date: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: "ضيف", clinic: "جامعة الدوحة للعلوم والتكنولوجيا", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: date, appointmentAt: "07:30", kind: "عادي", assistance: [], status: "تم طلب السيارة", category: "غير طبية", seriesId: "SER-1", ...extra,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}) => ({
  id, appointmentId, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "15:00", ...extra,
}) as VehicleRequest;

describe("recurring non-medical trips", () => {
  it("Sunday to Thursday between two dates (the Saturday start is skipped)", () => {
    // 2026-10-03 سبت، و2026-10-04 أحد
    expect(recurringDates("2026-10-03", "2026-10-17", RECURRING_DEFAULT_DAYS)).toEqual([
      "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
      "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    ]);
    expect(recurringDates("2026-10-04", "2026-10-10", [1, 3])).toEqual(["2026-10-05", "2026-10-07"]);
    // عبر نهاية الشهر
    expect(recurringDates("2026-10-29", "2026-11-02", [0, 1])).toEqual(["2026-11-01", "2026-11-02"]);
  });

  it("refuses an end before the start or longer than three months", () => {
    expect(recurringDates("2026-10-10", "2026-10-09", RECURRING_DEFAULT_DAYS)).toBeNull();
    expect(recurringDates("2026-10-04", addDays("2026-10-04", RECURRING_MAX_DAYS + 1), RECURRING_DEFAULT_DAYS)).toBeNull();
    expect(recurringDates("2026-10-04", addDays("2026-10-04", RECURRING_MAX_DAYS), RECURRING_DEFAULT_DAYS)?.length).toBeGreaterThan(60);
  });

  it("a trip booked on an earlier day needs the car from its departure, not from the booking time", () => {
    const appointment = trip("A1", "2026-10-05");
    // حُجزت يوم 03-10 الساعة 15:00: لا تُعامل كأنها طُلبت 15:00 يوم الرحلة
    const booked = request("R1", "A1", { requestedOn: "2026-10-03" });
    expect(requestedAt(booked, appointment)).toBeNull();
    // وقت الانطلاق قبل 07:30 (مدة الطريق)، لا 15:00 بعد الموعد
    expect(neededAt(booked, appointment).getTime()).toBeLessThan(appointmentDateTime(appointment).getTime());
    // طلب في نفس اليوم كما كان
    expect(requestedAt(request("R2", "A1"), appointment)).toEqual(appointmentDateTime({ appointmentDate: "2026-10-05", appointmentAt: "15:00" }));
    expect(neededAt(request("R2", "A1"), appointment)).toEqual(appointmentDateTime({ appointmentDate: "2026-10-05", appointmentAt: "15:00" }));
  });

  it("stopping the series: only the coming trips not dispatched yet", () => {
    const appointments = [
      trip("A1", "2026-10-04"), trip("A2", "2026-10-05"), trip("A3", "2026-10-06"), trip("A4", "2026-10-07"),
      trip("A5", "2026-10-08", { status: "ملغي" }), trip("B1", "2026-10-06", { seriesId: "SER-2" }),
    ];
    const requests = [request("R1", "A1"), request("R2", "A2"), request("R3", "A3", { status: "تم إرسال السيارة", vehiclePlate: "111" }), request("R4", "A4"), request("R5", "A5"), request("Q1", "B1")];
    expect(stoppableSeriesTrips(appointments, requests, "SER-1", "2026-10-05").map((item) => item.appointment.id)).toEqual(["A2", "A4"]);
    expect(stoppableSeriesTrips(appointments, requests, "SER-1", "2026-10-04").map((item) => item.requests.map((r) => r.id))).toEqual([["R1"], ["R2"], ["R4"]]);
    // رحلة لم يطلب لها مشرف المبنى سيارة بعد (بلا طلب): تُوقف أيضًا
    const waiting = [...appointments, trip("A6", "2026-10-11", { status: "بانتظار طلب السيارة" })];
    expect(stoppableSeriesTrips(waiting, requests, "SER-1", "2026-10-05").map((item) => [item.appointment.id, item.requests.length])).toEqual([["A2", 1], ["A4", 1], ["A6", 0]]);
  });
});
