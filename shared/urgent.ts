import { COMPLEX_CLINIC, type Hospital } from "./hospitals";
import { toWesternDigits } from "./text";
import {
  appointmentDateTime,
  localDateString,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
  type Gender,
  type UrgentOutcome,
  type VehicleRequest,
} from "./transport";

/**
 * شفت الليل (من 10 مساءً إلى 6 صباحًا) بلا مشرف سيارات: مشرف المبنى يطلب سيارة لحالة مستعجلة من المبنى إلى عيادة المجمع
 * (زر يعمل في هذه الساعات فقط)، ومشرف السيارات يرسل السائق من صفحته ويتابع الرحلة كما في
 * النهار (تطبيق السائق والإشعار والـ GPS). بعد وصول الضيف إلى العيادة تنتهي الحالة بإحدى النتائج:
 * - عاد إلى المبنى (عولج في العيادة فقط)، أو ذهب بسيارة الإسعاف: الحالة «مكتملة» وينتهي التتبع.
 * - إلى المستشفى بسيارة المجمع: رحلة من العيادة إلى مستشفى من الدليل (موعد مستعجل جديد urgentFrom وطلب نقل
 *   fromAppointmentId)، يرسل لها مشرف السيارات السائق بنفس نظام النهار، ثم تُطلب العودة من المستشفى كالمعتاد.
 * نفس القيم في api/lib/rules.php.
 */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;
export const NIGHT_SHIFT_TEXT = "من 10 مساءً إلى 6 صباحًا";
export const URGENT_LABEL = "حالة مستعجلة";

/** الآن في شفت الليل (بتوقيت الجهاز، قطر) */
export const isNightShift = (now = new Date()) => now.getHours() >= NIGHT_START_HOUR || now.getHours() < NIGHT_END_HOUR;

/** بداية شفت الليل الجاري، أو الأخير إن كان الوقت نهارًا */
export function nightShiftStart(now = new Date()) {
  const start = new Date(now);
  start.setHours(NIGHT_START_HOUR, 0, 0, 0);
  if (now.getHours() < NIGHT_START_HOUR) start.setDate(start.getDate() - 1);
  return start;
}

/** نهاية شفت الليل الذي بدأ في start */
export function nightShiftEnd(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(NIGHT_END_HOUR, 0, 0, 0);
  return end;
}

export const URGENT_OUTCOMES: { value: UrgentOutcome; label: string; done: string; hint: string }[] = [
  { value: "returned", label: "عاد إلى المبنى", done: "عولج في عيادة المجمع وعاد إلى المبنى", hint: "عولج في العيادة فقط" },
  { value: "ambulance", label: "ذهب بسيارة الإسعاف", done: "نُقل بسيارة الإسعاف", hint: "طُلبت له سيارة إسعاف" },
  { value: "hospital", label: "إلى المستشفى بسيارة المجمع", done: "نُقل إلى المستشفى بسيارة المجمع", hint: "يُرسل السائق بنفس نظام النهار" },
];
export const urgentOutcomeText = (outcome: UrgentOutcome | undefined) => URGENT_OUTCOMES.find((item) => item.value === outcome)?.done ?? "";

/** موعد حالة مستعجلة: إلى عيادة المجمع، أو رحلة المستشفى بعدها */
export const isUrgent = (appointment: Pick<ClinicAppointment, "urgent">) => appointment.urgent === true;
/** الحالة المستعجلة إلى عيادة المجمع (نتيجتها تُسجَّل بعد وصولها) */
export const isUrgentClinicCase = (appointment: Pick<ClinicAppointment, "urgent" | "hospitalId">) =>
  appointment.urgent === true && appointment.hospitalId === COMPLEX_CLINIC.id;
/** الحالة ما زالت مفتوحة: لم تنتهِ ولم تُلغَ */
export const isOpenCase = (appointment: Pick<ClinicAppointment, "status">) => appointment.status !== "مكتملة" && appointment.status !== "ملغي";

/** بيانات الضيف في نموذج الحالة المستعجلة (يكتبها مشرف المبنى أو يختارها من ضيوف المواعيد) */
export type UrgentDraft = {
  patientName: string;
  buildingNumber: string;
  apartmentNumber: string;
  mobile?: string;
  gender?: Gender;
  kind: AppointmentKind;
  assistance: AssistanceNeed[];
};

/** سبب رفض النموذج، أو null */
export function urgentDraftError(draft: UrgentDraft): string | null {
  if (draft.patientName.trim().length < 2) return "اكتب اسم الضيف";
  if (!draft.buildingNumber.trim()) return "اكتب رقم المبنى";
  if (!draft.apartmentNumber.trim()) return "اكتب رقم الشقة";
  const mobile = toWesternDigits(draft.mobile ?? "").replace(/[\s-]/g, "");
  if (mobile && !/^\+?\d{8,15}$/.test(mobile)) return "رقم الهاتف غير صالح";
  return null;
}

const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const uniqueId = (prefix: string, now: Date) => `${prefix}-${now.getTime()}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * الحالة المستعجلة الجديدة وطلب سيارتها من المبنى إلى عيادة المجمع (في حفظ واحد: الموعد أولًا). الطلب باسم مشرف المبنى
 * الذي طلبه (requestedBy) فيتابعه كطلباته في النهار.
 */
export function buildUrgentCase(draft: UrgentDraft, requestedBy: string, now = new Date()): { appointment: ClinicAppointment; request: VehicleRequest } {
  const mobile = toWesternDigits(draft.mobile ?? "").replace(/[\s-]/g, "");
  const appointment: ClinicAppointment = {
    id: uniqueId("URG", now),
    patientName: draft.patientName.trim().replace(/\s+/g, " "),
    clinic: COMPLEX_CLINIC.name,
    hospitalId: COMPLEX_CLINIC.id,
    buildingNumber: draft.buildingNumber.trim(),
    apartmentNumber: draft.apartmentNumber.trim(),
    mobile: mobile || "-",
    appointmentDate: localDateString(now),
    appointmentAt: clock(now),
    kind: draft.kind,
    assistance: draft.assistance,
    status: "تم طلب السيارة",
    ...(draft.gender ? { gender: draft.gender } : {}),
    urgent: true,
  };
  return { appointment, request: urgentRequest(appointment, now, requestedBy) };
}

function urgentRequest(appointment: ClinicAppointment, now: Date, requestedBy?: string, fromAppointmentId?: string): VehicleRequest {
  return {
    id: uniqueId("REQ", now),
    appointmentId: appointment.id,
    direction: "ذهاب",
    status: "بانتظار التوزيع",
    notificationMethod: "whatsapp",
    createdAt: clock(now),
    ...(requestedBy ? { requestedBy } : {}),
    ...(fromAppointmentId ? { fromAppointmentId } : {}),
  };
}

/**
 * نتيجة الحالة في العيادة باسم من سجّلها: عاد إلى المبنى أو ذهب بسيارة الإسعاف تنهيها («مكتملة»)، والمستشفى يبقيها
 * «تم استلام المريض» حتى يستلمه السائق من العيادة (كالموعد الأول في النقل بين موعدين).
 */
export function withUrgentOutcome(clinicCase: ClinicAppointment, outcome: UrgentOutcome, by: string, now = new Date()): ClinicAppointment {
  return {
    ...clinicCase,
    urgentOutcome: outcome,
    urgentOutcomeBy: by,
    urgentOutcomeAt: now.toISOString(),
    status: outcome === "hospital" ? clinicCase.status : "مكتملة",
  };
}

/**
 * الذهاب من العيادة إلى المستشفى بسيارة المجمع: موعد مستعجل للمستشفى (نفس الضيف، urgentFrom = الحالة في العيادة) وطلب نقل
 * يبدأ من العيادة (fromAppointmentId)، فيرسل له مشرف السيارات السائق بنفس نظام النهار. requestedBy: مشرف المبنى
 * الذي سجّل النتيجة.
 */
export function hospitalTransfer(clinicCase: ClinicAppointment, hospital: Hospital, now = new Date(), requestedBy?: string) {
  const appointment: ClinicAppointment = {
    id: uniqueId("URG", now),
    patientName: clinicCase.patientName,
    clinic: hospital.name,
    hospitalId: hospital.id,
    buildingNumber: clinicCase.buildingNumber,
    apartmentNumber: clinicCase.apartmentNumber,
    mobile: clinicCase.mobile,
    appointmentDate: localDateString(now),
    appointmentAt: clock(now),
    kind: clinicCase.kind,
    assistance: clinicCase.assistance,
    status: "تم طلب السيارة",
    ...(clinicCase.gender ? { gender: clinicCase.gender } : {}),
    urgent: true,
    urgentFrom: clinicCase.id,
  };
  return { appointment, request: urgentRequest(appointment, now, requestedBy, clinicCase.id) };
}

/** رحلة المستشفى بعد الحالة في العيادة (آخرها إن تكررت) */
export const hospitalTripOf = (clinicCase: Pick<ClinicAppointment, "id">, appointments: ClinicAppointment[]) =>
  appointments.filter((appointment) => appointment.urgentFrom === clinicCase.id).at(-1);
