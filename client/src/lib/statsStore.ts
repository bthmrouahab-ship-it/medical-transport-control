import type { StatsDay, TripStat } from "@shared/stats";
import { api } from "./api";

/**
 * رحلات ملفات Excel: مستند لكل يوم (بلا بيانات مرضى).
 * تُقرأ عند فتح الإحصائيات فقط، ولا تُحمَّل مع بيانات التشغيل اليومية.
 */
const REFRESH_MS = 60000;
const refreshers = new Set<() => void>();

export function watchStatsDays(onChange: (days: StatsDay[]) => void, onError: (error: unknown) => void) {
  let stopped = false;
  const load = () => api<{ days: StatsDay[] }>("stats-days")
    .then(({ days }) => { if (!stopped) onChange(days); })
    .catch((error) => { if (!stopped) onError(error); });
  load();
  refreshers.add(load);
  const timer = window.setInterval(load, REFRESH_MS);
  return () => {
    stopped = true;
    refreshers.delete(load);
    window.clearInterval(timer);
  };
}

/** عدد الأيام في كل طلب حفظ (حد حجم الطلب في الخادم). */
const DAYS_PER_REQUEST = 40;

/** يحفظ أيام الملف: كل يوم في الملف يُضاف أو يستبدل نفس اليوم، والأيام الأخرى تبقى كما هي. */
export async function saveStatsDays(trips: TripStat[], source: string) {
  const byDate = new Map<string, TripStat[]>();
  for (const trip of trips) byDate.set(trip.date, [...(byDate.get(trip.date) ?? []), trip]);
  const importedAt = new Date().toISOString();
  const days: StatsDay[] = Array.from(byDate, ([date, list]) => ({ date, source, importedAt, trips: list }));
  for (let index = 0; index < days.length; index += DAYS_PER_REQUEST) {
    await api("stats-days.save", { days: days.slice(index, index + DAYS_PER_REQUEST) });
  }
  refreshers.forEach((load) => load());
  return days.length;
}
