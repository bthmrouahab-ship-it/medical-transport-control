import { COMPLEX_CLINIC, DEFAULT_HOSPITALS, distanceKm, matchHospital, type Hospital } from "./hospitals";
import { FLEET_SEED } from "./seedData";
import { normalizeGender, normalizeMobile, readAliased, toText, toWesternDigits } from "./text";
import { PRIVATE_CAR_MESSAGE, findGuestByName, guestIndex, guestOfAppointment, hasPrivateCar, isMinor, type Guest } from "./guests";

export type AppointmentKind = "عادي" | "احتياجات خاصة";
export type VehicleKind = "سيدان" | "احتياجات خاصة" | "باص";
export type AssistanceNeed = "يحتاج مرافق" | "يحتاج Nurse" | "كرسي متحرك";
/** احتياجات الضيف بترتيب ظهورها في النماذج: مرافق وممرض (Nurse) خياران منفصلان. */
export const ASSISTANCE_NEEDS: AssistanceNeed[] = ["يحتاج مرافق", "يحتاج Nurse", "كرسي متحرك"];
export const ESCORT_NEED: AssistanceNeed = "يحتاج مرافق";
export const NURSE_NEED: AssistanceNeed = "يحتاج Nurse";

/**
 * الضيف أقل من 18 سنة: المرافق إلزامي في سيارة الموعد الطبي، إلا إن كان معه Nurse (لا في الرحلة غير الطبية). يعيد الاحتياجات ومعها المرافق إن لزم
 * (بترتيب ASSISTANCE_NEEDS)، ونفس المصفوفة إن لم يتغير شيء. الخادم يرفض موعده بلا مرافق ولا Nurse (registry_error).
 */
export function withMinorEscort(assistance: AssistanceNeed[], minor: boolean): AssistanceNeed[] {
  if (!minor || assistance.includes(ESCORT_NEED) || assistance.includes(NURSE_NEED)) return assistance;
  return ASSISTANCE_NEEDS.filter((need) => need === ESCORT_NEED || assistance.includes(need));
}
/** خانة المرافق لا تُزال: الضيف أقل من 18 سنة وليس معه Nurse */
export const escortLocked = (assistance: AssistanceNeed[], minor: boolean) => minor && !assistance.includes(NURSE_NEED);
export type AppointmentStatus =
  | "بانتظار طلب السيارة"
  | "تم طلب السيارة"
  | "تم استلام المريض"
  | "طلب عودة"
  | "مكتملة"
  | "ملغي";

export type ClinicAppointment = {
  id: string;
  /** الضيف من قائمة ضيوف المجمع (المواعيد القديمة قبل القائمة بلا رقم) */
  guestId?: string;
  patientName: string;
  clinic: string;
  buildingNumber: string;
  apartmentNumber: string;
  mobile: string;
  /** تاريخ الموعد YYYY-MM-DD */
  appointmentDate: string;
  appointmentAt: string;
  /** المستشفى من الدليل (إن وُجد) لحساب القرب بين الوجهات */
  hospitalId?: string;
  /** رحلة غير طبية (جامعة، مدرسة، تسوق...) يضيفها مشرف السيارات */
  category?: "غير طبية";
  kind: AppointmentKind;
  assistance: AssistanceNeed[];
  status: AppointmentStatus;
  /** إلغاء الموعد من مشرف المبنى: السبب (إلزامي)، ومن ألغاه، ومتى (ISO) */
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: string;
  /** جنس الضيف */
  gender?: Gender;
  /** حالة سرطان: أولوية في إرسال السيارة */
  cancer?: boolean;
  /** الضيف عاد إلى المجمع بنفسه بلا سيارة عودة (يسجّله مشرف المبنى): من سجّله ومتى (ISO) */
  returnedSelf?: boolean;
  returnedSelfBy?: string;
  returnedSelfAt?: string;
  /**
   * موافقة مسؤول العيادة: لا يظهر الموعد لمشرف المبنى إلا بعد موافقته (أو إن أضافه بنفسه).
   * بلا قيمة: موعد قديم قبل هذه الميزة، ويُعتبر موافقًا عليه.
   */
  approval?: Approval;
  approvedBy?: string;
  approvedAt?: string;
  /** استبعاد الموعد بلا حذف (يمكن إرجاعه): من استبعده ومتى */
  excludedBy?: string;
  excludedAt?: string;
  /**
   * طلب عودة فقط من المستشفى (تضيفه العيادة مثل الموعد): الضيف في المستشفى (ذهب بنفسه أو بالإسعاف) ويحتاج سيارة
   * تعيده إلى المجمع. appointmentAt وقت العودة المتوقع، ومشرف المبنى يطلب له سيارة عودة فقط (لا ذهاب) طوال يومه.
   */
  returnOnly?: boolean;
  /** الراكبة ممرضة من قائمة الممرضات (مبنى 03 شقة 001)، يُطلب لها سيارة مثل الضيف */
  nurse?: boolean;
  /** نوع الموعد (اختياري): من APPOINTMENT_TYPES بالعربية، أو مكتوب بعد «أخرى» */
  appointmentType?: string;
  /** رحلة غير طبية متكررة: رقم السلسلة نفسه لكل أيامها (يضيفها مشرف السيارات معًا، ويوقف القادم منها معًا) */
  seriesId?: string;
  /**
   * العودة التلقائية للرحلة غير الطبية («HH:MM» بعد وقت الذهاب): الخادم ينشئ طلب سيارة العودة قبلها بـ 30 دقيقة
   * بعد تسجيل استلام الضيف في الذهاب (auto_returns في api/index.php)، بدل أن يطلبها مشرف المبنى.
   */
  returnAt?: string;
  /** وقت تسجيل الموعد (ISO)؛ يكتبه الخادم وحده عند الإضافة، للإحصائيات (مجدول قبل يومه أو غير مجدول في يومه) */
  addedAt?: string;
  /**
   * حالة مستعجلة في شفت الليل (shared/urgent.ts): يطلبها مشرف المبنى من المبنى إلى عيادة المجمع (hospitalId
   * «complex-clinic»)، أو رحلة المستشفى بعدها (urgentFrom: الحالة في العيادة). أولوية في إرسال السيارة.
   */
  urgent?: true;
  /** نتيجة الحالة في العيادة: عاد إلى المبنى، أو ذهب بسيارة الإسعاف، أو إلى المستشفى بسيارة المجمع؛ ومن سجّلها ومتى (ISO) */
  urgentOutcome?: UrgentOutcome;
  urgentOutcomeBy?: string;
  urgentOutcomeAt?: string;
  urgentFrom?: string;
};

export type UrgentOutcome = "returned" | "ambulance" | "hospital";
export const URGENT_OUTCOME_VALUES: UrgentOutcome[] = ["returned", "ambulance", "hospital"];

/** أنواع المواعيد الجاهزة في نموذج العيادة (خانة اختيارية، ومعها «أخرى» تُكتب). تُحفظ بالعربية. */
export const APPOINTMENT_TYPES: { ar: string; en: string }[] = [
  { ar: "مراجعة", en: "Follow-up" },
  { ar: "استشارة", en: "Consultation" },
  { ar: "تحاليل", en: "Lab tests" },
  { ar: "أشعة", en: "Radiology" },
  { ar: "علاج طبيعي", en: "Physiotherapy" },
  { ar: "غسيل كلى", en: "Dialysis" },
  { ar: "علاج كيماوي", en: "Chemotherapy" },
  { ar: "أسنان", en: "Dental" },
  { ar: "عملية أو إجراء", en: "Surgery or procedure" },
  { ar: "تطعيم", en: "Vaccination" },
];
export const APPOINTMENT_TYPE_MAX = 60;

/** نوع الموعد من Excel أو النموذج: نوع من القائمة (بالعربية أو الإنجليزية) يُحفظ بالعربية، وغيره كما كُتب. */
export function normalizeAppointmentType(value: unknown) {
  const text = toText(value).replace(/\s+/g, " ").slice(0, APPOINTMENT_TYPE_MAX).trim();
  if (!text || /^(n\s*\/?\s*a|-+|لا\s*يوجد|بدون)$/i.test(text)) return "";
  const key = text.toLowerCase();
  return APPOINTMENT_TYPES.find((type) => type.ar === text || type.en.toLowerCase() === key)?.ar ?? text;
}

/** نوع الموعد بلغة الواجهة: أنواع القائمة مترجمة، والمكتوب كما هو. */
export function appointmentTypeText(value: string | undefined, lang: "ar" | "en") {
  if (!value) return "";
  return lang === "en" ? APPOINTMENT_TYPES.find((type) => type.ar === value)?.en ?? value : value;
}

/** طلب عودة فقط من المستشفى (بلا ذهاب) */
export const isReturnOnly = (appointment: Pick<ClinicAppointment, "returnOnly">) => appointment.returnOnly === true;
export const RETURN_ONLY_LABEL = "عودة فقط من المستشفى";

/** بانتظار موافقة مسؤول العيادة، أو موافق عليه، أو مستبعد (بلا حذف). */
export type Approval = "pending" | "approved" | "excluded";
export const approvalOf = (appointment: Pick<ClinicAppointment, "approval">): Approval => appointment.approval ?? "approved";
/** يظهر لمشرف المبنى: موافق عليه (أو موعد قديم بلا حالة موافقة) */
export const isApproved = (appointment: Pick<ClinicAppointment, "approval">) => approvalOf(appointment) === "approved";

export type Gender = "ذكر" | "أنثى";
export const GENDERS: Gender[] = ["ذكر", "أنثى"];

/**
 * أولوية في إرسال السيارة (حالات السرطان، والحالة المستعجلة في شفت الليل): تظهر أولًا لمشرف السيارات وتأخذ السيارة
 * قبل غيرها في التوزيع.
 */
export const isPriority = (appointment: Pick<ClinicAppointment, "cancer" | "urgent">) => Boolean(appointment.cancer || appointment.urgent);

export type Vehicle = {
  plate: string;
  /** اسم السائق الذي يقودها الآن ورقمه: منسوخان من قائمة السائقين (driverId)، وفارغان للسيارة بلا سائق */
  driver: string;
  phone: string;
  kind: VehicleKind;
  available: boolean;
  /** السائق المخصص لها من مشرف السيارات (Driver في shared/drivers.ts)، ومنذ متى */
  driverId?: string;
  driverSince?: string;
  /**
   * تخصيص السيارة من مشرف السيارات: للباص BusRole، ولسيارة الاحتياجات الخاصة «school» سيارة المدارس
   * (في أوقات المدارس: RoleSchedules)؛ وبلا تخصيص سيارة عادية
   */
  busRole?: VehicleRole;
  /** للسيدان فقط: يشغّلها مشرف السيارات بطاقتها الكاملة (4 أشخاص بدل 3) */
  fullCapacity?: boolean;
};

/**
 * تخصيص الباص يختاره مشرف السيارات: shuttle «باص المجمع» يلف داخل المجمع (ويمكن إرساله إلى مستشفى الثمامة
 * وقت الذروة)، وnonMedical «باص الجامعة» (أكثر من باص) لا يُرسل في أي رحلة في أوقاته (طوال اليوم ما لم يغيّرها
 * مشرف السيارات: RoleSchedules)، وclinic «باص العيادة» في خدمة العيادة فلا يُرسل في رحلات التوزيع.
 */
export type BusRole = "shuttle" | "nonMedical" | "clinic";
export const BUS_ROLES: BusRole[] = ["shuttle", "nonMedical", "clinic"];
/** تخصيص يأخذه أكثر من باص (وغيره باص واحد لكل تخصيص) */
export const SHARED_BUS_ROLES: BusRole[] = ["nonMedical"];
/** سيارة احتياجات خاصة محجوزة لإيصال الأولاد إلى المدارس وإرجاعهم في أوقاتها (RoleSchedules)، وتبقى في الخدمة */
export const SCHOOL_ROLE = "school" as const;
export type VehicleRole = BusRole | typeof SCHOOL_ROLE;
export const VEHICLE_ROLES: VehicleRole[] = [...BUS_ROLES, SCHOOL_ROLE];
export const BUS_ROLE_LABELS: Record<VehicleRole, string> = { shuttle: "باص المجمع", nonMedical: "باص الجامعة", clinic: "باص العيادة", school: "سيارة المدارس" };

/**
 * النص الظاهر للحالة: في الواجهة يُقال «الضيف» بدل «المريض». قيمة الحالة المخزنة «تم استلام المريض»
 * تبقى كما هي حتى تعمل البيانات والصلاحيات القائمة.
 */
export const statusText = (status: string) => status.replace("المريض", "الضيف");

/** للسيارة سائق يقودها (يختاره مشرف السيارات في بداية الشفت) */
export const hasDriver = (vehicle: Pick<Vehicle, "driver">) => Boolean(vehicle.driver?.trim());
/** تُرسل في الرحلات: متاحة للخدمة ولها سائق */
export const inService = (vehicle: Pick<Vehicle, "available" | "driver">) => vehicle.available && hasDriver(vehicle);

export type RequestStatus = "بانتظار التوزيع" | "تم إرسال السيارة" | "وصلت السيارة" | "تم استلام المريض" | "وصلت الوجهة";
/** كيف عُرف وصول السيارة إلى الوجهة: GPS السائق، أو انتهاء المدة التقديرية، أو تأكيد مشرف السيارات. */
export type ArrivalSource = "gps" | "estimate" | "manual";

export type VehicleRequest = {
  id: string;
  appointmentId: string;
  vehiclePlate?: string;
  driver?: string;
  direction: "ذهاب" | "عودة";
  status: RequestStatus;
  notificationMethod: "whatsapp" | "call";
  createdAt: string;
  /**
   * يوم الطلب (YYYY-MM-DD) إن كان قبل يوم الرحلة (حجز مسبق، مثل الرحلة المتكررة): createdAt وقته في ذلك اليوم،
   * والسيارة مطلوبة من وقت الانطلاق لا من وقت الحجز (requestedAt).
   */
  requestedOn?: string;
  /** طلب العودة التلقائي (أنشأه الخادم في وقت returnAt للرحلة غير الطبية)؛ createdAt وقت العودة */
  autoReturn?: true;
  groupId?: string;
  notificationSentAt?: string;
  /** رقم حساب مشرف المبنى الذي طلب السيارة: هو وحده يتابع الطلب (الطلبات القديمة بلا مالك يتابعها الجميع) */
  requestedBy?: string;
  /** اسم من طلب السيارة (يكتبه الخادم من حسابه: stamp_requester)، لمشرف السيارات ومسؤول مشرفي المباني */
  requestedByName?: string;
  /** وقت استلام المريض، أي بداية الطريق إلى الوجهة (ISO) */
  pickedUpAt?: string;
  /** الوقت التقديري للوصول إلى الوجهة (ISO) */
  etaAt?: string;
  /** إحداثيات الوجهة؛ منها يكتشف الخادم الوصول عبر GPS السائق */
  destLat?: number;
  destLng?: number;
  /** وقت الوصول إلى الوجهة (ISO) ومصدره */
  arrivedAt?: string;
  arrivalSource?: ArrivalSource;
  /**
   * نقل بين موعدين: الضيف يُستلم من مستشفى هذا الموعد (الأول) بعد انتهائه ويُنقل مباشرة إلى موعد الطلب (الثاني)
   * بدل العودة إلى المجمع. الطلب «ذهاب» لموعده الثاني.
   */
  fromAppointmentId?: string;
  /**
   * عودة الـ Nurse فقط (طلب «عودة» لموعد ضيف معه Nurse): الـ Nurse تعود وحدها إلى المجمع ويبقى الضيف في موعده.
   * لا يغيّر حالة الموعد، وعودة الضيف بعدها بدون الـ Nurse.
   */
  nurseOnly?: boolean;
  /** السائق سجّل وصوله إلى نقطة الاستلام من تطبيقه (ISO)؛ وقت استلامه الضيف هو pickedUpAt */
  driverArrivedAt?: string;
  /** يكتبها الخادم وحده للإحصائيات: وقت تسجيل وصول السيارة إلى نقطة الاستلام (مشرف المبنى)، ووقت اقتراب سيارة العودة أو النقل من المستشفى بالـ GPS */
  pickupArrivedAt?: string;
  nearPickupAt?: string;
  /** موقع هاتف السائق لحظة تسجيل الوصول، ولحظة تسجيل الاستلام */
  arrivalGps?: GpsPoint;
  pickupGps?: GpsPoint;
  /**
   * رد مشرف المبنى على ما سجّله السائق: pending ينتظر الرد، confirmed أكّده، denied نفاه
   * (النفي يعيد الطلب إلى المرحلة السابقة). بلا رد خلال CHECK_MINUTES يُعتبر مقبولًا تلقائيًا.
   */
  arrivalCheck?: CheckReply;
  arrivalCheckBy?: string;
  arrivalCheckAt?: string;
  pickupCheck?: CheckReply;
  pickupCheckBy?: string;
  pickupCheckAt?: string;
  /** تغيير السيارة بعد إرسالها (عطل أو حادث أو تأخر): السيارة السابقة، والسبب، ووقت التغيير (ISO) */
  previousPlate?: string;
  changeReason?: string;
  changedAt?: string;
  /** أُزيل الضيف من رحلة جارية (لم يركب، أو سجّله السائق خطأً): السيارة التي أُزيل منها، والسبب، والوقت (ISO) */
  removedFrom?: string;
  removeReason?: string;
  removedAt?: string;
};

export type GpsPoint = { lat: number; lng: number; accuracy?: number | null };
export type CheckReply = "pending" | "confirmed" | "denied";

export type TripGroupSuggestion = {
  appointmentIds: string[];
  score: number;
  timeGapMinutes: number;
  reason: string;
};

export type ImportedAppointmentResult = {
  appointments: ClinicAppointment[];
  errors: string[];
};

const appointmentStatuses = new Set<AppointmentStatus>([
  "بانتظار طلب السيارة",
  "تم طلب السيارة",
  "تم استلام المريض",
  "طلب عودة",
  "مكتملة",
  "ملغي",
]);

/** نعم/لا من Excel: نعم، yes، 1، ✓، أو اسم الخيار نفسه. */
function isYes(value: unknown, extra?: RegExp) {
  const text = toText(value).toLowerCase();
  if (!text) return false;
  return /^(نعم|yes|y|true|1|✓|✔|x)$/.test(text) || Boolean(extra?.test(text));
}

function normalizeTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = ((value % 1) + 1) % 1;
    const totalMinutes = Math.round(fraction * 24 * 60) % (24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }

  const text = toWesternDigits(toText(value));
  const match = text.match(/^(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?$/i);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toLowerCase();
  if (minutes > 59 || hours > 23) return "";
  if (suffix) {
    if (hours > 12 || hours === 0) return "";
    if (suffix.startsWith("p") && hours !== 12) hours += 12;
    if (suffix.startsWith("a") && hours === 12) hours = 0;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normalizeKind(value: unknown): AppointmentKind | null {
  const text = toText(value);
  if (text.includes("خاص")) return "احتياجات خاصة";
  if (["عادي", "سيدان", "باص", "normal", "regular"].includes(text.toLowerCase())) return "عادي";
  return null;
}

function normalizeAssistance(value: unknown): AssistanceNeed[] {
  const values = Array.isArray(value) ? value.map(toText) : [toText(value)];
  const text = values.join(" ");
  const needs: AssistanceNeed[] = [];
  if (text.includes("مرافق")) needs.push("يحتاج مرافق");
  if (/ممرض|nurse/i.test(text)) needs.push("يحتاج Nurse");
  if (text.includes("كرسي")) needs.push("كرسي متحرك");
  return needs;
}

/** مهلة طلب السيارة بعد وقت الموعد؛ بعدها يجب أن تعدّل العيادة الموعد. */
export const REQUEST_GRACE_MINUTES = 30;

export function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateString(value);
  if (typeof value === "number" && value > 30000 && value < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = toWesternDigits(toText(value));
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return "";
}

export function appointmentDateTime(appointment: Pick<ClinicAppointment, "appointmentDate" | "appointmentAt">) {
  const [year, month, day] = appointment.appointmentDate.split("-").map(Number);
  const [hours, minutes] = appointment.appointmentAt.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

/** هل ما زال طلب السيارة متاحًا؟ يُغلق بعد 30 دقيقة من وقت الموعد. */
export function requestWindow(appointment: Pick<ClinicAppointment, "appointmentDate" | "appointmentAt" | "returnOnly">, now = new Date()) {
  // طلب العودة فقط: الضيف في المستشفى حتى تُطلب سيارته، فيمكن طلبها طوال يومه
  const deadline = appointment.returnOnly
    ? appointmentDateTime({ appointmentDate: appointment.appointmentDate, appointmentAt: "23:59" })
    : new Date(appointmentDateTime(appointment).getTime() + REQUEST_GRACE_MINUTES * 60000);
  const minutesLeft = Math.floor((deadline.getTime() - now.getTime()) / 60000);
  return { open: minutesLeft >= 0, deadline, minutesLeft };
}

export function appointmentPickupLabel(appointment: Pick<ClinicAppointment, "buildingNumber" | "apartmentNumber">) {
  return `مبنى ${appointment.buildingNumber}، شقة ${appointment.apartmentNumber}`;
}

/** مكان الاستلام ← الوجهة كما يظهر في القوائم؛ في النقل بين موعدين من مستشفى الموعد الأول. */
export function routeLabel(appointment: ClinicAppointment, from?: ClinicAppointment | null) {
  return `${from ? from.clinic : appointmentPickupLabel(appointment)} ← ${appointment.clinic}`;
}

export function migrateAppointment(value: unknown, index = 0): ClinicAppointment | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const patientName = toText(raw.patientName);
  const clinic = toText(raw.clinic);
  const appointmentAt = normalizeTime(raw.appointmentAt);
  if (!patientName || !clinic || !appointmentAt) return null;

  const legacyPickup = toText(raw.pickupArea);
  const kind = normalizeKind(raw.kind) ?? "عادي";
  const status = appointmentStatuses.has(raw.status as AppointmentStatus)
    ? raw.status as AppointmentStatus
    : "بانتظار طلب السيارة";

  return {
    id: toText(raw.id) || `APT-MIG-${index + 1}`,
    ...(toText(raw.guestId) ? { guestId: toText(raw.guestId) } : {}),
    patientName,
    clinic,
    buildingNumber: toText(raw.buildingNumber) || legacyPickup || "غير محدد",
    apartmentNumber: toText(raw.apartmentNumber) || "-",
    mobile: normalizeMobile(raw.mobile) || "-",
    // المواعيد القديمة بلا تاريخ تُعتبر مواعيد اليوم
    appointmentDate: normalizeDate(raw.appointmentDate) || localDateString(),
    appointmentAt,
    ...(raw.category === "غير طبية"
      ? { category: "غير طبية" as const }
      : { hospitalId: toText(raw.hospitalId) || matchHospital(clinic)?.id || undefined }),
    kind,
    assistance: normalizeAssistance(raw.assistance ?? raw.notes),
    status,
    ...(status === "ملغي"
      ? { cancelReason: toText(raw.cancelReason) || undefined, cancelledBy: toText(raw.cancelledBy) || undefined, cancelledAt: toText(raw.cancelledAt) || undefined }
      : {}),
    ...(normalizeGender(raw.gender) ? { gender: normalizeGender(raw.gender) } : {}),
    ...(raw.cancer === true ? { cancer: true } : {}),
    ...(raw.returnedSelf === true
      ? { returnedSelf: true, returnedSelfBy: toText(raw.returnedSelfBy) || undefined, returnedSelfAt: toText(raw.returnedSelfAt) || undefined }
      : {}),
    ...(raw.approval === "pending" ? { approval: "pending" as const } : {}),
    ...(raw.approval === "approved" ? { approval: "approved" as const, approvedBy: toText(raw.approvedBy) || undefined, approvedAt: toText(raw.approvedAt) || undefined } : {}),
    ...(raw.approval === "excluded" ? { approval: "excluded" as const, excludedBy: toText(raw.excludedBy) || undefined, excludedAt: toText(raw.excludedAt) || undefined } : {}),
    ...(raw.returnOnly === true ? { returnOnly: true } : {}),
    ...(raw.nurse === true ? { nurse: true } : {}),
    ...(toText(raw.appointmentType) ? { appointmentType: toText(raw.appointmentType).slice(0, APPOINTMENT_TYPE_MAX) } : {}),
    ...(toText(raw.seriesId) ? { seriesId: toText(raw.seriesId) } : {}),
    ...(/^\d{2}:\d{2}$/.test(toText(raw.returnAt)) ? { returnAt: toText(raw.returnAt) } : {}),
    ...(toText(raw.addedAt) && !Number.isNaN(Date.parse(toText(raw.addedAt))) ? { addedAt: toText(raw.addedAt) } : {}),
    ...(raw.urgent === true ? { urgent: true as const } : {}),
    ...(raw.urgent === true && URGENT_OUTCOME_VALUES.includes(raw.urgentOutcome as UrgentOutcome)
      ? { urgentOutcome: raw.urgentOutcome as UrgentOutcome, urgentOutcomeBy: toText(raw.urgentOutcomeBy) || undefined, urgentOutcomeAt: toText(raw.urgentOutcomeAt) || undefined }
      : {}),
    ...(raw.urgent === true && toText(raw.urgentFrom) ? { urgentFrom: toText(raw.urgentFrom) } : {}),
  };
}

export function parseImportedAppointments(
  rows: Record<string, unknown>[],
  existingAppointments: ClinicAppointment[] = [],
  idSeed = Date.now(),
  today = localDateString(),
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** قائمة ضيوف المجمع: يُقبل الموعد لضيف منها فقط ولمستشفى من الدليل، والمبنى والشقة من القائمة */
  guests?: Guest[],
): ImportedAppointmentResult {
  const appointments: ClinicAppointment[] = [];
  const errors: string[] = [];
  const index = guests ? guestIndex(guests) : null;
  const duplicateKeys = new Set(
    existingAppointments.map((appointment) => [
      appointment.appointmentDate,
      appointment.patientName,
      appointment.clinic,
      appointment.buildingNumber,
      appointment.apartmentNumber,
      appointment.appointmentAt,
    ].join("|").toLowerCase()),
  );

  rows.forEach((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    let patientName = toText(readAliased(row, ["اسم الضيف أو الرقم", "اسم الضيف", "الضيف", "رقم الضيف", "اسم المريض أو الرقم", "اسم المريض", "المريض", "رقم المريض"]));
    const clinic = toText(readAliased(row, ["اسم العيادة أو المستشفى", "العيادة", "المستشفى", "الوجهة"]));
    let buildingNumber = toText(readAliased(row, ["رقم المبنى", "المبنى", "building number", "building"]));
    let apartmentNumber = toText(readAliased(row, ["رقم الشقة", "الشقة", "apartment number", "apartment"]));
    let mobile = normalizeMobile(readAliased(row, ["رقم الموبايل", "رقم الجوال", "الموبايل", "الجوال", "الهاتف", "mobile"]));
    const appointmentAt = normalizeTime(readAliased(row, ["وقت الموعد", "الوقت", "موعد", "appointment time"]));
    const rawDate = readAliased(row, ["تاريخ الموعد", "التاريخ", "appointment date", "date"]);
    const appointmentDate = rawDate === undefined || toText(rawDate) === "" ? today : normalizeDate(rawDate);
    const kind = normalizeKind(readAliased(row, ["نوع الرحلة", "نوع الخدمة", "النوع", "trip type"]));
    let assistance = normalizeAssistance(readAliased(row, ["احتياجات الضيف", "احتياجات المريض", "المساعدة", "الاحتياج", "ملاحظات", "assistance"]));
    // ملف المواعيد المصدَّر: كل احتياج في عمود «نعم/لا»
    for (const need of ASSISTANCE_NEEDS) if (!assistance.includes(need) && isYes(readAliased(row, [need]))) assistance.push(need);
    let gender = normalizeGender(readAliased(row, ["الجنس", "gender", "sex"]));
    const cancer = isYes(readAliased(row, ["حالة سرطان", "سرطان", "cancer"]), /سرطان|cancer/);
    // طلب عودة فقط من المستشفى (عمود «عودة فقط»: نعم/لا)
    const returnOnly = isYes(readAliased(row, ["عودة فقط", "طلب عودة فقط", "return only"]), /عودة فقط|return only/i);
    // نوع الموعد (اختياري)
    const appointmentType = normalizeAppointmentType(readAliased(row, ["نوع الموعد", "appointment type"]));

    // مع قائمة الضيوف: الضيف منها (والمبنى والشقة والجنس منها، والهاتف إن لم يُكتب)، والوجهة من دليل المستشفيات
    let guestId: string | undefined;
    let nurse = false;
    let destination = clinic;
    if (index && patientName) {
      const guest = findGuestByName(index, patientName, buildingNumber, apartmentNumber);
      if (!guest) {
        errors.push(`الصف ${excelRow}: الضيف «${patientName}» غير موجود في قائمة ضيوف المجمع`);
        return;
      }
      // صاحب سيارة خاصة أو من يسكن معه في نفس الشقة
      if (hasPrivateCar(guest)) {
        errors.push(`الصف ${excelRow}: «${guest.name}»: ${PRIVATE_CAR_MESSAGE}`);
        return;
      }
      guestId = guest.id;
      nurse = guest.nurse === true;
      patientName = guest.name;
      buildingNumber = guest.buildingNumber;
      apartmentNumber = guest.apartmentNumber;
      mobile = mobile || guest.mobile || "";
      gender = guest.gender ?? gender;
      // أقل من 18 سنة: يُضاف المرافق تلقائيًا إلا إن كان معه Nurse
      assistance = withMinorEscort(assistance, isMinor(guest));
    }
    const hospital = clinic ? matchHospital(clinic, hospitals) : null;
    if (index && clinic) {
      if (!hospital) {
        errors.push(`الصف ${excelRow}: المستشفى «${clinic}» غير موجود في دليل المستشفيات`);
        return;
      }
      destination = hospital.name;
    }

    const missing = [
      [patientName, "اسم الضيف"],
      [clinic, "اسم العيادة أو المستشفى"],
      [buildingNumber, "رقم المبنى"],
      [apartmentNumber, "رقم الشقة"],
      [mobile, "رقم الموبايل"],
      [appointmentAt, "وقت الموعد"],
      [appointmentDate, "تاريخ الموعد"],
      [kind, "نوع الرحلة"],
    ].filter(([value]) => !value).map(([, label]) => label);

    if (missing.length) {
      errors.push(`الصف ${excelRow}: حقول ناقصة أو غير صحيحة (${missing.join("، ")})`);
      return;
    }

    const duplicateKey = [appointmentDate, patientName, destination, buildingNumber, apartmentNumber, appointmentAt].join("|").toLowerCase();
    if (duplicateKeys.has(duplicateKey)) {
      errors.push(`الصف ${excelRow}: الموعد مكرر`);
      return;
    }
    duplicateKeys.add(duplicateKey);

    appointments.push({
      id: `APT-${String(idSeed).slice(-6)}-${String(rowIndex + 1).padStart(2, "0")}`,
      ...(guestId ? { guestId } : {}),
      patientName,
      clinic: destination,
      buildingNumber,
      apartmentNumber,
      mobile,
      appointmentDate,
      appointmentAt,
      hospitalId: hospital?.id,
      kind: kind as AppointmentKind,
      assistance,
      status: "بانتظار طلب السيارة",
      ...(gender ? { gender } : {}),
      ...(cancer ? { cancer: true } : {}),
      ...(returnOnly ? { returnOnly: true } : {}),
      ...(nurse ? { nurse: true } : {}),
      ...(appointmentType ? { appointmentType } : {}),
    });
  });

  return { appointments, errors };
}

export function canRequestVehicle(appointment: ClinicAppointment | undefined, existingRequest?: VehicleRequest, now = new Date()) {
  return Boolean(appointment && !existingRequest && appointment.status !== "مكتملة" && appointment.status !== "ملغي" && requestWindow(appointment, now).open);
}

/** أسباب جاهزة لإلغاء الموعد (ويمكن كتابة سبب آخر). */
export const CANCEL_REASONS = [
  "الضيف لا يرغب في الذهاب",
  "الضيف غير موجود في الشقة",
  "أُلغي الموعد من المستشفى",
  "ذهب الضيف بوسيلة أخرى",
  "حالة الضيف لا تسمح بالنقل",
];

/**
 * مشرف المبنى يلغي الموعد قبل استلام المريض فقط: بلا طلب، أو طلب ذهاب لم يُستلم مريضه بعد.
 * (بعد الاستلام تكون الرحلة قد بدأت، والعودة تُلغى بإلغاء طلبها.)
 */
export function canCancelAppointment(appointment: ClinicAppointment, request?: VehicleRequest) {
  if (appointment.status !== "بانتظار طلب السيارة" && appointment.status !== "تم طلب السيارة") return false;
  return !request || (request.direction === "ذهاب" && ["بانتظار التوزيع", "تم إرسال السيارة", "وصلت السيارة"].includes(request.status));
}

/**
 * هل يتابع هذا المستخدم الطلب؟ الطلب (ذهابًا أو عودة) لمن طلبه فقط.
 * الطلبات القديمة أو التي أضافها مشرف السيارات بلا مالك يتابعها الجميع.
 */
export const followsRequest = (request: VehicleRequest | undefined, uid: string) =>
  !request?.requestedBy || request.requestedBy === uid;

export function migrateRequest(value: unknown): VehicleRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = toText(raw.id);
  const appointmentId = toText(raw.appointmentId);
  if (!id || !appointmentId) return null;
  const legacyStatus = toText(raw.status);
  const status: VehicleRequest["status"] = legacyStatus === "وصلت السيارة" || legacyStatus === "تم استلام المريض" || legacyStatus === "وصلت الوجهة"
    ? legacyStatus
    : legacyStatus === "تم التأكيد" || legacyStatus === "تم إرسال السيارة"
      ? "تم إرسال السيارة"
      : "بانتظار التوزيع";
  const isoTime = (value: unknown) => {
    const text = toText(value);
    return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
  };
  const coordinate = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
  const arrivalSource = raw.arrivalSource === "gps" || raw.arrivalSource === "estimate" || raw.arrivalSource === "manual" ? raw.arrivalSource : undefined;
  const reply = (value: unknown) => (value === "pending" || value === "confirmed" || value === "denied" ? value : undefined);
  const gps = (value: unknown): GpsPoint | undefined => {
    const point = value as Record<string, unknown> | null;
    const lat = coordinate(point?.lat);
    const lng = coordinate(point?.lng);
    return lat === undefined || lng === undefined ? undefined : { lat, lng, accuracy: coordinate(point?.accuracy) ?? null };
  };
  const check = {
    driverArrivedAt: isoTime(raw.driverArrivedAt),
    pickupArrivedAt: isoTime(raw.pickupArrivedAt),
    nearPickupAt: isoTime(raw.nearPickupAt),
    arrivalGps: gps(raw.arrivalGps),
    pickupGps: gps(raw.pickupGps),
    arrivalCheck: reply(raw.arrivalCheck),
    arrivalCheckBy: toText(raw.arrivalCheckBy) || undefined,
    arrivalCheckAt: isoTime(raw.arrivalCheckAt),
    pickupCheck: reply(raw.pickupCheck),
    pickupCheckBy: toText(raw.pickupCheckBy) || undefined,
    pickupCheckAt: isoTime(raw.pickupCheckAt),
  };
  return {
    id,
    appointmentId,
    vehiclePlate: toText(raw.vehiclePlate) || undefined,
    driver: toText(raw.driver) || undefined,
    direction: raw.direction === "عودة" ? "عودة" : "ذهاب",
    status,
    notificationMethod: raw.notificationMethod === "call" ? "call" : "whatsapp",
    createdAt: toText(raw.createdAt),
    ...(/^\d{4}-\d{2}-\d{2}$/.test(toText(raw.requestedOn)) ? { requestedOn: toText(raw.requestedOn) } : {}),
    ...(raw.autoReturn === true ? { autoReturn: true as const } : {}),
    groupId: toText(raw.groupId) || undefined,
    notificationSentAt: toText(raw.notificationSentAt) || undefined,
    requestedBy: toText(raw.requestedBy) || undefined,
    requestedByName: toText(raw.requestedByName) || undefined,
    pickedUpAt: isoTime(raw.pickedUpAt),
    etaAt: isoTime(raw.etaAt),
    destLat: coordinate(raw.destLat),
    destLng: coordinate(raw.destLng),
    arrivedAt: isoTime(raw.arrivedAt),
    arrivalSource,
    fromAppointmentId: toText(raw.fromAppointmentId) || undefined,
    ...(raw.nurseOnly === true ? { nurseOnly: true } : {}),
    previousPlate: toText(raw.previousPlate) || undefined,
    changeReason: toText(raw.changeReason) || undefined,
    changedAt: isoTime(raw.changedAt),
    removedFrom: toText(raw.removedFrom) || undefined,
    removeReason: toText(raw.removeReason) || undefined,
    removedAt: isoTime(raw.removedAt),
    // الخانات الفارغة لا تُضاف، حتى لا تظهر تغييرات وهمية عند المقارنة قبل الحفظ
    ...Object.fromEntries(Object.entries(check).filter(([, value]) => value !== undefined)),
  };
}

/** أسباب تغيير السيارة بعد إرسالها (ومعها «أخرى» مكتوب) */
export const CHANGE_VEHICLE_REASONS = ["عطل في السيارة", "حادث", "تأخر السيارة", "السائق لا يرد"] as const;
/** السيارة السابقة لا تكمل الخدمة بعد هذين السببين (تُقترح إيقافها) */
export const VEHICLE_FAULT_REASONS: readonly string[] = ["عطل في السيارة", "حادث"];

/** يمكن تغيير سيارة الرحلة: أُرسلت ولم تصل إلى الوجهة بعد (قبل استلام الضيف أو بعده) */
export const canChangeVehicle = (request: Pick<VehicleRequest, "status" | "vehiclePlate">) => Boolean(request.vehiclePlate)
  && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة" || request.status === "تم استلام المريض");

/**
 * سيارة أخرى لرحلة أُرسلت لها سيارة (عطل أو حادث أو تأخر): السيارة الجديدة وسائقها ووقت إرسالها، والسيارة السابقة والسبب.
 * قبل استلام الضيف تعود الرحلة إلى «تم إرسال السيارة» ويُمحى ما سجّله سائق السيارة السابقة عند الاستلام.
 * بعد الاستلام (الضيف في السيارة السابقة) تبقى «تم استلام المريض» والوقت المتوقع للوصول، وتكمل السيارة الجديدة الطريق.
 */
export function changeRequestVehicle(request: VehicleRequest, vehicle: Pick<Vehicle, "plate" | "driver">, reason: string, now = new Date()): VehicleRequest {
  const beforePickup = request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة";
  const { driverArrivedAt: _at, arrivalGps: _gps, arrivalCheck: _check, arrivalCheckBy: _by, arrivalCheckAt: _checkAt, ...rest } = request;
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    ...(beforePickup ? rest : request),
    vehiclePlate: vehicle.plate,
    driver: vehicle.driver,
    status: beforePickup ? "تم إرسال السيارة" : request.status,
    notificationSentAt: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    previousPlate: request.vehiclePlate,
    changeReason: reason.trim(),
    changedAt: now.toISOString(),
  };
}

/** أسباب إزالة ضيف من رحلة جارية (ومعها «أخرى» مكتوب) */
export const REMOVE_FROM_TRIP_REASONS = ["لم يركب السيارة", "الضيف غير جاهز", "سجّله السائق خطأً"] as const;

/**
 * إزالة ضيف من رحلة جارية (لم يركب السيارة، أو سجّل السائق استلامه خطأً): يعود طلبه إلى «بانتظار التوزيع» بلا سيارة
 * ولا شيء من مراحل الرحلة، لترسل له سيارة أخرى، ومعه السيارة التي أُزيل منها والسبب. تبقى الرحلة لباقي الركاب.
 */
export function removeRequestFromTrip(request: VehicleRequest, reason: string, now = new Date()): VehicleRequest {
  return {
    id: request.id,
    appointmentId: request.appointmentId,
    direction: request.direction,
    status: "بانتظار التوزيع",
    notificationMethod: request.notificationMethod,
    createdAt: request.createdAt,
    ...(request.requestedBy ? { requestedBy: request.requestedBy } : {}),
    ...(request.requestedByName ? { requestedByName: request.requestedByName } : {}),
    // الحجز المسبق والعودة التلقائية من بيانات الطلب نفسه (لا من الرحلة)
    ...(request.requestedOn ? { requestedOn: request.requestedOn } : {}),
    ...(request.autoReturn ? { autoReturn: true as const } : {}),
    ...(request.fromAppointmentId ? { fromAppointmentId: request.fromAppointmentId } : {}),
    ...(request.nurseOnly ? { nurseOnly: true } : {}),
    removedFrom: request.vehiclePlate,
    removeReason: reason.trim(),
    removedAt: now.toISOString(),
  };
}

/**
 * حالة الموعد قبل استلام الضيف (عند إزالة ضيف سُجّل استلامه، أو نفي الاستلام): موعده «تم طلب السيارة» (والعودة
 * «طلب عودة»)، والموعد الأول في النقل «تم استلام المريض». عودة الـ Nurse فقط لا تغيّر موعد الضيف.
 */
export function appointmentsBeforePickup(appointments: ClinicAppointment[], request: VehicleRequest): ClinicAppointment[] {
  if (request.nurseOnly) return appointments;
  return appointments.map((appointment) => appointment.id === request.appointmentId
    ? { ...appointment, status: request.direction === "عودة" ? "طلب عودة" : "تم طلب السيارة" }
    : appointment.id === request.fromAppointmentId ? { ...appointment, status: "تم استلام المريض" } : appointment);
}

/** حالة الموعد بعد استلام الضيف: الذهاب «تم استلام المريض»، والعودة والموعد الأول في النقل «مكتملة». */
export function appointmentsAfterPickup(appointments: ClinicAppointment[], request: VehicleRequest): ClinicAppointment[] {
  if (request.nurseOnly) return appointments;
  return appointments.map((appointment) => appointment.id === request.appointmentId
    ? { ...appointment, status: request.direction === "عودة" ? "مكتملة" : "تم استلام المريض" }
    : appointment.id === request.fromAppointmentId ? { ...appointment, status: "مكتملة" } : appointment);
}

/** طلب نقل بين موعدين (من مستشفى الموعد الأول إلى الثاني). */
export const isTransfer = (request: Pick<VehicleRequest, "fromAppointmentId">) => Boolean(request.fromAppointmentId);

/** الضيف معه Nurse (فيمكن أن تعود وحدها قبله). */
export const hasNurse = (appointment: Pick<ClinicAppointment, "assistance">) => appointment.assistance.includes("يحتاج Nurse");

/**
 * عدد الأشخاص في رحلة الضيف (للمقاعد): الضيف، ومرافقه إن احتاج مرافقًا، والـ Nurse إن احتاجها.
 * عودة الـ Nurse فقط شخص واحد، وعودة الضيف بعد أن عادت الـ Nurse وحدها (nurseBack) بدونها.
 */
export function tripPersons(appointment: Pick<ClinicAppointment, "assistance">, request?: Pick<VehicleRequest, "nurseOnly">, nurseBack = false) {
  if (request?.nurseOnly) return 1;
  return 1 + Number(appointment.assistance.includes("يحتاج مرافق")) + Number(hasNurse(appointment) && !nurseBack);
}

/** عدد الأشخاص لطلب بين كل الطلبات: عودة الضيف بعد «عودة الـ Nurse فقط» لنفس الموعد لا تحسب الـ Nurse. */
export function requestPersons(request: VehicleRequest, appointment: ClinicAppointment, requests: VehicleRequest[]) {
  const nurseBack = request.direction === "عودة" && !request.nurseOnly
    && requests.some((other) => other.nurseOnly && other.appointmentId === request.appointmentId && other.id !== request.id);
  return tripPersons(appointment, request, nurseBack);
}

/** عدد الأشخاص بالعربية: شخص واحد، شخصان، 3 أشخاص، 11 شخصًا */
export const personsText = (count: number) => (count === 1 ? "شخص واحد" : count === 2 ? "شخصان" : count <= 10 ? `${count} أشخاص` : `${count} شخصًا`);

const guestKey = (appointment: Pick<ClinicAppointment, "patientName" | "buildingNumber" | "apartmentNumber">) =>
  [appointment.patientName, appointment.buildingNumber, appointment.apartmentNumber].map((part) => part.trim().replace(/\s+/g, " ").toLowerCase()).join("|");

/** نفس الضيف: الاسم والمبنى والشقة. */
export const sameGuest = (a: ClinicAppointment, b: ClinicAppointment) => guestKey(a) === guestKey(b);

/** موعدان لنفس الضيف بفارق أقل من هذا يُعتبران في نفس الوقت (لا يمكن حضورهما معًا). */
export const CONFLICT_MINUTES = 30;
const clockMinutes = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};
const sameHospital = (a: ClinicAppointment, b: ClinicAppointment) => (a.hospitalId && b.hospitalId
  ? a.hospitalId === b.hospitalId
  : a.clinic.trim().replace(/\s+/g, " ").toLowerCase() === b.clinic.trim().replace(/\s+/g, " ").toLowerCase());

/**
 * تنبيهات مسؤول العيادة لموعد: للضيف نفسه في نفس اليوم موعد آخر في نفس الوقت (أو بفارق أقل من CONFLICT_MINUTES)،
 * أو موعد آخر في نفس المستشفى في وقت مختلف (قد يكون مكررًا). الملغي والمستبعد لا يُحسبان.
 */
export type GuestAlert = { kind: "sameTime" | "sameHospital"; other: ClinicAppointment; gap: number };
export function guestAlerts(appointment: ClinicAppointment, appointments: ClinicAppointment[]): GuestAlert[] {
  const counts = (item: ClinicAppointment) => item.status !== "ملغي" && approvalOf(item) !== "excluded" && !isNonMedical(item);
  if (!counts(appointment)) return [];
  return appointments
    .filter((other) => other.id !== appointment.id && other.appointmentDate === appointment.appointmentDate && counts(other) && sameGuest(other, appointment))
    .flatMap((other): GuestAlert[] => {
      const gap = Math.abs(clockMinutes(other.appointmentAt) - clockMinutes(appointment.appointmentAt));
      if (gap < CONFLICT_MINUTES) return [{ kind: "sameTime", other, gap }];
      return sameHospital(other, appointment) ? [{ kind: "sameHospital", other, gap }] : [];
    })
    .sort((a, b) => a.other.appointmentAt.localeCompare(b.other.appointmentAt));
}

/** مواعيد الضيف الأخرى في نفس اليوم (غير الملغاة)، بترتيب الوقت. */
export function sameDayAppointments(appointment: ClinicAppointment, appointments: ClinicAppointment[]) {
  return appointments
    .filter((other) => other.id !== appointment.id && other.appointmentDate === appointment.appointmentDate
      && other.status !== "ملغي" && !isNonMedical(other) && sameGuest(other, appointment))
    .sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt));
}

/**
 * الموعد التالي لنفس الضيف في نفس اليوم، إن كان يمكن نقله إليه مباشرة بعد انتهاء هذا الموعد:
 * بعده في الوقت، ولم يُطلب له سيارة بعد، ومهلة طلبه مفتوحة.
 */
export function nextAppointmentOf(appointment: ClinicAppointment, appointments: ClinicAppointment[], now = new Date()) {
  if (isNonMedical(appointment)) return null;
  return sameDayAppointments(appointment, appointments)
    .find((other) => other.appointmentAt > appointment.appointmentAt && other.status === "بانتظار طلب السيارة" && !isReturnOnly(other) && requestWindow(other, now).open) ?? null;
}

/** عدد رحلات كل سيارة في يوم (الرحلة المجمّعة رحلة واحدة)، لتوزيع العمل على السيارات بالتساوي. */
export function vehicleLoad(requests: VehicleRequest[], appointments: ClinicAppointment[], date: string) {
  const dates = new Map(appointments.map((appointment) => [appointment.id, appointment.appointmentDate]));
  const trips = new Map<string, Set<string>>();
  for (const request of requests) {
    if (!request.vehiclePlate || dates.get(request.appointmentId) !== date) continue;
    const plateTrips = trips.get(request.vehiclePlate) ?? new Set<string>();
    plateTrips.add(request.groupId ?? request.id);
    trips.set(request.vehiclePlate, plateTrips);
  }
  return new Map(Array.from(trips, ([plate, set]) => [plate, set.size]));
}

const KIND_ORDER: Record<VehicleKind, number> = { "سيدان": 0, "باص": 1, "احتياجات خاصة": 2 };

/** وقت الذروة في قطر: من الأحد إلى الخميس، صباحًا 6:30–8:30 وظهرًا 13:00–16:00. */
export function isRushHour(at: Date) {
  const day = at.getDay();
  if (day === 5 || day === 6) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return (minutes >= 390 && minutes <= 510) || (minutes >= 780 && minutes <= 960);
}

// ————— الباصات —————

/** مقاعد الباص */
export const BUS_SEATS = 14;
/** السيدان تحمل 4 أشخاص، ويُفضل 3 إلا إذا شغّلها مشرف السيارات بطاقتها الكاملة (fullCapacity) */
export const SEDAN_SEATS = 4;
export const SEDAN_PREFERRED_SEATS = 3;
/** سيارة الاحتياجات الخاصة: ضيف احتياجات خاصة واحد وثلاثة أشخاص عاديين */
export const ACCESSIBLE_SEATS = 4;
/** لا يُجمع ضيفا احتياجات خاصة في سيارة واحدة */
export const MAX_SPECIAL_PER_VEHICLE = 1;
/** الباصات غير متاحة من 6 إلى 9 صباحًا */
export const BUS_OFF_HOURS = { from: 6, to: 9 };
/** مستشفى الثمامة (مركز الثمامة الصحي): الوجهة الوحيدة لباص المجمع، وقت الذروة فقط */
export const SHUTTLE_HOSPITAL_ID = "thumama-hc";

/** تخصيص الباص (null لغير الباص أو الباص العادي). */
export const busRoleOf = (vehicle: Pick<Vehicle, "kind" | "busRole">): BusRole | null =>
  (vehicle.kind === "باص" && vehicle.busRole && (BUS_ROLES as VehicleRole[]).includes(vehicle.busRole) ? vehicle.busRole as BusRole : null);

// ————— سيارات المدارس وباص الجامعة: أوقات محجوزة يعدّلها مشرف السيارات —————

/** وقت محجوز بالدقائق منذ منتصف الليل (to حتى 1440 = نهاية اليوم) */
export type ReservedRun = { from: number; to: number };
/** أوقات تخصيص: أيام الأسبوع (0 الأحد … 6 السبت) والأوقات في كل يوم منها */
export type RoleSchedule = { days: number[]; runs: ReservedRun[] };
/** التخصيصات التي لها أوقات محجوزة: سيارة المدارس وباص الجامعة */
export type ScheduledRole = typeof SCHOOL_ROLE | "nonMedical";
export const SCHEDULED_ROLES: ScheduledRole[] = [SCHOOL_ROLE, "nonMedical"];
/** الأوقات المحفوظة (meta/schedules)، وما لم يُحفظ يأخذ DEFAULT_SCHEDULES */
export type RoleSchedules = Partial<Record<ScheduledRole, RoleSchedule>>;
export const DAY_MINUTES = 24 * 60;
/** أكثر عدد من الأوقات في اليوم */
export const MAX_RESERVED_RUNS = 6;
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6];
/**
 * الأوقات الافتراضية: سيارة المدارس من الأحد إلى الخميس، الذهاب 11:00–14:00 والعودة 17:30–19:00؛ وباص الجامعة
 * محجوز طوال اليوم كل الأيام (لا يُرسل في أي رحلة حتى يحدد مشرف السيارات أوقاته).
 */
export const DEFAULT_SCHEDULES: Record<ScheduledRole, RoleSchedule> = {
  school: { days: [0, 1, 2, 3, 4], runs: [{ from: 11 * 60, to: 14 * 60 }, { from: 17 * 60 + 30, to: 19 * 60 }] },
  nonMedical: { days: [...WEEK_DAYS], runs: [{ from: 0, to: DAY_MINUTES }] },
};
/** قبل الوقت المحجوز بهذه الدقائق لا تُقترح السيارة لرحلة أخرى (ويمكن لمشرف السيارات اختيارها بتنبيه) */
export const RESERVED_SOON_MINUTES = 60;

/** أوقات صالحة: أيام مختلفة 0–6، وأوقات مرتبة لا تتداخل داخل اليوم */
export function validSchedule(schedule: unknown): schedule is RoleSchedule {
  if (!schedule || typeof schedule !== "object") return false;
  const { days, runs } = schedule as RoleSchedule;
  if (!Array.isArray(days) || !Array.isArray(runs) || runs.length > MAX_RESERVED_RUNS) return false;
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(days).size !== days.length) return false;
  return runs.every((run, index) => run && Number.isInteger(run.from) && Number.isInteger(run.to) && run.from >= 0 && run.to <= DAY_MINUTES
    && run.from < run.to && (index === 0 || run.from >= runs[index - 1].to));
}

/** أوقات التخصيص: المحفوظة إن كانت صالحة، وإلا الافتراضية. */
export const scheduleOf = (schedules: RoleSchedules | null | undefined, role: ScheduledRole): RoleSchedule => {
  const saved = schedules?.[role];
  return validSchedule(saved) ? saved : DEFAULT_SCHEDULES[role];
};

/** وقت طوال اليوم */
export const isAllDay = (run: ReservedRun) => run.from === 0 && run.to >= DAY_MINUTES;

/** سيارة احتياجات خاصة مخصصة للمدارس */
export const isSchoolCar = (vehicle: Pick<Vehicle, "kind" | "busRole">) => vehicle.kind === "احتياجات خاصة" && vehicle.busRole === SCHOOL_ROLE;

/** تخصيص السيارة (الباص أو سيارة المدارس)، أو null للسيارة العادية. */
export const vehicleRoleOf = (vehicle: Pick<Vehicle, "kind" | "busRole">): VehicleRole | null => busRoleOf(vehicle) ?? (isSchoolCar(vehicle) ? SCHOOL_ROLE : null);

/** تخصيص له أوقات محجوزة (سيارة المدارس أو باص الجامعة)، أو null. */
export const scheduledRoleOf = (vehicle: Pick<Vehicle, "kind" | "busRole">): ScheduledRole | null => {
  const role = vehicleRoleOf(vehicle);
  return role && (SCHEDULED_ROLES as VehicleRole[]).includes(role) ? role as ScheduledRole : null;
};

export const clockOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
/** الأيام نصًّا: «من الأحد إلى الخميس» للأيام المتتالية، أو «كل الأيام»، أو أسماؤها. */
export function scheduleDaysText(days: number[]) {
  const sorted = [...days].sort((a, b) => a - b);
  if (!sorted.length) return "لا يوجد يوم";
  if (sorted.length === 7) return "كل الأيام";
  const consecutive = sorted.length > 2 && sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  return consecutive ? `من ${WEEKDAY_NAMES[sorted[0]]} إلى ${WEEKDAY_NAMES[sorted.at(-1)!]}` : sorted.map((day) => WEEKDAY_NAMES[day]).join(" و");
}

/** الأوقات نصًّا: «11:00–14:00 و17:30–19:00»، أو «طوال اليوم». */
export const scheduleRunsText = (runs: ReservedRun[]) => (runs.length === 1 && isAllDay(runs[0]) ? "طوال اليوم"
  : runs.map((run) => `${clockOf(run.from)}–${run.to >= DAY_MINUTES ? "24:00" : clockOf(run.to)}`).join(" و"));

/** «من الأحد إلى الخميس 11:00–14:00 و17:30–19:00»، أو «بلا أوقات محجوزة» (نفس schedule_text في api/lib/activity.php). */
export const scheduleText = (schedule: RoleSchedule) => (!schedule.days.length || !schedule.runs.length ? "بلا أوقات محجوزة"
  : `${scheduleDaysText(schedule.days)} ${scheduleRunsText(schedule.runs)}`);

/** الوقت المحجوز الجاري الآن للسيارة (سيارة المدارس أو باص الجامعة في أوقاته)، أو null. */
export function reservedRun(vehicle: Pick<Vehicle, "kind" | "busRole">, at: Date, schedules?: RoleSchedules | null) {
  const role = scheduledRoleOf(vehicle);
  if (!role) return null;
  const schedule = scheduleOf(schedules, role);
  if (!schedule.days.includes(at.getDay())) return null;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const run = schedule.runs.find((item) => minutes >= item.from && minutes < item.to);
  return run ? { role, ...run, allDay: isAllDay(run), until: run.to >= DAY_MINUTES ? "نهاية اليوم" : clockOf(run.to) } : null;
}

/** الوقت المحجوز التالي اليوم إن بدأ خلال `within` دقيقة، أو null. */
export function reservedSoon(vehicle: Pick<Vehicle, "kind" | "busRole">, at: Date, schedules?: RoleSchedules | null, within = RESERVED_SOON_MINUTES) {
  const role = scheduledRoleOf(vehicle);
  if (!role) return null;
  const schedule = scheduleOf(schedules, role);
  if (!schedule.days.includes(at.getDay())) return null;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const run = schedule.runs.find((item) => item.from > minutes && item.from - minutes <= within);
  return run ? { role, ...run, starts: clockOf(run.from) } : null;
}

/** سبب عدم إرسال السيارة في وقتها المحجوز: «في رحلة المدارس حتى 14:00» أو «في خدمة الجامعة». */
export function reservedText(reserved: NonNullable<ReturnType<typeof reservedRun>>) {
  if (reserved.role === SCHOOL_ROLE) return reserved.allDay ? "في خدمة المدارس" : `في رحلة المدارس حتى ${reserved.until}`;
  return reserved.allDay ? "في خدمة الجامعة" : `في رحلة الجامعة حتى ${reserved.until}`;
}

/** تنبيه لمشرف السيارات: السيارة تخرج قريبًا لوقتها المحجوز («سيارة المدارس · تخرج 11:00»)، أو null. */
export function reservedSoonWarning(vehicle: Pick<Vehicle, "kind" | "busRole">, at: Date, schedules?: RoleSchedules | null) {
  const soon = reservedSoon(vehicle, at, schedules);
  if (!soon) return null;
  return soon.role === SCHOOL_ROLE ? `سيارة المدارس · تخرج ${soon.starts}` : `باص الجامعة · يخرج ${soon.starts}`;
}

/** الباصات غير متاحة في هذا الوقت (6–9 صباحًا). */
export function busesOff(at: Date) {
  const hour = at.getHours();
  return hour >= BUS_OFF_HOURS.from && hour < BUS_OFF_HOURS.to;
}

/**
 * عدد الأشخاص الذين تتسع لهم السيارة في رحلة واحدة (مع المرافقين والـ Nurse): الباص 14، وسيارة الاحتياجات
 * الخاصة 4 (ضيف احتياجات خاصة واحد و3 عاديون)، والسيدان 3 أو 4 إن شغّلها مشرف السيارات بطاقتها الكاملة.
 */
export function vehicleSeats(vehicle: Pick<Vehicle, "kind" | "fullCapacity">) {
  if (vehicle.kind === "باص") return BUS_SEATS;
  if (vehicle.kind === "احتياجات خاصة") return ACCESSIBLE_SEATS;
  return vehicle.fullCapacity ? SEDAN_SEATS : SEDAN_PREFERRED_SEATS;
}

/** عدد ضيوف الاحتياجات الخاصة في رحلة */
export const specialCount = (appointments: Pick<ClinicAppointment, "kind">[]) =>
  appointments.filter((appointment) => appointment.kind === "احتياجات خاصة").length;

/** رحلة بين المجمع ومستشفى الثمامة (ذهابًا أو عودة): يمكن أن يأخذها باص المجمع وقت الذروة. */
export const isShuttleTrip = (appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) =>
  appointmentHospital(appointment, hospitals)?.id === SHUTTLE_HOSPITAL_ID;

/**
 * رحلة (ضيف أو أكثر في سيارة واحدة). transfer: نقل بين موعدين (يبدأ من مستشفى).
 * persons: عدد الأشخاص (الضيوف ومرافقوهم والـ Nurse: requestPersons)، وإلا يُحسب من احتياجات الضيوف.
 */
export type TripLoad = { appointments: ClinicAppointment[]; transfer?: boolean; persons?: number };

/** عدد الأشخاص في الرحلة. */
export const loadPersons = (trip: TripLoad) => trip.persons ?? trip.appointments.reduce((sum, appointment) => sum + tripPersons(appointment), 0);
/** وقت اختيار السيارة (لساعات الباصات ووقت الذروة) ودليل المستشفيات، وأوقات سيارات المدارس وباص الجامعة (schedules) */
/**
 * regularForSpecial: مشرف السيارات يختار السيارة بنفسه، فتُقبل سيارة عادية لضيف احتياجات خاصة بعد موافقته على
 * التنبيه (`regularForSpecialWarning`). الاقتراح والتوزيع التلقائي والضم والتوجيه بلا هذا الخيار.
 */
export type VehicleRules = { now?: Date; hospitals?: Hospital[]; regularForSpecial?: boolean; schedules?: RoleSchedules | null };

/** تنبيه سيارة عادية لرحلة فيها ضيف احتياجات خاصة (يُرسلها مشرف السيارات بعد الموافقة عليه)، أو null */
export function regularForSpecialWarning(vehicle: Pick<Vehicle, "kind">, appointments: Pick<ClinicAppointment, "kind">[]) {
  return needsAccessibleVehicle(appointments) && vehicle.kind !== "احتياجات خاصة" ? "سيارة عادية · الضيف يحتاج سيارة احتياجات خاصة" : null;
}

/**
 * لماذا لا تناسب السيارة هذه الرحلة الآن، أو null إن كانت تناسبها (انشغالها برحلة يُفحص في مكان آخر):
 * - باص العيادة في خدمة العيادة، فلا يُرسل في أي رحلة.
 * - الاحتياجات الخاصة تحتاج سيارة مجهزة، وعدد الأشخاص (مع المرافق والـ Nurse) لا يتجاوز مقاعد السيارة (الباص 14)؛
 *   والضيف الواحد مع مرافقيه يُقبل دائمًا في السيارة المناسبة له.
 * - الباصات غير متاحة من 6 إلى 9 صباحًا.
 * - باص المجمع يلف داخل المجمع، ويُرسل فقط إلى مستشفى الثمامة (ذهابًا أو عودة) وقت الذروة.
 * - سيارة المدارس وباص الجامعة لا يُرسلان في أي رحلة (طبية أو غير طبية) في أوقاتهما المحجوزة (reservedRun:
 *   أوقات المدارس الأحد إلى الخميس 11:00–14:00 و17:30–19:00، وباص الجامعة طوال اليوم، ما لم يغيّرها مشرف السيارات).
 */
export function vehicleRestriction(vehicle: Vehicle, trip: TripLoad, rules: VehicleRules = {}): string | null {
  const now = rules.now ?? new Date();
  if (!vehicle.available) return "خارج الخدمة";
  if (!hasDriver(vehicle)) return "بلا سائق";
  const role = busRoleOf(vehicle);
  if (role === "clinic") return "في خدمة العيادة";
  const reserved = reservedRun(vehicle, now, rules.schedules);
  if (reserved) return reservedText(reserved);
  if (!rules.regularForSpecial && needsAccessibleVehicle(trip.appointments) && vehicle.kind !== "احتياجات خاصة") return "تحتاج سيارة احتياجات خاصة";
  if (specialCount(trip.appointments) > MAX_SPECIAL_PER_VEHICLE) return "ضيف احتياجات خاصة واحد فقط في السيارة";
  const seats = vehicleSeats(vehicle);
  const persons = loadPersons(trip);
  if (trip.appointments.length > 1 && persons > seats) {
    // السيدان بطاقتها المفضلة (3) تستطيع أن تحمل 4 إن شغّلها مشرف السيارات بطاقتها الكاملة
    const full = vehicle.kind === "سيدان" && !vehicle.fullCapacity && persons <= SEDAN_SEATS;
    return `تتسع لـ ${personsText(seats)} فقط${full ? " (أو 4 بطاقتها الكاملة)" : ""}`;
  }
  if (vehicle.kind === "باص" && busesOff(now)) return "الباصات غير متاحة من 6 إلى 9 صباحًا";
  if (role === "shuttle" && !(isRushHour(now) && !trip.transfer && trip.appointments.every((appointment) => isShuttleTrip(appointment, rules.hospitals)))) {
    return "باص المجمع: مستشفى الثمامة وقت الذروة فقط";
  }
  return null;
}

type Candidate = { vehicle: Vehicle; index: number };

/** ترتيب السيارات المناسبة: preference أولًا، ثم المجهزة آخرًا، ثم rank، ثم الأقل رحلات، ثم السيدان قبل الباص، ثم ترتيب الأسطول. */
function pickVehicle(candidates: Candidate[], load: Map<string, number>, rank?: (vehicle: Vehicle) => number, preference?: (vehicle: Vehicle) => number) {
  candidates.sort((a, b) => (preference ? preference(a.vehicle) - preference(b.vehicle) : 0)
    || Number(a.vehicle.kind === "احتياجات خاصة") - Number(b.vehicle.kind === "احتياجات خاصة")
    || (rank ? rank(a.vehicle) - rank(b.vehicle) : 0)
    || (load.get(a.vehicle.plate) ?? 0) - (load.get(b.vehicle.plate) ?? 0)
    || KIND_ORDER[a.vehicle.kind] - KIND_ORDER[b.vehicle.kind]
    || a.index - b.index);
  return candidates[0]?.vehicle ?? null;
}

/**
 * السيارة المناسبة من السيارات المتاحة: رحلة الاحتياجات الخاصة تحتاج سيارة مجهزة، والرحلة العادية تأخذ
 * سيارة عادية أولًا (تبقى المجهزة لمن يحتاجها). وبين المناسبة: الأقل رحلات اليوم (load) حتى يتوزع العمل،
 * ثم السيدان قبل الباص، ثم ترتيب الأسطول. rank (اختياري): تفضيل حسب مكان السيارة (الأقل أولًا) قبل عدد الرحلات.
 */
export function assignVehicle(vehicles: Vehicle[], kind: AppointmentKind, load: Map<string, number> = new Map(), rank?: (vehicle: Vehicle) => number) {
  const candidates = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .filter(({ vehicle }) => inService(vehicle) && (kind !== "احتياجات خاصة" || vehicle.kind === "احتياجات خاصة"));
  return pickVehicle(candidates, load, rank);
}

export const needsAccessibleVehicle = (appointments: Pick<ClinicAppointment, "kind">[]) => appointments.some((appointment) => appointment.kind === "احتياجات خاصة");

/**
 * السيارة المقترحة لرحلة (ضيف أو أكثر): من السيارات التي تناسبها الآن (vehicleRestriction: المقاعد والباصات)،
 * ثم كما في assignVehicle. باص المجمع آخر خيار حتى يبقى في المجمع، وبعده سيارة المدارس أو باص الجامعة الذي
 * يخرج لوقته المحجوز خلال ساعة (reservedSoon) حتى لا يتأخر عنه.
 */
export function assignVehicleForTrips(
  vehicles: Vehicle[],
  appointments: ClinicAppointment[],
  load: Map<string, number> = new Map(),
  rank?: (vehicle: Vehicle) => number,
  rules: VehicleRules & { transfer?: boolean; persons?: number } = {},
) {
  const trip = { appointments, transfer: rules.transfer, persons: rules.persons };
  const candidates = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .filter(({ vehicle }) => !vehicleRestriction(vehicle, trip, rules));
  const now = rules.now ?? new Date();
  return pickVehicle(candidates, load, rank, (vehicle) => (reservedSoon(vehicle, now, rules.schedules) ? 3 : busRoleOf(vehicle) === "shuttle" ? 2 : 1));
}

/**
 * أقصى عدد أشخاص في رحلة مجمّعة فيها هذا الموعد: أكبر سيارة تناسبه من السيارات المعطاة (الباص 14 إن كان يناسبه الآن،
 * والسيدان 4 إن شُغّلت بطاقتها الكاملة)، وإلا groupCapacity. سيارة الاحتياجات الخاصة لضيف الاحتياجات الخاصة فقط
 * (4 مع ثلاثة عاديين)، ولا تُحسب لجمع ضيوف عاديين حتى تبقى لمن يحتاجها. لجمع الرحلات (buildTripGroups).
 */
export function seatsFor(vehicles: Vehicle[], rules: VehicleRules = {}) {
  return (appointment: ClinicAppointment) => {
    const special = appointment.kind === "احتياجات خاصة";
    return Math.max(
      groupCapacity(appointment.kind),
      ...vehicles
        .filter((vehicle) => (vehicle.kind === "احتياجات خاصة") === special && !vehicleRestriction(vehicle, { appointments: [appointment] }, rules))
        .map((vehicle) => vehicleSeats(vehicle)),
    );
  };
}

/** رحلة في خطة التوزيع: الطلبات ومواعيدها بنفس الترتيب، وعدد الأشخاص فيها (مع المرافقين والـ Nurse) */
export type PlannedTrip = { requestIds: string[]; appointments: ClinicAppointment[]; direction: VehicleRequest["direction"]; persons: number };
export type DispatchPlan = {
  /** رحلة (ضيف أو أكثر مجمّعين) وسيارتها */
  assignments: (PlannedTrip & { vehicle: Vehicle })[];
  /** رحلات لا توجد لها سيارة متاحة الآن */
  waiting: PlannedTrip[];
};

/**
 * خطة توزيع كل الطلبات المنتظرة على السيارات المتاحة الآن (كل سيارة رحلة واحدة):
 * - الرحلات القابلة للجمع (buildTripGroups) تذهب في سيارة واحدة (حتى 14 شخصًا في الباص إن كان يناسبها).
 * - حالات السرطان أولًا (أولوية)، ثم رحلات الاحتياجات الخاصة لأن سياراتها أقل، ثم الأقرب موعدًا.
 * - كل رحلة تأخذ السيارة المناسبة الأقل رحلات اليوم، فيتوزع العمل على كل السيارات.
 * - الرحلة المجمّعة الأكبر من السيارة المتبقية تُقسم (3 أشخاص في كل سيارة).
 * - rank (اختياري): تفضيل حسب مكان السيارة لكل رحلة (مثل سيارة خارج المجمع قريبة من ضيف العودة).
 */
export function planDispatch(
  /**
   * at (اختياري): وقت الحاجة إلى السيارة لكل رحلة (neededAt من وقت الطلب) لجمع الرحلات.
   * persons (اختياري): عدد الأشخاص في الرحلة (requestPersons)، وإلا من احتياجات الضيف.
   */
  trips: { request: VehicleRequest; appointment: ClinicAppointment; at?: Date; persons?: number }[],
  vehicles: Vehicle[],
  load: Map<string, number> = new Map(),
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  rank?: (trip: PlannedTrip, vehicle: Vehicle) => number,
  rules: VehicleRules = {},
): DispatchPlan {
  const byAppointment = new Map(trips.map((trip) => [trip.appointment.id, trip]));
  const personsOf = new Map(trips.map((trip) => [trip.request.id, trip.persons ?? tripPersons(trip.appointment, trip.request)]));
  const sum = (requestIds: string[]) => requestIds.reduce((total, id) => total + (personsOf.get(id) ?? 1), 0);
  const free = vehicles.filter(inService);
  const vehicleRules = { ...rules, hospitals };
  const units: PlannedTrip[] = [];
  const grouped = new Set<string>();
  // النقل بين موعدين يبدأ من مستشفى، فلا يُجمع مع رحلات تبدأ من المجمع
  const groupable = trips.filter((trip) => !isTransfer(trip.request));
  const transferIds = new Set(trips.filter((trip) => isTransfer(trip.request)).map((trip) => trip.request.id));
  const unit = (members: typeof trips, direction: VehicleRequest["direction"]): PlannedTrip => {
    const requestIds = members.map((trip) => trip.request.id);
    return { requestIds, appointments: members.map((trip) => trip.appointment), direction, persons: sum(requestIds) };
  };
  const groups = buildTripGroups(
    groupable.map((trip) => ({ appointment: trip.appointment, direction: trip.request.direction, at: trip.at, persons: personsOf.get(trip.request.id) })),
    hospitals,
    seatsFor(free, vehicleRules),
  );
  for (const group of groups) {
    const members = group.appointmentIds.map((id) => byAppointment.get(id)).filter((trip): trip is NonNullable<typeof trip> => Boolean(trip));
    if (members.length < 2) continue;
    members.forEach((trip) => grouped.add(trip.appointment.id));
    units.push(unit(members, group.direction));
  }
  for (const trip of trips) {
    if (!grouped.has(trip.appointment.id)) units.push(unit([trip], trip.request.direction));
  }
  const startOf = (item: PlannedTrip) => item.appointments.map((appointment) => `${appointment.appointmentDate} ${appointment.appointmentAt}`).sort()[0];
  // حالات السرطان أولًا، ثم الاحتياجات الخاصة (سياراتها أقل)، ثم الأقرب موعدًا
  const priority = (item: PlannedTrip) => item.appointments.some(isPriority);
  units.sort((a, b) => Number(priority(b)) - Number(priority(a))
    || Number(needsAccessibleVehicle(b.appointments)) - Number(needsAccessibleVehicle(a.appointments))
    || startOf(a).localeCompare(startOf(b)));

  const plan: DispatchPlan = { assignments: [], waiting: [] };
  const queue = [...units];
  while (queue.length) {
    const next = queue.shift()!;
    const transfer = next.requestIds.some((id) => transferIds.has(id));
    const vehicle = assignVehicleForTrips(free, next.appointments, load, rank && ((candidate) => rank(next, candidate)), { ...vehicleRules, transfer, persons: next.persons });
    if (vehicle) {
      free.splice(free.indexOf(vehicle), 1);
      plan.assignments.push({ ...next, vehicle });
      continue;
    }
    // رحلة مجمّعة للباص وأُخذ الباص: تُقسم على السيارات بالترتيب الزمني، كل سيارة حتى 3 أشخاص (4 مع ضيف احتياجات خاصة)
    const size = groupSeats(next.appointments);
    if (next.appointments.length > 1 && next.persons > size) {
      const order = next.appointments.map((appointment, index) => ({ appointment, id: next.requestIds[index] }))
        .sort((a, b) => a.appointment.appointmentAt.localeCompare(b.appointment.appointmentAt));
      const parts: PlannedTrip[] = [];
      let part: typeof order = [];
      const close = () => {
        if (!part.length) return;
        const requestIds = part.map((item) => item.id);
        parts.push({ requestIds, appointments: part.map((item) => item.appointment), direction: next.direction, persons: sum(requestIds) });
        part = [];
      };
      for (const item of order) {
        if (part.length && sum([...part.map((member) => member.id), item.id]) > size) close();
        part.push(item);
      }
      close();
      queue.unshift(...parts);
      continue;
    }
    plan.waiting.push(next);
  }
  plan.assignments.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  plan.waiting.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return plan;
}

/** المسافة التي تُعتبر فيها الوجهتان متجاورتين (مثل مباني مدينة حمد الطبية). */
export const NEARBY_KM = 3;
/** وجهتان في نفس الاتجاه يمكن توصيلهما في رحلة واحدة. */
export const SAME_DIRECTION_KM = 8;

function hospitalFor(appointment: ClinicAppointment, hospitals: Hospital[]) {
  if (isNonMedical(appointment)) return nonMedicalPlace(appointment);
  // الحالة المستعجلة إلى عيادة المجمع (ليست في الدليل)
  if (appointment.hospitalId === COMPLEX_CLINIC.id) return COMPLEX_CLINIC;
  return (appointment.hospitalId && hospitals.find((hospital) => hospital.id === appointment.hospitalId))
    || matchHospital(appointment.clinic, hospitals);
}

/** مستشفى الموعد من الدليل، أو موقع وجهة الرحلة غير الطبية (null للوجهات غير المعروفة). */
export function appointmentHospital(appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  return hospitalFor(appointment, hospitals) || null;
}

/** منطقة المستشفى (مثل «مدينة حمد الطبية») لموعد، إن كان المستشفى في الدليل. */
export function matchHospitalZone(appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  return hospitalFor(appointment, hospitals)?.zone ?? null;
}

/**
 * نقاط الجمع (لترتيب الاقتراحات): 45 للقرب الزمني ناقص فرق الدقائق،
 * +25 لنفس الوجهة أو +20 لوجهات متجاورة (≤ 3 كم) أو +10 لنفس الاتجاه (≤ 8 كم)، +10 لنفس نوع الرحلة.
 * المبنى لا يُحتسب: كل مباني المجمع متقاربة. times (اختياري): وقت الحاجة إلى السيارة لكل موعد
 * (neededAt في shared/trips.ts، من وقت الطلب)، وإلا وقت الموعدين. المواعيد في أيام مختلفة لا تُجمع.
 */
export function calculateTripGroupingScore(first: ClinicAppointment, second: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS, times?: [Date, Date]) {
  const [firstAt, secondAt] = times ?? [appointmentDateTime(first), appointmentDateTime(second)];
  const timeGapMinutes = Math.round(Math.abs(firstAt.getTime() - secondAt.getTime()) / 60000);
  const sameBuilding = first.buildingNumber.trim().toLowerCase() === second.buildingNumber.trim().toLowerCase();
  // الرحلة غير الطبية ذات الموقع تُقارن بالمستشفيات مثل أي وجهة: تُجمع مع موعد طبي قريب منها
  const firstHospital = hospitalFor(first, hospitals);
  const secondHospital = hospitalFor(second, hospitals);
  const sameDestination = firstHospital && secondHospital
    ? firstHospital.id === secondHospital.id
    : first.clinic.trim().toLowerCase() === second.clinic.trim().toLowerCase();
  const destinationKm = firstHospital && secondHospital ? distanceKm(firstHospital, secondHospital) : null;
  const nearbyDestination = !sameDestination && destinationKm !== null && destinationKm <= NEARBY_KM;
  const sameDirection = !sameDestination && !nearbyDestination && destinationKm !== null && destinationKm <= SAME_DIRECTION_KM;
  const compatibleVehicle = first.kind === second.kind;
  const timeScore = Math.max(0, 45 - timeGapMinutes);
  const destinationScore = sameDestination ? 25 : nearbyDestination ? 20 : sameDirection ? 10 : 0;
  const score = timeScore + destinationScore + (compatibleVehicle ? 10 : 0);
  return {
    score,
    timeGapMinutes,
    sameBuilding,
    sameDestination,
    nearbyDestination,
    sameDirection,
    destinationKm,
    zone: nearbyDestination && firstHospital?.zone === secondHospital?.zone ? firstHospital?.zone ?? null : null,
    compatibleVehicle,
  };
}

export function suggestTripGroups(appointments: ClinicAppointment[], hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  const suggestions: TripGroupSuggestion[] = [];
  for (let firstIndex = 0; firstIndex < appointments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < appointments.length; secondIndex += 1) {
      const first = appointments[firstIndex];
      const second = appointments[secondIndex];
      const details = calculateTripGroupingScore(first, second, hospitals);
      if (!canShareVehicle(details, 45)) continue;
      const reasons = [
        details.sameDestination ? "نفس الوجهة" : null,
        details.nearbyDestination ? `وجهات متجاورة${details.zone ? ` (${details.zone})` : ""} ${details.destinationKm!.toFixed(1)} كم` : null,
        details.sameDirection ? `نفس الاتجاه ${details.destinationKm!.toFixed(1)} كم` : null,
        `فارق ${details.timeGapMinutes} دقيقة`,
      ].filter(Boolean);
      suggestions.push({
        appointmentIds: [first.id, second.id],
        score: details.score,
        timeGapMinutes: details.timeGapMinutes,
        reason: reasons.join(" · "),
      });
    }
  }
  return suggestions.sort((a, b) => b.score - a.score || a.timeGapMinutes - b.timeGapMinutes);
}


export const VEHICLE_KINDS: VehicleKind[] = ["سيدان", "احتياجات خاصة", "باص"];

/** يتحقق من بيانات سيارة قبل الحفظ (رقمها ونوعها؛ السائق منفصل عنها) ويعيدها بصيغة موحدة، أو يعيد رسالة الخطأ. */
export function validateVehicle(
  input: Pick<Vehicle, "plate" | "kind">,
  vehicles: Vehicle[],
  originalPlate?: string,
): { vehicle: Pick<Vehicle, "plate" | "kind"> } | { error: string } {
  const plate = toWesternDigits(toText(input.plate)).replace(/\s+/g, "");
  if (!/^[0-9A-Za-z-]{2,12}$/.test(plate)) return { error: "رقم السيارة يجب أن يكون من 2 إلى 12 رقمًا أو حرفًا" };
  if (!VEHICLE_KINDS.includes(input.kind)) return { error: "اختر نوع سيارة صحيحًا" };
  if (plate !== originalPlate && vehicles.some((vehicle) => vehicle.plate === plate)) {
    return { error: `رقم السيارة ${plate} مسجل مسبقًا` };
  }
  return { vehicle: { plate, kind: input.kind } };
}

/** تحديث بيانات سيارة (من لوحة المدير أو ملف Excel): تخصيص الباص للباص فقط، والطاقة الكاملة للسيدان فقط. */
export function mergeVehicle(vehicle: Vehicle, changes: Partial<Vehicle>): Vehicle {
  const next = { ...vehicle, ...changes };
  // تخصيص الباص للباص، وسيارة المدارس لسيارة الاحتياجات الخاصة
  if (next.busRole && !(next.kind === "باص" ? (BUS_ROLES as VehicleRole[]).includes(next.busRole) : next.kind === "احتياجات خاصة" && next.busRole === SCHOOL_ROLE)) delete next.busRole;
  if (next.kind !== "سيدان" || !next.fullCapacity) delete next.fullCapacity;
  return next;
}

/** السيارات المرتبطة برحلة جارية لا يُسمح بتغيير رقمها أو حذفها. */
export function vehicleHasActiveTrip(plate: string, requests: VehicleRequest[], now = new Date()) {
  return requests.some((request) => request.vehiclePlate === plate
    && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة"
      // في الطريق إلى الوجهة ولم تنتهِ مدته التقديرية
      || (request.status === "تم استلام المريض" && Boolean(request.etaAt) && !request.arrivedAt && Date.parse(request.etaAt!) > now.getTime())));
}

/** قائمة السيارات الأولية (من ملف السائقين)؛ تُحفظ في قاعدة البيانات عند أول دخول للمدير ثم يعدّلها من لوحته. */
/** السيارات الأولية، وكل سيارة مخصصة لسائقها في الورقة (DRIVERS_SEED في seedData.ts) */
export const DEFAULT_VEHICLES: Vehicle[] = FLEET_SEED.map((vehicle, index) => ({ ...vehicle, driverId: `D-${index + 1}` }));

// ————— جمع الرحلات —————

/**
 * أقصى عدد أشخاص في رحلة مجمّعة (مع المرافقين والـ Nurse) بلا باص ولا سيدان بطاقتها الكاملة: 3 في السيدان،
 * و4 مع ضيف احتياجات خاصة في سيارته (هو و3 عاديون). الباص 14 والسيدان بطاقتها الكاملة 4: vehicleSeats.
 */
export function groupCapacity(kind: AppointmentKind) {
  return kind === "احتياجات خاصة" ? ACCESSIBLE_SEATS : SEDAN_PREFERRED_SEATS;
}

/** مقاعد رحلة مجمّعة بلا باص: 4 إن كان فيها ضيف احتياجات خاصة (في سيارته)، وإلا 3. */
export const groupSeats = (appointments: Pick<ClinicAppointment, "kind">[]) =>
  (needsAccessibleVehicle(appointments) ? ACCESSIBLE_SEATS : SEDAN_PREFERRED_SEATS);

export type TripGroup = {
  appointmentIds: string[];
  /** عدد الأشخاص (الضيوف ومرافقوهم والـ Nurse) */
  persons: number;
  direction: VehicleRequest["direction"];
  /** أقل نقاط بين أي موعدين في المجموعة */
  score: number;
  /** الفرق بين أول وآخر موعد */
  spanMinutes: number;
  reason: string;
};

/** أقصى فرق بين وقتي الحاجة إلى السيارة لجمع ضيفين، حسب قرب وجهتيهما (المبنى لا يهم: مباني المجمع متقاربة). */
export const GROUP_GAP_MINUTES = { sameDestination: 45, nearby: 30, sameDirection: 15 };

/**
 * موعدان يُجمعان في سيارة واحدة: نفس الوجهة خلال 45 دقيقة، ووجهتان متجاورتان (≤ 3 كم) خلال 30،
 * وفي نفس الاتجاه (≤ 8 كم) خلال 15، ولا أكثر من maxGapMinutes (30 لضمّ ضيف إلى سيارة في الطريق).
 * الفرق بين وقتي الحاجة إلى السيارة (من وقت الطلب) إن أُعطيت لـ calculateTripGroupingScore.
 */
export function canShareVehicle(details: ReturnType<typeof calculateTripGroupingScore>, maxGapMinutes: number) {
  const limit = details.sameDestination ? GROUP_GAP_MINUTES.sameDestination
    : details.nearbyDestination ? GROUP_GAP_MINUTES.nearby
      : details.sameDirection ? GROUP_GAP_MINUTES.sameDirection
        : -1;
  return details.timeGapMinutes <= Math.min(limit, maxGapMinutes);
}

function pairReason(details: ReturnType<typeof calculateTripGroupingScore>) {
  if (details.sameDestination) return "نفس الوجهة";
  if (details.nearbyDestination) return `وجهات متجاورة${details.zone ? ` (${details.zone})` : ""}`;
  return details.sameDirection ? "نفس الاتجاه" : "توقيت متقارب";
}

/**
 * يبني مجموعات رحلات (حتى 3 مرضى، وحتى 14 إن كان باص يناسبهم: seats) من الطلبات بانتظار التوزيع.
 * كل موعدين داخل المجموعة يجب أن يكونا متوافقين (canShareVehicle: قرب الوجهتين والفرق الزمني)،
 * ولا تُخلط رحلات الذهاب مع العودة، ولا يُتجاوز عدد المقاعد.
 * at (اختياري): وقت الحاجة إلى السيارة لكل رحلة (neededAt: من وقت الطلب)، وإلا وقت الموعد.
 */
export function buildTripGroups(
  /** persons (اختياري): عدد الأشخاص مع الضيف (requestPersons)، وإلا من احتياجاته */
  items: { appointment: ClinicAppointment; direction: VehicleRequest["direction"]; at?: Date; persons?: number }[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** أقصى عدد أشخاص في رحلة فيها هذا الموعد (seatsFor: الباص 14)، وإلا groupCapacity */
  seats?: (appointment: ClinicAppointment) => number,
): TripGroup[] {
  const groups: TripGroup[] = [];
  const timeOf = new Map(items.map((item) => [item.appointment.id, item.at ?? appointmentDateTime(item.appointment)]));
  const seatsOf = new Map(items.map((item) => [item.appointment.id, seats ? seats(item.appointment) : groupCapacity(item.appointment.kind)]));
  const personsOf = new Map(items.map((item) => [item.appointment.id, item.persons ?? tripPersons(item.appointment)]));
  const cap = (appointment: ClinicAppointment) => seatsOf.get(appointment.id) ?? groupCapacity(appointment.kind);
  const people = (appointment: ClinicAppointment) => personsOf.get(appointment.id) ?? 1;
  const total = (members: ClinicAppointment[]) => members.reduce((sum, member) => sum + people(member), 0);
  // مقاعد المجموعة: مع ضيف احتياجات خاصة سيارته (4)، وإلا أصغر سيارة تناسب كل الأعضاء؛ ولا ضيفا احتياجات خاصة معًا
  const capacityOf = (members: ClinicAppointment[]) => {
    const specials = members.filter((member) => member.kind === "احتياجات خاصة");
    return Math.min(...(specials.length ? specials : members).map(cap));
  };
  const fitsTogether = (members: ClinicAppointment[]) =>
    specialCount(members) <= MAX_SPECIAL_PER_VEHICLE && total(members) <= capacityOf(members);
  const byRequest = items.some((item) => item.at);
  for (const direction of ["ذهاب", "عودة"] as const) {
    const list = items.filter((item) => item.direction === direction).map((item) => item.appointment);
    const score = new Map<string, ReturnType<typeof calculateTripGroupingScore>>();
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const pairs: { a: ClinicAppointment; b: ClinicAppointment; details: ReturnType<typeof calculateTripGroupingScore> }[] = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const details = calculateTripGroupingScore(list[i], list[j], hospitals, [timeOf.get(list[i].id)!, timeOf.get(list[j].id)!]);
        score.set(key(list[i].id, list[j].id), details);
        if (fitsTogether([list[i], list[j]]) && canShareVehicle(details, 45)) pairs.push({ a: list[i], b: list[j], details });
      }
    }
    pairs.sort((x, y) => y.details.score - x.details.score || x.details.timeGapMinutes - y.details.timeGapMinutes);
    const used = new Set<string>();
    const compatible = (a: ClinicAppointment, b: ClinicAppointment) => {
      const details = score.get(key(a.id, b.id));
      return Boolean(details && canShareVehicle(details, 45));
    };
    for (const pair of pairs) {
      if (used.has(pair.a.id) || used.has(pair.b.id)) continue;
      const members = [pair.a, pair.b];
      // توسيع المجموعة بكل موعد متوافق مع كل الأعضاء ما دامت المقاعد تكفي أشخاصه (مع المرافق والـ Nurse):
      // أولًا من لا يقلل المقاعد (ركاب الباص)، ثم الباقي
      for (const keepSeats of [true, false]) {
        for (const candidate of list) {
          if (used.has(candidate.id) || members.includes(candidate)) continue;
          const next = [...members, candidate];
          if (!fitsTogether(next) || (keepSeats && capacityOf(next) < capacityOf(members))) continue;
          if (members.every((member) => compatible(member, candidate))) members.push(candidate);
        }
      }
      members.forEach((member) => used.add(member.id));
      const pairDetails = members.flatMap((first, index) => members.slice(index + 1).map((second) => score.get(key(first.id, second.id))!));
      const times = members.map((member) => timeOf.get(member.id)!.getTime());
      const reasons = Array.from(new Set(pairDetails.map(pairReason)));
      const spanMinutes = Math.round((Math.max(...times) - Math.min(...times)) / 60000);
      // الفرق بين أوقات الانطلاق اللازمة (الذهاب) أو طلبات العودة، أو بين المواعيد إن لم تُعرف أوقات الطلب
      const span = !byRequest ? "المواعيد" : direction === "عودة" ? "طلبات العودة" : "الانطلاق";
      groups.push({
        appointmentIds: members.map((member) => member.id),
        persons: total(members),
        direction,
        score: Math.min(...pairDetails.map((details) => details.score)),
        spanMinutes,
        reason: [...reasons, spanMinutes ? `${span} خلال ${spanMinutes} دقيقة` : `${span} في نفس الوقت`].join(" · "),
      });
    }
  }
  return groups.sort((a, b) => b.appointmentIds.length - a.appointmentIds.length || b.score - a.score);
}

export type JoinSuggestion = {
  requestId: string;
  appointmentId: string;
  plate: string;
  groupId?: string;
  reason: string;
  /** السيارة استلمت ضيفها من المجمع: يمكن الضم حتى هذا الوقت (ISO) */
  openUntil?: string;
};

/** بعد استلام ضيف الذهاب تبقى السيارة في المجمع هذه الدقائق، يمكن فيها ضم ضيف آخر في نفس الاتجاه إليها. */
export const JOIN_AFTER_PICKUP_MINUTES = 5;

/**
 * هل يمكن ضم ضيف إلى رحلة هذا الطلب الآن: السيارة أُرسلت أو وصلت إلى نقطة الاستلام، أو (ذهابًا من المجمع)
 * استلمت ضيفها قبل JOIN_AFTER_PICKUP_MINUTES دقائق أو أقل. يعيد وقت انتهاء الضم بعد الاستلام، أو true، أو false.
 */
export function joinWindow(request: Pick<VehicleRequest, "status" | "direction" | "pickedUpAt" | "arrivedAt" | "vehiclePlate" | "fromAppointmentId">, now = new Date()): string | boolean {
  if (!request.vehiclePlate) return false;
  if (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") return true;
  if (request.status !== "تم استلام المريض" || request.direction !== "ذهاب" || request.fromAppointmentId || request.arrivedAt || !request.pickedUpAt) return false;
  const until = Date.parse(request.pickedUpAt) + JOIN_AFTER_PICKUP_MINUTES * 60000;
  return Number.isFinite(until) && now.getTime() <= until ? new Date(until).toISOString() : false;
}

/**
 * طلب جديد يمكن ضمّه لسيارة في رحلة: أُرسلت ولم تستلم ضيوفها بعد، أو استلمت ضيف الذهاب من المجمع قبل 5 دقائق
 * أو أقل (joinWindow)، متجهة لنفس الوجهة أو وجهة مجاورة أو في نفس الاتجاه وفي نفس التوقيت (at: وقت الحاجة إلى
 * السيارة من وقت الطلب، وإلا وقت الموعد)، بشرط وجود مقعد فارغ وأن تناسبه السيارة (vehicleRestriction).
 */
export function suggestJoinDispatched(
  /** persons (اختياري): عدد الأشخاص مع كل ضيف (requestPersons)، وإلا من احتياجاته */
  pending: { request: VehicleRequest; appointment: ClinicAppointment; at?: Date; persons?: number }[],
  dispatched: { request: VehicleRequest; appointment: ClinicAppointment; at?: Date; persons?: number }[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** السيارات: مقاعد السيارة في الطريق وقواعدها (الباص 14، وباص الجامعة للرحلات غير الطبية فقط) */
  vehicles: Vehicle[] = [],
  rules: VehicleRules = {},
): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const timeOf = (item: { appointment: ClinicAppointment; at?: Date }) => item.at ?? appointmentDateTime(item.appointment);
  const now = rules.now ?? new Date();
  const byTrip = new Map<string, (typeof dispatched)[number][]>();
  for (const item of dispatched) {
    if (!item.request.vehiclePlate) continue;
    const tripKey = item.request.groupId ?? item.request.id;
    byTrip.set(tripKey, [...(byTrip.get(tripKey) ?? []), item]);
  }
  // الرحلة كلها يجب أن تقبل الضم: إن استلمت السيارة ضيفًا قبل أكثر من 5 دقائق فقد غادرت
  const trips = Array.from(byTrip.values()).flatMap((members) => {
    const windows = members.map((member) => joinWindow(member.request, now));
    if (windows.some((window) => window === false)) return [];
    const closes = windows.filter((window): window is string => typeof window === "string").sort()[0];
    return [{ members, openUntil: closes }];
  });
  for (const item of pending) {
    let best: { suggestion: JoinSuggestion; score: number } | null = null;
    for (const { members, openUntil } of trips) {
      if (members[0].request.direction !== item.request.direction) continue;
      const vehicle = vehicles.find((candidate) => candidate.plate === members[0].request.vehiclePlate);
      const riders = [...members.map((member) => member.appointment), item.appointment];
      const personsOf = (trip: (typeof dispatched)[number]) => trip.persons ?? tripPersons(trip.appointment, trip.request);
      const onBoard = members.reduce((sum, member) => sum + personsOf(member), 0);
      const persons = onBoard + personsOf(item);
      if (vehicle) {
        if (vehicleRestriction({ ...vehicle, available: true }, { appointments: riders, persons }, { ...rules, hospitals })) continue;
      } else if (specialCount(riders) > MAX_SPECIAL_PER_VEHICLE || persons > groupSeats(riders)) continue;
      const scores = members.map((member) => calculateTripGroupingScore(member.appointment, item.appointment, hospitals, [timeOf(member), timeOf(item)]));
      if (!scores.every((details) => canShareVehicle(details, 30))) continue;
      const worst = Math.min(...scores.map((details) => details.score));
      if (!best || worst > best.score) {
        const riding = `${members.length} ${members.length === 1 ? "ضيف" : "ضيوف"}${onBoard > members.length ? ` · ${personsText(onBoard)}` : ""}`;
        best = {
          score: worst,
          suggestion: {
            requestId: item.request.id,
            appointmentId: item.appointment.id,
            plate: members[0].request.vehiclePlate!,
            groupId: members[0].request.groupId,
            reason: openUntil
              ? `${pairReason(scores[0])} · السيارة استلمت ضيفها وما زالت في المجمع (${riding})`
              : `${pairReason(scores[0])} · السيارة في الطريق (${riding})`,
            ...(openUntil ? { openUntil } : {}),
          },
        };
      }
    }
    if (best) out.push(best.suggestion);
  }
  return out;
}

export type UnrequestedMatch = {
  appointment: ClinicAppointment;
  /** الموعد الآخر (له طلب سيارة) الذي يطابقه في الوجهة والتوقيت */
  matchedAppointment: ClinicAppointment;
  matchedRequest: VehicleRequest;
  gapMinutes: number;
  sameDestination: boolean;
};

/**
 * مواعيد لم يُطلب لها سيارة بعد، ولها رحلة مطلوبة أو مرسلة لنفس الوجهة (أو وجهة مجاورة)
 * خلال 30 دقيقة. تظهر كتنبيه حتى يُطلب لها سيارة ضمن نفس الرحلة.
 */
export function findUnrequestedMatches(
  appointments: ClinicAppointment[],
  requests: VehicleRequest[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
): UnrequestedMatch[] {
  const requested = new Set(requests.map((request) => request.appointmentId));
  // طلب العودة فقط لا يُطلب له ذهاب، فلا يُقارن برحلات الذهاب
  const open = appointments.filter((appointment) => appointment.status === "بانتظار طلب السيارة"
    && !isReturnOnly(appointment)
    && !requested.has(appointment.id)
    && requestWindow(appointment, now).open);
  const active = requests
    .filter((request) => request.direction === "ذهاب" && (request.status === "بانتظار التوزيع" || request.status === "تم إرسال السيارة"))
    .map((request) => ({ request, appointment: appointments.find((item) => item.id === request.appointmentId) }))
    .filter((item): item is { request: VehicleRequest; appointment: ClinicAppointment } => Boolean(item.appointment));
  const matches: UnrequestedMatch[] = [];
  for (const appointment of open) {
    let best: UnrequestedMatch | null = null;
    for (const item of active) {
      const details = calculateTripGroupingScore(appointment, item.appointment, hospitals);
      if (details.timeGapMinutes > 30 || !(details.sameDestination || details.nearbyDestination)) continue;
      if (!best || details.timeGapMinutes < best.gapMinutes) {
        best = { appointment, matchedAppointment: item.appointment, matchedRequest: item.request, gapMinutes: details.timeGapMinutes, sameDestination: details.sameDestination };
      }
    }
    if (best) matches.push(best);
  }
  return matches.sort((a, b) => byTime(a.appointment, b.appointment));
}

const byTime = (a: ClinicAppointment, b: ClinicAppointment) => appointmentDateTime(a).getTime() - appointmentDateTime(b).getTime();

// ————— رسالة السائق (عربي / إنجليزي) —————

const KIND_EN: Record<AppointmentKind, string> = { "عادي": "Regular", "احتياجات خاصة": "Special needs" };
const NEED_EN: Record<AssistanceNeed, string> = { "يحتاج مرافق": "Needs escort", "يحتاج Nurse": "Needs nurse", "كرسي متحرك": "Wheelchair" };

/**
 * وجهات الرحلات غير الطبية (مع «أخرى» تُكتب يدويًا). الوجهة التي لها موقع (من خرائط جوجل، ورمز Plus Code بجانبها)
 * يُحسب لها الوصول المتوقع والوصول بالـ GPS والملاحة للسائق مثل المستشفى (nonMedicalPlace).
 */
export const NON_MEDICAL_DESTINATIONS: { ar: string; en: string; place?: Pick<Hospital, "id" | "zone" | "lat" | "lng"> }[] = [
  { ar: "الجامعة", en: "University" },
  { ar: "المدرسة", en: "School" },
  { ar: "أنصار جاليري المطار القديم", en: "Ansar Gallery, Old Airport" },
  { ar: "جامعة الدوحة للعلوم والتكنولوجيا", en: "University of Doha for Science and Technology", place: { id: "nm-udst", zone: "الدوحة", lat: 25.360687, lng: 51.481062 } }, // 9F6J+7C الدوحة
  { ar: "جامعة أوريكس", en: "Oryx University (Liverpool John Moores University)", place: { id: "nm-oryx", zone: "الدوحة", lat: 25.270562, lng: 51.492187 } }, // 7FCR+6V الدوحة
  { ar: "جامعة لوسيل", en: "Lusail University", place: { id: "nm-lusail-university", zone: "لوسيل", lat: 25.402188, lng: 51.512937 } }, // CG27+V5 الدوحة
  { ar: "المدرسة الفلسطينية", en: "Palestinian School", place: { id: "nm-palestinian-school", zone: "الدوحة", lat: 25.222313, lng: 51.495812 } }, // 6FCW+W8 الدوحة
  { ar: "معهد النور", en: "Al Noor Center", place: { id: "nm-al-noor", zone: "الدوحة", lat: 25.340688, lng: 51.465203 } }, // 8FR8+73G الدوحة
];

export const isNonMedical = (appointment: Pick<ClinicAppointment, "category">) => appointment.category === "غير طبية";

/**
 * رحلة غير طبية لم تُرسل سيارتها (قبل طلب سيارتها، أو كل طلباتها بانتظار التوزيع): يعدّلها مشرف السيارات أو يحذفها.
 * بعد إرسال السيارة تبقى كما هي (non_medical_open في api/lib/rules.php).
 */
export function nonMedicalOpen(appointment: Pick<ClinicAppointment, "id" | "category" | "status">, requests: Pick<VehicleRequest, "appointmentId" | "status">[]) {
  return isNonMedical(appointment) && (appointment.status === "بانتظار طلب السيارة" || appointment.status === "تم طلب السيارة")
    && requests.every((request) => request.appointmentId !== appointment.id || request.status === "بانتظار التوزيع");
}

// ————— الرحلة غير الطبية المتكررة —————

/** أيام الأسبوع (0 الأحد … 6 السبت، مثل getUTCDay) */
export const WEEKDAY_NAMES = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] as const;
/** أيام التكرار الافتراضية: الأحد إلى الخميس */
export const RECURRING_DEFAULT_DAYS = [0, 1, 2, 3, 4];
/** أطول مدة للتكرار في المرة الواحدة (3 أشهر تقريبًا)، حتى لا تمتلئ القوائم برحلات بعيدة */
export const RECURRING_MAX_DAYS = 92;

const dayOf = (date: string) => new Date(`${date}T00:00:00Z`);
/** اليوم بعد عدد من الأيام (YYYY-MM-DD) */
export function addDays(date: string, days: number) {
  const next = dayOf(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * أيام الرحلة المتكررة من start إلى end (مع الطرفين) التي يقع يومها في days. null إن كانت النهاية قبل البداية
 * أو أبعد من RECURRING_MAX_DAYS يومًا.
 */
export function recurringDates(start: string, end: string, days: readonly number[]): string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
  if (end > addDays(start, RECURRING_MAX_DAYS)) return null;
  const wanted = new Set(days);
  const dates: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) if (wanted.has(dayOf(date).getUTCDay())) dates.push(date);
  return dates;
}

/**
 * رحلات السلسلة القادمة التي يمكن إيقافها: من يوم from فصاعدًا، لم يُطلب لها سيارة بعد، أو طُلبت ولم تُرسل
 * (طلبها بانتظار التوزيع).
 */
export function stoppableSeriesTrips(appointments: ClinicAppointment[], requests: VehicleRequest[], seriesId: string, from: string) {
  return appointments
    .filter((appointment) => appointment.seriesId === seriesId && appointment.appointmentDate >= from
      && (appointment.status === "بانتظار طلب السيارة" || appointment.status === "تم طلب السيارة"))
    .map((appointment) => ({ appointment, requests: requests.filter((request) => request.appointmentId === appointment.id) }))
    .filter((trip) => trip.requests.every((request) => request.status === "بانتظار التوزيع"))
    .sort((a, b) => byTime(a.appointment, b.appointment));
}

/** موقع وجهة الرحلة غير الطبية (بشكل مستشفى من الدليل)، أو null للوجهة بلا موقع («الجامعة» أو «أخرى» مكتوبة). */
export function nonMedicalPlace(appointment: Pick<ClinicAppointment, "category" | "clinic">): Hospital | null {
  if (!isNonMedical(appointment)) return null;
  const destination = NON_MEDICAL_DESTINATIONS.find((item) => item.ar === appointment.clinic.trim());
  return destination?.place ? { ...destination.place, name: destination.ar, nameEn: destination.en, aliases: [], verified: true } : null;
}

/** اسم الوجهة بالعربية والإنجليزية (من دليل المستشفيات، أو قائمة الرحلات غير الطبية). */
export function destinationLabels(appointment: ClinicAppointment, hospitals: Hospital[]) {
  if (isNonMedical(appointment)) {
    const known = NON_MEDICAL_DESTINATIONS.find((item) => item.ar === appointment.clinic);
    return { ar: appointment.clinic, en: known?.en ?? appointment.clinic };
  }
  const hospital = appointment.hospitalId === COMPLEX_CLINIC.id ? COMPLEX_CLINIC
    : (appointment.hospitalId && hospitals.find((item) => item.id === appointment.hospitalId)) || matchHospital(appointment.clinic, hospitals);
  return { ar: hospital?.name ?? appointment.clinic, en: hospital?.nameEn || appointment.clinic };
}

/** رسالة واتساب للسائق بالعربية ثم الإنجليزية؛ تدعم رحلة واحدة أو رحلة مجمّعة. */
export function buildDriverMessage(
  /**
   * from: الموعد الأول في رحلة النقل بين موعدين (الاستلام من مستشفاه).
   * persons: عدد الأشخاص مع الضيف (requestPersons)، وإلا من احتياجاته.
   */
  trips: { appointment: ClinicAppointment; request: VehicleRequest; from?: ClinicAppointment | null; persons?: number }[],
  vehicle: Pick<Vehicle, "plate" | "driver">,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** قائمة ضيوف المجمع: اسم الضيف الإنجليزي في النصف الإنجليزي من الرسالة (وإلا الاسم كما في الموعد) */
  guests: Guest[] = [],
) {
  const sorted = [...trips].sort((a, b) => byTime(a.appointment, b.appointment));
  const index = guestIndex(guests);
  const englishName = (appointment: ClinicAppointment) => guestOfAppointment(index, appointment)?.nameEn || appointment.patientName;
  const returning = sorted[0]?.request.direction === "عودة";
  const transfer = Boolean(sorted[0]?.from);
  const nurseLeg = sorted.length > 0 && sorted.every((trip) => trip.request.nurseOnly);
  const leg = nurseLeg
    ? { ar: "عودة الـ Nurse فقط", en: "Nurse return only" }
    : { ar: transfer ? "نقل بين موعدين" : returning ? "عودة" : "ذهاب", en: transfer ? "Transfer between appointments" : returning ? "Return" : "Outbound" };
  // عدد الأشخاص دائمًا بجانب رقم السيارة: الضيف ومرافقه والـ Nurse (وفي الرحلة المجمّعة مجموعهم، وعدد كل ضيف تحته)
  const grouped = sorted.length > 1;
  const peopleOf = (trip: (typeof sorted)[number]) => trip.persons ?? tripPersons(trip.appointment, trip.request);
  const totalPeople = sorted.reduce((sum, trip) => sum + peopleOf(trip), 0);
  // الحالة المستعجلة في شفت الليل (إلى عيادة المجمع أو منها إلى المستشفى)
  const urgent = sorted.some((trip) => trip.appointment.urgent);
  const ar: string[] = [
    ...(urgent ? ["🚨 حالة مستعجلة"] : []),
    grouped ? `رحلة مجمّعة (${sorted.length} ضيوف) — ${leg.ar}` : `رحلة جديدة — ${leg.ar}`,
    `السيارة: ${vehicle.plate}`,
    grouped ? `مجموع الأشخاص في السيارة: ${totalPeople}` : `عدد الأشخاص: ${totalPeople}`,
  ];
  const en: string[] = [
    ...(urgent ? ["🚨 URGENT case"] : []),
    grouped ? `Grouped trip (${sorted.length} guests) — ${leg.en}` : `New trip — ${leg.en}`,
    `Vehicle: ${vehicle.plate}`,
    grouped ? `Total persons in the car: ${totalPeople}` : `Persons: ${totalPeople}`,
  ];
  sorted.forEach((trip, index) => {
    const { appointment, request, from } = trip;
    const destination = destinationLabels(appointment, hospitals);
    const prefix = sorted.length > 1 ? `${index + 1}) ` : "";
    // الممرضة من قائمة الممرضات تُذكر باسم وظيفتها
    const rider = isNonMedical(appointment) ? { ar: "الراكب", en: "Passenger" } : appointment.nurse ? { ar: "الممرضة", en: "Nurse" } : { ar: "الضيف", en: "Guest" };
    // عودة الـ Nurse فقط: الراكب هو الـ Nurse ويبقى الضيف في موعده
    const nurse = Boolean(request.nurseOnly);
    const people = peopleOf(trip);
    const needsAr = nurse ? "" : appointment.assistance.join("، ");
    const needsEn = nurse ? "" : appointment.assistance.map((need) => NEED_EN[need]).join(", ");
    // في النقل بين موعدين يُستلم الضيف من مستشفى موعده الأول
    const firstPlace = from ? destinationLabels(from, hospitals) : null;
    const pickupAr = firstPlace ? `${firstPlace.ar} (بعد موعده ${from!.appointmentAt})` : `مبنى ${appointment.buildingNumber}، شقة ${appointment.apartmentNumber}`;
    const pickupEn = firstPlace ? `${firstPlace.en} (after appointment ${from!.appointmentAt})` : `Building ${appointment.buildingNumber}, Apt ${appointment.apartmentNumber}`;
    ar.push(
      "",
      nurse
        ? `${prefix}الراكب: الـ Nurse مرافقة الضيف ${appointment.patientName} (عودة الـ Nurse فقط)`
        : `${prefix}${rider.ar}: ${appointment.patientName}${appointment.gender ? ` (${appointment.gender})` : ""}${isNonMedical(appointment) ? " (رحلة غير طبية)" : ""}`,
      returning ? `من: ${destination.ar}` : `من: ${pickupAr}`,
      returning ? `إلى: ${pickupAr}` : `إلى: ${destination.ar}`,
      `${isNonMedical(appointment) ? "الوقت" : "الموعد"}: ${appointment.appointmentDate} ${appointment.appointmentAt}`,
      `جوال ${rider.ar}: ${appointment.mobile}`,
      `نوع الرحلة: ${appointment.kind}${needsAr ? ` · ${needsAr}` : ""}`,
      ...(grouped ? [`عدد الأشخاص: ${people}`] : []),
    );
    en.push(
      "",
      nurse
        ? `${prefix}Passenger: Nurse escorting guest ${englishName(appointment)} (nurse return only)`
        : `${prefix}${rider.en}: ${englishName(appointment)}${appointment.gender ? ` (${appointment.gender === "أنثى" ? "female" : "male"})` : ""}${isNonMedical(appointment) ? " (non-medical trip)" : ""}`,
      returning ? `From: ${destination.en}` : `From: ${pickupEn}`,
      returning ? `To: ${pickupEn}` : `To: ${destination.en}`,
      `${isNonMedical(appointment) ? "Time" : "Appointment"}: ${appointment.appointmentDate} ${appointment.appointmentAt}`,
      `${rider.en} mobile: ${appointment.mobile}`,
      `Trip type: ${KIND_EN[appointment.kind]}${needsEn ? ` · ${needsEn}` : ""}`,
      ...(grouped ? [`Persons: ${people}`] : []),
    );
  });
  return [...ar, "", "—————", "", ...en].join("\n");
}

/** رقم واتساب دولي: الأرقام القطرية المكونة من 8 أرقام تُسبق بـ 974. */
export function whatsappNumber(phone: string) {
  const digits = toWesternDigits(phone).replace(/\D/g, "").replace(/^00/, "");
  return digits.length === 8 ? `974${digits}` : digits;
}

export function whatsappLink(phone: string, message: string) {
  return `https://wa.me/${whatsappNumber(phone)}?text=${encodeURIComponent(message)}`;
}
