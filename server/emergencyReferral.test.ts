import { describe, expect, it } from "vitest";
import {
  appointmentPickupLabel,
  buildDriverMessage,
  isPriority,
  normalizeAppointmentType,
  pickupLabels,
  routeLabel,
  type ClinicAppointment,
  type VehicleRequest,
} from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

// بيانات مصطنعة فقط
const appointment: ClinicAppointment = {
  id: "A1", patientName: "ضيف تجريبي", clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "17", apartmentNumber: "104",
  mobile: "55500001", appointmentDate: "2026-10-10", appointmentAt: "10:00", kind: "عادي", assistance: [], status: "تم طلب السيارة",
  appointmentType: "تحويلة طارئة",
};
const go: VehicleRequest = { id: "R1", appointmentId: "A1", direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "09:30", vehiclePlate: "111" };

describe("emergency referral: priority, and the car picks the guest up from building 03", () => {
  it("is a preset appointment type with priority", () => {
    expect(normalizeAppointmentType("Emergency referral")).toBe("تحويلة طارئة");
    expect(isPriority(appointment)).toBe(true);
    expect(isPriority({ ...appointment, appointmentType: "مراجعة" })).toBe(false);
  });

  it("the pickup is building 03, not the guest's building", () => {
    expect(appointmentPickupLabel(appointment)).toBe("مبنى 03 (تحويلة طارئة)");
    expect(pickupLabels(appointment).en).toBe("Building 03 (emergency referral)");
    expect(routeLabel(appointment)).toBe("مبنى 03 (تحويلة طارئة) ← مستشفى حمد العام");
    expect(appointmentPickupLabel({ ...appointment, appointmentType: undefined })).toBe("مبنى 17، شقة 104");
  });

  it("the driver message: from building 03 going, back to the guest's home returning", () => {
    const [arabic, english] = buildDriverMessage([{ appointment, request: go }], { plate: "111", driver: "علي" }, DEFAULT_HOSPITALS).split("—————");
    expect(arabic).toContain("من: مبنى 03 (تحويلة طارئة)");
    expect(english).toContain("From: Building 03 (emergency referral)");
    const back = buildDriverMessage([{ appointment, request: { ...go, direction: "عودة" } }], { plate: "111", driver: "علي" }, DEFAULT_HOSPITALS);
    expect(back).toContain("إلى: مبنى 17، شقة 104");
    expect(back).not.toContain("مبنى 03");
  });
});
