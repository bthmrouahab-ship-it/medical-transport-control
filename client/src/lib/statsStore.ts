import { collection, doc, onSnapshot, writeBatch } from "firebase/firestore";
import type { StatsDay, TripStat } from "@shared/stats";
import { firestore } from "./firebase";

/**
 * رحلات ملفات Excel: مستند لكل يوم في statsDays (بلا بيانات مرضى).
 * تُقرأ عند فتح الإحصائيات فقط، ولا تُحمَّل مع بيانات التشغيل اليومية.
 */
export function watchStatsDays(onChange: (days: StatsDay[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(
    collection(firestore, "statsDays"),
    (snap) => onChange(snap.docs.map((item) => item.data() as StatsDay)),
    onError,
  );
}

/** عدد الأيام في كل دفعة كتابة (حد حجم الطلب في Firestore). */
const DAYS_PER_BATCH = 40;

/** يحفظ أيام الملف: كل يوم في الملف يُضاف أو يستبدل نفس اليوم، والأيام الأخرى تبقى كما هي. */
export async function saveStatsDays(trips: TripStat[], source: string) {
  const byDate = new Map<string, TripStat[]>();
  for (const trip of trips) byDate.set(trip.date, [...(byDate.get(trip.date) ?? []), trip]);
  const importedAt = new Date().toISOString();
  const days = Array.from(byDate);
  for (let index = 0; index < days.length; index += DAYS_PER_BATCH) {
    const batch = writeBatch(firestore);
    for (const [date, list] of days.slice(index, index + DAYS_PER_BATCH)) {
      const day: StatsDay = { date, source, importedAt, trips: list };
      batch.set(doc(firestore, "statsDays", date), day);
    }
    await batch.commit();
  }
  return days.length;
}
