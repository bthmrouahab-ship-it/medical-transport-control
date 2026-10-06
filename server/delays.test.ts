import { describe, expect, it } from "vitest";
import { bookingOf, requestTiming, serviceHours, summarizeTrips, tripsFromSystem, type ServiceEvent } from "../shared/stats";
import { appointmentDateTime, type ClinicAppointment, type Vehicle, type VehicleRequest } from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

const day = "2026-10-05";
const at = (time: string, date = day) => appointmentDateTime({ appointmentDate: date, appointmentAt: time });
const iso = (time: string, date = day) => at(time, date).toISOString();
const appointment = (id: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: day, appointmentAt: "11:00", kind: "عادي", assistance: [], status: "تم استلام المريض", ...extra,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}) => ({
  id, appointmentId, direction: "ذهاب", status: "تم استلام المريض", notificationMethod: "whatsapp", createdAt: "10:00", vehiclePlate: "111", driver: "سائق", ...extra,
}) as VehicleRequest;
const fleet: Pick<Vehicle, "plate" | "kind">[] = [{ plate: "111", kind: "سيدان" }, { plate: "900", kind: "باص" }];

describe("appointments scheduled ahead or on the same day", () => {
  it("compares the day the appointment was added with its day", () => {
    expect(bookingOf({ appointmentDate: day, addedAt: iso("21:00", "2026-10-04") })).toBe("scheduled");
    expect(bookingOf({ appointmentDate: day, addedAt: iso("07:30") })).toBe("sameDay");
    // سُجّل قبل حفظ وقت التسجيل
    expect(bookingOf({ appointmentDate: day })).toBeNull();
  });
});

describe("delay stages of a car trip", () => {
  it("dispatch late: the car was sent long after it was needed", () => {
    // طُلبت الساعة 10:00 والموعد 11:00 (الانطلاق اللازم قبله)، وأُرسلت 10:40
    const timing = requestTiming(request("R1", "A1", { notificationSentAt: "10:40" }), appointment("A1"), DEFAULT_HOSPITALS)!;
    expect(timing.dispatchWait).toBeGreaterThanOrEqual(15);
    expect(timing.stages).toContain("dispatch");
    // أُرسلت في وقتها
    expect(requestTiming(request("R2", "A1", { notificationSentAt: "10:05" }), appointment("A1"), DEFAULT_HOSPITALS)!.stages).not.toContain("dispatch");
  });

  it("at pickup: car late to the building, and the guest late coming down", () => {
    const timing = requestTiming(request("R1", "A1", {
      notificationSentAt: "10:00", pickupArrivedAt: iso("10:20"), pickedUpAt: iso("10:35"),
    }), appointment("A1", { appointmentAt: "12:00" }), DEFAULT_HOSPITALS)!;
    expect(timing).toMatchObject({ toPickup: 20, guestWait: 15 });
    expect(timing.stages).toEqual(["arrival", "guest"]);
  });

  it("return trip: the car came from the complex; GPS shows the driver arrived before registering", () => {
    const back = (extra: Partial<VehicleRequest>) => request("R1", "A1", { direction: "عودة", createdAt: "13:00", notificationSentAt: "13:02", ...extra });
    const fromComplex = requestTiming(back({ driverArrivedAt: iso("13:30"), pickedUpAt: iso("13:33") }), appointment("A1"), DEFAULT_HOSPITALS)!;
    expect(fromComplex.stages).toEqual(["fromComplex"]);
    const unregistered = requestTiming(back({ nearPickupAt: iso("13:20"), pickupArrivedAt: iso("13:31"), pickedUpAt: iso("13:33") }), appointment("A1"), DEFAULT_HOSPITALS)!;
    expect(unregistered).toMatchObject({ unregistered: 11 });
    expect(unregistered.stages).toEqual(["unregistered"]);
    // نفى مشرف المبنى ما سجّله السائق: لا يُحسب وقته
    expect(requestTiming(back({ driverArrivedAt: iso("13:05"), arrivalCheck: "denied" }), appointment("A1"), DEFAULT_HOSPITALS)!.toPickup).toBeNull();
  });

  it("arrival at the appointment after its time (recorded arrival only)", () => {
    const late = requestTiming(request("R1", "A1", { notificationSentAt: "10:00", pickedUpAt: iso("10:30"), arrivedAt: iso("11:10"), arrivalSource: "gps" }), appointment("A1"), DEFAULT_HOSPITALS)!;
    expect(late.lateToAppointment).toBe(10);
    const estimated = requestTiming(request("R1", "A1", { notificationSentAt: "10:00", pickedUpAt: iso("10:30"), arrivedAt: iso("11:10"), arrivalSource: "estimate" }), appointment("A1"), DEFAULT_HOSPITALS)!;
    expect(estimated.lateToAppointment).toBeNull();
  });
});

describe("summary: completed trips by direction, booking and delays", () => {
  const appointments = [
    appointment("A1", { addedAt: iso("20:00", "2026-10-04"), appointmentAt: "12:00" }),
    appointment("A2", { addedAt: iso("08:00") }),
    appointment("A3", { status: "بانتظار طلب السيارة" }),
  ];
  const requests = [
    request("R1", "A1", { notificationSentAt: "10:00", pickupArrivedAt: iso("10:20"), pickedUpAt: iso("10:35") }),
    request("R1b", "A1", { direction: "عودة", createdAt: "14:00", notificationSentAt: "14:05" }),
    request("R2", "A2", { createdAt: "09:00", notificationSentAt: "09:05", pickupArrivedAt: iso("09:10"), pickedUpAt: iso("09:12") }),
  ];
  const summary = summarizeTrips(tripsFromSystem(appointments, requests, fleet, DEFAULT_HOSPITALS, at("18:00")));

  it("counts go and return trips, and scheduled and same-day appointments", () => {
    expect(summary.completedTrips).toBe(2);
    expect(summary.directions).toEqual({ go: 2, back: 1, unknown: 0 });
    expect(summary.booking).toEqual({ scheduled: 1, sameDay: 1, unknown: 1 });
  });

  it("late trips by stage with their average minutes", () => {
    expect(summary.delays).toMatchObject({ trips: 3, late: 1, withoutArrival: 1 });
    expect(summary.delays!.stages.find((item) => item.stage === "arrival")).toEqual({ stage: "arrival", trips: 1, avgMinutes: 20 });
    expect(summary.delays!.stages.find((item) => item.stage === "guest")).toEqual({ stage: "guest", trips: 1, avgMinutes: 15 });
  });
});

describe("time in service and the assigned buses", () => {
  const event = (time: string, plate: string, extra: Partial<ServiceEvent> = {}, date = day): ServiceEvent => ({
    at: iso(time, date), plate, kind: plate === "900" ? "باص" : "سيدان", available: true, hasDriver: true, busRole: "", driver: "سائق", ...extra,
  });
  const events = [
    // في الخدمة قبل الفترة، ثم أُوقفت 14:00
    event("06:00", "111", {}, "2026-10-04"),
    event("14:00", "111", { available: false }),
    // باص العيادة: من موقوف إلى «باص العيادة» 07:00 حتى 15:30
    event("05:00", "900", { available: false }, "2026-10-04"),
    event("07:00", "900", { busRole: "clinic" }),
    event("15:30", "900", { available: false, busRole: "clinic" }),
  ];

  it("minutes in service per vehicle and day, from the state before the period", () => {
    const service = serviceHours(events, day, day, at("23:00"));
    expect(service.vehicles.find((item) => item.plate === "111")).toMatchObject({ minutes: 14 * 60, first: 0, last: 14 * 60, days: 1 });
    expect(service.vehicles.find((item) => item.plate === "900")).toMatchObject({ minutes: 8 * 60 + 30, first: 7 * 60, busRoles: ["clinic"] });
    // سيارة ما زالت في الخدمة تُحسب حتى الآن
    const running = serviceHours([event("08:00", "111")], day, day, at("10:00"));
    expect(running.totalMinutes).toBe(120);
    // بلا سائق: خارج الخدمة
    expect(serviceHours([event("08:00", "111", { hasDriver: false })], day, day, at("10:00")).totalMinutes).toBe(0);
  });

  it("an assigned bus in service counts as a working vehicle on that day", () => {
    const service = serviceHours(events, day, day, at("23:00"));
    const trips = tripsFromSystem([appointment("A1")], [request("R1", "A1", { notificationSentAt: "10:30" })], fleet, DEFAULT_HOSPITALS, at("18:00"));
    const summary = summarizeTrips(trips, DEFAULT_HOSPITALS, null, service.days);
    expect(summary.workingVehicles).toMatchObject({ total: 2, roleBuses: [{ plate: "900", busRole: "clinic" }] });
    expect(summary.workingVehicles!.byKind.find((item) => item.kind === "باص")?.vehicles).toBe(1);
    expect(summary.daily[0].vehicles).toBe(2);
  });
});
