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
  appointmentAt: string;
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
    appointmentAt,
    kind,
    assistance: normalizeAssistance(raw.assistance ?? raw.notes),
    status,
  };
}

export function parseImportedAppointments(
  rows: Record<string, unknown>[],
  existingAppointments: ClinicAppointment[] = [],
  idSeed = Date.now(),
): ImportedAppointmentResult {
  const appointments: ClinicAppointment[] = [];
  const errors: string[] = [];
  const duplicateKeys = new Set(
    existingAppointments.map((appointment) => [
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
    const kind = normalizeKind(readAliased(row, ["نوع الرحلة", "نوع الخدمة", "النوع", "trip type"]));
    const assistance = normalizeAssistance(readAliased(row, ["احتياجات المريض", "المساعدة", "الاحتياج", "ملاحظات", "assistance"]));

    const missing = [
      [patientName, "اسم المريض"],
      [clinic, "اسم العيادة أو المستشفى"],
      [buildingNumber, "رقم المبنى"],
      [apartmentNumber, "رقم الشقة"],
      [mobile, "رقم الموبايل"],
      [appointmentAt, "وقت الموعد"],
      [kind, "نوع الرحلة"],
    ].filter(([value]) => !value).map(([, label]) => label);

    if (missing.length) {
      errors.push(`الصف ${excelRow}: حقول ناقصة أو غير صحيحة (${missing.join("، ")})`);
      return;
    }

    const duplicateKey = [patientName, clinic, buildingNumber, apartmentNumber, appointmentAt].join("|").toLowerCase();
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
      appointmentAt,
      kind: kind as AppointmentKind,
      assistance,
      status: "بانتظار طلب السيارة",
    });
  });

  return { appointments, errors };
}

export function canRequestVehicle(appointment: ClinicAppointment | undefined, existingRequest?: VehicleRequest) {
  return Boolean(appointment && !existingRequest && appointment.status !== "مكتملة");
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

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function calculateTripGroupingScore(first: ClinicAppointment, second: ClinicAppointment) {
  const timeGapMinutes = Math.abs(toMinutes(first.appointmentAt) - toMinutes(second.appointmentAt));
  const sameBuilding = first.buildingNumber.trim().toLowerCase() === second.buildingNumber.trim().toLowerCase();
  const sameDestination = first.clinic.trim().toLowerCase() === second.clinic.trim().toLowerCase();
  const compatibleVehicle = first.kind === second.kind;
  const timeScore = Math.max(0, 45 - timeGapMinutes);
  const score = timeScore + (sameBuilding ? 35 : 0) + (sameDestination ? 25 : 0) + (compatibleVehicle ? 10 : 0);
  return { score, timeGapMinutes, sameBuilding, sameDestination, compatibleVehicle };
}

export function suggestTripGroups(appointments: ClinicAppointment[]) {
  const suggestions: TripGroupSuggestion[] = [];
  for (let firstIndex = 0; firstIndex < appointments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < appointments.length; secondIndex += 1) {
      const first = appointments[firstIndex];
      const second = appointments[secondIndex];
      const details = calculateTripGroupingScore(first, second);
      if (details.timeGapMinutes > 45 || details.score < 55) continue;
      const reasons = [
        details.sameBuilding ? "نفس المبنى" : null,
        details.sameDestination ? "نفس الوجهة" : null,
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

export function buildDriverMessage(appointment: ClinicAppointment, request: VehicleRequest) {
  return `رحلة جديدة: ${appointment.patientName} من ${appointmentPickupLabel(appointment)} إلى ${appointment.clinic} الساعة ${appointment.appointmentAt}. رقم الموبايل ${appointment.mobile}. السيارة ${request.vehiclePlate ?? "بانتظار التحديد"}.`;
}

/** رقم الجوال بصيغة دولية بلا "+" (مثل 97477712995) كما تطلبه روابط واتساب. رقم قطري من 8 أرقام يُضاف له 974. */
export function toInternationalDigits(phone: string, countryCode = "974") {
  const digits = normalizeMobile(phone).replace(/^\+/, "").replace(/^00/, "").replace(/\D/g, "");
  if (digits.length === 8) return `${countryCode}${digits}`;
  return digits.length > 8 ? digits : "";
}

/** رسالة السائق لرحلة واحدة أو لعدة رحلات مجمّعة على نفس السيارة. */
export function buildDriverTripsMessage(trips: { appointment: ClinicAppointment; request: VehicleRequest }[]) {
  if (trips.length === 1) {
    const { appointment, request } = trips[0];
    const needs = appointment.assistance.length ? ` احتياجات: ${appointment.assistance.join("، ")}.` : "";
    return `${buildDriverMessage(appointment, request)}${needs}`;
  }
  const lines = trips.map(({ appointment, request }, index) =>
    `${index + 1}) ${request.direction}: ${appointment.patientName} من ${appointmentPickupLabel(appointment)} إلى ${appointment.clinic} الساعة ${appointment.appointmentAt}. رقم الموبايل ${appointment.mobile}.${appointment.assistance.length ? ` (${appointment.assistance.join("، ")})` : ""}`);
  return [`لديك ${trips.length} رحلات مجمّعة على السيارة ${trips[0].request.vehiclePlate ?? ""}:`, ...lines].join("\n");
}

/** رابط يفتح واتساب برسالة جاهزة للسائق (يعمل على الجوال والكمبيوتر). */
export function driverWhatsAppLink(phone: string, message: string) {
  const number = toInternationalDigits(phone);
  return number ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : "";
}

/** رابط اتصال مباشر بالسائق. */
export function driverCallLink(phone: string) {
  const number = toInternationalDigits(phone);
  return number ? `tel:+${number}` : "";
}
