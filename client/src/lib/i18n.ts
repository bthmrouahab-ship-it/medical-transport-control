import { useState } from "react";
import type { AppointmentKind, AppointmentStatus, AssistanceNeed } from "@shared/transport";

export type Lang = "ar" | "en";

const STORAGE_KEY = "fox_lang";

/** لغة الواجهة (تُحفظ على هذا الجهاز فقط). */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ar";
    } catch {
      return "ar";
    }
  });
  return [lang, (next) => {
    setLang(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* التخزين غير متاح */
    }
  }];
}

const STATUS_EN: Record<AppointmentStatus, string> = {
  "بانتظار طلب السيارة": "Awaiting car request",
  "تم طلب السيارة": "Car requested",
  "تم استلام المريض": "Patient picked up",
  "طلب عودة": "Return requested",
  "مكتملة": "Completed",
};
const KIND_EN: Record<AppointmentKind, string> = { "عادي": "Regular", "احتياجات خاصة": "Special needs" };
const NEED_EN: Record<AssistanceNeed, string> = { "يحتاج مرافق": "Needs escort", "كرسي متحرك": "Wheelchair" };

const ar = {
  dir: "rtl" as "rtl" | "ltr",
  workspace: "العيادة",
  title: "مواعيد المرضى",
  template: "تنزيل القالب",
  import: "استيراد Excel",
  importing: "جارٍ الاستيراد",
  add: "إضافة موعد",
  statToday: "مواعيد اليوم",
  statWaiting: "بانتظار السيارة",
  statLinked: "مرتبطة بطلب سيارة",
  list: "المواعيد",
  empty: "لا توجد مواعيد",
  edit: "تعديل",
  delete: "حذف",
  expired: "انتهت مهلة الطلب · عدّل الموعد",
  lockedHint: "لا يمكن التعديل بعد طلب السيارة",
  days: { today: "اليوم", tomorrow: "غدًا", yesterday: "أمس" },
  newTitle: "موعد جديد",
  editTitle: "تعديل الموعد",
  back: "المواعيد",
  patient: "اسم المريض أو الرقم",
  hospital: "المستشفى أو العيادة",
  hospitalHint: "اكتب أو اختر",
  building: "رقم المبنى",
  apartment: "رقم الشقة",
  mobile: "رقم الموبايل",
  date: "تاريخ الموعد",
  time: "وقت الموعد",
  tripType: "نوع الرحلة",
  needs: "احتياجات المريض",
  save: "حفظ الموعد",
  saveChanges: "حفظ التعديلات",
  cancel: "إلغاء",
  pickup: (building: string, apartment: string) => `مبنى ${building}، شقة ${apartment}`,
  status: (status: AppointmentStatus): string => status,
  kind: (kind: AppointmentKind): string => kind,
  need: (need: AssistanceNeed): string => need,
  errIncomplete: "أكمل بيانات المريض والمبنى والشقة والموبايل والموعد",
  errMobile: "أدخل رقم موبايل صحيحًا من 8 إلى 15 رقمًا",
  errPast: (minutes: number) => `وقت الموعد مضى عليه أكثر من ${minutes} دقيقة. أدخل التاريخ والوقت الصحيحين.`,
  errLocked: "لا يمكن تعديل أو حذف موعد مرتبط بطلب سيارة",
  confirmDelete: (name: string) => `هل تريد حذف موعد ${name}؟`,
  saved: "تم تسجيل الموعد",
  updated: "تم تحديث الموعد",
  deleted: "تم حذف الموعد",
  importFound: (count: number) => `تم العثور على ${count} موعد صالح. هل تريد إضافتها؟`,
  imported: (count: number) => `تم استيراد ${count} موعد`,
  skipped: (count: number) => `تم تجاهل ${count} صف غير صالح أو مكرر`,
  importNone: "لم يتم العثور على مواعيد صالحة في الملف",
  importError: "تعذر قراءة الملف. استخدم القالب المعتمد.",
  templateDone: "تم تنزيل القالب",
  templateError: "تعذر إنشاء القالب",
  changePassword: "تغيير كلمة المرور",
  logout: "تسجيل الخروج",
  switchLang: "English",
};

export type ClinicText = typeof ar;

const en: ClinicText = {
  dir: "ltr",
  workspace: "Clinic",
  title: "Patient appointments",
  template: "Download template",
  import: "Import Excel",
  importing: "Importing",
  add: "New appointment",
  statToday: "Today's appointments",
  statWaiting: "Awaiting car",
  statLinked: "Car requested",
  list: "Appointments",
  empty: "No appointments",
  edit: "Edit",
  delete: "Delete",
  expired: "Request window closed · edit appointment",
  lockedHint: "Cannot be changed after a car is requested",
  days: { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" },
  newTitle: "New appointment",
  editTitle: "Edit appointment",
  back: "Appointments",
  patient: "Patient name or number",
  hospital: "Hospital or clinic",
  hospitalHint: "Type or choose",
  building: "Building",
  apartment: "Apartment",
  mobile: "Mobile",
  date: "Date",
  time: "Time",
  tripType: "Trip type",
  needs: "Patient needs",
  save: "Save appointment",
  saveChanges: "Save changes",
  cancel: "Cancel",
  pickup: (building, apartment) => `Building ${building}, Apt ${apartment}`,
  status: (status) => STATUS_EN[status] ?? status,
  kind: (kind) => KIND_EN[kind] ?? kind,
  need: (need) => NEED_EN[need] ?? need,
  errIncomplete: "Complete the patient, building, apartment, mobile and time fields",
  errMobile: "Enter a valid mobile number (8–15 digits)",
  errPast: (minutes) => `The appointment time is more than ${minutes} minutes in the past. Enter the correct date and time.`,
  errLocked: "An appointment linked to a car request cannot be changed or deleted",
  confirmDelete: (name) => `Delete the appointment for ${name}?`,
  saved: "Appointment saved",
  updated: "Appointment updated",
  deleted: "Appointment deleted",
  importFound: (count) => `${count} valid appointments found. Add them?`,
  imported: (count) => `${count} appointments imported`,
  skipped: (count) => `${count} invalid or duplicate rows skipped`,
  importNone: "No valid appointments found in the file",
  importError: "Could not read the file. Use the approved template.",
  templateDone: "Template downloaded",
  templateError: "Could not create the template",
  changePassword: "Change password",
  logout: "Sign out",
  switchLang: "العربية",
};


export const CLINIC_TEXT: Record<Lang, ClinicText> = { ar, en };
