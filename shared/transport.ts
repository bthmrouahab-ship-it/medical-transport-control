import { DEFAULT_HOSPITALS, distanceKm, matchHospital, type Hospital } from "./hospitals";
import { FLEET_SEED } from "./seedData";
import { normalizeGender, normalizeMobile, readAliased, toText, toWesternDigits } from "./text";
import { findGuestByName, guestIndex, type Guest } from "./guests";

export type AppointmentKind = "عادي" | "احتياجات خاصة";
export type VehicleKind = "سيدان" | "احتياجات خاصة" | "باص";
export type AssistanceNeed = "يحتاج مرافق" | "يحتاج Nurse" | "كرسي متحرك";
/** احتياجات الضيف بترتيب ظهورها في النماذج: مرافق وممرض (Nurse) خياران منفصلان. */
export const ASSISTANCE_NEEDS: AssistanceNeed[] = ["يحتاج مرافق", "يحتاج Nurse", "كرسي متحرك"];
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
};

/** بانتظار موافقة مسؤول العيادة، أو موافق عليه، أو مستبعد (بلا حذف). */
export type Approval = "pending" | "approved" | "excluded";
export const approvalOf = (appointment: Pick<ClinicAppointment, "approval">): Approval => appointment.approval ?? "approved";
/** يظهر لمشرف المبنى: موافق عليه (أو موعد قديم بلا حالة موافقة) */
export const isApproved = (appointment: Pick<ClinicAppointment, "approval">) => approvalOf(appointment) === "approved";

export type Gender = "ذكر" | "أنثى";
export const GENDERS: Gender[] = ["ذكر", "أنثى"];

/** أولوية في إرسال السيارة (حالات السرطان): تظهر أولًا لمشرف السيارات وتأخذ السيارة قبل غيرها في التوزيع. */
export const isPriority = (appointment: Pick<ClinicAppointment, "cancer">) => Boolean(appointment.cancer);

export type Vehicle = {
  plate: string;
  driver: string;
  phone: string;
  kind: VehicleKind;
  available: boolean;
  /** للباص فقط: تخصيصه اليومي من مشرف السيارات (BusRole)، وبلا تخصيص باص عادي */
  busRole?: BusRole;
};

/**
 * تخصيص الباص يختاره مشرف السيارات: shuttle «باص المجمع» يلف داخل المجمع (ويمكن إرساله إلى مستشفى الثمامة
 * وقت الذروة)، وnonMedical «باص الرحلات غير الطبية» يجمع الرحلات غير الطبية، وclinic «باص العيادة» في خدمة
 * العيادة فلا يُرسل في رحلات التوزيع.
 */
export type BusRole = "shuttle" | "nonMedical" | "clinic";
export const BUS_ROLES: BusRole[] = ["shuttle", "nonMedical", "clinic"];
export const BUS_ROLE_LABELS: Record<BusRole, string> = { shuttle: "باص المجمع", nonMedical: "باص الرحلات غير الطبية", clinic: "باص العيادة" };

/**
 * النص الظاهر للحالة: في الواجهة يُقال «الضيف» بدل «المريض». قيمة الحالة المخزنة «تم استلام المريض»
 * تبقى كما هي حتى تعمل البيانات والصلاحيات القائمة.
 */
export const statusText = (status: string) => status.replace("المريض", "الضيف");

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
  groupId?: string;
  notificationSentAt?: string;
  /** رقم حساب مشرف المبنى الذي طلب السيارة: هو وحده يتابع الطلب (الطلبات القديمة بلا مالك يتابعها الجميع) */
  requestedBy?: string;
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
export function requestWindow(appointment: Pick<ClinicAppointment, "appointmentDate" | "appointmentAt">, now = new Date()) {
  const deadline = new Date(appointmentDateTime(appointment).getTime() + REQUEST_GRACE_MINUTES * 60000);
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
    const assistance = normalizeAssistance(readAliased(row, ["احتياجات الضيف", "احتياجات المريض", "المساعدة", "الاحتياج", "ملاحظات", "assistance"]));
    // ملف المواعيد المصدَّر: كل احتياج في عمود «نعم/لا»
    for (const need of ASSISTANCE_NEEDS) if (!assistance.includes(need) && isYes(readAliased(row, [need]))) assistance.push(need);
    let gender = normalizeGender(readAliased(row, ["الجنس", "gender", "sex"]));
    const cancer = isYes(readAliased(row, ["حالة سرطان", "سرطان", "cancer"]), /سرطان|cancer/);

    // مع قائمة الضيوف: الضيف منها (والمبنى والشقة والجنس منها، والهاتف إن لم يُكتب)، والوجهة من دليل المستشفيات
    let guestId: string | undefined;
    let destination = clinic;
    if (index && patientName) {
      const guest = findGuestByName(index, patientName, buildingNumber, apartmentNumber);
      if (!guest) {
        errors.push(`الصف ${excelRow}: الضيف «${patientName}» غير موجود في قائمة ضيوف المجمع`);
        return;
      }
      guestId = guest.id;
      patientName = guest.name;
      buildingNumber = guest.buildingNumber;
      apartmentNumber = guest.apartmentNumber;
      mobile = mobile || guest.mobile || "";
      gender = guest.gender ?? gender;
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
    groupId: toText(raw.groupId) || undefined,
    notificationSentAt: toText(raw.notificationSentAt) || undefined,
    requestedBy: toText(raw.requestedBy) || undefined,
    pickedUpAt: isoTime(raw.pickedUpAt),
    etaAt: isoTime(raw.etaAt),
    destLat: coordinate(raw.destLat),
    destLng: coordinate(raw.destLng),
    arrivedAt: isoTime(raw.arrivedAt),
    arrivalSource,
    fromAppointmentId: toText(raw.fromAppointmentId) || undefined,
    ...(raw.nurseOnly === true ? { nurseOnly: true } : {}),
    // الخانات الفارغة لا تُضاف، حتى لا تظهر تغييرات وهمية عند المقارنة قبل الحفظ
    ...Object.fromEntries(Object.entries(check).filter(([, value]) => value !== undefined)),
  };
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
    .find((other) => other.appointmentAt > appointment.appointmentAt && other.status === "بانتظار طلب السيارة" && requestWindow(other, now).open) ?? null;
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

/** مقاعد الباص (السيارة 3 ضيوف، وسيارة الاحتياجات الخاصة ضيفان: groupCapacity) */
export const BUS_SEATS = 14;
/** الباصات غير متاحة من 6 إلى 9 صباحًا */
export const BUS_OFF_HOURS = { from: 6, to: 9 };
/** مستشفى الثمامة (مركز الثمامة الصحي): الوجهة الوحيدة لباص المجمع، وقت الذروة فقط */
export const SHUTTLE_HOSPITAL_ID = "thumama-hc";

/** تخصيص الباص (null لغير الباص أو الباص العادي). */
export const busRoleOf = (vehicle: Pick<Vehicle, "kind" | "busRole">): BusRole | null =>
  (vehicle.kind === "باص" && vehicle.busRole && BUS_ROLES.includes(vehicle.busRole) ? vehicle.busRole : null);

/** الباصات غير متاحة في هذا الوقت (6–9 صباحًا). */
export function busesOff(at: Date) {
  const hour = at.getHours();
  return hour >= BUS_OFF_HOURS.from && hour < BUS_OFF_HOURS.to;
}

/** عدد الأشخاص الذين تتسع لهم السيارة في رحلة واحدة (مع المرافقين والـ Nurse): الباص 14، والسيارة 3، ومع ضيف احتياجات خاصة 2. */
export function vehicleSeats(vehicle: Pick<Vehicle, "kind">, appointments: Pick<ClinicAppointment, "kind">[] = []) {
  if (appointments.some((appointment) => appointment.kind === "احتياجات خاصة")) return groupCapacity("احتياجات خاصة");
  return vehicle.kind === "باص" ? BUS_SEATS : groupCapacity("عادي");
}

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
/** وقت اختيار السيارة (لساعات الباصات ووقت الذروة) ودليل المستشفيات */
export type VehicleRules = { now?: Date; hospitals?: Hospital[] };

/**
 * لماذا لا تناسب السيارة هذه الرحلة الآن، أو null إن كانت تناسبها (انشغالها برحلة يُفحص في مكان آخر):
 * - باص العيادة في خدمة العيادة، فلا يُرسل في أي رحلة.
 * - الاحتياجات الخاصة تحتاج سيارة مجهزة، وعدد الأشخاص (مع المرافق والـ Nurse) لا يتجاوز مقاعد السيارة (الباص 14)؛
 *   والضيف الواحد مع مرافقيه يُقبل دائمًا في السيارة المناسبة له.
 * - الباصات غير متاحة من 6 إلى 9 صباحًا.
 * - باص المجمع يلف داخل المجمع، ويُرسل فقط إلى مستشفى الثمامة (ذهابًا أو عودة) وقت الذروة.
 * - باص الرحلات غير الطبية لها فقط.
 */
export function vehicleRestriction(vehicle: Vehicle, trip: TripLoad, rules: VehicleRules = {}): string | null {
  const now = rules.now ?? new Date();
  if (!vehicle.available) return "خارج الخدمة";
  const role = busRoleOf(vehicle);
  if (role === "clinic") return "في خدمة العيادة";
  if (needsAccessibleVehicle(trip.appointments) && vehicle.kind !== "احتياجات خاصة") return "تحتاج سيارة احتياجات خاصة";
  const seats = vehicleSeats(vehicle, trip.appointments);
  if (trip.appointments.length > 1 && loadPersons(trip) > seats) return `تتسع ${seats === 2 ? "لشخصين" : `لـ ${personsText(seats)}`} فقط`;
  if (vehicle.kind === "باص" && busesOff(now)) return "الباصات غير متاحة من 6 إلى 9 صباحًا";
  if (role === "shuttle" && !(isRushHour(now) && !trip.transfer && trip.appointments.every((appointment) => isShuttleTrip(appointment, rules.hospitals)))) {
    return "باص المجمع: مستشفى الثمامة وقت الذروة فقط";
  }
  if (role === "nonMedical" && !trip.appointments.every(isNonMedical)) return "للرحلات غير الطبية فقط";
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
    .filter(({ vehicle }) => vehicle.available && (kind !== "احتياجات خاصة" || vehicle.kind === "احتياجات خاصة"));
  return pickVehicle(candidates, load, rank);
}

export const needsAccessibleVehicle = (appointments: Pick<ClinicAppointment, "kind">[]) => appointments.some((appointment) => appointment.kind === "احتياجات خاصة");

/**
 * السيارة المقترحة لرحلة (ضيف أو أكثر): من السيارات التي تناسبها الآن (vehicleRestriction: المقاعد والباصات)،
 * ثم كما في assignVehicle. الرحلات غير الطبية تأخذ باصها أولًا، وباص المجمع آخر خيار حتى يبقى في المجمع.
 */
export function assignVehicleForTrips(
  vehicles: Vehicle[],
  appointments: ClinicAppointment[],
  load: Map<string, number> = new Map(),
  rank?: (vehicle: Vehicle) => number,
  rules: VehicleRules & { transfer?: boolean; persons?: number } = {},
) {
  const trip = { appointments, transfer: rules.transfer, persons: rules.persons };
  const nonMedical = appointments.length > 0 && appointments.every(isNonMedical);
  const candidates = vehicles
    .map((vehicle, index) => ({ vehicle, index }))
    .filter(({ vehicle }) => !vehicleRestriction(vehicle, trip, rules));
  return pickVehicle(candidates, load, rank, (vehicle) => {
    const role = busRoleOf(vehicle);
    return role === "nonMedical" && nonMedical ? 0 : role === "shuttle" ? 2 : 1;
  });
}

/**
 * أقصى عدد أشخاص في رحلة مجمّعة فيها هذا الموعد: أكبر سيارة تناسبه من السيارات المعطاة (الباص 14 إن كان يناسبه الآن)،
 * وإلا 3 (و2 للاحتياجات الخاصة). لجمع الرحلات (buildTripGroups).
 */
export function seatsFor(vehicles: Vehicle[], rules: VehicleRules = {}) {
  return (appointment: ClinicAppointment) => Math.max(
    groupCapacity(appointment.kind),
    ...vehicles
      .filter((vehicle) => !vehicleRestriction(vehicle, { appointments: [appointment] }, rules))
      .map((vehicle) => vehicleSeats(vehicle, [appointment])),
  );
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
  const free = vehicles.filter((vehicle) => vehicle.available);
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
    // رحلة مجمّعة للباص وأُخذ الباص: تُقسم على السيارات بالترتيب الزمني، كل سيارة حتى 3 أشخاص
    const size = Math.min(...next.appointments.map((appointment) => groupCapacity(appointment.kind)));
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
  if (isNonMedical(appointment)) return null;
  return (appointment.hospitalId && hospitals.find((hospital) => hospital.id === appointment.hospitalId))
    || matchHospital(appointment.clinic, hospitals);
}

/** مستشفى الموعد من الدليل (null للرحلات غير الطبية أو الوجهات غير المعروفة). */
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

/** يتحقق من بيانات سيارة قبل الحفظ ويعيدها بصيغة موحدة، أو يعيد رسالة الخطأ. */
export function validateVehicle(
  input: Pick<Vehicle, "plate" | "driver" | "phone" | "kind">,
  vehicles: Vehicle[],
  originalPlate?: string,
): { vehicle: Pick<Vehicle, "plate" | "driver" | "phone" | "kind"> } | { error: string } {
  const plate = toWesternDigits(toText(input.plate)).replace(/\s+/g, "");
  const driver = toText(input.driver).replace(/\s+/g, " ");
  const phone = normalizeMobile(input.phone);
  if (!/^[0-9A-Za-z-]{2,12}$/.test(plate)) return { error: "رقم السيارة يجب أن يكون من 2 إلى 12 رقمًا أو حرفًا" };
  if (driver.length < 2 || driver.length > 60) return { error: "اسم السائق يجب أن يكون من 2 إلى 60 حرفًا" };
  if (!/^\+?\d{8,15}$/.test(phone)) return { error: "رقم هاتف السائق يجب أن يكون من 8 إلى 15 رقمًا" };
  if (!VEHICLE_KINDS.includes(input.kind)) return { error: "اختر نوع سيارة صحيحًا" };
  if (plate !== originalPlate && vehicles.some((vehicle) => vehicle.plate === plate)) {
    return { error: `رقم السيارة ${plate} مسجل مسبقًا` };
  }
  return { vehicle: { plate, driver, phone, kind: input.kind } };
}

/** تحديث بيانات سيارة (من لوحة المدير أو ملف Excel): تخصيص الباص يبقى للباص فقط. */
export function mergeVehicle(vehicle: Vehicle, changes: Partial<Vehicle>): Vehicle {
  const next = { ...vehicle, ...changes };
  if (next.kind !== "باص") delete next.busRole;
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
export const DEFAULT_VEHICLES: Vehicle[] = FLEET_SEED;

// ————— جمع الرحلات —————

/** أقصى عدد أشخاص في رحلة مجمّعة بسيارة عادية (مع المرافقين والـ Nurse): 3، ومع احتياجات خاصة 2 (الباص 14: vehicleSeats). */
export function groupCapacity(kind: AppointmentKind) {
  return kind === "احتياجات خاصة" ? 2 : 3;
}

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
        const fits = people(list[i]) + people(list[j]) <= Math.min(cap(list[i]), cap(list[j]));
        if (fits && canShareVehicle(details, 45)) pairs.push({ a: list[i], b: list[j], details });
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
      const capacity = () => Math.min(...members.map(cap));
      // توسيع المجموعة بكل موعد متوافق مع كل الأعضاء ما دامت المقاعد تكفي أشخاصه (مع المرافق والـ Nurse):
      // أولًا من لا يقلل المقاعد (ركاب الباص)، ثم الباقي
      for (const keepSeats of [true, false]) {
        for (const candidate of list) {
          if (used.has(candidate.id) || members.includes(candidate)) continue;
          if (total(members) + people(candidate) > Math.min(capacity(), cap(candidate)) || (keepSeats && cap(candidate) < capacity())) continue;
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

export type JoinSuggestion = { requestId: string; appointmentId: string; plate: string; groupId?: string; reason: string };

/**
 * طلب جديد يمكن ضمّه لسيارة أُرسلت ولم تستلم مرضاها بعد، متجهة لنفس الوجهة أو وجهة مجاورة
 * وفي نفس التوقيت (at: وقت الحاجة إلى السيارة من وقت الطلب، وإلا وقت الموعد)، بشرط وجود مقعد فارغ
 * (الباص 14) وأن تناسبه السيارة.
 */
export function suggestJoinDispatched(
  /** persons (اختياري): عدد الأشخاص مع كل ضيف (requestPersons)، وإلا من احتياجاته */
  pending: { request: VehicleRequest; appointment: ClinicAppointment; at?: Date; persons?: number }[],
  dispatched: { request: VehicleRequest; appointment: ClinicAppointment; at?: Date; persons?: number }[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** السيارات: مقاعد السيارة في الطريق وقواعدها (الباص 14، وباص الرحلات غير الطبية لها فقط) */
  vehicles: Vehicle[] = [],
  rules: VehicleRules = {},
): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const timeOf = (item: { appointment: ClinicAppointment; at?: Date }) => item.at ?? appointmentDateTime(item.appointment);
  const byTrip = new Map<string, (typeof dispatched)[number][]>();
  for (const item of dispatched) {
    if (item.request.status !== "تم إرسال السيارة" || !item.request.vehiclePlate) continue;
    const tripKey = item.request.groupId ?? item.request.id;
    byTrip.set(tripKey, [...(byTrip.get(tripKey) ?? []), item]);
  }
  for (const item of pending) {
    let best: { suggestion: JoinSuggestion; score: number } | null = null;
    for (const members of Array.from(byTrip.values())) {
      if (members[0].request.direction !== item.request.direction) continue;
      const vehicle = vehicles.find((candidate) => candidate.plate === members[0].request.vehiclePlate);
      const riders = [...members.map((member) => member.appointment), item.appointment];
      const personsOf = (trip: (typeof dispatched)[number]) => trip.persons ?? tripPersons(trip.appointment, trip.request);
      const onBoard = members.reduce((sum, member) => sum + personsOf(member), 0);
      const persons = onBoard + personsOf(item);
      if (vehicle) {
        if (vehicleRestriction({ ...vehicle, available: true }, { appointments: riders, persons }, { ...rules, hospitals })) continue;
      } else if (persons > Math.min(...riders.map((rider) => groupCapacity(rider.kind)))) continue;
      const scores = members.map((member) => calculateTripGroupingScore(member.appointment, item.appointment, hospitals, [timeOf(member), timeOf(item)]));
      if (!scores.every((details) => canShareVehicle(details, 30))) continue;
      const worst = Math.min(...scores.map((details) => details.score));
      if (!best || worst > best.score) {
        best = {
          score: worst,
          suggestion: {
            requestId: item.request.id,
            appointmentId: item.appointment.id,
            plate: members[0].request.vehiclePlate!,
            groupId: members[0].request.groupId,
            reason: `${pairReason(scores[0])} · السيارة في الطريق (${members.length} ${members.length === 1 ? "ضيف" : "ضيوف"}${onBoard > members.length ? ` · ${personsText(onBoard)}` : ""})`,
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
  const open = appointments.filter((appointment) => appointment.status === "بانتظار طلب السيارة"
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

/** وجهات الرحلات غير الطبية (مع «أخرى» تُكتب يدويًا). */
export const NON_MEDICAL_DESTINATIONS: { ar: string; en: string }[] = [
  { ar: "الجامعة", en: "University" },
  { ar: "المدرسة", en: "School" },
  { ar: "أنصار جاليري المطار القديم", en: "Ansar Gallery, Old Airport" },
];

export const isNonMedical = (appointment: Pick<ClinicAppointment, "category">) => appointment.category === "غير طبية";

/** اسم الوجهة بالعربية والإنجليزية (من دليل المستشفيات، أو قائمة الرحلات غير الطبية). */
export function destinationLabels(appointment: ClinicAppointment, hospitals: Hospital[]) {
  if (isNonMedical(appointment)) {
    const known = NON_MEDICAL_DESTINATIONS.find((item) => item.ar === appointment.clinic);
    return { ar: appointment.clinic, en: known?.en ?? appointment.clinic };
  }
  const hospital = (appointment.hospitalId && hospitals.find((item) => item.id === appointment.hospitalId)) || matchHospital(appointment.clinic, hospitals);
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
) {
  const sorted = [...trips].sort((a, b) => byTime(a.appointment, b.appointment));
  const returning = sorted[0]?.request.direction === "عودة";
  const transfer = Boolean(sorted[0]?.from);
  const nurseLeg = sorted.length > 0 && sorted.every((trip) => trip.request.nurseOnly);
  const leg = nurseLeg
    ? { ar: "عودة الـ Nurse فقط", en: "Nurse return only" }
    : { ar: transfer ? "نقل بين موعدين" : returning ? "عودة" : "ذهاب", en: transfer ? "Transfer between appointments" : returning ? "Return" : "Outbound" };
  const ar: string[] = [
    sorted.length > 1 ? `رحلة مجمّعة (${sorted.length} ضيوف) — ${leg.ar}` : `رحلة جديدة — ${leg.ar}`,
    `السيارة: ${vehicle.plate}`,
  ];
  const en: string[] = [
    sorted.length > 1 ? `Grouped trip (${sorted.length} guests) — ${leg.en}` : `New trip — ${leg.en}`,
    `Vehicle: ${vehicle.plate}`,
  ];
  sorted.forEach(({ appointment, request, from, persons }, index) => {
    const destination = destinationLabels(appointment, hospitals);
    const prefix = sorted.length > 1 ? `${index + 1}) ` : "";
    const rider = isNonMedical(appointment) ? { ar: "الراكب", en: "Passenger" } : { ar: "الضيف", en: "Guest" };
    // عودة الـ Nurse فقط: الراكب هو الـ Nurse ويبقى الضيف في موعده
    const nurse = Boolean(request.nurseOnly);
    const people = persons ?? tripPersons(appointment, request);
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
      ...(people > 1 ? [`عدد الأشخاص: ${people}`] : []),
    );
    en.push(
      "",
      nurse
        ? `${prefix}Passenger: Nurse escorting guest ${appointment.patientName} (nurse return only)`
        : `${prefix}${rider.en}: ${appointment.patientName}${appointment.gender ? ` (${appointment.gender === "أنثى" ? "female" : "male"})` : ""}${isNonMedical(appointment) ? " (non-medical trip)" : ""}`,
      returning ? `From: ${destination.en}` : `From: ${pickupEn}`,
      returning ? `To: ${pickupEn}` : `To: ${destination.en}`,
      `${isNonMedical(appointment) ? "Time" : "Appointment"}: ${appointment.appointmentDate} ${appointment.appointmentAt}`,
      `${rider.en} mobile: ${appointment.mobile}`,
      `Trip type: ${KIND_EN[appointment.kind]}${needsEn ? ` · ${needsEn}` : ""}`,
      ...(people > 1 ? [`Persons: ${people}`] : []),
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
