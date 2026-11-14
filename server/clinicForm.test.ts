import { describe, expect, it } from "vitest";
import { isMinor, type Guest } from "../shared/guests";
import {
  appointmentTypeText,
  buildDriverMessage,
  destinationLabels,
  escortLocked,
  migrateAppointment,
  needsSameDayReason,
  sameDayReasonValid,
  normalizeAppointmentType,
  parseImportedAppointments,
  withMinorEscort,
  type ClinicAppointment,
  type VehicleRequest,
} from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

// بيانات مصطنعة فقط (لا تُرفع بيانات الضيوف الحقيقية إلى المستودع)
const guests: Guest[] = [
  { id: "G-1", name: "ضيف بالغ", nameEn: "ADULT GUEST", buildingNumber: "17", apartmentNumber: "104", mobile: "55500001", gender: "ذكر" },
  { id: "G-2", name: "ضيف صغير", nameEn: "YOUNG GUEST", buildingNumber: "18", apartmentNumber: "201", mobile: "55500002", gender: "أنثى", minor: true },
  { id: "G-3", name: "ضيف بلا اسم إنجليزي", buildingNumber: "19", apartmentNumber: "301", mobile: "55500003", gender: "ذكر" },
];
const row = (name: string, extra: Record<string, unknown> = {}) => ({
  "اسم الضيف أو الرقم": name, "اسم العيادة أو المستشفى": "مستشفى حمد العام", "رقم الموبايل": "", "تاريخ الموعد": "2026-10-04",
  "وقت الموعد": "09:00", "نوع الرحلة": "عادي", ...extra,
});
const importRows = (rows: Record<string, unknown>[]) => parseImportedAppointments(rows, [], 1, "2026-10-03", DEFAULT_HOSPITALS, guests);

describe("guest under 18: an escort is required unless a nurse goes with them", () => {
  it("knows a minor from the sync flag or from the age", () => {
    expect(isMinor(guests[1])).toBe(true);
    expect(isMinor({ age: 17 })).toBe(true);
    expect(isMinor({ age: 18 })).toBe(false);
    expect(isMinor(guests[0])).toBe(false);
    expect(isMinor(undefined)).toBe(false);
  });

  it("adds the escort automatically, and only a nurse makes it removable", () => {
    expect(withMinorEscort([], true)).toEqual(["يحتاج مرافق"]);
    expect(withMinorEscort(["كرسي متحرك"], true)).toEqual(["يحتاج مرافق", "كرسي متحرك"]);
    // مع Nurse: المرافق اختياري
    expect(withMinorEscort(["يحتاج Nurse"], true)).toEqual(["يحتاج Nurse"]);
    expect(escortLocked(["يحتاج مرافق"], true)).toBe(true);
    expect(escortLocked(["يحتاج مرافق", "يحتاج Nurse"], true)).toBe(false);
    // البالغ بلا تغيير
    const adult: ClinicAppointment["assistance"] = [];
    expect(withMinorEscort(adult, false)).toBe(adult);
    expect(escortLocked([], false)).toBe(false);
  });

  it("the Excel import adds the escort for a minor without a nurse", () => {
    const { appointments, errors } = importRows([
      row("ضيف صغير"),
      row("YOUNG GUEST", { "وقت الموعد": "11:00", "احتياجات الضيف": "يحتاج Nurse" }),
      row("ضيف بالغ"),
    ]);
    expect(errors).toEqual([]);
    expect(appointments.map((appointment) => appointment.assistance)).toEqual([["يحتاج مرافق"], ["يحتاج Nurse"], []]);
  });
});

describe("appointment type (optional)", () => {
  it("keeps the preset types in Arabic and other types as written", () => {
    expect(normalizeAppointmentType("Dental")).toBe("أسنان");
    expect(normalizeAppointmentType("Emergency referral")).toBe("تحويلة طارئة");
    expect(appointmentTypeText("تحويلة طارئة", "en")).toBe("Emergency referral");
    expect(normalizeAppointmentType(" مراجعة ")).toBe("مراجعة");
    expect(normalizeAppointmentType("فحص نظر")).toBe("فحص نظر");
    expect(normalizeAppointmentType("N/A")).toBe("");
    expect(normalizeAppointmentType(undefined)).toBe("");
    expect(normalizeAppointmentType("x".repeat(80))).toHaveLength(60);
  });

  it("shows preset types in English in the English interface", () => {
    expect(appointmentTypeText("علاج طبيعي", "en")).toBe("Physiotherapy");
    expect(appointmentTypeText("علاج طبيعي", "ar")).toBe("علاج طبيعي");
    expect(appointmentTypeText("فحص نظر", "en")).toBe("فحص نظر");
    expect(appointmentTypeText(undefined, "en")).toBe("");
  });

  it("is read from the Excel column and kept when the appointment is loaded", () => {
    const { appointments } = importRows([row("ضيف بالغ", { "نوع الموعد": "Lab tests" }), row("ضيف بالغ", { "وقت الموعد": "12:00" })]);
    expect(appointments[0].appointmentType).toBe("تحاليل");
    expect("appointmentType" in appointments[1]).toBe(false);
    expect(migrateAppointment({ ...appointments[0] })?.appointmentType).toBe("تحاليل");
    expect(migrateAppointment({ ...appointments[1] })).not.toHaveProperty("appointmentType");
  });
});

describe("English names for the English interface and the driver", () => {
  const [appointment] = importRows([row("ضيف بالغ")]).appointments;
  const request: VehicleRequest = { id: "R1", appointmentId: appointment.id, direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "08:30" };

  it("names the hospital in English from the directory", () => {
    expect(destinationLabels(appointment, DEFAULT_HOSPITALS)).toEqual({ ar: "مستشفى حمد العام", en: "Hamad General Hospital" });
  });

  it("the English half of the driver message uses the guest's English name", () => {
    const message = buildDriverMessage([{ appointment, request }], { plate: "111", driver: "علي" }, DEFAULT_HOSPITALS, guests);
    const [arabic, english] = message.split("—————");
    expect(arabic).toContain("الضيف: ضيف بالغ");
    expect(english).toContain("Guest: ADULT GUEST");
    expect(english).not.toContain("ضيف بالغ");
    // بلا قائمة الضيوف، أو ضيف بلا اسم إنجليزي: الاسم كما في الموعد
    expect(buildDriverMessage([{ appointment, request }], { plate: "111", driver: "علي" }).split("—————")[1]).toContain("Guest: ضيف بالغ");
    const [plain] = importRows([row("ضيف بلا اسم إنجليزي")]).appointments;
    expect(buildDriverMessage([{ appointment: plain, request: { ...request, appointmentId: plain.id } }], { plate: "111", driver: "علي" }, DEFAULT_HOSPITALS, guests))
      .toContain("Guest: ضيف بلا اسم إنجليزي");
  });
});

describe("same-day booking needs a reason", () => {
  const today = "2026-10-03";
  const base = { appointmentDate: today };

  it("asks for it for a medical appointment added for today or moved to today", () => {
    expect(needsSameDayReason(base, undefined, today)).toBe(true);
    expect(needsSameDayReason({ appointmentDate: "2026-10-04" }, undefined, today)).toBe(false);
    // نُقل من الغد إلى اليوم، أو موعد اليوم يُعدَّل (القديم بلا سبب لا يُطلب له)
    expect(needsSameDayReason(base, { appointmentDate: "2026-10-04" }, today)).toBe(true);
    expect(needsSameDayReason(base, { appointmentDate: today }, today)).toBe(false);
  });

  it("does not ask for return-only, hospital transfer, emergency referral or non-medical trips", () => {
    expect(needsSameDayReason({ ...base, returnOnly: true }, undefined, today)).toBe(false);
    expect(needsSameDayReason({ ...base, fromClinic: "مركز الثمامة الصحي" }, undefined, today)).toBe(false);
    expect(needsSameDayReason({ ...base, appointmentType: "تحويلة طارئة" }, undefined, today)).toBe(false);
    expect(needsSameDayReason({ ...base, category: "غير طبية" }, undefined, today)).toBe(false);
  });

  it("refuses a same-day Excel row without the reason and keeps the reason it was given", () => {
    const missing = importRows([row("ضيف بالغ", { "تاريخ الموعد": today })]);
    expect(missing.appointments).toHaveLength(0);
    expect(missing.errors[0]).toContain("سبب حجز الموعد في نفس اليوم");
    const given = importRows([row("ضيف بالغ", { "تاريخ الموعد": today, "سبب الحجز في نفس اليوم": "موعد جديد من المستشفى" })]);
    expect(given.errors).toEqual([]);
    expect(given.appointments[0].sameDayReason).toBe("موعد جديد من المستشفى");
    // موعد الغد بلا سبب يُقبل
    expect(importRows([row("ضيف بالغ")]).errors).toEqual([]);
  });

  it("keeps the reason when the appointment syncs, and a reason needs at least three letters", () => {
    expect(migrateAppointment({ id: "A", patientName: "ضيف", clinic: "مستشفى حمد العام", appointmentDate: today, appointmentAt: "09:00", sameDayReason: "موعد طارئ" })?.sameDayReason).toBe("موعد طارئ");
    expect(sameDayReasonValid("  ")).toBe(false);
    expect(sameDayReasonValid("سبب")).toBe(true);
  });
});
