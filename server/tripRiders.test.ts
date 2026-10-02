import { describe, expect, it } from "vitest";
import { appointmentsAfterPickup, appointmentsBeforePickup, removeRequestFromTrip, type ClinicAppointment, type VehicleRequest } from "../shared/transport";

const now = new Date("2026-10-02T07:30:00.000Z");
const pickedUp: VehicleRequest = {
  id: "R2", appointmentId: "A2", direction: "ذهاب", status: "تم استلام المريض", notificationMethod: "whatsapp", createdAt: "09:00",
  vehiclePlate: "111", driver: "علي", groupId: "G1", notificationSentAt: "09:05", requestedBy: "4",
  pickedUpAt: "2026-10-02T07:20:00.000Z", etaAt: "2026-10-02T07:50:00.000Z", destLat: 25.2, destLng: 51.5,
  driverArrivedAt: "2026-10-02T07:15:00.000Z", arrivalGps: { lat: 25.2, lng: 51.5, accuracy: 10 }, pickupGps: { lat: 25.2, lng: 51.5, accuracy: 10 },
  pickupCheck: "pending", previousPlate: "222", changeReason: "عطل", changedAt: "2026-10-02T07:00:00.000Z",
};
const appointment = (id: string, status: ClinicAppointment["status"]) => ({ id, status }) as ClinicAppointment;

describe("removing a guest from a running trip", () => {
  it("back to «بانتظار التوزيع» with no car and nothing of the trip, keeping who asked and why", () => {
    const next = removeRequestFromTrip(pickedUp, " لم يركب السيارة ", now);
    expect(next).toEqual({
      id: "R2", appointmentId: "A2", direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "09:00",
      requestedBy: "4", removedFrom: "111", removeReason: "لم يركب السيارة", removedAt: now.toISOString(),
    });
  });

  it("keeps a transfer and a Nurse-only return as they are", () => {
    expect(removeRequestFromTrip({ ...pickedUp, fromAppointmentId: "A1" }, "x", now).fromAppointmentId).toBe("A1");
    expect(removeRequestFromTrip({ ...pickedUp, direction: "عودة", nurseOnly: true }, "x", now).nurseOnly).toBe(true);
  });

  it("the appointment goes back to before the pickup (and forward when a guest joins picked up)", () => {
    const list = [appointment("A1", "مكتملة"), appointment("A2", "تم استلام المريض")];
    expect(appointmentsBeforePickup(list, pickedUp).map((item) => item.status)).toEqual(["مكتملة", "تم طلب السيارة"]);
    expect(appointmentsBeforePickup(list, { ...pickedUp, fromAppointmentId: "A1" }).map((item) => item.status)).toEqual(["تم استلام المريض", "تم طلب السيارة"]);
    expect(appointmentsBeforePickup([appointment("A2", "مكتملة")], { ...pickedUp, direction: "عودة" })[0].status).toBe("طلب عودة");
    // عودة الـ Nurse فقط لا تغيّر موعد الضيف
    expect(appointmentsBeforePickup(list, { ...pickedUp, nurseOnly: true })).toBe(list);
    expect(appointmentsAfterPickup([appointment("A2", "تم طلب السيارة")], pickedUp)[0].status).toBe("تم استلام المريض");
    expect(appointmentsAfterPickup([appointment("A2", "طلب عودة")], { ...pickedUp, direction: "عودة" })[0].status).toBe("مكتملة");
  });
});
