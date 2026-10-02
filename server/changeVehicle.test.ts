import { describe, expect, it } from "vitest";
import { canChangeVehicle, changeRequestVehicle, migrateRequest, type VehicleRequest } from "../shared/transport";

const now = new Date("2026-10-02T07:30:00.000Z");
const sent: VehicleRequest = {
  id: "R1", appointmentId: "A1", direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "09:00",
  vehiclePlate: "111", driver: "علي", notificationSentAt: "09:05", requestedBy: "4", groupId: "G1",
};
const car = { plate: "222", driver: "حسن" };

describe("changing the vehicle after it was sent", () => {
  it("only for a sent trip that has not reached its destination", () => {
    expect(canChangeVehicle(sent)).toBe(true);
    expect(canChangeVehicle({ ...sent, status: "وصلت السيارة" })).toBe(true);
    expect(canChangeVehicle({ ...sent, status: "تم استلام المريض" })).toBe(true);
    expect(canChangeVehicle({ ...sent, status: "وصلت الوجهة" })).toBe(false);
    expect(canChangeVehicle({ ...sent, status: "بانتظار التوزيع", vehiclePlate: undefined })).toBe(false);
  });

  it("before pickup: back to «تم إرسال السيارة» with the new car, the old driver's arrival record cleared", () => {
    const arrived: VehicleRequest = { ...sent, status: "وصلت السيارة", driverArrivedAt: "2026-10-02T07:20:00.000Z", arrivalGps: { lat: 25.2, lng: 51.5, accuracy: 10 }, arrivalCheck: "pending" };
    const next = changeRequestVehicle(arrived, car, " عطل في السيارة ", now);
    expect(next).toMatchObject({ vehiclePlate: "222", driver: "حسن", status: "تم إرسال السيارة", previousPlate: "111", changeReason: "عطل في السيارة", changedAt: now.toISOString(), groupId: "G1", requestedBy: "4" });
    expect(next.notificationSentAt).toMatch(/^\d\d:\d\d$/);
    expect(next.driverArrivedAt).toBeUndefined();
    expect(next.arrivalGps).toBeUndefined();
    expect(next.arrivalCheck).toBeUndefined();
  });

  it("after pickup: the new car continues the trip (status and ETA kept)", () => {
    const pickedUp: VehicleRequest = { ...sent, status: "تم استلام المريض", pickedUpAt: "2026-10-02T07:10:00.000Z", etaAt: "2026-10-02T07:45:00.000Z", driverArrivedAt: "2026-10-02T07:05:00.000Z" };
    const next = changeRequestVehicle(pickedUp, car, "حادث", now);
    expect(next).toMatchObject({ vehiclePlate: "222", status: "تم استلام المريض", pickedUpAt: pickedUp.pickedUpAt, etaAt: pickedUp.etaAt, driverArrivedAt: pickedUp.driverArrivedAt, previousPlate: "111", changeReason: "حادث" });
  });

  it("the change survives loading the request again", () => {
    const next = changeRequestVehicle(sent, car, "تأخر السيارة", now);
    expect(migrateRequest(JSON.parse(JSON.stringify(next)))).toMatchObject({ previousPlate: "111", changeReason: "تأخر السيارة", changedAt: now.toISOString() });
  });
});
