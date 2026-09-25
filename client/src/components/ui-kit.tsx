import { useState, type ReactNode } from "react";
import type { CalendarDays } from "lucide-react";
import { localDateString, type ClinicAppointment } from "@shared/transport";

export const byAppointmentTime = (a: ClinicAppointment, b: ClinicAppointment) =>
  `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`);

export function PageHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

export function SectionCard({ title, badge, tone = "slate", children }: { title: ReactNode; badge?: ReactNode; tone?: "slate" | "amber" | "blue" | "red"; children: ReactNode }) {
  const tones = {
    slate: "border-slate-200",
    amber: "border-amber-200",
    blue: "border-blue-100",
    red: "border-red-200",
  };
  const heads = { slate: "", amber: "bg-amber-50/70", blue: "bg-blue-50/60", red: "bg-red-50/70" };
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white ${tones[tone]}`}>
      <div className={`flex items-center justify-between gap-3 border-b border-inherit px-5 py-4 ${heads[tone]}`}>
        <h3 className="flex items-center gap-2 font-bold text-slate-900">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

export function InfoCard({ icon: Icon, label, value, tone }: { icon: typeof CalendarDays; label: string; value: string; tone: "teal" | "amber" | "blue" }) {
  const styles = { teal: "bg-[#fff1f2] text-[#a61d2d]", amber: "bg-[#fff1e6] text-[#d86f20]", blue: "bg-[#e9efff] text-[#2864dc]" };
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between"><p className="text-xs font-bold text-slate-500">{label}</p><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${styles[tone]}`}><Icon className="h-5 w-5" /></div></div>
      <p className="mt-4 text-3xl font-bold">{value}</p>
    </div>
  );
}

export function Field({ label, value, onChange, placeholder = "", type = "text", wide, dir, list }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
  dir?: "rtl" | "ltr";
  list?: string;
}) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>
      <input dir={dir} list={list} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]" />
    </label>
  );
}

/** "اليوم" / "غدًا" / "أمس" أو التاريخ */
export function formatDay(date: string, now: Date, labels = { today: "اليوم", tomorrow: "غدًا", yesterday: "أمس" }) {
  const offset = (days: number) => localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  if (date === offset(0)) return labels.today;
  if (date === offset(1)) return labels.tomorrow;
  if (date === offset(-1)) return labels.yesterday;
  return date;
}

/** تاريخ ووقت بالتقويم الميلادي وأرقام لاتينية (مثل 24/09/2026 14:05). */
export function stamp(date = new Date()) {
  const day = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  return `${day} ${timeLabel(date)}`;
}

export const timeLabel = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return localDateString(new Date(year, month - 1, day + days));
}

/** اختيار التاريخ: اليوم، غدًا، أو تاريخ آخر من التقويم. */
export function DateChooser({ value, onChange, labels = { today: "اليوم", tomorrow: "غدًا", other: "تاريخ آخر" }, label }: {
  value: string;
  onChange: (date: string) => void;
  labels?: { today: string; tomorrow: string; other: string };
  label?: string;
}) {
  const today = localDateString();
  const tomorrow = addDays(today, 1);
  const [picking, setPicking] = useState(value !== today && value !== tomorrow);
  const mode = picking ? "other" : value === today ? "today" : value === tomorrow ? "tomorrow" : "other";
  const chip = (active: boolean) => `h-10 rounded-xl px-4 text-sm font-bold transition ${active ? "bg-[#10233f] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;
  return (
    <div>
      {label && <span className="mb-1.5 block text-xs font-bold text-slate-600">{label}</span>}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label ?? "التاريخ"}>
        <button type="button" aria-pressed={mode === "today"} onClick={() => { setPicking(false); onChange(today); }} className={chip(mode === "today")}>{labels.today}</button>
        <button type="button" aria-pressed={mode === "tomorrow"} onClick={() => { setPicking(false); onChange(tomorrow); }} className={chip(mode === "tomorrow")}>{labels.tomorrow}</button>
        <button type="button" aria-pressed={mode === "other"} onClick={() => setPicking(true)} className={chip(mode === "other")}>{labels.other}</button>
        {mode === "other" && <input type="date" aria-label={labels.other} value={value} onChange={(event) => event.target.value && onChange(event.target.value)} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-[#e6a1aa]" />}
      </div>
    </div>
  );
}
