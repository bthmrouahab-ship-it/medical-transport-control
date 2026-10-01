import { describe, expect, it } from "vitest";
import { NURSE_APARTMENT, NURSE_BUILDING, isNurse, parseNurseRows, planGuestImport, tableRows, type GuestRecord } from "../shared/guests";
import { buildDriverMessage, parseImportedAppointments, type ClinicAppointment, type VehicleRequest } from "../shared/transport";

// بيانات مصطنعة فقط (لا تُرفع بيانات الممرضات الحقيقية إلى المستودع)
// ملف الممرضات «نموذج إضافة بيانات»: عنوان النموذج وسطر فارغ قبل العناوين
const sheet: unknown[][] = [
  ["نموزج اضافة بيانات", "", "", "", "", "", "", ""],
  ["", "", "", "", "", "", "", ""],
  ["الرقم", "الاسم كامل عربي", "الاسم انجليزي", "الرقم الشخصي", "رقم الجوال", "الوظيفة", "الجنسية", "الجهة/المؤسسة"],
  [1, "ممرضة أولى", "FIRST NURSE", 11111111111, 70000001, "REGISTERED NURSE", "بلد", "شركة أ"],
  [2, "ممرضة ثانية", "SECOND NURSE", 22222222222, 70000002, "REGISTERED NURSE", "بلد", "شركة ب"],
  [3, "", "", "", "", "", "", ""],
  [4, "ممرضة أولى", "DUPLICATE", 33333333333, 70000003, "REGISTERED NURSE", "بلد", "شركة أ"],
];

describe("nurse list", () => {
  it("finds the header row after the form title and reads each nurse into building 03, apartment 001", () => {
    const table = tableRows(sheet);
    expect(table.firstRow).toBe(4);
    const { guests, errors } = parseNurseRows(table.rows, table.firstRow);
    expect(guests).toHaveLength(2);
    expect(guests[0]).toEqual({ id: "", name: "ممرضة أولى", nameEn: "FIRST NURSE", mobile: "70000001", buildingNumber: NURSE_BUILDING, apartmentNumber: NURSE_APARTMENT, nurse: true, organization: "شركة أ" });
    // الرقم الشخصي والجنسية لا يُحفظان
    expect(JSON.stringify(guests)).not.toContain("11111111111");
    expect(JSON.stringify(guests)).not.toContain("بلد");
    // الصف الفارغ يُتجاوز، والاسم المكرر يُذكر برقم صفه في Excel
    expect(errors).toEqual(["الصف 7: الاسم مكرر (كما في الصف 4)"]);
  });

  it("keeps guests and nurses apart when a list is uploaded again", () => {
    const guest: GuestRecord = { id: "G-1", name: "ضيف", buildingNumber: "17", apartmentNumber: "1" };
    const nurse: GuestRecord = { id: "N-1", name: "ممرضة أولى", buildingNumber: "03", apartmentNumber: "001", nurse: true };
    const oldNurse: GuestRecord = { id: "N-2", name: "ممرضة سابقة", buildingNumber: "03", apartmentNumber: "001", nurse: true };
    const { guests: nurses } = parseNurseRows(tableRows(sheet).rows);
    const plan = planGuestImport(nurses, [guest, nurse, oldNurse], 1);
    // الممرضة الموجودة تبقى برقمها، والجديدة برقم يبدأ بـ N، ومن ليست في الملف ممرضة فقط (لا الضيف)
    expect(plan.guests.map((item) => item.id)).toEqual(["N-1", "N-1-2"]);
    expect(plan.missing.map((item) => item.id)).toEqual(["N-2"]);
    // ملف الضيوف لا يرى الممرضات
    const guestPlan = planGuestImport([{ id: "", name: "ضيف آخر", buildingNumber: "17", apartmentNumber: "2" }], [guest, nurse], 1);
    expect(guestPlan.missing.map((item) => item.id)).toEqual(["G-1"]);
    expect(isNurse(nurse)).toBe(true);
    expect(isNurse(guest)).toBe(false);
  });

  it("an appointment for a nurse carries the nurse flag, and the driver message names her as a nurse", () => {
    const guests: GuestRecord[] = [{ id: "N-1", name: "ممرضة أولى", nameEn: "FIRST NURSE", buildingNumber: "03", apartmentNumber: "001", mobile: "70000001", nurse: true }];
    const result = parseImportedAppointments([{
      "اسم الضيف أو الرقم": "FIRST NURSE", "اسم العيادة أو المستشفى": "مستشفى الوكرة", "رقم الموبايل": "", "تاريخ الموعد": "2026-10-02",
      "وقت الموعد": "09:00", "نوع الرحلة": "عادي", "الجنس": "أنثى",
    }], [], 1, "2026-10-01", undefined, guests);
    expect(result.errors).toEqual([]);
    expect(result.appointments[0]).toMatchObject({ guestId: "N-1", patientName: "ممرضة أولى", buildingNumber: "03", apartmentNumber: "001", nurse: true });
    const appointment: ClinicAppointment = result.appointments[0];
    const request: VehicleRequest = { id: "R1", appointmentId: appointment.id, direction: "ذهاب", status: "تم إرسال السيارة", notificationMethod: "whatsapp", createdAt: "08:30" };
    const message = buildDriverMessage([{ appointment, request }], { plate: "111", driver: "علي" });
    expect(message).toContain("الممرضة");
    expect(message).toContain("Nurse");
  });
});
