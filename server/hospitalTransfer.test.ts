import { describe, expect, it } from "vitest";
import {
  HOSPITAL_TRANSFER_LABEL,
  appointmentCategory,
  buildDriverMessage,
  directStatus,
  isDirectRequest,
  isHospitalTransfer,
  isTransfer,
  migrateAppointment,
  parseImportedAppointments,
  planDispatch,
  transferSource,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "../shared/transport";
import { neededAt, pickupDetails, tripEndpoints } from "../shared/trips";
import { DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";

// بيانات مصطنعة فقط
const appt = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: "ضيف تجربة", clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "17", apartmentNumber: "4", mobile: "55500000",
  appointmentDate: "2026-10-01", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة", ...extra,
});
const transfer = (id = "T", time = "11:00", extra: Partial<ClinicAppointment> = {}) =>
  appt(id, time, { fromClinic: "مركز الثمامة الصحي", fromHospitalId: "thumama-hc", ...extra });
const request = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}): VehicleRequest => ({
  id, appointmentId, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "08:00", ...extra,
});
const wakra = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "wakra")!;
const thumama = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "thumama-hc")!;

describe("hospital to hospital transfer", () => {
  it("keeps the pickup hospital and is a direct request without approval", () => {
    const loaded = migrateAppointment(transfer())!;
    expect(loaded).toMatchObject({ fromClinic: "مركز الثمامة الصحي", fromHospitalId: "thumama-hc" });
    expect(isHospitalTransfer(loaded)).toBe(true);
    expect(isDirectRequest(loaded)).toBe(true);
    expect(directStatus(loaded)).toBe("تم طلب السيارة");
    expect(directStatus(appt("R", "10:00", { returnOnly: true }))).toBe("طلب عودة");
    expect(appointmentCategory(loaded)).toBe(HOSPITAL_TRANSFER_LABEL);
    // لا يكون طلب عودة ولا رحلة غير طبية في نفس الوقت
    expect(migrateAppointment({ ...transfer(), returnOnly: true })).not.toHaveProperty("fromClinic");
    expect(migrateAppointment(appt("A", "10:00"))).not.toHaveProperty("fromClinic");
  });

  it("starts the outbound trip at the pickup hospital, and the return at the appointment hospital", () => {
    const appointment = transfer();
    const go = tripEndpoints(appointment, "ذهاب");
    expect(go.from).toEqual({ lat: thumama.lat, lng: thumama.lng });
    expect(go.to).toEqual({ lat: wakra.lat, lng: wakra.lng });
    const back = tripEndpoints(appointment, "عودة");
    expect(back.from).toEqual({ lat: wakra.lat, lng: wakra.lng });
    expect(back.to).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    // الوصول المتوقع إلى مستشفى الموعد
    const details = pickupDetails(request("R1", "T"), appointment, DEFAULT_HOSPITALS, new Date("2026-10-01T10:00:00"));
    expect(details).toMatchObject({ destLat: wakra.lat, destLng: wakra.lng });
  });

  it("is needed from the departure time from the pickup hospital", () => {
    const appointment = transfer("T", "11:00");
    const needed = neededAt(request("R1", "T", { createdAt: "07:00" }), appointment);
    // الطريق من الثمامة إلى الوكرة أقل من ساعة، ويبدأ قبل الموعد
    expect(needed < new Date("2026-10-01T11:00:00")).toBe(true);
    expect(needed > new Date("2026-10-01T10:00:00")).toBe(true);
  });

  it("is a transfer for the outbound request only, with the pickup hospital as its source", () => {
    const appointment = transfer();
    expect(isTransfer(request("R1", "T"), appointment)).toBe(true);
    expect(isTransfer(request("R2", "T", { direction: "عودة" }), appointment)).toBe(false);
    expect(isTransfer(request("R3", "A"), appt("A", "10:00"))).toBe(false);
    expect(transferSource(request("R1", "T"), [appointment])).toMatchObject({ clinic: "مركز الثمامة الصحي", hospitalId: "thumama-hc" });
    expect(transferSource(request("R2", "T", { direction: "عودة" }), [appointment])).toBeNull();
    // النقل بين موعدين ما زال من الموعد الأول
    const first = appt("F", "08:00", { clinic: "مركز الثمامة الصحي", hospitalId: "thumama-hc" });
    expect(transferSource(request("R4", "A", { fromAppointmentId: "F" }), [first, appt("A", "10:00")])?.id).toBe("F");
  });

  it("is never grouped with trips from the complex", () => {
    const vehicles: Vehicle[] = [
      { plate: "111", kind: "سيدان", driver: "سائق 1", available: true, driverId: "D-1" },
      { plate: "222", kind: "سيدان", driver: "سائق 2", available: true, driverId: "D-2" },
    ];
    const other = appt("B", "11:00", { patientName: "ضيف ثان", apartmentNumber: "9" });
    const trips = [
      { request: request("R1", "T"), appointment: transfer(), at: new Date("2026-10-01T10:30:00") },
      { request: request("R2", "B"), appointment: other, at: new Date("2026-10-01T10:30:00") },
    ];
    const unitsOf = (list: typeof trips) => {
      const plan = planDispatch(list, vehicles, new Map(), DEFAULT_HOSPITALS);
      return [...plan.assignments, ...plan.waiting].map((trip) => [...trip.requestIds].sort());
    };
    expect(unitsOf(trips)).toEqual(expect.arrayContaining([["R1"], ["R2"]]));
    // نفس الموعدين من المجمع يُجمعان في سيارة واحدة
    const regular = trips.map((trip) => ({ ...trip, appointment: { ...trip.appointment, fromClinic: undefined, fromHospitalId: undefined } }));
    expect(unitsOf(regular)).toEqual([["R1", "R2"]]);
  });

  it("tells the driver to pick the guest up at the first hospital", () => {
    const appointment = transfer();
    const message = buildDriverMessage([{ appointment, request: request("R1", "T"), from: transferSource(request("R1", "T"), [appointment]) }], { plate: "111", driver: "سائق" });
    expect(message).toContain(HOSPITAL_TRANSFER_LABEL);
    expect(message).toContain("من: مركز الثمامة الصحي");
    expect(message).not.toContain("بعد موعده");
    expect(message).toContain("Hospital to hospital transfer");
  });

  it("imports the «من مستشفى» column from the directory", () => {
    const row = { "اسم الضيف": "ضيف تجربة", "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم المبنى": "17", "رقم الشقة": "4", "رقم الموبايل": "55500000",
      "تاريخ الموعد": "2026-10-01", "وقت الموعد": "11:00", "نوع الرحلة": "عادي" };
    const ok = parseImportedAppointments([{ ...row, "من مستشفى": "مركز الثمامة الصحي" }], [], 1, "2026-10-01");
    expect(ok.errors).toEqual([]);
    expect(ok.appointments[0]).toMatchObject({ fromClinic: "مركز الثمامة الصحي", fromHospitalId: "thumama-hc" });
    expect(parseImportedAppointments([{ ...row, "من مستشفى": "مستشفى غير موجود" }], [], 1, "2026-10-01").errors[0]).toContain("غير موجود في دليل المستشفيات");
    expect(parseImportedAppointments([{ ...row, "من مستشفى": "مستشفى الوكرة" }], [], 1, "2026-10-01").errors[0]).toContain("نفس مستشفى الموعد");
    expect(parseImportedAppointments([{ ...row, "من مستشفى": "مركز الثمامة الصحي", "عودة فقط": "نعم" }], [], 1, "2026-10-01").errors[0]).toContain("لا الاثنين");
    expect(parseImportedAppointments([row], [], 1, "2026-10-01").appointments[0]).not.toHaveProperty("fromClinic");
  });
});
