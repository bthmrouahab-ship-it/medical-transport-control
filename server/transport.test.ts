import { describe, expect, it } from "vitest";
import {
  appointmentPickupLabel,
  assignVehicle,
  buildDriverMessage,
  calculateTripGroupingScore,
  canRequestVehicle,
  migrateAppointment,
  parseImportedAppointments,
  buildTripGroups,
  findUnrequestedMatches,
  requestWindow,
  suggestJoinDispatched,
  whatsappLink,
  whatsappNumber,
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
  appointmentDate: "2026-09-24",
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
    const beforeAppointment = new Date(2026, 8, 24, 8, 0);
    expect(canRequestVehicle(undefined)).toBe(false);
    expect(canRequestVehicle(appointment, request, beforeAppointment)).toBe(false);
    expect(canRequestVehicle(appointment, undefined, beforeAppointment)).toBe(true);
  });

  it("closes vehicle requests 30 minutes after the appointment time", () => {
    expect(canRequestVehicle(appointment, undefined, new Date(2026, 8, 24, 9, 30))).toBe(true);
    expect(canRequestVehicle(appointment, undefined, new Date(2026, 8, 24, 9, 31))).toBe(false);
    expect(requestWindow(appointment, new Date(2026, 8, 24, 9, 10)).minutesLeft).toBe(20);
    // تعديل العيادة لوقت الموعد يعيد فتح الطلب
    const edited = { ...appointment, appointmentAt: "11:00" };
    expect(canRequestVehicle(edited, undefined, new Date(2026, 8, 24, 9, 31))).toBe(true);
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
    const message = buildDriverMessage([{ appointment, request }], { plate: "943438", driver: "خرم" });
    expect(message).toContain("مريض 001");
    expect(message).toContain("مبنى 12، شقة 4");
    expect(message).toContain("Building 12, Apt 4");
    expect(message).toContain("Al Wakra Hospital");
    expect(message).toContain("55123456");
    expect(message).toContain("943438");
    expect(message).toContain("Needs escort");
  });

  it("builds WhatsApp links with the Qatar country code", () => {
    expect(whatsappNumber("77712995")).toBe("97477712995");
    expect(whatsappNumber("+974 7771 2995")).toBe("97477712995");
    expect(whatsappLink("77712995", "مرحبا")).toBe("https://wa.me/97477712995?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7");
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
    ], [], 123456789, "2026-09-24");

    expect(result.appointments).toHaveLength(1);
    expect(result.appointments[0]).toMatchObject({
      patientName: "مريض 010",
      buildingNumber: "22",
      apartmentNumber: "8",
      mobile: "55667788",
      appointmentDate: "2026-09-24",
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
    }], [appointment], 1000, appointment.appointmentDate);

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

  it("groups trips to neighbouring hospitals in Hamad Medical City", () => {
    const first: ClinicAppointment = { ...appointment, clinic: "Hamad General Hospital", buildingNumber: "12" };
    const second: ClinicAppointment = { ...appointment, id: "APT-3", clinic: "Bone and joint center", buildingNumber: "30", appointmentAt: "09:10" };
    const score = calculateTripGroupingScore(first, second);
    expect(score.sameDestination).toBe(false);
    expect(score.nearbyDestination).toBe(true);
    expect(score.zone).toBe("مدينة حمد الطبية");
    expect(suggestTripGroups([first, second])[0].reason).toContain("متجاورة");
  });

  it("does not group appointments on different days", () => {
    const tomorrow: ClinicAppointment = { ...appointment, id: "APT-4", appointmentDate: "2026-09-25" };
    expect(suggestTripGroups([appointment, tomorrow])).toHaveLength(0);
  });

  it("migrates legacy appointments without a date to today and links the hospital", () => {
    const migrated = migrateAppointment({ id: "X", patientName: "p", clinic: "مستشفى سدرة / مجمع الثمامة", appointmentAt: "10:00" });
    expect(migrated?.appointmentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(migrated?.hospitalId).toBe("sidra");
  });

  it("builds groups of three for the same destination but never mixes directions or exceeds seats", () => {
    const make = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({ ...appointment, id, appointmentAt: time, ...extra });
    const trips = [make("A", "09:00"), make("B", "09:10"), make("C", "09:15"), make("D", "09:20")];
    const groups = buildTripGroups(trips.map((item) => ({ appointment: item, direction: "ذهاب" as const })));
    expect(groups[0].appointmentIds).toHaveLength(3);
    expect(groups).toHaveLength(1);
    const special = buildTripGroups([make("S1", "09:00", { kind: "احتياجات خاصة" }), make("S2", "09:05", { kind: "احتياجات خاصة" }), make("S3", "09:10", { kind: "احتياجات خاصة" })]
      .map((item) => ({ appointment: item, direction: "ذهاب" as const })));
    expect(Math.max(...special.map((group) => group.appointmentIds.length))).toBe(2);
    const mixed = buildTripGroups([{ appointment: make("X", "09:00"), direction: "ذهاب" }, { appointment: make("Y", "09:05"), direction: "عودة" }]);
    expect(mixed).toHaveLength(0);
  });

  it("suggests joining a car already on its way to the same destination", () => {
    const sent: VehicleRequest = { ...request, id: "R-SENT", status: "تم إرسال السيارة", vehiclePlate: "943438" };
    const second: ClinicAppointment = { ...appointment, id: "APT-9", appointmentAt: "09:15" };
    const newRequest: VehicleRequest = { ...request, id: "R-NEW", appointmentId: "APT-9", vehiclePlate: undefined };
    const joins = suggestJoinDispatched([{ request: newRequest, appointment: second }], [{ request: sent, appointment }]);
    expect(joins).toEqual([expect.objectContaining({ requestId: "R-NEW", plate: "943438" })]);
  });

  it("alerts about an unrequested appointment to the same destination at the same time", () => {
    const now = new Date(2026, 8, 24, 8, 0);
    const waiting: ClinicAppointment = { ...appointment, id: "APT-W", appointmentAt: "09:20", buildingNumber: "30" };
    const other: ClinicAppointment = { ...appointment, id: "APT-X", clinic: "مستشفى حمد العام", appointmentAt: "09:05" };
    const matches = findUnrequestedMatches([appointment, waiting, other], [request], undefined, now);
    expect(matches.map((match) => match.appointment.id)).toEqual(["APT-W"]);
    expect(matches[0]).toMatchObject({ gapMinutes: 20, sameDestination: true });
  });
});
