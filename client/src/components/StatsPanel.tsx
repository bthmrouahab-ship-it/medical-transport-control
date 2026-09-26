import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Building2, FileSpreadsheet, FilterX, Info, Loader2, Upload, X } from "lucide-react";
import type { Hospital } from "@shared/hospitals";
import { parseDriverList, parseTripRows, type HistorySummary, type ImportedDriver } from "@shared/history";
import {
  EMPTY_FILTER,
  TRIP_KINDS,
  filterOptions,
  hasDetailFilters,
  inRange,
  matchesFilter,
  selectTrips,
  summarizeTrips,
  tripsFromSystem,
  type StatsDay,
  type StatsFilter,
  type TripStat,
} from "@shared/stats";
import { localDateString, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { saveState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import { saveStatsDays, watchStatsDays } from "@/lib/statsStore";
import { addDays } from "./ui-kit";
import HistoryCharts from "./HistoryCharts";

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

const selectClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#d88994]";

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${selectClass} ${value !== "all" ? "border-[#d88994] bg-[#fff7f8]" : ""}`}>{children}</select>
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

  const systemTrips = useMemo(() => tripsFromSystem(appointments, requests, fleet, hospitals), [appointments, requests, fleet, hospitals]);
  const selected = useMemo(
    () => selectTrips({ imported: imported ?? [], legacy: history, system: systemTrips }, filter.source),
    [imported, history, systemTrips, filter.source],
  );
  const periodTrips = useMemo(() => selected.trips.filter((trip) => inRange(trip.date, filter)), [selected, filter]);
  const options = useMemo(() => filterOptions(periodTrips, hospitals), [periodTrips, hospitals]);
  const summary = useMemo(() => {
    const trips = periodTrips.filter((trip) => matchesFilter(trip, filter, hospitals));
    // تفاصيل الملخص القديم تُضاف فقط عندما تشمل الفترة كل أيامه ولا توجد فلاتر أخرى
    const legacy = selected.legacy
      && (!filter.from || filter.from <= selected.legacy.from)
      && (!filter.to || filter.to >= selected.legacy.to)
      && !hasDetailFilters(filter)
      ? selected.legacy : null;
    return summarizeTrips(trips, hospitals, legacy);
  }, [periodTrips, filter, hospitals, selected.legacy]);

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

  const chip = (active: boolean) => `h-9 shrink-0 rounded-xl px-3 text-xs font-bold transition ${active ? "bg-[#10233f] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="space-y-5">
      {canEdit && <HistoryImport fleet={fleet} hospitals={hospitals} actor={actor} imported={imported ?? []} />}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="فلترة الإحصائيات">
        <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="الفترة">
          {PRESETS.map((item) => <button key={item.id} type="button" aria-pressed={preset === item.id} onClick={() => choosePreset(item.id)} className={chip(preset === item.id)}>{item.label}</button>)}
        </div>
        {preset === "custom" && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">من</span><input type="date" value={filter.from} max={filter.to || undefined} onChange={(event) => update({ from: event.target.value })} className={selectClass} /></label>
            <label className="block"><span className="mb-1 block text-[11px] font-bold text-slate-500">إلى</span><input type="date" value={filter.to} min={filter.from || undefined} onChange={(event) => update({ to: event.target.value })} className={selectClass} /></label>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <div className="flex items-end">
            <button type="button" disabled={!filtersActive} onClick={() => { setPreset("all"); setFilter(EMPTY_FILTER); }} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40"><FilterX className="h-4 w-4" /> مسح الفلاتر</button>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {summary.totalTrips ? <>الفترة من <b>{summary.from}</b> إلى <b>{summary.to}</b> · </> : null}
          الأيام المحسوبة: {selected.days.excel} من ملفات Excel · {selected.days.system} من رحلات النظام
          {filter.source === "all" && " (اليوم الذي له ملف Excel يُحسب من الملف فقط)"}
        </p>
      </section>

      {loadError && <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">تعذر تحميل بيانات ملفات Excel المحفوظة. تظهر رحلات النظام والملخص القديم فقط.</p>}

      {Boolean(summary.withoutDetails) && selected.legacy && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{summary.withoutDetails!.toLocaleString("en")} رحلة من الملخص القديم ({selected.legacy.from} إلى {selected.legacy.to}) محسوبة في الأعداد ونوع المركبة فقط، ولا تظهر في الساعات والوجهات والسيارات والمباني عند التصفية. {canEdit ? "لإظهار تفاصيلها أعد رفع ملف Excel لتلك الفترة." : "يستطيع مدير النظام إظهار تفاصيلها بإعادة رفع ملف Excel لتلك الفترة."}</span>
        </p>
      )}

      {imported === null ? (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>
      ) : summary.totalTrips ? (
        <HistoryCharts summary={summary} onFilter={update} />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 font-bold text-slate-600">{filtersActive ? "لا توجد رحلات مطابقة للفلاتر المختارة" : "لا توجد رحلات بعد"}</p>
          {!filtersActive && <p className="mt-1 text-sm text-slate-400">{canEdit ? "ارفع ملف Excel لحركة السيارات من الزر أعلاه، وستظهر رحلات النظام هنا تلقائيًا." : "ستظهر رحلات النظام هنا تلقائيًا."}</p>}
        </div>
      )}
    </div>
  );
}

type Preview = { fileName: string; trips: TripStat[] | null; drivers: ImportedDriver[]; error?: string };

function HistoryImport({ fleet, hospitals, actor, imported }: { fleet: Vehicle[]; hospitals: Hospital[]; actor: string; imported: StatsDay[] }) {
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
      appendAudit(`استيراد ${preview.trips.length} رحلة من ${preview.fileName} (${days} يوم: ${fileDays[0]} إلى ${fileDays[fileDays.length - 1]})`, actor);
      toast.success(`تمت إضافة ${days} يوم إلى الإحصائيات`);
      setPreview(preview.drivers.length ? { ...preview, trips: null } : null);
    } catch (error) {
      console.error("[stats] import", error);
      toast.error("تعذر حفظ الإحصائيات. تحقق من الاتصال وحاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  function updateFleet() {
    if (!preview?.drivers.length) return;
    const next = [...fleet];
    for (const item of preview.drivers) {
      const data = { plate: item.plate, driver: item.drivers.join(" / "), phone: item.phone, kind: item.kind };
      const index = next.findIndex((vehicle) => vehicle.plate === item.plate);
      if (index >= 0) next[index] = { ...next[index], ...data };
      else next.push({ ...data, available: true });
    }
    saveState("fox_fleet", next);
    appendAudit(`تحديث ${preview.drivers.length} سيارة من ملف Excel`, actor);
    toast.success("تم تحديث السيارات والسائقين");
    setPreview(preview.trips ? { ...preview, drivers: [] } : null);
  }

  const newPlates = preview?.drivers.filter((item) => !fleet.some((vehicle) => vehicle.plate === item.plate)).length ?? 0;
  const completed = preview?.trips?.filter((trip) => trip.kind).length ?? 0;

  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 font-bold"><Upload className="h-4 w-4 text-[#a61d2d]" /> إضافة ملف حركة السيارات (Excel)</h3>
          <p className="mt-1 text-xs text-slate-500">أيام الملف تُضاف إلى الإحصائيات، واليوم المرفوع سابقًا يُستبدل بالملف الجديد. {imported.length ? `المحفوظ حاليًا: ${imported.length} يوم.` : ""}</p>
        </div>
        <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => read(event.target.files?.[0])} />
        <button disabled={busy} onClick={() => input.current?.click()} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white disabled:opacity-60"><FileSpreadsheet className="h-4 w-4" /> {busy ? "جارٍ المعالجة..." : "اختيار الملف"}</button>
      </div>
      {preview && (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex items-center justify-between"><b>{preview.fileName}</b><button onClick={() => setPreview(null)} aria-label="إغلاق"><X className="h-4 w-4 text-slate-400" /></button></div>
          {preview.error && <p className="font-bold text-red-700">{preview.error}</p>}
          {preview.trips && (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p>{preview.trips.length.toLocaleString("en")} موعد ({completed.toLocaleString("en")} منجز) · {fileDays.length} يوم من {fileDays[0]} إلى {fileDays[fileDays.length - 1]}{replacedDays ? ` · ${replacedDays} يوم مرفوع سابقًا سيُستبدل` : ""} · {preview.trips.filter((trip) => trip.kind && !trip.hospitalId).length} رحلة لوجهات خارج الدليل</p>
              <button disabled={busy} onClick={saveTrips} className="shrink-0 rounded-xl bg-[#10233f] px-4 py-2 text-xs font-bold text-white disabled:opacity-60">إضافة إلى الإحصائيات</button>
            </div>
          )}
          {preview.drivers.length > 0 && (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-400" /> قائمة السائقين: {preview.drivers.length} سيارة ({newPlates} جديدة). السيارة التي يتناوب عليها أكثر من سائق تُحفظ بأسمائهم معًا.</p>
              <button onClick={updateFleet} className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700">تحديث السيارات</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
