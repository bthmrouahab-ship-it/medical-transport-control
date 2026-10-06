import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Building2, Download, FileCode2, FileSpreadsheet, Filter, FilterX, Info, Loader2, Upload, X } from "lucide-react";
import type { Hospital } from "@shared/hospitals";
import { guestIndex, guestOfAppointment, guestStats, type GuestRecord } from "@shared/guests";
import { parseDriverList, parseTripRows, type HistorySummary, type ImportedDriver } from "@shared/history";
import {
  EMPTY_FILTER,
  TRIP_KINDS,
  filterOptions,
  hasDetailFilters,
  inRange,
  matchesFilter,
  selectTrips,
  serviceHours,
  summarizeTrips,
  tripsFromSystem,
  type ServiceEvent,
  type ServiceSummary,
  type StatsDay,
  type StatsFilter,
  type TripStat,
} from "@shared/stats";
import { localDateString, mergeVehicle, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { summarizeOperations, type OpsEvent } from "@shared/operations";
import { saveStates } from "@/lib/appStore";
import { useDrivers } from "@/lib/useShared";
import { assignDrivers, newDriverId, type Driver } from "@shared/drivers";
import { api } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth";
import { dayRange, fetchAllActivity } from "@/lib/activity";
import { activitySection, downloadExcel, downloadHtml, guestSections, statsReport, tripsSection } from "@/lib/report";
import { saveStatsDays, watchStatsDays } from "@/lib/statsStore";
import { EmptyState, Panel, Segmented, addDays, btn, cx, inputClass, stamp } from "./ui-kit";
import HistoryCharts from "./HistoryCharts";
import ActivityLog from "./ActivityLog";
import GuestStats from "./GuestStats";
import StatsAppointments from "./StatsAppointments";
import OperationsStats from "./OperationsStats";

type Preset = "all" | "today" | "7d" | "30d" | "month" | "lastMonth" | "year" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "all", label: "كل الفترات" },
  { id: "today", label: "اليوم" },
  { id: "7d", label: "آخر 7 أيام" },
  { id: "30d", label: "آخر 30 يومًا" },
  { id: "month", label: "هذا الشهر" },
  { id: "lastMonth", label: "الشهر الماضي" },
  { id: "year", label: "هذه السنة" },
  { id: "custom", label: "فترة محددة" },
];

function presetRange(preset: Preset, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "7d": return { from: addDays(today, -6), to: today };
    case "30d": return { from: addDays(today, -29), to: today };
    case "month": return { from: `${month}-01`, to: today };
    case "lastMonth": {
      const lastDay = addDays(`${month}-01`, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    case "year": return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default: return { from: "", to: "" };
  }
}

const selectClass = cx(inputClass, "h-10");
const smallLabel = "mb-1 block text-xs font-medium text-slate-500";

/** قائمة فلترة: تتلون بإطار أحمر الهلال عندما تكون مختارة. */
function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={smallLabel}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cx(selectClass, value !== "all" && "border-brand-600 bg-brand-50 font-medium text-brand-700")}>{children}</select>
    </label>
  );
}

export default function StatsPanel({ canEdit, actor, hospitals, fleet, appointments, requests, history }: {
  canEdit: boolean;
  actor: string;
  hospitals: Hospital[];
  fleet: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  history: HistorySummary | null;
}) {
  const [imported, setImported] = useState<StatsDay[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [preset, setPreset] = useState<Preset>("all");
  const [filter, setFilter] = useState<StatsFilter>(EMPTY_FILTER);

  useEffect(() => watchStatsDays((days) => { setImported(days); setLoadError(false); }, (error) => {
    console.error("[stats]", error);
    setLoadError(true);
    setImported([]);
  }), []);

  // قائمة الضيوف مع العمر والرقم الصحي: من الخادم للإحصائيات فقط (لا تصل مع المزامنة)
  const [guestRecords, setGuestRecords] = useState<GuestRecord[] | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ guests: GuestRecord[] }>("guests-stats")
      .then((response) => alive && setGuestRecords(response.guests))
      .catch((error) => {
        console.error("[stats] guests", error);
        if (alive) setGuestRecords([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const systemTrips = useMemo(() => tripsFromSystem(appointments, requests, fleet, hospitals), [appointments, requests, fleet, hospitals]);
  const selected = useMemo(
    () => selectTrips({ imported: imported ?? [], legacy: history, system: systemTrips }, filter.source),
    [imported, history, systemTrips, filter.source],
  );
  const periodTrips = useMemo(() => selected.trips.filter((trip) => inRange(trip.date, filter)), [selected, filter]);
  const options = useMemo(() => filterOptions(periodTrips, hospitals), [periodTrips, hospitals]);
  const filteredTrips = useMemo(() => periodTrips.filter((trip) => matchesFilter(trip, filter, hospitals)), [periodTrips, filter, hospitals]);

  // وقت توفر السيارات في الخدمة للفترة (من سجل حالات السيارات في الخادم)
  const range = useMemo(() => dayRange(filter.from || undefined, filter.to || undefined), [filter.from, filter.to]);
  const [serviceLog, setServiceLog] = useState<{ events: ServiceEvent[]; trackedSince: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const query: Record<string, string> = {};
    if (range.since) query.since = range.since;
    if (range.until) query.until = range.until;
    api<{ events: ServiceEvent[]; trackedSince: string | null }>("service-log", undefined, query)
      .then((response) => alive && setServiceLog(response))
      .catch((error) => {
        console.error("[stats] service", error);
        if (alive) setServiceLog({ events: [], trackedSince: null });
      });
    return () => {
      alive = false;
    };
  }, [range.since, range.until]);
  // سير العمل: الإلغاء وتغيير السيارات وإزالة الضيوف من سجل العمليات (من أسبوع قبل الفترة: إلغاء طلبات حُجزت مبكرًا)
  const [opsLog, setOpsLog] = useState<OpsEvent[] | null>(null);
  useEffect(() => {
    let alive = true;
    setOpsLog(null);
    const query: Record<string, string> = {};
    if (range.since) query.since = new Date(new Date(range.since).getTime() - 7 * 86400000).toISOString();
    if (range.until) query.until = range.until;
    api<{ events: OpsEvent[] }>("ops-log", undefined, query)
      .then((response) => alive && setOpsLog(response.events))
      .catch((error) => {
        console.error("[stats] ops", error);
        if (alive) setOpsLog([]);
      });
    return () => {
      alive = false;
    };
  }, [range.since, range.until]);
  const operations = useMemo(() => summarizeOperations(filteredTrips, opsLog), [filteredTrips, opsLog]);

  const service = useMemo((): ServiceSummary | null => {
    if (!serviceLog) return null;
    const all = serviceHours(serviceLog.events, filter.from, filter.to || localDateString());
    const keep = (item: { plate: string; kind: string }) => (filter.plate === "all" || item.plate === filter.plate) && (filter.kind === "all" || item.kind === filter.kind);
    const days = all.days.filter(keep);
    return { days, vehicles: all.vehicles.filter(keep), totalMinutes: days.reduce((total, day) => total + day.minutes, 0) };
  }, [serviceLog, filter.from, filter.to, filter.plate, filter.kind]);

  const summary = useMemo(() => {
    // تفاصيل الملخص القديم تُضاف فقط عندما تشمل الفترة كل أيامه ولا توجد فلاتر أخرى
    const legacy = selected.legacy
      && (!filter.from || filter.from <= selected.legacy.from)
      && (!filter.to || filter.to >= selected.legacy.to)
      && !hasDetailFilters(filter)
      ? selected.legacy : null;
    // الباصات المخصصة في الخدمة سيارات عاملة، ما لم تُختر وجهة أو منطقة أو مبنى أو نوع رحلة
    const roleDays = filter.zone === "all" && filter.destination === "all" && filter.building === "all" && filter.category === "all" ? service?.days ?? [] : [];
    return summarizeTrips(filteredTrips, hospitals, legacy, roleDays);
  }, [filteredTrips, filter, hospitals, selected.legacy, service]);

  const update = (patch: Partial<StatsFilter>) => setFilter((current) => ({ ...current, ...patch }));
  function choosePreset(next: Preset) {
    setPreset(next);
    if (next !== "custom") update(presetRange(next, localDateString()));
  }
  const filtersActive = preset !== "all" || JSON.stringify(filter) !== JSON.stringify(EMPTY_FILTER);
  const destinationOptions = filter.zone === "all" ? options.destinations : options.destinations.filter((item) => item.zone === filter.zone);
  const plateLabel = (plate: string) => {
    const vehicle = fleet.find((item) => item.plate === plate);
    return vehicle ? `${plate} · ${vehicle.driver}` : plate;
  };
  // القيمة المختارة تبقى في القائمة حتى لو لم تعد لها رحلات في الفترة الجديدة
  const withSelected = (values: string[], value: string) => (value !== "all" && !values.includes(value) ? [value, ...values] : values);

  // سجل العمليات والتصدير لنفس فترة الإحصائيات (range أعلاه)
  const periodLabel = filter.from || filter.to
    ? `الفترة ${filter.from || "البداية"} إلى ${filter.to || localDateString()}`
    : `كل الفترات${summary.totalTrips ? ` (${summary.from} إلى ${summary.to})` : ""}`;
  const [exporting, setExporting] = useState<"excel" | "html" | null>(null);
  const guestSummary = useMemo(
    () => guestStats(appointments, requests, guestRecords ?? [], { from: filter.from, to: filter.to, building: filter.building }),
    [appointments, requests, guestRecords, filter.from, filter.to, filter.building],
  );

  /** تصدير كل الإحصائيات: الملخص والجداول، والرحلات بتفاصيلها (من طلب ومن أرسل ومتى)، وسجل العمليات. */
  async function exportReport(format: "excel" | "html") {
    setExporting(format);
    try {
      const { items, truncated } = await fetchAllActivity(range);
      const report = statsReport(summary, "إحصائيات سيارات مجمع الثمامة", `${periodLabel} · أنشأه ${actor} في ${stamp()}`, service, operations);
      const index = guestIndex(guestRecords ?? []);
      report.sections.push(
        ...guestSections(guestSummary),
        tripsSection(appointments, requests, items, filter.from || undefined, filter.to || undefined, (appointment) => guestOfAppointment(index, appointment), hospitals),
        activitySection(items, truncated),
      );
      const name = `althumama-stats-${localDateString()}`;
      if (format === "excel") await downloadExcel(report, `${name}.xlsx`);
      else downloadHtml(report, `${name}.html`);
      toast.success(format === "excel" ? "تم تصدير الإحصائيات إلى Excel" : "تم تصدير الإحصائيات إلى صفحة HTML");
    } catch (error) {
      console.error("[stats] export", error);
      toast.error(authErrorMessage(error, "تعذر تصدير الإحصائيات"));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-6">
      {canEdit && <HistoryImport fleet={fleet} hospitals={hospitals} imported={imported ?? []} />}

      <Panel
        icon={Filter}
        title="الفلاتر"
        description={(
          <>
            {summary.totalTrips ? <>الفترة من <span dir="ltr">{summary.from}</span> إلى <span dir="ltr">{summary.to}</span> · </> : null}
            {selected.days.excel} يوم من ملفات Excel · {selected.days.system} يوم من رحلات النظام{filter.source === "all" ? " (اليوم الذي له ملف Excel يُحسب من الملف فقط)" : ""}
          </>
        )}
        actions={(
          <>
            <button type="button" disabled={!filtersActive} onClick={() => { setPreset("all"); setFilter(EMPTY_FILTER); }} className={btn("ghost", "sm")}><FilterX className="h-4 w-4" /> مسح الفلاتر</button>
            <button type="button" disabled={Boolean(exporting)} onClick={() => exportReport("excel")} title="الملخص والرحلات بتفاصيلها وسجل العمليات" className={btn("primary", "sm")}>
              {exporting === "excel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} تصدير Excel
            </button>
            <button type="button" disabled={Boolean(exporting)} onClick={() => exportReport("html")} title="صفحة تقرير مستقلة تُفتح في المتصفح وتُطبع" className={btn("secondary", "sm")}>
              {exporting === "html" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode2 className="h-4 w-4" />} صفحة HTML
            </button>
          </>
        )}
        bodyClassName="space-y-4 p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-end gap-3">
          <Segmented label="الفترة" size="sm" value={preset} onChange={choosePreset} options={PRESETS.map((item) => ({ value: item.id, label: item.label }))} />
          {preset === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="block"><span className={smallLabel}>من</span><input type="date" value={filter.from} max={filter.to || undefined} onChange={(event) => update({ from: event.target.value })} className={cx(selectClass, "w-auto")} /></label>
              <label className="block"><span className={smallLabel}>إلى</span><input type="date" value={filter.to} min={filter.from || undefined} onChange={(event) => update({ to: event.target.value })} className={cx(selectClass, "w-auto")} /></label>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Select label="المصدر" value={filter.source} onChange={(value) => update({ source: value as StatsFilter["source"] })}>
            <option value="all">الكل</option>
            <option value="excel">ملفات Excel</option>
            <option value="system">رحلات النظام</option>
          </Select>
          <Select label="نوع الرحلة" value={filter.category} onChange={(value) => update({ category: value as StatsFilter["category"] })}>
            <option value="all">الكل</option>
            <option value="medical">طبية</option>
            <option value="nonMedical">غير طبية</option>
          </Select>
          <Select label="نوع المركبة" value={filter.kind} onChange={(value) => update({ kind: value as StatsFilter["kind"] })}>
            <option value="all">الكل</option>
            {TRIP_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
          </Select>
          <Select label="المنطقة" value={filter.zone} onChange={(value) => update({ zone: value, destination: "all" })}>
            <option value="all">كل المناطق</option>
            {withSelected(options.zones, filter.zone).map((zone) => <option key={zone} value={zone}>{zone}</option>)}
          </Select>
          <Select label="الوجهة" value={filter.destination} onChange={(value) => update({ destination: value })}>
            <option value="all">كل الوجهات</option>
            {filter.destination !== "all" && !destinationOptions.some((item) => item.key === filter.destination) && <option value={filter.destination}>{summary.destinations.find((item) => item.key === filter.destination)?.name ?? "الوجهة المختارة"}</option>}
            {destinationOptions.slice(0, 80).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
          </Select>
          <Select label="السيارة" value={filter.plate} onChange={(value) => update({ plate: value })}>
            <option value="all">كل السيارات</option>
            {withSelected(options.plates, filter.plate).map((plate) => <option key={plate} value={plate}>{plateLabel(plate)}</option>)}
          </Select>
          <Select label="المبنى" value={filter.building} onChange={(value) => update({ building: value })}>
            <option value="all">كل المباني</option>
            {withSelected(options.buildings, filter.building).map((building) => <option key={building} value={building}>مبنى {building}</option>)}
          </Select>
        </div>
      </Panel>

      {loadError && <p className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> تعذر تحميل بيانات ملفات Excel المحفوظة. تظهر رحلات النظام والملخص القديم فقط.</p>}

      {Boolean(summary.withoutDetails) && selected.legacy && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900 ring-1 ring-inset ring-amber-200">
          <Info className="mt-1 h-4 w-4 shrink-0" />
          <span>{summary.withoutDetails!.toLocaleString("en")} رحلة من الملخص القديم ({selected.legacy.from} إلى {selected.legacy.to}) محسوبة في الأعداد ونوع المركبة فقط، ولا تظهر في الساعات والوجهات والسيارات والمباني عند التصفية. {canEdit ? "لإظهار تفاصيلها أعد رفع ملف Excel لتلك الفترة." : "يستطيع مدير النظام إظهار تفاصيلها بإعادة رفع ملف Excel لتلك الفترة."}</span>
        </p>
      )}

      {imported === null ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-card ring-1 ring-slate-200/80"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>
      ) : summary.totalTrips ? (
        <>
          <HistoryCharts summary={summary} onFilter={update} service={service} trackedSince={serviceLog?.trackedSince ?? null} />
          <OperationsStats ops={operations} onFilter={update} />
          <StatsAppointments trips={filteredTrips} appointments={appointments} requests={requests} />
        </>
      ) : (
        <div className="rounded-2xl bg-white shadow-card ring-1 ring-slate-200/80">
          <EmptyState
            icon={FileSpreadsheet}
            title={filtersActive ? "لا توجد رحلات مطابقة للفلاتر المختارة" : "لا توجد رحلات بعد"}
            hint={filtersActive ? undefined : canEdit ? "ارفع ملف Excel لحركة السيارات من الزر أعلاه، وستظهر رحلات النظام هنا تلقائيًا." : "ستظهر رحلات النظام هنا تلقائيًا."}
          />
        </div>
      )}

      <GuestStats stats={guestSummary} loading={guestRecords === null} periodLabel={periodLabel} />

      <ActivityLog since={range.since} until={range.until} periodLabel={periodLabel} exportable={false} />
    </div>
  );
}

type Preview = { fileName: string; trips: TripStat[] | null; drivers: ImportedDriver[]; error?: string };

function HistoryImport({ fleet, hospitals, imported }: { fleet: Vehicle[]; hospitals: Hospital[]; imported: StatsDay[] }) {
  const drivers = useDrivers();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let trips: TripStat[] | null = null;
      let drivers: ImportedDriver[] = [];
      let error: string | undefined;
      for (const name of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
        if (!trips) {
          try {
            trips = parseTripRows(rows, hospitals);
          } catch (sheetError) {
            error = sheetError instanceof Error ? sheetError.message : String(sheetError);
          }
        }
        if (!drivers.length) drivers = parseDriverList(rows);
      }
      setPreview({ fileName: file.name, trips, drivers, error: trips ? undefined : error });
    } catch {
      toast.error("تعذر قراءة الملف");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const fileDays = useMemo(() => Array.from(new Set(preview?.trips?.map((trip) => trip.date) ?? [])).sort(), [preview]);
  const replacedDays = fileDays.filter((date) => imported.some((day) => day.date === date)).length;

  async function saveTrips() {
    if (!preview?.trips) return;
    setBusy(true);
    try {
      const days = await saveStatsDays(preview.trips, preview.fileName);
      toast.success(`تمت إضافة ${days} يوم إلى الإحصائيات`);
      setPreview(preview.drivers.length ? { ...preview, trips: null } : null);
    } catch (error) {
      console.error("[stats] import", error);
      toast.error("تعذر حفظ الإحصائيات. تحقق من الاتصال وحاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * السيارات من الملف (رقمها ونوعها)، وسائقوها يُضافون إلى قائمة السائقين (السيارة التي يتناوب عليها أكثر من سائق:
   * كلهم). السيارة بلا سائق تأخذ أول سائق لها في الملف إن لم يكن في سيارة أخرى، والباقي يخصصه مشرف السيارات.
   */
  function updateFleet() {
    if (!preview?.drivers.length) return;
    const nextDrivers: Driver[] = [...drivers];
    let next = [...fleet];
    const assignments = new Map<string, string | null>();
    for (const item of preview.drivers) {
      const phone = item.drivers.length === 1 && /^\+?\d{8,15}$/.test(item.phone) ? item.phone : undefined;
      const ids = item.drivers.map((name) => name.trim().slice(0, 60)).filter((name) => name.length >= 2).map((name) => {
        const known = nextDrivers.find((driver) => driver.name === name);
        if (known) return known.id;
        const driver: Driver = { id: newDriverId(nextDrivers), name, ...(phone ? { phone } : {}) };
        nextDrivers.push(driver);
        return driver.id;
      });
      const index = next.findIndex((vehicle) => vehicle.plate === item.plate);
      if (index >= 0) next[index] = mergeVehicle(next[index], { kind: item.kind });
      else next.push({ plate: item.plate, kind: item.kind, driver: "", phone: "", available: true });
      const free = ids.find((id) => !next.some((vehicle) => vehicle.driverId === id) && !Array.from(assignments.values()).includes(id));
      if (!next.find((vehicle) => vehicle.plate === item.plate)?.driverId && free) assignments.set(item.plate, free);
    }
    next = assignDrivers(next, nextDrivers, assignments);
    saveStates([{ key: "fox_drivers", value: nextDrivers, baseline: drivers }, { key: "fox_fleet", value: next, baseline: fleet }]);
    toast.success("تم تحديث السيارات والسائقين");
    setPreview(preview.trips ? { ...preview, drivers: [] } : null);
  }

  const newPlates = preview?.drivers.filter((item) => !fleet.some((vehicle) => vehicle.plate === item.plate)).length ?? 0;
  const completed = preview?.trips?.filter((trip) => trip.kind).length ?? 0;

  return (
    <Panel
      tone="blue"
      icon={Upload}
      title="إضافة ملف حركة السيارات (Excel)"
      description={`أيام الملف تُضاف إلى الإحصائيات، واليوم المرفوع سابقًا يُستبدل بالملف الجديد.${imported.length ? ` المحفوظ حاليًا: ${imported.length} يوم.` : ""}`}
      actions={(
        <>
          <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => read(event.target.files?.[0])} />
          <button disabled={busy} onClick={() => input.current?.click()} className={btn("primary", "sm")}><FileSpreadsheet className="h-4 w-4" /> {busy ? "جارٍ المعالجة..." : "اختيار الملف"}</button>
        </>
      )}
    >
      {preview ? (
        <div className="space-y-3 p-4 text-sm sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-2 font-semibold text-ink"><FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" /><span className="truncate">{preview.fileName}</span></p>
            <button onClick={() => setPreview(null)} aria-label="إغلاق" className={btn("ghost", "sm")}><X className="h-4 w-4" /></button>
          </div>
          {preview.error && <p className="rounded-xl bg-red-50 p-3 font-medium text-red-700 ring-1 ring-inset ring-red-200">{preview.error}</p>}
          {preview.trips && (
            <div className="flex flex-col justify-between gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
              <p className="text-slate-700">{preview.trips.length.toLocaleString("en")} موعد ({completed.toLocaleString("en")} منجز) · {fileDays.length} يوم من {fileDays[0]} إلى {fileDays[fileDays.length - 1]}{replacedDays ? ` · ${replacedDays} يوم مرفوع سابقًا سيُستبدل` : ""} · {preview.trips.filter((trip) => trip.kind && !trip.hospitalId).length} رحلة لوجهات خارج الدليل</p>
              <button disabled={busy} onClick={saveTrips} className={btn("dark", "sm")}>إضافة إلى الإحصائيات</button>
            </div>
          )}
          {preview.drivers.length > 0 && (
            <div className="flex flex-col justify-between gap-3 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
              <p className="flex items-start gap-2 text-slate-700"><Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> قائمة السائقين: {preview.drivers.length} سيارة ({newPlates} جديدة). يُضاف كل سائق إلى قائمة السائقين (ومنهم من يتناوبون على سيارة واحدة)، ويختار مشرف السيارات سائق كل سيارة.</p>
              <button onClick={updateFleet} className={btn("secondary", "sm")}>تحديث السيارات</button>
            </div>
          )}
        </div>
      ) : <p className="px-5 py-3.5 text-sm text-slate-500">اختر ملف Excel لحركة السيارات، ثم راجع ملخصه قبل إضافته.</p>}
    </Panel>
  );
}
