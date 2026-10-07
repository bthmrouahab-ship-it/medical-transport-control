import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Layers, Printer, Table2, X } from "lucide-react";
import { DAY_RATING_LABELS, completionPercent, dayRating, type CalendarDay, type DayRating } from "@shared/stats";
import type { ClinicAppointment, VehicleKind, VehicleRequest } from "@shared/transport";
import HistoryCharts from "@/components/HistoryCharts";
import OperationsStats from "@/components/OperationsStats";
import StatsAppointments from "@/components/StatsAppointments";
import GuestStats from "@/components/GuestStats";
import { Badge, EmptyState, PageHeader, Panel, btn, cx, type Tone } from "@/components/ui-kit";
import type { ReportSection } from "@/lib/report";
import { parseRoute, routeHash, sectionForDates, statsForDates, type Route } from "./compute";
import type { ReportViewerData } from "./types";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const WEEKDAYS = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const RATING_TONE: Record<DayRating, Tone> = { excellent: "green", average: "amber", weak: "red", holiday: "neutral", none: "neutral", today: "blue", upcoming: "neutral" };
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const fullDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
const daysText = (count: number) => (count === 1 ? "يوم واحد" : count === 2 ? "يومان" : count <= 10 ? `${count} أيام` : `${count} يومًا`);
const selectedText = (count: number) => (count === 1 ? "يوم واحد محدد" : count === 2 ? "يومان محددان" : count <= 10 ? `${count} أيام محددة` : `${count} يومًا محددًا`);
const go = (hash: string) => { window.location.hash = hash; };

/**
 * صفحة الإحصائيات المصدرة: نفس عرض صفحة الإحصائيات في الموقع (البطاقات والرسوم البيانية وسير العمل والمواعيد بالتفصيل)،
 * وتقويم الأيام: الضغط على يوم ينقل إلى صفحة ذلك اليوم بإحصائياته ورسومه ومواعيده، ومربع التحديد يجمع أيامًا في صفحة واحدة.
 */
export default function ReportViewer({ data }: { data: ReportViewerData }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    const onHash = () => { setRoute(parseRoute(window.location.hash)); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const fleetKinds = useMemo(() => new Map(data.fleetKinds), [data.fleetKinds]);
  const toggle = (dates: string[], on: boolean) => setSelected((current) => (on ? Array.from(new Set([...current, ...dates])) : current.filter((date) => !dates.includes(date))).sort());

  return (
    <div className="min-h-screen bg-page" dir="rtl" lang="ar">
      <header className="bg-navy-900 text-white print:bg-white print:text-ink">
        <div className="h-[3px] bg-brand-600" />
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            {data.logo && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white p-0.5"><img src={data.logo} alt="" className="h-full w-full object-contain" /></div>}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[15px] font-semibold">{data.title}</p>
              <p className="mt-0.5 text-xs text-slate-300 print:text-slate-600">{data.subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={() => window.print()} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-200 ring-1 ring-inset ring-white/15 hover:bg-white/10 print:hidden">
            <Printer className="h-4 w-4" /> طباعة
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
        {route.kind === "period"
          ? <PeriodPage data={data} fleetKinds={fleetKinds} selected={selected} onToggle={toggle} />
          : <DaysPage key={route.dates.join()} data={data} dates={route.dates} fleetKinds={fleetKinds} />}
      </main>
      {/* الأيام المحددة: صفحة واحدة لإحصائياتها مجتمعة */}
      {route.kind === "period" && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-raised backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2">
            <p className="me-auto text-sm font-semibold text-ink">{selectedText(selected.length)} <span className="font-normal text-slate-500">· {selected.map(dayMonth).join("، ")}</span></p>
            <button type="button" onClick={() => setSelected([])} className={btn("ghost", "sm")}><X className="h-3.5 w-3.5" /> إلغاء التحديد</button>
            <button type="button" onClick={() => go(routeHash(selected))} className={btn("primary", "sm")}><Layers className="h-3.5 w-3.5" /> عرض الأيام المحددة</button>
          </div>
        </div>
      )}
    </div>
  );
}

function PeriodPage({ data, fleetKinds, selected, onToggle }: { data: ReportViewerData; fleetKinds: Map<string, VehicleKind>; selected: string[]; onToggle: (dates: string[], on: boolean) => void }) {
  return (
    <>
      <PageHeader title="الإحصائيات" subtitle={data.periodLabel} />
      {data.calendar && <CalendarPanel days={data.calendar.days} today={data.calendar.today} selected={selected} onToggle={onToggle} />}
      {data.summary.totalTrips ? (
        <>
          <HistoryCharts summary={data.summary} service={data.service} trackedSince={data.trackedSince} fleetKinds={fleetKinds} />
          <OperationsStats ops={data.operations} />
          <StatsAppointments trips={data.trips} appointments={data.appointments as ClinicAppointment[]} requests={data.requests as VehicleRequest[]} />
        </>
      ) : <Panel title="لا توجد رحلات"><EmptyState icon={CalendarDays} title="لا توجد رحلات في الفترة المختارة" /></Panel>}
      {data.guests && <GuestStats stats={data.guests} loading={false} periodLabel={data.periodLabel} />}
      {data.sections.map((section) => <SectionTable key={section.title} section={section} />)}
    </>
  );
}

/** صفحة يوم (أو أيام محددة): نفس عرض الإحصائيات لأيامها فقط، مع الانتقال إلى اليوم السابق والتالي */
function DaysPage({ data, dates, fleetKinds }: { data: ReportViewerData; dates: string[]; fleetKinds: Map<string, VehicleKind> }) {
  const view = useMemo(() => statsForDates(data, dates), [data, dates]);
  const active = useMemo(() => Array.from(new Set([...(data.calendar?.days.filter((day) => day.total).map((day) => day.date) ?? []), ...data.trips.map((trip) => trip.date)])).sort(), [data]);
  const single = dates.length === 1 ? dates[0] : null;
  const at = single ? active.indexOf(single) : -1;
  const previous = at > 0 ? active[at - 1] : null;
  const next = at >= 0 && at < active.length - 1 ? active[at + 1] : null;
  const weekday = (date: string) => data.calendar?.days.find((day) => day.date === date)?.weekday ?? "";
  const sections = data.sections.flatMap((section) => {
    const rows = sectionForDates(section, dates);
    return rows ? [rows] : [];
  });
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" onClick={() => go("")} className={btn("secondary", "sm")}><ArrowRight className="h-4 w-4" /> كل الفترة والأيام</button>
        {single && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={!previous} onClick={() => previous && go(routeHash([previous]))} className={btn("secondary", "sm")}><ChevronRight className="h-4 w-4" /> اليوم السابق</button>
            <button type="button" disabled={!next} onClick={() => next && go(routeHash([next]))} className={btn("secondary", "sm")}>اليوم التالي <ChevronLeft className="h-4 w-4" /></button>
          </div>
        )}
      </div>
      <PageHeader
        title={single ? `${weekday(single)} ${fullDate(single)}`.trim() : selectedText(dates.length)}
        subtitle={single ? "إحصائيات اليوم ومواعيده" : dates.map((date) => `${weekday(date)} ${dayMonth(date)}`.trim()).join(" · ")}
      />
      {view.summary.totalTrips ? (
        <>
          <HistoryCharts summary={view.summary} service={view.service} trackedSince={data.trackedSince} fleetKinds={fleetKinds} />
          <OperationsStats ops={view.operations} />
          <StatsAppointments trips={view.trips} appointments={data.appointments as ClinicAppointment[]} requests={data.requests as VehicleRequest[]} />
        </>
      ) : <Panel title="لا توجد مواعيد"><EmptyState icon={CalendarDays} title={single ? "لا توجد مواعيد في هذا اليوم" : "لا توجد مواعيد في هذه الأيام"} /></Panel>}
      {sections.map((section) => <SectionTable key={section.title} section={section} open={section.rows.length > 0 && section.rows.length <= 300} />)}
    </>
  );
}

/** تقويم الأيام: بطاقة لكل يوم بعدد مواعيده وإنجازه وتقييمه؛ الضغط ينقل إلى صفحة اليوم، والمربع يحدده مع غيره */
function CalendarPanel({ days, today, selected, onToggle }: { days: CalendarDay[]; today: string; selected: string[]; onToggle: (dates: string[], on: boolean) => void }) {
  const months = new Map<string, CalendarDay[]>();
  for (const day of days) months.set(day.date.slice(0, 7), [...(months.get(day.date.slice(0, 7)) ?? []), day]);
  const isSelected = (date: string) => selected.includes(date);
  return (
    <Panel
      id="report-days"
      icon={CalendarDays}
      tone="blue"
      title="الأيام"
      count={days.length}
      description="اضغط على يوم لفتح صفحته (إحصائياته ورسومه ومواعيده) · حدّد أكثر من يوم بالمربع ثم «عرض الأيام المحددة» · الإنجاز: المواعيد التي أُرسلت لها سيارة (ممتاز 85% فأكثر، متوسط 70% فأكثر)"
      bodyClassName="space-y-6 p-3 sm:p-5"
    >
      {Array.from(months).map(([key, list]) => {
        const [year, month] = key.split("-").map(Number);
        const withTrips = list.filter((day) => day.total).map((day) => day.date);
        const allSelected = withTrips.length > 0 && withTrips.every(isSelected);
        const weeks: (CalendarDay | null)[][] = [];
        let week: (CalendarDay | null)[] = Array(list[0].day).fill(null);
        for (const day of list) {
          week.push(day);
          if (week.length === 7) { weeks.push(week); week = []; }
        }
        if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
        return (
          <section key={key} aria-label={`${MONTHS[month - 1]} ${year}`}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-base font-bold text-ink">{MONTHS[month - 1]} {year}</h3>
              <span className="text-xs text-slate-500 tabular">{daysText(list.length)} · {list.reduce((sum, day) => sum + day.total, 0).toLocaleString("en")} موعد</span>
              {withTrips.length > 0 && (
                <button type="button" onClick={() => onToggle(withTrips, !allSelected)} className={cx(btn("ghost", "sm"), "ms-auto h-7 px-2 text-brand-700 print:hidden")}>
                  {allSelected ? "إلغاء تحديد الشهر" : "تحديد الشهر"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-slate-500 sm:gap-2 sm:text-xs" aria-hidden="true">
              {WEEKDAYS.map((name) => <span key={name} className="truncate py-1">{name}</span>)}
            </div>
            <div className="space-y-1 sm:space-y-2">
              {weeks.map((row, index) => (
                <div key={index} className="grid grid-cols-7 gap-1 sm:gap-2">
                  {row.map((day, at) => (day ? <DayCard key={day.date} day={day} today={today} selected={isSelected(day.date)} onSelect={(on) => onToggle([day.date], on)} /> : <span key={`blank-${at}`} />))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </Panel>
  );
}

function DayCard({ day, today, selected, onSelect }: { day: CalendarDay; today: string; selected: boolean; onSelect: (on: boolean) => void }) {
  const rating = dayRating(day, today);
  const percent = completionPercent(day);
  // على الهاتف: رقم اليوم وحده (الشهر في عنوانه) بلا شارة التقييم
  const badge = <span className="hidden sm:block"><Badge tone={RATING_TONE[rating]}>{DAY_RATING_LABELS[rating]}</Badge></span>;
  const dateText = <><span className="sm:hidden">{Number(day.date.slice(8))}</span><span className="hidden sm:inline">{dayMonth(day.date)}</span></>;
  if (!day.total) {
    return (
      <div className="flex min-h-[64px] flex-col rounded-xl bg-slate-50 p-1.5 text-start ring-1 ring-inset ring-slate-200/70 sm:min-h-[120px] sm:p-2.5" title={`${day.weekday} ${day.date}: ${DAY_RATING_LABELS[rating]}`}>
        <span className="hidden text-xs text-slate-400 sm:block">{day.weekday}</span>
        <span className="text-[11px] text-slate-400 tabular sm:text-xs">{dateText}</span>
        <span className="mt-auto text-lg font-bold text-slate-300 tabular sm:text-2xl">0</span>
        <span className="mt-1">{badge}</span>
      </div>
    );
  }
  return (
    <div className={cx("relative rounded-xl bg-white ring-inset transition", selected ? "ring-2 ring-brand-600" : "ring-1 ring-slate-200 hover:ring-slate-300")}>
      <a
        href={routeHash([day.date])}
        data-date={day.date}
        title={`${day.weekday} ${day.date}: ${day.total} موعد، المنجزة ${day.completed} · افتح صفحة اليوم`}
        className="flex min-h-[64px] flex-col rounded-xl p-1.5 text-start hover:bg-slate-50 sm:min-h-[120px] sm:p-2.5"
      >
        <span className="hidden text-xs font-semibold text-ink sm:block">{day.weekday}</span>
        <span className="text-[11px] font-semibold text-slate-600 tabular sm:text-xs sm:font-normal sm:text-slate-500">{dateText}</span>
        <span className="mt-auto text-lg font-bold leading-tight text-ink tabular sm:text-2xl">{day.total.toLocaleString("en")}<span className="ms-1 hidden text-xs font-medium text-slate-500 sm:inline">موعد</span></span>
        <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-orange-300" aria-hidden="true"><span className="bg-blue-600" style={{ width: `${percent}%` }} /></span>
        <span className="mt-1 hidden items-center justify-between gap-1 text-[11px] text-slate-600 sm:flex">
          <span>إنجاز <b className="tabular text-ink">{percent}%</b></span>
          {badge}
        </span>
      </a>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`تحديد ${day.weekday} ${day.date}`}
        onClick={() => onSelect(!selected)}
        className={cx("absolute end-1 top-1 flex h-4 w-4 items-center justify-center rounded ring-1 ring-inset transition print:hidden sm:end-1.5 sm:top-1.5 sm:h-5 sm:w-5 sm:rounded-md",
          selected ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-transparent ring-slate-300 hover:ring-slate-400")}
      >
        <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
      </button>
    </div>
  );
}

const PAGE_ROWS = 200;

/** جدول تفصيلي (الرحلات بالتفصيل، سجل العمليات…): مطوي في صفحة الفترة، ويُعرض 200 صف ثم «عرض المزيد» */
function SectionTable({ section, open: initiallyOpen = false }: { section: ReportSection; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [shown, setShown] = useState(PAGE_ROWS);
  return (
    <Panel
      icon={Table2}
      title={section.title}
      count={section.rows.length}
      description={section.note}
      actions={section.rows.length > 0 && (
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={cx(btn("secondary", "sm"), "print:hidden")}>
          {open ? "إخفاء الجدول" : "عرض الجدول"}
        </button>
      )}
    >
      {open && (
        <>
          <div className="max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>{section.columns.map((column) => <th key={column} className="whitespace-nowrap border-b border-slate-200 px-3 py-2 text-start font-semibold">{column}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {section.rows.slice(0, shown).map((row, index) => (
                  <tr key={index} className="hover:bg-slate-50">
                    {row.map((cell, at) => <td key={at} className="whitespace-nowrap px-3 py-1.5 align-top text-slate-700">{cell === null || cell === undefined ? "" : String(cell)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.rows.length > shown && (
            <div className="border-t border-slate-100 px-5 py-2.5 text-center print:hidden">
              <button type="button" onClick={() => setShown((count) => count + PAGE_ROWS * 5)} className={btn("ghost", "sm")}>عرض المزيد ({(section.rows.length - shown).toLocaleString("en")})</button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
