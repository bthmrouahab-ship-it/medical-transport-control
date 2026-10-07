import { summarizeOperations } from "@shared/operations";
import { serviceSummaryOf, summarizeTrips } from "@shared/stats";
import type { ReportSection } from "@/lib/report";
import type { ReportViewerData } from "./types";

/**
 * إحصائيات يوم أو أيام محددة من بيانات الصفحة المصدرة، بنفس حساب صفحة الإحصائيات في الموقع (summarizeTrips
 * وsummarizeOperations، والتوفر في الخدمة لأيامها فقط).
 */
export function statsForDates(data: ReportViewerData, dates: string[]) {
  const set = new Set(dates);
  const trips = data.trips.filter((trip) => set.has(trip.date));
  const service = data.service ? serviceSummaryOf(data.service.days.filter((day) => set.has(day.date))) : null;
  // الباصات المخصصة في الخدمة سيارات عاملة، ما لم تُختر وجهة أو منطقة أو مبنى أو نوع رحلة (كما في الموقع)
  const { filter } = data;
  const roleDays = filter.zone === "all" && filter.destination === "all" && filter.building === "all" && filter.category === "all" ? service?.days ?? [] : [];
  return {
    trips,
    service,
    summary: summarizeTrips(trips, data.hospitals, null, roleDays, data.schedules),
    operations: summarizeOperations(trips, data.opsLog),
  };
}

/** تاريخ صف في جدول تفصيلي: YYYY-MM-DD (الرحلات بالتفصيل) أو DD/MM/YYYY */
export function rowDate(value: unknown): string | null {
  const text = String(value ?? "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** صفوف الجدول في هذه الأيام (بعمود «التاريخ»)؛ الجدول بلا تاريخ لا يظهر في صفحة اليوم */
export function sectionForDates(section: ReportSection, dates: string[]): ReportSection | null {
  const index = section.columns.indexOf("التاريخ");
  if (index < 0) return null;
  const set = new Set(dates);
  return { ...section, rows: section.rows.filter((row) => set.has(rowDate(row[index]) ?? "")) };
}

/** «#day=YYYY-MM-DD» أو «#days=…,…» أو الفترة كاملة */
export type Route = { kind: "period" } | { kind: "days"; dates: string[] };
export function parseRoute(hash: string): Route {
  const match = /^#days?=([\d,-]+)$/.exec(hash);
  const dates = match ? match[1].split(",").filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) : [];
  return dates.length ? { kind: "days", dates: Array.from(new Set(dates)).sort() } : { kind: "period" };
}
export const routeHash = (dates: string[]) => (dates.length === 1 ? `#day=${dates[0]}` : `#days=${[...dates].sort().join(",")}`);
