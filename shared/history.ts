import { DEFAULT_HOSPITALS, matchHospital, normalizePlaceName, stripReturnLeg, type Hospital } from "./hospitals";

/**
 * تحويل ملف "حركة السيارات اليومية" (ورقة المواعيد) إلى إحصائيات مجمّعة.
 * لا يُحفظ اسم المريض أو رقمه أو رقم الشقة: الناتج أرقام وإجماليات فقط.
 */

export type TripKind = "سيدان" | "احتياجات خاصة" | "باص";

export type DailyStat = { date: string; weekday: string; total: number; completed: number; sedan: number; special: number; bus: number };
export type DestinationStat = { key: string; name: string; hospitalId: string | null; zone: string | null; trips: number; avgMinutes: number | null };

export type HistorySummary = {
  source: string;
  importedAt: string;
  from: string;
  to: string;
  totalTrips: number;
  completedTrips: number;
  activeDays: number;
  avgTripMinutes: number | null;
  daily: DailyStat[];
  byWeekday: { weekday: string; trips: number; days: number }[];
  byHour: { hour: number; trips: number }[];
  byKind: { kind: TripKind; trips: number }[];
  destinations: DestinationStat[];
  zones: { zone: string; trips: number }[];
  vehicles: { plate: string; driver: string; trips: number }[];
  buildings: { building: string; trips: number }[];
  requesters: { type: string; trips: number }[];
  unmatchedDestinations: number;
};

const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const KINDS: TripKind[] = ["سيدان", "احتياجات خاصة", "باص"];

const HEADERS = {
  date: ["التاريخ"],
  plate: ["رقم السيارة"],
  kind: ["نوع المركبة"],
  driver: ["اسم السائق"],
  out: ["خروج السيارة"],
  in: ["دخول السيارة"],
  destination: ["الوجهة"],
  building: ["المبنى"],
  requester: ["الجهة الطالبة"],
} as const;

type Column = keyof typeof HEADERS;

const clean = (value: unknown) => (value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim());

function findHeader(rows: unknown[][]) {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const cells = rows[index].map(clean);
    if (cells.includes("التاريخ") && cells.includes("الوجهة")) {
      const columns = {} as Record<Column, number>;
      for (const [key, names] of Object.entries(HEADERS) as [Column, readonly string[]][]) {
        columns[key] = cells.findIndex((cell) => names.includes(cell));
      }
      return { index, columns };
    }
  }
  return null;
}

/** تاريخ Excel (رقم تسلسلي أو Date أو نص) إلى YYYY-MM-DD. */
export function excelDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && value > 30000 && value < 80000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
    return date.toISOString().slice(0, 10);
  }
  const text = clean(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** وقت Excel (كسر من يوم أو Date أو "HH:MM") إلى دقائق منذ منتصف الليل. */
export function excelMinutes(value: unknown): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getHours() * 60 + value.getMinutes();
  if (typeof value === "number" && Number.isFinite(value)) {
    const fraction = value % 1;
    if (fraction === 0 && value !== 0) return null;
    return Math.round(fraction * 24 * 60) % (24 * 60);
  }
  const match = clean(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes < 24 * 60 ? minutes : null;
}

function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function increment(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

const sortDesc = <T extends { trips: number }>(items: T[]) => items.sort((a, b) => b.trips - a.trips);

export function summarizeHistory(rows: unknown[][], source: string, hospitals: Hospital[] = DEFAULT_HOSPITALS, now = new Date()): HistorySummary {
  const header = findHeader(rows);
  if (!header) throw new Error("لم يتم العثور على ورقة المواعيد (أعمدة التاريخ والوجهة)");
  const { columns } = header;
  const cell = (row: unknown[], column: Column) => (columns[column] >= 0 ? row[columns[column]] : undefined);

  const daily = new Map<string, DailyStat>();
  const hours = new Map<string, number>();
  const kinds = new Map<string, number>();
  const zones = new Map<string, number>();
  const vehicles = new Map<string, { plate: string; drivers: Map<string, number>; trips: number }>();
  const buildings = new Map<string, number>();
  const requesters = new Map<string, number>();
  const destinations = new Map<string, DestinationStat & { minutesTotal: number; minutesCount: number }>();
  let totalTrips = 0;
  let completedTrips = 0;
  let unmatched = 0;
  let durationTotal = 0;
  let durationCount = 0;

  for (const row of rows.slice(header.index + 1)) {
    const date = excelDate(cell(row, "date"));
    if (!date) continue;
    totalTrips += 1;
    const day = daily.get(date) ?? { date, weekday: weekdayOf(date), total: 0, completed: 0, sedan: 0, special: 0, bus: 0 };
    daily.set(date, day);
    day.total += 1;

    // نوع المركبة "0" أو فارغ يعني أن الرحلة لم تخرج (نفس تعريف ورقة الإحصائيات)
    const kind = KINDS.find((item) => item === clean(cell(row, "kind")));
    if (!kind) continue;
    completedTrips += 1;
    day.completed += 1;
    if (kind === "سيدان") day.sedan += 1;
    else if (kind === "احتياجات خاصة") day.special += 1;
    else day.bus += 1;
    increment(kinds, kind);

    const out = excelMinutes(cell(row, "out"));
    const back = excelMinutes(cell(row, "in"));
    if (out !== null) increment(hours, String(Math.floor(out / 60)));
    const duration = out !== null && back !== null && back > out && back - out <= 6 * 60 ? back - out : null;
    if (duration !== null) {
      durationTotal += duration;
      durationCount += 1;
    }

    const rawDestination = clean(cell(row, "destination"));
    const hospital = rawDestination ? matchHospital(rawDestination, hospitals) : null;
    const name = hospital?.name ?? (clean(stripReturnLeg(rawDestination)) || "غير محدد");
    const key = hospital ? `h:${hospital.id}` : `t:${normalizePlaceName(name) || "غير محدد"}`;
    if (!hospital) unmatched += 1;
    const destination = destinations.get(key) ?? { key, name, hospitalId: hospital?.id ?? null, zone: hospital?.zone ?? null, trips: 0, avgMinutes: null, minutesTotal: 0, minutesCount: 0 };
    destinations.set(key, destination);
    destination.trips += 1;
    if (duration !== null) {
      destination.minutesTotal += duration;
      destination.minutesCount += 1;
    }
    increment(zones, hospital?.zone ?? "وجهات أخرى");

    const plate = clean(cell(row, "plate")).replace(/\.0$/, "");
    if (plate && plate !== "0") {
      const vehicle = vehicles.get(plate) ?? { plate, drivers: new Map<string, number>(), trips: 0 };
      vehicles.set(plate, vehicle);
      vehicle.trips += 1;
      const driver = clean(cell(row, "driver"));
      if (driver) increment(vehicle.drivers, driver);
    }
    const building = clean(cell(row, "building")).replace(/\.0$/, "");
    if (building && building !== "0") increment(buildings, building);
    increment(requesters, clean(cell(row, "requester")) || "غير محدد");
  }

  if (!totalTrips) throw new Error("الملف لا يحتوي على رحلات بتاريخ صحيح");

  const days = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
  const activeDays = days.filter((day) => day.total > 0);
  const weekdayMap = new Map<string, { trips: number; days: number }>();
  for (const day of activeDays) {
    const entry = weekdayMap.get(day.weekday) ?? { trips: 0, days: 0 };
    entry.trips += day.total;
    entry.days += 1;
    weekdayMap.set(day.weekday, entry);
  }

  const destinationList = sortDesc(Array.from(destinations.values()).map(({ minutesTotal, minutesCount, ...item }) => ({
    ...item,
    avgMinutes: minutesCount ? Math.round(minutesTotal / minutesCount) : null,
  })));
  // نحتفظ بالمستشفيات المعروفة كلها، وبأكثر الوجهات الأخرى تكرارًا فقط
  const keptDestinations = [
    ...destinationList.filter((item) => item.hospitalId),
    ...destinationList.filter((item) => !item.hospitalId).slice(0, 25),
  ];

  return {
    source,
    importedAt: now.toISOString(),
    from: days[0].date,
    to: days[days.length - 1].date,
    totalTrips,
    completedTrips,
    activeDays: activeDays.length,
    avgTripMinutes: durationCount ? Math.round(durationTotal / durationCount) : null,
    daily: days,
    byWeekday: WEEKDAYS.map((weekday) => ({ weekday, trips: weekdayMap.get(weekday)?.trips ?? 0, days: weekdayMap.get(weekday)?.days ?? 0 })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, trips: hours.get(String(hour)) ?? 0 })),
    byKind: KINDS.map((kind) => ({ kind, trips: kinds.get(kind) ?? 0 })),
    destinations: sortDesc(keptDestinations),
    zones: sortDesc(Array.from(zones, ([zone, trips]) => ({ zone, trips }))),
    vehicles: sortDesc(Array.from(vehicles.values()).map((vehicle) => ({
      plate: vehicle.plate,
      driver: Array.from(vehicle.drivers).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3).join(" / "),
      trips: vehicle.trips,
    }))),
    buildings: sortDesc(Array.from(buildings, ([building, trips]) => ({ building, trips }))).slice(0, 60),
    requesters: sortDesc(Array.from(requesters, ([type, trips]) => ({ type, trips }))),
    unmatchedDestinations: unmatched,
  };
}

export type ImportedDriver = { plate: string; drivers: string[]; phone: string; kind: TripKind };

/** قراءة ورقة "قائمة" (السائقون والسيارات): سيارة واحدة قد يتناوب عليها أكثر من سائق. */
export function parseDriverList(rows: unknown[][]): ImportedDriver[] {
  const headerIndex = rows.findIndex((row) => row.map(clean).some((cell) => cell === "اسم السائق") && row.map(clean).some((cell) => cell.includes("رقم سيارة")));
  if (headerIndex < 0) return [];
  const cells = rows[headerIndex].map(clean);
  const nameCol = cells.indexOf("اسم السائق");
  const phoneCol = cells.indexOf("رقم السائق");
  const kindCol = cells.indexOf("نوع المركبة");
  const plateCol = cells.findIndex((cell) => cell.includes("رقم سيارة"));
  const byPlate = new Map<string, ImportedDriver>();
  for (const row of rows.slice(headerIndex + 1)) {
    const name = clean(row[nameCol]);
    const plate = clean(row[plateCol]).replace(/\.0$/, "");
    const kind = KINDS.find((item) => item === clean(row[kindCol]));
    if (!name || !plate || !kind) continue;
    const phone = clean(row[phoneCol]).replace(/\.0$/, "");
    const entry = byPlate.get(plate) ?? { plate, drivers: [], phone, kind };
    if (!entry.drivers.includes(name)) entry.drivers.push(name);
    byPlate.set(plate, entry);
  }
  return Array.from(byPlate.values());
}
