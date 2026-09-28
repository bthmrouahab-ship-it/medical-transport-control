import { describe, expect, it } from "vitest";
import { CHECK_MINUTES, checkReplyChanges, confirmPendingChecks, driverCheck, pendingCheck } from "../shared/driverChecks";
import { migrateRequest, type VehicleRequest } from "../shared/transport";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 7, 0) + minutes * 60000);
const base: VehicleRequest = {
  id: "R1", appointmentId: "A1", vehiclePlate: "943438", driver: "خرم", direction: "ذهاب", status: "وصلت السيارة",
  notificationMethod: "whatsapp", createdAt: "09:30", requestedBy: "7",
  driverArrivedAt: at(0).toISOString(), arrivalGps: { lat: 25.2287, lng: 51.5688, accuracy: 12 }, arrivalCheck: "pending",
};

describe("building supervisor checks on what the driver recorded", () => {
  it("waits for a reply for 5 minutes, then counts as accepted", () => {
    expect(pendingCheck(base, at(1))).toMatchObject({ kind: "arrival", state: "pending", secondsLeft: (CHECK_MINUTES - 1) * 60 });
    expect(pendingCheck(base, at(CHECK_MINUTES))).toBeNull();
    expect(driverCheck(base, "arrival", at(CHECK_MINUTES + 1))?.state).toBe("auto");
    // لم يسجّله السائق: لا شيء يُسأل عنه
    expect(driverCheck({ ...base, arrivalCheck: undefined }, "arrival", at(1))).toBeNull();
  });

  it("asks about the pickup first, and confirming it confirms the arrival too", () => {
    const picked: VehicleRequest = { ...base, status: "تم استلام المريض", pickedUpAt: at(2).toISOString(), etaAt: at(30).toISOString(), pickupCheck: "pending" };
    expect(pendingCheck(picked, at(3))?.kind).toBe("pickup");
    const { set, unset } = checkReplyChanges(picked, "pickup", "confirmed", "مشرف المبنى 17", at(3));
    expect(set).toMatchObject({ pickupCheck: "confirmed", arrivalCheck: "confirmed", pickupCheckBy: "مشرف المبنى 17", arrivalCheckBy: "مشرف المبنى 17" });
    expect(set.status).toBeUndefined();
    expect(unset).toEqual([]);
    // بعد الرد على الاستلام وحده يبقى سؤال الوصول إن كانت مهلته باقية
    expect(pendingCheck({ ...picked, pickupCheck: "confirmed" }, at(3))?.kind).toBe("arrival");
  });

  it("denying moves the trip back one step", () => {
    expect(checkReplyChanges(base, "arrival", "denied", "م", at(1)).set).toMatchObject({ arrivalCheck: "denied", status: "تم إرسال السيارة" });
    const picked: VehicleRequest = { ...base, status: "تم استلام المريض", pickedUpAt: at(2).toISOString(), etaAt: at(30).toISOString(), destLat: 25.17, destLng: 51.6, pickupGps: base.arrivalGps, pickupCheck: "pending" };
    const denied = checkReplyChanges(picked, "pickup", "denied", "م", at(3));
    expect(denied.set).toMatchObject({ pickupCheck: "denied", status: "وصلت السيارة" });
    expect(denied.unset).toEqual(expect.arrayContaining(["pickedUpAt", "etaAt", "destLat", "destLng", "pickupGps"]));
    // الوصول لا يُسأل عنه بعد عودة الطلب إلى «تم إرسال السيارة»
    expect(pendingCheck({ ...base, status: "تم إرسال السيارة" }, at(1))).toBeNull();
  });

  it("a supervisor who moves the status forward confirms what is pending", () => {
    expect(confirmPendingChecks(base, "م", at(1))).toMatchObject({ arrivalCheck: "confirmed", arrivalCheckBy: "م" });
    expect(confirmPendingChecks({ ...base, arrivalCheck: "denied" }, "م", at(1))).toEqual({});
  });

  it("keeps the driver fields when reading stored requests", () => {
    const stored = migrateRequest({ ...base, arrivalCheck: "bogus", pickupGps: { lat: "x" } });
    expect(stored?.driverArrivedAt).toBe(base.driverArrivedAt);
    expect(stored?.arrivalGps).toEqual(base.arrivalGps);
    expect(stored?.arrivalCheck).toBeUndefined();
    expect(stored && "pickupGps" in stored).toBe(false);
  });
});
