import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "../shared/users";
import { DEFAULT_VEHICLES, validateVehicle, vehicleHasActiveTrip, type VehicleRequest } from "../shared/transport";

describe("users", () => {
  it("normalizes usernames case-insensitively", () => {
    expect(normalizeUsername("  Admin ")).toBe("admin");
  });

  it("validates usernames", () => {
    expect(validateUsername("clinic.ahmed")).toBeNull();
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("مستخدم")).not.toBeNull();
    expect(validateUsername(".admin")).not.toBeNull();
  });

  it("requires passwords with letters and digits, at least 8 characters", () => {
    expect(validatePassword("Admin123")).toBeNull();
    expect(validatePassword("short1")).not.toBeNull();
    expect(validatePassword("onlyletters")).not.toBeNull();
    expect(validatePassword("12345678")).not.toBeNull();
  });

  it("generates temporary passwords that satisfy the policy", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(validatePassword(generateTemporaryPassword())).toBeNull();
    }
  });
});

describe("vehicle management", () => {
  it("normalizes and accepts valid vehicle data", () => {
    const result = validateVehicle({ plate: " ١٢٣٤٥٦ ", driver: "  أحمد   علي ", phone: "5512 3456", kind: "باص" }, DEFAULT_VEHICLES);
    expect(result).toEqual({ vehicle: { plate: "123456", driver: "أحمد علي", phone: "55123456", kind: "باص" } });
  });

  it("rejects duplicate plates except for the vehicle being edited", () => {
    const existing = DEFAULT_VEHICLES[0];
    expect(validateVehicle(existing, DEFAULT_VEHICLES)).toHaveProperty("error");
    expect(validateVehicle(existing, DEFAULT_VEHICLES, existing.plate)).toHaveProperty("vehicle");
  });

  it("rejects invalid phone numbers and names", () => {
    expect(validateVehicle({ plate: "999", driver: "علي", phone: "123", kind: "سيدان" }, [])).toHaveProperty("error");
    expect(validateVehicle({ plate: "999", driver: "", phone: "55123456", kind: "سيدان" }, [])).toHaveProperty("error");
  });

  it("detects vehicles on an active trip", () => {
    const requests: VehicleRequest[] = [
      { id: "R1", appointmentId: "A1", vehiclePlate: "943438", direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "call", createdAt: "" },
      { id: "R2", appointmentId: "A2", vehiclePlate: "956479", direction: "ذهاب", status: "تم استلام المريض", notificationMethod: "call", createdAt: "" },
    ];
    expect(vehicleHasActiveTrip("943438", requests)).toBe(true);
    expect(vehicleHasActiveTrip("956479", requests)).toBe(false);
  });
});
