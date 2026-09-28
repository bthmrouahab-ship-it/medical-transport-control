import { describe, expect, it } from "vitest";
import { buildDriverMessage, migrateAppointment, parseImportedAppointments, planDispatch, type ClinicAppointment, type VehicleRequest } from "../shared/transport";

const appointment = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: id, apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-09-28", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة", ...extra,
});
const request = (appointmentId: string): VehicleRequest => ({ id: `R-${appointmentId}`, appointmentId, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "09:00" });

describe("cancer priority, gender and appointment export", () => {
  it("gives the car to the cancer case first", () => {
    // مستشفيات متباعدة حتى لا تُجمع
    const early = appointment("10", "09:00", { clinic: "مستشفى الخور", hospitalId: "alkhor" });
    const cancer = appointment("20", "11:00", { cancer: true, clinic: "مستشفى سدرة", hospitalId: "sidra" });
    const plan = planDispatch([early, cancer].map((item) => ({ request: request(item.id), appointment: item })), [{ plate: "111", driver: "علي", phone: "1", kind: "سيدان", available: true }]);
    expect(plan.assignments.map((item) => item.appointments[0].id)).toEqual(["20"]);
    expect(plan.waiting.map((item) => item.appointments[0].id)).toEqual(["10"]);
  });

  it("keeps gender and the cancer flag, and names the gender in the driver message", () => {
    const migrated = migrateAppointment({ ...appointment("30", "10:00"), gender: "أنثى", cancer: true })!;
    expect(migrated.gender).toBe("أنثى");
    expect(migrated.cancer).toBe(true);
    expect(migrateAppointment({ ...appointment("31", "10:00"), gender: "x", cancer: "yes" })).not.toHaveProperty("cancer");
    const message = buildDriverMessage([{ appointment: migrated, request: request("30") }], { plate: "111", driver: "علي" });
    expect(message).toContain("الضيف: ضيف 30 (أنثى)");
    expect(message).toContain("Guest: ضيف 30 (female)");
    expect(message).not.toMatch(/سرطان|cancer/i);
  });

  it("re-imports the exported file: one column per option", () => {
    const exported = {
      "رقم الموعد": "APT-1", "اسم الضيف أو الرقم": "ضيف", "الجنس": "أنثى", "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم المبنى": "17", "رقم الشقة": "3",
      "رقم الموبايل": "55500000", "تاريخ الموعد": "2026-09-28", "وقت الموعد": "10:00", "نوع الرحلة": "عادي",
      "يحتاج مرافق": "لا", "يحتاج Nurse": "نعم", "كرسي متحرك": "نعم", "حالة سرطان": "نعم", "الحالة": "بانتظار طلب السيارة",
    };
    const [imported] = parseImportedAppointments([exported], [], 1, "2026-09-28").appointments;
    expect(imported.assistance).toEqual(["يحتاج Nurse", "كرسي متحرك"]);
    expect(imported.gender).toBe("أنثى");
    expect(imported.cancer).toBe(true);
    // عمود «CANCER» في ملفات المواعيد، والجنس بالإنجليزية
    const [other] = parseImportedAppointments([{ ...exported, "حالة سرطان": "CANCER", "الجنس": "M", "يحتاج Nurse": "", "كرسي متحرك": "لا" }], [], 1, "2026-09-28").appointments;
    expect([other.cancer, other.gender, other.assistance]).toEqual([true, "ذكر", []]);
  });
});
