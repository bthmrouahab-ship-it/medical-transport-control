import { DEFAULT_HOSPITALS, distanceKm, matchHospital, type Hospital } from "./hospitals";
import { FLEET_SEED } from "./seedData";

export type AppointmentKind = "عادي" | "احتياجات خاصة";
export type VehicleKind = "سيدان" | "احتياجات خاصة" | "باص";
export type AssistanceNeed = "يحتاج مرافق" | "كرسي متحرك";
export type AppointmentStatus =
  | "بانتظار طلب السيارة"
  | "تم طلب السيارة"
  | "تم استلام المريض"
  | "طلب عودة"
  | "مكتملة";

export type ClinicAppointment = {
  id: string;
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
};

export type Vehicle = {
  plate: string;
  driver: string;
  phone: string;
  kind: VehicleKind;
  available: boolean;
};

export type VehicleRequest = {
  id: string;
  appointmentId: string;
  vehiclePlate?: string;
  driver?: string;
  direction: "ذهاب" | "عودة";
  status: "بانتظار التوزيع" | "تم إرسال السيارة" | "وصلت السيارة" | "تم استلام المريض";
  notificationMethod: "whatsapp" | "call";
  createdAt: string;
  groupId?: string;
  notificationSentAt?: string;
};

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
]);

function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toWesternDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)));
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s_\-\/]+/g, "");
}

function readAliased(row: Record<string, unknown>, aliases: string[]) {
  const aliasSet = new Set(aliases.map(normalizeHeader));
  const entry = Object.entries(row).find(([key]) => aliasSet.has(normalizeHeader(key)));
  return entry?.[1];
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
  if (text.includes("كرسي")) needs.push("كرسي متحرك");
  return needs;
}

function normalizeMobile(value: unknown) {
  return toWesternDigits(toText(value)).replace(/\.0$/, "").replace(/[\s-]/g, "");
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
  };
}

export function parseImportedAppointments(
  rows: Record<string, unknown>[],
  existingAppointments: ClinicAppointment[] = [],
  idSeed = Date.now(),
  today = localDateString(),
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
): ImportedAppointmentResult {
  const appointments: ClinicAppointment[] = [];
  const errors: string[] = [];
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

  rows.forEach((row, index) => {
    const excelRow = index + 2;
    const patientName = toText(readAliased(row, ["اسم المريض أو الرقم", "اسم المريض", "المريض", "رقم المريض"]));
    const clinic = toText(readAliased(row, ["اسم العيادة أو المستشفى", "العيادة", "المستشفى", "الوجهة"]));
    const buildingNumber = toText(readAliased(row, ["رقم المبنى", "المبنى", "building number", "building"]));
    const apartmentNumber = toText(readAliased(row, ["رقم الشقة", "الشقة", "apartment number", "apartment"]));
    const mobile = normalizeMobile(readAliased(row, ["رقم الموبايل", "رقم الجوال", "الموبايل", "الجوال", "الهاتف", "mobile"]));
    const appointmentAt = normalizeTime(readAliased(row, ["وقت الموعد", "الوقت", "موعد", "appointment time"]));
    const rawDate = readAliased(row, ["تاريخ الموعد", "التاريخ", "appointment date", "date"]);
    const appointmentDate = rawDate === undefined || toText(rawDate) === "" ? today : normalizeDate(rawDate);
    const kind = normalizeKind(readAliased(row, ["نوع الرحلة", "نوع الخدمة", "النوع", "trip type"]));
    const assistance = normalizeAssistance(readAliased(row, ["احتياجات المريض", "المساعدة", "الاحتياج", "ملاحظات", "assistance"]));

    const missing = [
      [patientName, "اسم المريض"],
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

    const duplicateKey = [appointmentDate, patientName, clinic, buildingNumber, apartmentNumber, appointmentAt].join("|").toLowerCase();
    if (duplicateKeys.has(duplicateKey)) {
      errors.push(`الصف ${excelRow}: الموعد مكرر`);
      return;
    }
    duplicateKeys.add(duplicateKey);

    appointments.push({
      id: `APT-${String(idSeed).slice(-6)}-${String(index + 1).padStart(2, "0")}`,
      patientName,
      clinic,
      buildingNumber,
      apartmentNumber,
      mobile,
      appointmentDate,
      appointmentAt,
      hospitalId: matchHospital(clinic, hospitals)?.id,
      kind: kind as AppointmentKind,
      assistance,
      status: "بانتظار طلب السيارة",
    });
  });

  return { appointments, errors };
}

export function canRequestVehicle(appointment: ClinicAppointment | undefined, existingRequest?: VehicleRequest, now = new Date()) {
  return Boolean(appointment && !existingRequest && appointment.status !== "مكتملة" && requestWindow(appointment, now).open);
}

export function migrateRequest(value: unknown): VehicleRequest | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const id = toText(raw.id);
  const appointmentId = toText(raw.appointmentId);
  if (!id || !appointmentId) return null;
  const legacyStatus = toText(raw.status);
  const status: VehicleRequest["status"] = legacyStatus === "وصلت السيارة" || legacyStatus === "تم استلام المريض"
    ? legacyStatus
    : legacyStatus === "تم التأكيد" || legacyStatus === "تم إرسال السيارة"
      ? "تم إرسال السيارة"
      : "بانتظار التوزيع";
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
  };
}

export function assignVehicle(vehicles: Vehicle[], kind: AppointmentKind) {
  const available = vehicles.filter((vehicle) => vehicle.available);
  if (kind === "احتياجات خاصة") {
    return available.find((vehicle) => vehicle.kind === "احتياجات خاصة") ?? null;
  }
  return available.find((vehicle) => vehicle.kind === "سيدان")
    ?? available.find((vehicle) => vehicle.kind === "باص")
    ?? available[0]
    ?? null;
}

export function assignVehicleForTrips(vehicles: Vehicle[], appointments: ClinicAppointment[]) {
  const requiresAccessibleVehicle = appointments.some((appointment) => appointment.kind === "احتياجات خاصة");
  return assignVehicle(vehicles, requiresAccessibleVehicle ? "احتياجات خاصة" : "عادي");
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

/** منطقة المستشفى (مثل «مدينة حمد الطبية») لموعد، إن كان المستشفى في الدليل. */
export function matchHospitalZone(appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  return hospitalFor(appointment, hospitals)?.zone ?? null;
}

/**
 * نقاط الجمع: 45 للقرب الزمني ناقص فرق الدقائق، +35 لنفس المبنى،
 * +25 لنفس الوجهة أو +20 لوجهات متجاورة (≤ 3 كم) أو +10 لنفس الاتجاه (≤ 8 كم)،
 * +10 لنفس نوع الرحلة. المواعيد في أيام مختلفة لا تُجمع.
 */
export function calculateTripGroupingScore(first: ClinicAppointment, second: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  const timeGapMinutes = Math.round(Math.abs(appointmentDateTime(first).getTime() - appointmentDateTime(second).getTime()) / 60000);
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
  const score = timeScore + (sameBuilding ? 35 : 0) + destinationScore + (compatibleVehicle ? 10 : 0);
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
      if (details.timeGapMinutes > 45 || details.score < 55) continue;
      const reasons = [
        details.sameBuilding ? "نفس المبنى" : null,
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

/** السيارات المرتبطة برحلة جارية لا يُسمح بتغيير رقمها أو حذفها. */
export function vehicleHasActiveTrip(plate: string, requests: VehicleRequest[]) {
  return requests.some((request) => request.vehiclePlate === plate
    && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة"));
}

/** قائمة السيارات الأولية (من ملف السائقين)؛ تُحفظ في قاعدة البيانات عند أول دخول للمدير ثم يعدّلها من لوحته. */
export const DEFAULT_VEHICLES: Vehicle[] = FLEET_SEED;

// ————— جمع الرحلات —————

/** أقصى عدد مرضى في سيارة واحدة: سيدان/باص 3، احتياجات خاصة 2. */
export function groupCapacity(kind: AppointmentKind) {
  return kind === "احتياجات خاصة" ? 2 : 3;
}

export type TripGroup = {
  appointmentIds: string[];
  direction: VehicleRequest["direction"];
  /** أقل نقاط بين أي موعدين في المجموعة */
  score: number;
  /** الفرق بين أول وآخر موعد */
  spanMinutes: number;
  reason: string;
};

function pairReason(details: ReturnType<typeof calculateTripGroupingScore>) {
  if (details.sameDestination) return "نفس الوجهة";
  if (details.nearbyDestination) return `وجهات متجاورة${details.zone ? ` (${details.zone})` : ""}`;
  if (details.sameDirection) return "نفس الاتجاه";
  return details.sameBuilding ? "نفس المبنى" : "توقيت متقارب";
}

/**
 * يبني مجموعات رحلات (حتى 3 مرضى) من الطلبات بانتظار التوزيع.
 * كل موعدين داخل المجموعة يجب أن يكونا متوافقين (55 نقطة فأكثر وخلال 45 دقيقة)،
 * ولا تُخلط رحلات الذهاب مع العودة، ولا يُتجاوز عدد المقاعد.
 */
export function buildTripGroups(
  items: { appointment: ClinicAppointment; direction: VehicleRequest["direction"] }[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
): TripGroup[] {
  const groups: TripGroup[] = [];
  for (const direction of ["ذهاب", "عودة"] as const) {
    const list = items.filter((item) => item.direction === direction).map((item) => item.appointment);
    const score = new Map<string, ReturnType<typeof calculateTripGroupingScore>>();
    const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const pairs: { a: ClinicAppointment; b: ClinicAppointment; details: ReturnType<typeof calculateTripGroupingScore> }[] = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const details = calculateTripGroupingScore(list[i], list[j], hospitals);
        score.set(key(list[i].id, list[j].id), details);
        if (details.timeGapMinutes <= 45 && details.score >= 55) pairs.push({ a: list[i], b: list[j], details });
      }
    }
    pairs.sort((x, y) => y.details.score - x.details.score || x.details.timeGapMinutes - y.details.timeGapMinutes);
    const used = new Set<string>();
    const compatible = (a: ClinicAppointment, b: ClinicAppointment) => {
      const details = score.get(key(a.id, b.id));
      return Boolean(details && details.timeGapMinutes <= 45 && details.score >= 55);
    };
    for (const pair of pairs) {
      if (used.has(pair.a.id) || used.has(pair.b.id)) continue;
      const members = [pair.a, pair.b];
      const capacity = () => Math.min(...members.map((member) => groupCapacity(member.kind)));
      // توسيع المجموعة بأفضل موعد متوافق مع كل الأعضاء
      for (const candidate of list) {
        if (members.length >= capacity() || used.has(candidate.id) || members.includes(candidate)) continue;
        if (groupCapacity(candidate.kind) < members.length + 1) continue;
        if (members.every((member) => compatible(member, candidate))) members.push(candidate);
      }
      members.forEach((member) => used.add(member.id));
      const pairDetails = members.flatMap((first, index) => members.slice(index + 1).map((second) => score.get(key(first.id, second.id))!));
      const times = members.map((member) => appointmentDateTime(member).getTime());
      const reasons = Array.from(new Set([
        ...pairDetails.map(pairReason),
        ...(pairDetails.every((details) => details.sameBuilding) ? ["نفس المبنى"] : []),
      ]));
      const spanMinutes = Math.round((Math.max(...times) - Math.min(...times)) / 60000);
      groups.push({
        appointmentIds: members.map((member) => member.id),
        direction,
        score: Math.min(...pairDetails.map((details) => details.score)),
        spanMinutes,
        reason: [...reasons, `خلال ${spanMinutes} دقيقة`].join(" · "),
      });
    }
  }
  return groups.sort((a, b) => b.appointmentIds.length - a.appointmentIds.length || b.score - a.score);
}

export type JoinSuggestion = { requestId: string; appointmentId: string; plate: string; groupId?: string; reason: string };

/**
 * طلب جديد يمكن ضمّه لسيارة أُرسلت ولم تستلم مرضاها بعد، متجهة لنفس الوجهة أو وجهة مجاورة
 * وفي نفس التوقيت، بشرط وجود مقعد فارغ.
 */
export function suggestJoinDispatched(
  pending: { request: VehicleRequest; appointment: ClinicAppointment }[],
  dispatched: { request: VehicleRequest; appointment: ClinicAppointment }[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
): JoinSuggestion[] {
  const out: JoinSuggestion[] = [];
  const byTrip = new Map<string, { request: VehicleRequest; appointment: ClinicAppointment }[]>();
  for (const item of dispatched) {
    if (item.request.status !== "تم إرسال السيارة" || !item.request.vehiclePlate) continue;
    const tripKey = item.request.groupId ?? item.request.id;
    byTrip.set(tripKey, [...(byTrip.get(tripKey) ?? []), item]);
  }
  for (const item of pending) {
    let best: { suggestion: JoinSuggestion; score: number } | null = null;
    for (const members of Array.from(byTrip.values())) {
      if (members[0].request.direction !== item.request.direction) continue;
      const capacity = Math.min(groupCapacity(item.appointment.kind), ...members.map((member) => groupCapacity(member.appointment.kind)));
      if (members.length + 1 > capacity) continue;
      const scores = members.map((member) => calculateTripGroupingScore(member.appointment, item.appointment, hospitals));
      if (scores.some((details) => details.timeGapMinutes > 30 || details.score < 55)) continue;
      const worst = Math.min(...scores.map((details) => details.score));
      if (!best || worst > best.score) {
        best = {
          score: worst,
          suggestion: {
            requestId: item.request.id,
            appointmentId: item.appointment.id,
            plate: members[0].request.vehiclePlate!,
            groupId: members[0].request.groupId,
            reason: `${pairReason(scores[0])} · السيارة في الطريق (${members.length} ${members.length === 1 ? "مريض" : "مرضى"})`,
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
const NEED_EN: Record<AssistanceNeed, string> = { "يحتاج مرافق": "Needs escort", "كرسي متحرك": "Wheelchair" };

/** وجهات الرحلات غير الطبية (مع «أخرى» تُكتب يدويًا). */
export const NON_MEDICAL_DESTINATIONS: { ar: string; en: string }[] = [
  { ar: "الجامعة", en: "University" },
  { ar: "المدرسة", en: "School" },
  { ar: "أنصار جاليري المطار القديم", en: "Ansar Gallery, Old Airport" },
];

export const isNonMedical = (appointment: Pick<ClinicAppointment, "category">) => appointment.category === "غير طبية";

function destinationLabels(appointment: ClinicAppointment, hospitals: Hospital[]) {
  if (isNonMedical(appointment)) {
    const known = NON_MEDICAL_DESTINATIONS.find((item) => item.ar === appointment.clinic);
    return { ar: appointment.clinic, en: known?.en ?? appointment.clinic };
  }
  const hospital = (appointment.hospitalId && hospitals.find((item) => item.id === appointment.hospitalId)) || matchHospital(appointment.clinic, hospitals);
  return { ar: hospital?.name ?? appointment.clinic, en: hospital?.nameEn || appointment.clinic };
}

/** رسالة واتساب للسائق بالعربية ثم الإنجليزية؛ تدعم رحلة واحدة أو رحلة مجمّعة. */
export function buildDriverMessage(
  trips: { appointment: ClinicAppointment; request: VehicleRequest }[],
  vehicle: Pick<Vehicle, "plate" | "driver">,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
) {
  const sorted = [...trips].sort((a, b) => byTime(a.appointment, b.appointment));
  const returning = sorted[0]?.request.direction === "عودة";
  const ar: string[] = [
    sorted.length > 1 ? `رحلة مجمّعة (${sorted.length} مرضى) — ${returning ? "عودة" : "ذهاب"}` : `رحلة جديدة — ${returning ? "عودة" : "ذهاب"}`,
    `السيارة: ${vehicle.plate}`,
  ];
  const en: string[] = [
    sorted.length > 1 ? `Grouped trip (${sorted.length} patients) — ${returning ? "Return" : "Outbound"}` : `New trip — ${returning ? "Return" : "Outbound"}`,
    `Vehicle: ${vehicle.plate}`,
  ];
  sorted.forEach(({ appointment }, index) => {
    const destination = destinationLabels(appointment, hospitals);
    const prefix = sorted.length > 1 ? `${index + 1}) ` : "";
    const rider = isNonMedical(appointment) ? { ar: "الراكب", en: "Passenger" } : { ar: "المريض", en: "Patient" };
    const needsAr = appointment.assistance.join("، ");
    const needsEn = appointment.assistance.map((need) => NEED_EN[need]).join(", ");
    const pickupAr = `مبنى ${appointment.buildingNumber}، شقة ${appointment.apartmentNumber}`;
    const pickupEn = `Building ${appointment.buildingNumber}, Apt ${appointment.apartmentNumber}`;
    ar.push(
      "",
      `${prefix}${rider.ar}: ${appointment.patientName}${isNonMedical(appointment) ? " (رحلة غير طبية)" : ""}`,
      returning ? `من: ${destination.ar}` : `من: ${pickupAr}`,
      returning ? `إلى: ${pickupAr}` : `إلى: ${destination.ar}`,
      `${isNonMedical(appointment) ? "الوقت" : "الموعد"}: ${appointment.appointmentDate} ${appointment.appointmentAt}`,
      `جوال ${rider.ar}: ${appointment.mobile}`,
      `نوع الرحلة: ${appointment.kind}${needsAr ? ` · ${needsAr}` : ""}`,
    );
    en.push(
      "",
      `${prefix}${rider.en}: ${appointment.patientName}${isNonMedical(appointment) ? " (non-medical trip)" : ""}`,
      returning ? `From: ${destination.en}` : `From: ${pickupEn}`,
      returning ? `To: ${pickupEn}` : `To: ${destination.en}`,
      `${isNonMedical(appointment) ? "Time" : "Appointment"}: ${appointment.appointmentDate} ${appointment.appointmentAt}`,
      `${rider.en} mobile: ${appointment.mobile}`,
      `Trip type: ${KIND_EN[appointment.kind]}${needsEn ? ` · ${needsEn}` : ""}`,
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
