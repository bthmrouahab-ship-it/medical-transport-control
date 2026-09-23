import { describe, expect, it } from "vitest";
import {
  appointmentPickupLabel,
  assignVehicle,
  buildDriverMessage,
  calculateTripGroupingScore,
  canRequestVehicle,
  migrateAppointment,
  parseImportedAppointments,
  suggestTripGroups,
  type ClinicAppointment,
  type VehicleRequest,
} from "../shared/transport";

const appointment: ClinicAppointment = {
  id: "APT-1",
  patientName: "مريض 001",
  clinic: "مستشفى الوكرة",
  buildingNumber: "12",
  apartmentNumber: "4",
  mobile: "55123456",
  appointmentAt: "09:00",
  kind: "عادي",
  assistance: ["يحتاج مرافق"],
  status: "بانتظار طلب السيارة",
};

const request: VehicleRequest = {
  id: "REQ-1",
  appointmentId: "APT-1",
  vehiclePlate: "943438",
  driver: "خرم",
  direction: "ذهاب",
  status: "بانتظار التوزيع",
  notificationMethod: "whatsapp",
  createdAt: "09:01",
};

describe("medical transport rules", () => {
  it("blocks a vehicle request without an appointment", () => {
    expect(canRequestVehicle(undefined)).toBe(false);
    expect(canRequestVehicle(appointment, request)).toBe(false);
    expect(canRequestVehicle(appointment)).toBe(true);
  });

  it("chooses the correct vehicle for normal and special-needs trips", () => {
    const vehicles = [
      { plate: "A", driver: "سيدان", phone: "1", kind: "سيدان" as const, available: true },
      { plate: "B", driver: "خاص", phone: "2", kind: "احتياجات خاصة" as const, available: true },
    ];
    expect(assignVehicle(vehicles, "عادي")?.plate).toBe("A");
    expect(assignVehicle(vehicles, "احتياجات خاصة")?.plate).toBe("B");
  });

  it("builds a driver message with the building, apartment, and mobile", () => {
    const message = buildDriverMessage(appointment, request);
    expect(message).toContain("مريض 001");
    expect(message).toContain("مبنى 12، شقة 4");
    expect(message).toContain("55123456");
    expect(message).toContain("943438");
  });

  it("migrates previously saved appointments without losing their pickup address", () => {
    const migrated = migrateAppointment({
      id: "APT-OLD",
      patientName: "مريض قديم",
      clinic: "مستشفى حمد",
      pickupArea: "الثمامة",
      appointmentAt: "08:15",
      kind: "سيدان",
      notes: "يحتاج مرافقًا وكرسيًا متحركًا",
      status: "بانتظار طلب السيارة",
    });
    expect(migrated).toMatchObject({
      buildingNumber: "الثمامة",
      apartmentNumber: "-",
      mobile: "-",
      kind: "عادي",
      assistance: ["يحتاج مرافق", "كرسي متحرك"],
    });
    expect(migrated && appointmentPickupLabel(migrated)).toBe("مبنى الثمامة، شقة -");
  });

  it("converts valid Arabic Excel rows into appointments and reports invalid rows", () => {
    const result = parseImportedAppointments([
      {
        "اسم المريض أو الرقم": "مريض 010",
        "اسم العيادة أو المستشفى": "مستشفى حمد العام",
        "رقم المبنى": 22,
        "رقم الشقة": 8,
        "رقم الموبايل": "55667788",
        "وقت الموعد": "10:30",
        "نوع الرحلة": "احتياجات خاصة",
        "احتياجات المريض": "يحتاج مرافق، كرسي متحرك",
      },
      {
        "اسم المريض أو الرقم": "مريض ناقص",
        "اسم العيادة أو المستشفى": "مستشفى حمد العام",
      },
    ], [], 123456789);

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      patientName: "مريض 010",
      buildingNumber: "22",
      apartmentNumber: "8",
      mobile: "55667788",
      appointmentAt: "10:30",
      kind: "احتياجات خاصة",
      assistance: ["يحتاج مرافق", "كرسي متحرك"],
      status: "بانتظار طلب السيارة",
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("الصف 3");
  });

  it("rejects duplicate appointments during Excel import", () => {
    const result = parseImportedAppointments([{
      "اسم المريض": appointment.patientName,
      "المستشفى": appointment.clinic,
      "رقم المبنى": appointment.buildingNumber,
      "رقم الشقة": appointment.apartmentNumber,
      "رقم الموبايل": appointment.mobile,
      "وقت الموعد": appointment.appointmentAt,
      "نوع الرحلة": appointment.kind,
    }], [appointment], 1000);

    expect(result.appointments).toHaveLength(0);
    expect(result.errors[0]).toContain("مكرر");
  });

  it("scores close appointments in the same building and suggests grouping them", () => {
    const second: ClinicAppointment = {
      ...appointment,
      id: "APT-2",
      patientName: "مريض 002",
      apartmentNumber: "7",
      appointmentAt: "09:20",
    };
    const score = calculateTripGroupingScore(appointment, second);
    expect(score.score).toBeGreaterThanOrEqual(55);
    expect(score.sameBuilding).toBe(true);
    expect(suggestTripGroups([appointment, second])).toHaveLength(1);
  });
});
