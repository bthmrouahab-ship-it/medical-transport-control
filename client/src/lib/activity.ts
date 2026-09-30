import { api } from "./api";

/** عملية من سجل العمليات (يكتبه الخادم مع اسم من نفّذها ووقتها). */
export type ActivityItem = {
  id: number;
  at: string;
  userId: string | null;
  userName: string;
  role: string;
  type: string;
  action: string;
  ref: string;
  summary: string;
  /** بيانات إضافية: المريض، المبنى، الوجهة، السيارة، السائق، السبب، التغييرات... */
  details: Record<string, string>;
};

export const ACTIVITY_TYPES: Record<string, string> = {
  appointment: "المواعيد",
  request: "طلبات السيارات",
  vehicle: "السيارات",
  hospital: "دليل المستشفيات",
  user: "المستخدمون",
  session: "الدخول والخروج",
  location: "مشاركة الموقع",
  stats: "الإحصائيات",
};

export const ACTIVITY_ROLES: Record<string, string> = {
  admin: "مدير النظام",
  clinic: "العيادة",
  clinicLead: "مسؤول العيادة",
  buildingSupervisor: "مشرف المبنى",
  buildingLead: "مسؤول مشرفي المباني",
  fleetSupervisor: "مشرف السيارات",
  driver: "سائق",
};

/** أسماء بيانات العملية كما تظهر في الجداول والتصدير. */
export const DETAIL_LABELS: [string, string][] = [
  ["patient", "الضيف"],
  ["building", "المبنى"],
  ["apartment", "الشقة"],
  ["destination", "الوجهة"],
  ["date", "تاريخ الموعد"],
  ["time", "وقت الموعد"],
  ["direction", "الاتجاه"],
  ["plate", "السيارة"],
  ["driver", "السائق"],
  ["status", "الحالة"],
  ["eta", "الوصول المتوقع"],
  ["arrivedAt", "وقت الوصول"],
  ["source", "مصدر الوصول"],
  ["from", "النقل من"],
  ["reason", "سبب الإلغاء"],
  ["changes", "التغييرات"],
  ["ip", "عنوان الشبكة"],
];

type Range = { since?: string; until?: string };

/** صفحة من العمليات (الأحدث أولًا). before: رقم آخر عملية في الصفحة السابقة. */
export function fetchActivity(range: Range & { limit?: number; before?: number } = {}) {
  const query: Record<string, string | number> = { limit: range.limit ?? 500 };
  if (range.since) query.since = range.since;
  if (range.until) query.until = range.until;
  if (range.before) query.before = range.before;
  return api<{ items: ActivityItem[]; more: boolean }>("activity", undefined, query);
}

/** كل العمليات في الفترة (للتصدير)، حتى حدّ أعلى. */
export async function fetchAllActivity(range: Range, cap = 50000) {
  const items: ActivityItem[] = [];
  let before: number | undefined;
  for (;;) {
    const page = await fetchActivity({ ...range, limit: 5000, before });
    items.push(...page.items);
    if (!page.more || !page.items.length || items.length >= cap) return { items, truncated: page.more };
    before = page.items[page.items.length - 1].id;
  }
}

/** حدود الفترة بتوقيت الجهاز: من بداية يوم from حتى نهاية يوم to (YYYY-MM-DD). */
export function dayRange(from?: string, to?: string): Range {
  const start = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(year, month - 1, day);
  };
  const range: Range = {};
  if (from) range.since = start(from).toISOString();
  if (to) {
    const end = start(to);
    end.setDate(end.getDate() + 1);
    range.until = end.toISOString();
  }
  return range;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** التاريخ والوقت بتوقيت الجهاز: 27/09/2026 و14:05:32 */
export const activityDate = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
};
export const activityTime = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
