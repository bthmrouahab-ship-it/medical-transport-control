import { normalizeGender, normalizeMobile, readAliased, toText, toWesternDigits } from "./text";
import type { ClinicAppointment, Gender, VehicleRequest } from "./transport";

/**
 * قائمة ضيوف المجمع: يرفعها مدير النظام من ملف Excel (أو يضيف ضيفًا ويعدّل مبناه وشقته ويحذفه)،
 * ولا تُضاف المواعيد إلا لضيف منها. تُحفظ في قاعدة البيانات فقط (لا في المستودع).
 * العمر والرقم الصحي لا يُرسلان مع القائمة إلى صفحات المواعيد، ويظهران في الإحصائيات فقط.
 */
export type Guest = {
  id: string;
  /** الاسم بالعربية (يُكتب في الموعد كما هو) */
  name: string;
  nameEn?: string;
  gender?: Gender;
  mobile?: string;
  buildingNumber: string;
  apartmentNumber: string;
};

/** بيانات لا تظهر عند طلب الموعد: في الإحصائيات فقط */
export type GuestPrivate = { age?: number; healthNumber?: string };
export type GuestRecord = Guest & GuestPrivate;

export const GUEST_NAME_MAX = 120;

/** الاسم للمطابقة والبحث: بلا فرق في الهمزات والتاء المربوطة والياء والتشكيل والمسافات والأحرف الكبيرة. */
export function normalizeGuestName(value: string) {
  return toWesternDigits(toText(value))
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىئ]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/[^0-9a-z؀-ۿ]+/g, " ")
    .trim();
}

const cellText = (value: unknown) => toWesternDigits(toText(value)).replace(/\.0$/, "").replace(/\s+/g, " ");
const spaced = (value: unknown) => toText(value).replace(/\s+/g, " ");

const COLUMNS = {
  name: ["الاسم باللغة العربية", "الاسم بالعربية", "الاسم العربي", "اسم الضيف", "الاسم", "الضيف", "arabic name"],
  nameEn: ["الاسم باللغة الإنجليزية", "الاسم باللغة الانجليزية", "الاسم بالإنجليزية", "الاسم بالانجليزية", "الاسم الإنجليزي", "english name", "name"],
  gender: ["الجنس", "gender", "sex"],
  age: ["العمر", "السن", "age"],
  healthNumber: ["الرقم الصحي", "رقم البطاقة الصحية", "البطاقة الصحية", "health number", "health card", "hc number"],
  mobile: ["رقم الهاتف", "رقم الموبايل", "رقم الجوال", "الهاتف", "الموبايل", "الجوال", "mobile", "phone"],
  building: ["رقم المبنى", "المبنى", "building number", "building"],
  apartment: ["رقم الشقة", "الشقة", "apartment number", "apartment"],
};

/** رقم المبنى أو الشقة كما يُكتب في المواعيد (R1 بأحرف كبيرة) */
export const normalizeUnit = (value: unknown) => cellText(value).toUpperCase();

/** العمر من الخلية (رقم صحيح من 0 إلى 130)، وإلا بلا عمر. */
export function normalizeAge(value: unknown): number | undefined {
  const digits = cellText(value).match(/\d{1,3}/)?.[0];
  const age = digits === undefined ? NaN : Number(digits);
  return Number.isInteger(age) && age >= 0 && age <= 130 ? age : undefined;
}

/** قيمة فارغة في الملف: N/A أو «لا يوجد» أو - */
const NOT_AVAILABLE = /^(n\s*\/?\s*a|none|-+|لا\s*يوجد|لا)$/i;

/** الرقم الصحي كما في الملف (N/A أو «لا يوجد» = بلا رقم) */
export function normalizeHealthNumber(value: unknown) {
  const text = cellText(value).replace(/\s+/g, "");
  return NOT_AVAILABLE.test(text) ? "" : text.slice(0, 30);
}

/** رقم الهاتف: الأول إن كُتب أكثر من رقم (55512345/44412345) */
export function normalizeGuestMobile(value: unknown) {
  return toText(value).split(/[\/,،;|]|\sو\s/).map(normalizeMobile).find((mobile) => /^\+?\d{7,15}$/.test(mobile)) ?? "";
}

/** يقرأ صفوف ملف الضيوف (بعناوين الملف المرفوع أو ما يشبهها). الاسم بالعربية والمبنى والشقة إلزامية، والاسم لا يتكرر. */
export function parseGuestRows(rows: Record<string, unknown>[]): { guests: GuestRecord[]; errors: string[] } {
  const guests: GuestRecord[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const excelRow = index + 2;
    const name = spaced(readAliased(row, COLUMNS.name)).slice(0, GUEST_NAME_MAX);
    if (!name) {
      if (Object.values(row).some((value) => toText(value))) errors.push(`الصف ${excelRow}: الاسم بالعربية ناقص`);
      return;
    }
    const buildingNumber = normalizeUnit(readAliased(row, COLUMNS.building));
    const apartmentNumber = normalizeUnit(readAliased(row, COLUMNS.apartment));
    if (!buildingNumber || !apartmentNumber) {
      errors.push(`الصف ${excelRow}: رقم المبنى أو الشقة ناقص`);
      return;
    }
    const key = normalizeGuestName(name);
    if (seen.has(key)) {
      errors.push(`الصف ${excelRow}: الاسم مكرر (كما في الصف ${seen.get(key)})`);
      return;
    }
    seen.set(key, excelRow);
    const englishName = spaced(readAliased(row, COLUMNS.nameEn)).slice(0, GUEST_NAME_MAX);
    const nameEn = NOT_AVAILABLE.test(englishName) ? "" : englishName;
    const gender = normalizeGender(readAliased(row, COLUMNS.gender));
    const mobile = normalizeGuestMobile(readAliased(row, COLUMNS.mobile));
    const age = normalizeAge(readAliased(row, COLUMNS.age));
    const healthNumber = normalizeHealthNumber(readAliased(row, COLUMNS.healthNumber));
    guests.push({
      id: "",
      name,
      ...(nameEn ? { nameEn } : {}),
      ...(gender ? { gender } : {}),
      ...(mobile ? { mobile } : {}),
      buildingNumber,
      apartmentNumber,
      ...(age !== undefined ? { age } : {}),
      ...(healthNumber ? { healthNumber } : {}),
    });
  });
  return { guests, errors };
}

/**
 * رفع ملف ضيوف جديد: الضيف الموجود بنفس الاسم يُحدَّث (ويبقى رقمه في النظام فتبقى مواعيده مرتبطة به)،
 * والجديد يُضاف برقم جديد. «غير موجودين في الملف» يمكن حذفهم إن اختار المدير ذلك.
 */
export function planGuestImport(incoming: GuestRecord[], existing: Guest[], idSeed = Date.now()) {
  const byName = new Map(existing.map((guest) => [normalizeGuestName(guest.name), guest]));
  const matched = new Set<string>();
  const stamp = idSeed.toString(36);
  const guests = incoming.map((guest, index) => {
    const found = byName.get(normalizeGuestName(guest.name));
    if (found) matched.add(found.id);
    return { ...guest, id: found?.id ?? `G-${stamp}-${index + 1}` };
  });
  return {
    guests,
    added: guests.length - matched.size,
    updated: matched.size,
    missing: existing.filter((guest) => !matched.has(guest.id)),
  };
}

/** بيانات ضيف يضيفه المدير أو يعدّله: يعيد سبب الرفض، أو null. */
export function validateGuest(guest: GuestRecord, guests: Guest[]): string | null {
  if (!guest.name.trim()) return "اكتب اسم الضيف بالعربية.";
  if (guest.name.length > GUEST_NAME_MAX) return "اسم الضيف طويل جدًا.";
  if (!guest.buildingNumber.trim() || !guest.apartmentNumber.trim()) return "اكتب رقم المبنى ورقم الشقة.";
  if (guest.buildingNumber.length > 20 || guest.apartmentNumber.length > 20) return "رقم المبنى أو الشقة غير صحيح.";
  const key = normalizeGuestName(guest.name);
  if (guests.some((other) => other.id !== guest.id && normalizeGuestName(other.name) === key)) return "يوجد ضيف بنفس الاسم في القائمة.";
  if (guest.mobile && !/^\+?\d{7,15}$/.test(guest.mobile)) return "رقم الهاتف غير صحيح.";
  if (guest.age !== undefined && !(Number.isInteger(guest.age) && guest.age >= 0 && guest.age <= 130)) return "العمر غير صحيح.";
  return null;
}

/** بحث في القائمة بالاسم (العربي أو الإنجليزي) أو المبنى والشقة أو الهاتف؛ كل كلمة يجب أن تطابق. */
export function searchGuests(guests: Guest[], query: string, limit = 30): Guest[] {
  const words = normalizeGuestName(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  const first = words.join(" ");
  const matches: { guest: Guest; rank: number }[] = [];
  for (const guest of guests) {
    const name = normalizeGuestName(guest.name);
    const nameEn = normalizeGuestName(guest.nameEn ?? "");
    const haystack = ` ${name} ${nameEn} ${guest.buildingNumber.toLowerCase()} ${guest.apartmentNumber.toLowerCase()} ${guest.mobile ?? ""} `;
    if (!words.every((word) => haystack.includes(word))) continue;
    const rank = name.startsWith(first) || nameEn.startsWith(first) ? 0 : haystack.includes(` ${words[0]}`) ? 1 : 2;
    matches.push({ guest, rank });
  }
  return matches
    .sort((a, b) => a.rank - b.rank || a.guest.name.localeCompare(b.guest.name, "ar"))
    .slice(0, limit)
    .map((item) => item.guest);
}

/** فهرس القائمة: بالرقم، وبالاسم العربي أو الإنجليزي. */
export function guestIndex<T extends Guest>(guests: T[]) {
  const byId = new Map(guests.map((guest) => [guest.id, guest]));
  const byName = new Map<string, T[]>();
  for (const guest of guests) {
    for (const name of [guest.name, guest.nameEn ?? ""]) {
      const key = normalizeGuestName(name);
      if (key) byName.set(key, [...(byName.get(key) ?? []), guest]);
    }
  }
  return { byId, byName };
}
export type GuestIndex<T extends Guest = Guest> = ReturnType<typeof guestIndex<T>>;

/** الضيف بالاسم (العربي أو الإنجليزي)، ومع أكثر من ضيف بنفس الاسم: صاحب المبنى والشقة. */
export function findGuestByName<T extends Guest>(index: GuestIndex<T>, name: string, buildingNumber?: string, apartmentNumber?: string): T | undefined {
  const candidates = index.byName.get(normalizeGuestName(name)) ?? [];
  if (candidates.length <= 1) return candidates[0];
  const building = normalizeUnit(buildingNumber);
  const apartment = normalizeUnit(apartmentNumber);
  const exact = candidates.filter((guest) => guest.buildingNumber === building && guest.apartmentNumber === apartment);
  return exact.length === 1 ? exact[0] : undefined;
}

/** ضيف الموعد: برقمه في القائمة، أو (للمواعيد القديمة) بالاسم والمبنى والشقة. */
export function guestOfAppointment<T extends Guest>(
  index: GuestIndex<T>,
  appointment: Pick<ClinicAppointment, "guestId" | "patientName" | "buildingNumber" | "apartmentNumber">,
): T | undefined {
  if (appointment.guestId) {
    const guest = index.byId.get(appointment.guestId);
    if (guest) return guest;
  }
  return findGuestByName(index, appointment.patientName, appointment.buildingNumber, appointment.apartmentNumber);
}

// ————— الإحصائيات: العمر والرقم الصحي —————

export const AGE_GROUPS: { label: string; max: number }[] = [
  { label: "أقل من 18", max: 17 },
  { label: "18 إلى 39", max: 39 },
  { label: "40 إلى 59", max: 59 },
  { label: "60 إلى 74", max: 74 },
  { label: "75 فأكثر", max: Infinity },
];
export const UNKNOWN_AGE = "غير محدد";
export const ageGroupOf = (age?: number) => (age === undefined ? UNKNOWN_AGE : AGE_GROUPS.find((group) => age <= group.max)!.label);

export type GuestStat = {
  key: string;
  name: string;
  buildingNumber: string;
  apartmentNumber: string;
  gender?: Gender;
  age?: number;
  healthNumber?: string;
  /** false: موعد قديم لضيف غير موجود في القائمة الحالية */
  listed: boolean;
  appointments: number;
  cancelled: number;
  /** سيارات أُرسلت له (ذهاب وعودة ونقل) */
  trips: number;
};

export type GuestStatsFilter = { from: string; to: string; building: string };

/**
 * ضيوف الفترة: كل ضيف له موعد طبي في الفترة (غير المستبعد)، مع عمره ورقمه الصحي من القائمة،
 * وعدد مواعيده والملغي منها والسيارات التي أُرسلت له. ومعها الفئات العمرية.
 */
export function guestStats(appointments: ClinicAppointment[], requests: VehicleRequest[], guests: GuestRecord[], filter: GuestStatsFilter) {
  const index = guestIndex(guests);
  const sent = new Map<string, number>();
  for (const request of requests) {
    if (request.vehiclePlate && !request.nurseOnly) sent.set(request.appointmentId, (sent.get(request.appointmentId) ?? 0) + 1);
  }
  const rows = new Map<string, GuestStat>();
  for (const appointment of appointments) {
    if (appointment.category === "غير طبية" || appointment.approval === "excluded") continue;
    if ((filter.from && appointment.appointmentDate < filter.from) || (filter.to && appointment.appointmentDate > filter.to)) continue;
    const guest = guestOfAppointment(index, appointment);
    const buildingNumber = guest?.buildingNumber ?? appointment.buildingNumber;
    if (filter.building !== "all" && buildingNumber !== filter.building) continue;
    const key = guest ? `g:${guest.id}` : `a:${normalizeGuestName(appointment.patientName)}|${appointment.buildingNumber}|${appointment.apartmentNumber}`;
    const row = rows.get(key) ?? {
      key,
      name: guest?.name ?? appointment.patientName,
      buildingNumber,
      apartmentNumber: guest?.apartmentNumber ?? appointment.apartmentNumber,
      gender: guest?.gender ?? appointment.gender,
      age: guest?.age,
      healthNumber: guest?.healthNumber,
      listed: Boolean(guest),
      appointments: 0,
      cancelled: 0,
      trips: 0,
    };
    row.appointments += 1;
    if (appointment.status === "ملغي") row.cancelled += 1;
    row.trips += sent.get(appointment.id) ?? 0;
    rows.set(key, row);
  }
  const list = Array.from(rows.values()).sort((a, b) => b.trips - a.trips || b.appointments - a.appointments || a.name.localeCompare(b.name, "ar"));
  const ages = list.filter((row) => row.age !== undefined).map((row) => row.age!);
  const ageGroups = [...AGE_GROUPS.map((group) => group.label), UNKNOWN_AGE].map((label) => {
    const members = list.filter((row) => ageGroupOf(row.age) === label);
    return { label, guests: members.length, appointments: members.reduce((sum, row) => sum + row.appointments, 0), trips: members.reduce((sum, row) => sum + row.trips, 0) };
  }).filter((group) => group.label !== UNKNOWN_AGE || group.guests > 0);
  return {
    rows: list,
    ageGroups,
    averageAge: ages.length ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length) : null,
    unlisted: list.filter((row) => !row.listed).length,
  };
}
