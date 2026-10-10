import { describe, expect, it } from "vitest";
import { COMPLEX_CLINIC, DEFAULT_HOSPITALS, ORIGIN } from "../shared/hospitals";
import { appointmentsAfterPickup, buildDriverMessage, isPriority, migrateAppointment, type ClinicAppointment } from "../shared/transport";
import { pickupDetails, tripEndpoints } from "../shared/trips";
import {
  buildUrgentCase,
  hospitalTransfer,
  hospitalTripOf,
  isNightShift,
  isUrgentClinicCase,
  nightShiftEnd,
  nightShiftStart,
  shiftCases,
  urgentDraftError,
  withUrgentOutcome,
} from "../shared/urgent";

// بيانات مصطنعة
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
const draft = { patientName: "  ضيف   تجريبي ", buildingNumber: "5", apartmentNumber: "12", kind: "عادي" as const, assistance: [] };

describe("night shift: urgent cases from the building to the complex clinic", () => {
  it("works from 10 pm to 6 am only", () => {
    expect(isNightShift(at("2026-10-07", "21:59"))).toBe(false);
    expect(isNightShift(at("2026-10-07", "22:00"))).toBe(true);
    expect(isNightShift(at("2026-10-08", "03:30"))).toBe(true);
    expect(isNightShift(at("2026-10-08", "05:59"))).toBe(true);
    expect(isNightShift(at("2026-10-08", "06:00"))).toBe(false);
    // بداية الشفت الجاري أو الأخير ونهايته
    expect(nightShiftStart(at("2026-10-07", "23:10"))).toEqual(at("2026-10-07", "22:00"));
    expect(nightShiftStart(at("2026-10-08", "03:00"))).toEqual(at("2026-10-07", "22:00"));
    expect(nightShiftStart(at("2026-10-08", "14:00"))).toEqual(at("2026-10-07", "22:00"));
    expect(nightShiftEnd(at("2026-10-07", "22:00"))).toEqual(at("2026-10-08", "06:00"));
  });

  it("checks the form: name, building and apartment, and a valid phone if written", () => {
    expect(urgentDraftError(draft)).toBeNull();
    expect(urgentDraftError({ ...draft, patientName: " " })).toBe("اكتب اسم الضيف");
    expect(urgentDraftError({ ...draft, buildingNumber: "" })).toBe("اكتب رقم المبنى");
    expect(urgentDraftError({ ...draft, apartmentNumber: " " })).toBe("اكتب رقم الشقة");
    expect(urgentDraftError({ ...draft, mobile: "123" })).toBe("رقم الهاتف غير صالح");
    expect(urgentDraftError({ ...draft, mobile: "٥٥٥ ١٢٣٤٥" })).toBeNull();
  });

  it("requests a car now from the building to the complex clinic, owned by the supervisor", () => {
    const now = at("2026-10-07", "23:05");
    const { appointment, request } = buildUrgentCase({ ...draft, mobile: "5551 2345" }, "7", now);
    expect(appointment).toMatchObject({
      patientName: "ضيف تجريبي", clinic: COMPLEX_CLINIC.name, hospitalId: COMPLEX_CLINIC.id, appointmentDate: "2026-10-07", appointmentAt: "23:05",
      status: "تم طلب السيارة", urgent: true, mobile: "55512345",
    });
    expect(appointment.approval).toBeUndefined();
    expect(request).toMatchObject({ appointmentId: appointment.id, direction: "ذهاب", status: "بانتظار التوزيع", createdAt: "23:05", requestedBy: "7" });
    expect(isUrgentClinicCase(appointment)).toBe(true);
    expect(isPriority(appointment)).toBe(true);
    expect(buildUrgentCase(draft, "7", now).appointment.mobile).toBe("-");
  });

  it("drives inside the complex: the clinic is at the complex, so the trip is the minimum margin and the handover, and GPS arrival works", () => {
    const now = at("2026-10-07", "23:05");
    const { appointment, request } = buildUrgentCase(draft, "7", now);
    const ends = tripEndpoints(appointment, "ذهاب", DEFAULT_HOSPITALS);
    expect(ends.to).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(ends.destination).toBe(COMPLEX_CLINIC.name);
    const pickup = pickupDetails(request, appointment, DEFAULT_HOSPITALS, now);
    expect(pickup.destLat).toBeCloseTo(ORIGIN.lat, 5);
    // هامش الطريق 5 دقائق على الأقل، و10 دقائق للتسليم
    expect((Date.parse(pickup.etaAt!) - now.getTime()) / 60000).toBe(15);
    // الكرسي المتحرك: 15 دقيقة للتسليم
    const special = buildUrgentCase({ ...draft, kind: "احتياجات خاصة", assistance: ["كرسي متحرك"] }, "7", now);
    expect((Date.parse(pickupDetails(special.request, special.appointment, DEFAULT_HOSPITALS, now).etaAt!) - now.getTime()) / 60000).toBe(20);
  });

  it("ends with returned or ambulance, or goes to a hospital with the day system (a transfer from the clinic)", () => {
    const now = at("2026-10-08", "00:20");
    const clinicCase = { ...buildUrgentCase(draft, "7", at("2026-10-07", "23:05")).appointment, status: "تم استلام المريض" as const };
    expect(withUrgentOutcome(clinicCase, "returned", "مشرف", now)).toMatchObject({ status: "مكتملة", urgentOutcome: "returned", urgentOutcomeBy: "مشرف", urgentOutcomeAt: now.toISOString() });
    expect(withUrgentOutcome(clinicCase, "ambulance", "مشرف", now).status).toBe("مكتملة");
    expect(withUrgentOutcome(clinicCase, "hospital", "مشرف", now).status).toBe("تم استلام المريض");

    const hospital = DEFAULT_HOSPITALS.find((item) => item.id === "hgh") ?? DEFAULT_HOSPITALS[0];
    const transfer = hospitalTransfer(clinicCase, hospital, now);
    expect(transfer.appointment).toMatchObject({
      patientName: clinicCase.patientName, buildingNumber: "5", apartmentNumber: "12", clinic: hospital.name, hospitalId: hospital.id,
      appointmentDate: "2026-10-08", appointmentAt: "00:20", status: "تم طلب السيارة", urgent: true, urgentFrom: clinicCase.id,
    });
    expect(transfer.request).toMatchObject({ direction: "ذهاب", fromAppointmentId: clinicCase.id, appointmentId: transfer.appointment.id });
    expect(transfer.request.requestedBy).toBeUndefined();
    expect(hospitalTransfer(clinicCase, hospital, now, "7").request.requestedBy).toBe("7");
    // من العيادة (موقع المجمع) إلى المستشفى
    const ends = tripEndpoints(transfer.appointment, "ذهاب", DEFAULT_HOSPITALS, clinicCase);
    expect(ends.from).toEqual({ lat: ORIGIN.lat, lng: ORIGIN.lng });
    expect(ends.to).toEqual({ lat: hospital.lat, lng: hospital.lng });
    // استلام الضيف من العيادة ينهي الحالة فيها (كالموعد الأول في النقل)
    const after = appointmentsAfterPickup([clinicCase, transfer.appointment], { ...transfer.request, status: "تم استلام المريض" });
    expect(after.map((item) => item.status)).toEqual(["مكتملة", "تم استلام المريض"]);
    expect(hospitalTripOf(clinicCase, [clinicCase, transfer.appointment])?.id).toBe(transfer.appointment.id);
  });

  it("keeps the urgent fields when loading, and lists the shift's cases (and any open one)", () => {
    const clinicCase = withUrgentOutcome({ ...buildUrgentCase(draft, "7", at("2026-10-07", "23:05")).appointment, status: "تم استلام المريض" }, "ambulance", "مشرف");
    const loaded = migrateAppointment(JSON.parse(JSON.stringify(clinicCase)))!;
    expect(loaded).toMatchObject({ urgent: true, hospitalId: COMPLEX_CLINIC.id, urgentOutcome: "ambulance", urgentOutcomeBy: "مشرف" });
    expect(migrateAppointment({ ...clinicCase, urgent: false, urgentOutcome: "ambulance" })).not.toHaveProperty("urgentOutcome");

    const older = { ...buildUrgentCase(draft, "7", at("2026-10-06", "23:00")).appointment, id: "OLD", status: "مكتملة" as const };
    const stillOpen = { ...buildUrgentCase(draft, "7", at("2026-10-06", "23:30")).appointment, id: "OPEN" };
    const regular = { ...clinicCase, id: "REG", urgent: undefined, hospitalId: "hgh" } as ClinicAppointment;
    const list = shiftCases([older, stillOpen, clinicCase, regular], at("2026-10-08", "01:00"));
    expect(list.map((item) => item.id)).toEqual([clinicCase.id, "OPEN"]);
  });

  it("tells the driver it is urgent, with the clinic in both languages", () => {
    const now = at("2026-10-07", "23:05");
    const { appointment, request } = buildUrgentCase({ ...draft, mobile: "55512345" }, "7", now);
    const message = buildDriverMessage([{ appointment, request }], { plate: "111", driver: "سائق" }, DEFAULT_HOSPITALS);
    expect(message.split("\n")[0]).toBe("🚨 حالة مستعجلة");
    expect(message).toContain(`إلى: ${COMPLEX_CLINIC.name}`);
    expect(message).toContain("🚨 URGENT case");
    expect(message).toContain(`To: ${COMPLEX_CLINIC.nameEn}`);
  });
});
