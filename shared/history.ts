import { DEFAULT_HOSPITALS, matchHospital, stripReturnLeg, type Hospital } from "./hospitals";
import { NON_MEDICAL_DESTINATIONS } from "./transport";
import { TRIP_KINDS, summarizeTrips, type StatsSummary, type TripKind, type TripStat } from "./stats";

/**
 * قراءة ملف "حركة السيارات اليومية" (ورقة المواعيد) إلى سجلات رحلات للإحصائيات.
 * لا يُحفظ اسم المريض أو رقمه أو رقم الشقة.
 */

export type { DailyStat, DestinationStat, TripKind } from "./stats";

/** الملخص القديم المحفوظ في meta/history (إجماليات فقط). */
export type HistorySummary = StatsSummary & {
  source: string;
  importedAt: string;
  requesters?: { type: string; trips: number }[];
};

const HEADERS = {
  date: ["التاريخ"],
  plate: ["رقم السيارة"],
  kind: ["نوع المركبة"],
  driver: ["اسم السائق"],
  out: ["خروج السيارة"],
  in: ["دخول السيارة"],
  destination: ["الوجهة"],
  building: ["المبنى"],
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

const NON_MEDICAL_NAMES = NON_MEDICAL_DESTINATIONS.flatMap((item) => [item.ar, item.en]).map((name) => name.toLowerCase());

/** يحوّل ورقة المواعيد إلى رحلات (رحلة لكل صف له تاريخ صحيح). */
export function parseTripRows(rows: unknown[][], hospitals: Hospital[] = DEFAULT_HOSPITALS): TripStat[] {
  const header = findHeader(rows);
  if (!header) throw new Error("لم يتم العثور على ورقة المواعيد (أعمدة التاريخ والوجهة)");
  const { columns } = header;
  const cell = (row: unknown[], column: Column) => (columns[column] >= 0 ? row[columns[column]] : undefined);
  const trips: TripStat[] = [];

  for (const row of rows.slice(header.index + 1)) {
    const date = excelDate(cell(row, "date"));
    if (!date) continue;
    // نوع المركبة "0" أو فارغ يعني أن الرحلة لم تخرج (نفس تعريف ورقة الإحصائيات)
    const kind = TRIP_KINDS.find((item) => item === clean(cell(row, "kind"))) ?? null;
    const out = kind ? excelMinutes(cell(row, "out")) : null;
    const back = kind ? excelMinutes(cell(row, "in")) : null;
    const rawDestination = clean(cell(row, "destination"));
    const hospital = rawDestination ? matchHospital(rawDestination, hospitals) : null;
    const place = hospital?.name ?? (clean(stripReturnLeg(rawDestination)) || "غير محدد");
    const plate = clean(cell(row, "plate")).replace(/\.0$/, "");
    const building = clean(cell(row, "building")).replace(/\.0$/, "");
    trips.push({
      date,
      hour: out !== null ? Math.floor(out / 60) : null,
      kind,
      hospitalId: hospital?.id ?? null,
      place,
      plate: kind && plate && plate !== "0" ? plate : null,
      driver: kind ? clean(cell(row, "driver")) || null : null,
      building: building && building !== "0" ? building : null,
      minutes: out !== null && back !== null && back > out && back - out <= 6 * 60 ? back - out : null,
      nonMedical: !hospital && NON_MEDICAL_NAMES.some((name) => place.toLowerCase().includes(name)),
    });
  }

  if (!trips.length) throw new Error("الملف لا يحتوي على رحلات بتاريخ صحيح");
  return trips;
}

export function summarizeHistory(rows: unknown[][], source: string, hospitals: Hospital[] = DEFAULT_HOSPITALS, now = new Date()): HistorySummary {
  return { ...summarizeTrips(parseTripRows(rows, hospitals), hospitals), source, importedAt: now.toISOString() };
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
    const kind = TRIP_KINDS.find((item) => item === clean(row[kindCol]));
    if (!name || !plate || !kind) continue;
    const phone = clean(row[phoneCol]).replace(/\.0$/, "");
    const entry = byPlate.get(plate) ?? { plate, drivers: [], phone, kind };
    if (!entry.drivers.includes(name)) entry.drivers.push(name);
    byPlate.set(plate, entry);
  }
  return Array.from(byPlate.values());
}
