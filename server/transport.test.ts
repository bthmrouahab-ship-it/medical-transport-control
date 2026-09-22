import { describe, expect, it } from "vitest";
import { assignVehicle, buildDriverMessage, canRequestVehicle, type ClinicAppointment, type VehicleRequest } from "../shared/transport";

const appointment: ClinicAppointment = {
  id: "APT-1",
  patientName: "مريض 001",
  clinic: "مستشفى الوكرة",
  pickupArea: "الثمامة",
  appointmentAt: "09:00",
  kind: "سيدان",
  status: "بانتظار طلب السيارة",
};

const request: VehicleRequest = {
  id: "REQ-1",
  appointmentId: "APT-1",
  vehiclePlate: "943438",
  driver: "خرم",
  direction: "ذهاب",
  status: "مطلوب",
  notificationMethod: "whatsapp",
  createdAt: "09:01",
};

describe("medical transport rules", () => {
  it("blocks a vehicle request without an appointment", () => {
    expect(canRequestVehicle(undefined)).toBe(false);
    expect(canRequestVehicle(appointment, request)).toBe(false);
    expect(canRequestVehicle(appointment)).toBe(true);
  });

  it("chooses an accessibility vehicle for a special-needs appointment", () => {
    const vehicle = assignVehicle([
      { plate: "A", driver: "سيدان", phone: "1", kind: "سيدان", available: true },
      { plate: "B", driver: "خاص", phone: "2", kind: "احتياجات خاصة", available: true },
    ], "احتياجات خاصة");
    expect(vehicle?.plate).toBe("B");
  });

  it("builds a driver message from the appointment and request", () => {
    expect(buildDriverMessage(appointment, request)).toContain("مريض 001");
    expect(buildDriverMessage(appointment, request)).toContain("943438");
    expect(buildDriverMessage(appointment, request)).toContain("مستشفى الوكرة");
  });
});
