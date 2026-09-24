import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Building2, FileSpreadsheet, Hospital as HospitalIcon, Map as MapIcon, Radio, Truck, Upload, X } from "lucide-react";
import { matchHospital, type Hospital } from "@shared/hospitals";
import { parseDriverList, summarizeHistory, type HistorySummary, type ImportedDriver } from "@shared/history";
import { DEFAULT_VEHICLES, migrateAppointment, migrateRequest, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { saveState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import { useHospitals, useNow, useSharedState } from "@/lib/useShared";
import HistoryCharts from "./HistoryCharts";
import HospitalManager from "./HospitalManager";
import LiveMap, { locationFreshness, type ActiveTrip, type VehicleLocation } from "./LiveMap";

type Tab = "map" | "stats" | "hospitals";
type Preview = { fileName: string; summary: HistorySummary | null; drivers: ImportedDriver[]; error?: string };

/** لوحة السيارات: خريطة مباشرة، إحصائيات سابقة مستوردة من Excel، ودليل المستشفيات (للمدير). */
export default function FleetDashboard({ canEdit = false, actor }: { canEdit?: boolean; actor: string }) {
  const [tab, setTab] = useState<Tab>("map");
  const hospitals = useHospitals();
  const history = useSharedState<HistorySummary | null>("fox_history", null);
  const locations = useSharedState<VehicleLocation[]>("fox_locations", []);
  const fleet = useSharedState<Vehicle[]>("fox_fleet", DEFAULT_VEHICLES);
  const rawRequests = useSharedState<unknown[]>("fox_requests", []);
  const rawAppointments = useSharedState<unknown[]>("fox_appointments", []);
  const now = useNow(15000);

  const tripCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of history?.destinations ?? []) if (item.hospitalId) counts[item.hospitalId] = item.trips;
    return counts;
  }, [history]);

  const activeTrips = useMemo<ActiveTrip[]>(() => {
    const appointments = rawAppointments.map((item, index) => migrateAppointment(item, index)).filter((item): item is ClinicAppointment => Boolean(item));
    return rawRequests
      .map(migrateRequest)
      .filter((request): request is VehicleRequest => Boolean(request) && (request!.status === "تم إرسال السيارة" || request!.status === "وصلت السيارة"))
      .flatMap((request) => {
        const appointment = appointments.find((item) => item.id === request.appointmentId);
        const hospitalId = appointment && (appointment.hospitalId || matchHospital(appointment.clinic, hospitals)?.id);
        return hospitalId ? [{ id: request.id, hospitalId, plate: request.vehiclePlate, label: `${request.vehiclePlate ?? ""} → ${appointment!.clinic} (${request.status})` }] : [];
      });
  }, [rawRequests, rawAppointments, hospitals]);

  const liveCount = locations.filter((location) => locationFreshness(location, now.getTime()).state === "live").length;

  function saveHospitals(next: Hospital[], message: string) {
    saveState("fox_hospitals", next);
    appendAudit(message, actor);
  }

  const tabs: { id: Tab; label: string; icon: typeof MapIcon }[] = [
    { id: "map", label: "الخريطة المباشرة", icon: MapIcon },
    { id: "stats", label: "الإحصائيات السابقة", icon: BarChart3 },
    ...(canEdit ? [{ id: "hospitals" as const, label: "دليل المستشفيات", icon: HospitalIcon }] : []),
  ];

  return (
    <div>
      <nav className="mb-6 flex gap-2 overflow-x-auto" aria-label="أقسام لوحة السيارات">
        {tabs.map((item) => (
          <button key={item.id} onClick={() => setTab(item.id)} aria-current={tab === item.id ? "page" : undefined} className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-bold ${tab === item.id ? "bg-[#10233f] text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
            <item.icon className="h-4 w-4" /> {item.label}
          </button>
        ))}
      </nav>

      {tab === "map" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <LiveMap hospitals={hospitals} locations={locations} trips={activeTrips} tripCounts={tripCounts} />
          <aside className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="flex items-center gap-1 text-xs font-bold text-slate-500"><Radio className="h-3.5 w-3.5" /> GPS مباشر</p><p className="mt-2 text-2xl font-bold">{liveCount}<span className="text-sm font-normal text-slate-400"> / {fleet.length}</span></p></div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="flex items-center gap-1 text-xs font-bold text-slate-500"><Truck className="h-3.5 w-3.5" /> رحلات جارية</p><p className="mt-2 text-2xl font-bold">{activeTrips.length}</p></div>
            </div>
            <section className="rounded-2xl border border-slate-200 bg-white">
              <h3 className="border-b border-slate-100 p-4 text-sm font-bold">حالة السيارات</h3>
              <ul className="max-h-[380px] divide-y divide-slate-100 overflow-auto">
                {fleet.map((vehicle) => {
                  const location = locations.find((item) => item.plate === vehicle.plate);
                  const fresh = location ? locationFreshness(location, now.getTime()) : null;
                  return (
                    <li key={vehicle.plate} className="flex items-center justify-between gap-2 px-4 py-3 text-xs">
                      <span><b dir="ltr">{vehicle.plate}</b> <span className="text-slate-500">{vehicle.driver}</span></span>
                      <span className="flex items-center gap-1.5 font-bold text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: fresh?.color ?? "#d4d2cc" }} />{fresh?.label ?? "لا يوجد GPS"}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <ul className="grid grid-cols-2 gap-2 rounded-xl bg-white p-3 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#2a78d6]" /> مستشفى</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-2 border-dashed border-[#2a78d6] bg-[#2a78d6]/40" /> موقع تقريبي</li>
              <li className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-[#eb6834]" /> رحلة جارية</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-[#1baf7a]" /> GPS مباشر</li>
            </ul>
          </aside>
        </div>
      )}

      {tab === "stats" && (
        <div className="space-y-5">
          {canEdit && <HistoryImport fleet={fleet} hospitals={hospitals} actor={actor} hasHistory={Boolean(history)} />}
          {history ? <HistoryCharts summary={history} /> : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 font-bold text-slate-600">لم تُستورد إحصائيات سابقة بعد</p>
              <p className="mt-1 text-sm text-slate-400">{canEdit ? "ارفع ملف Excel لحركة السيارات اليومية من الزر أعلاه." : "يستطيع مدير النظام رفع ملف الإحصائيات من لوحته."}</p>
            </div>
          )}
        </div>
      )}

      {tab === "hospitals" && canEdit && <HospitalManager hospitals={hospitals} tripCounts={tripCounts} onSave={saveHospitals} />}
    </div>
  );
}

function HistoryImport({ fleet, hospitals, actor, hasHistory }: { fleet: Vehicle[]; hospitals: Hospital[]; actor: string; hasHistory: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  async function read(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      let summary: HistorySummary | null = null;
      let drivers: ImportedDriver[] = [];
      let error: string | undefined;
      for (const name of workbook.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: true, defval: "" });
        if (!summary) {
          try {
            summary = summarizeHistory(rows, file.name, hospitals);
          } catch (sheetError) {
            error = sheetError instanceof Error ? sheetError.message : String(sheetError);
          }
        }
        if (!drivers.length) drivers = parseDriverList(rows);
      }
      setPreview({ fileName: file.name, summary, drivers, error: summary ? undefined : error });
    } catch {
      toast.error("تعذر قراءة الملف");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function saveSummary() {
    if (!preview?.summary) return;
    saveState("fox_history", preview.summary);
    appendAudit(`استيراد إحصائيات ${preview.summary.totalTrips} رحلة (${preview.summary.from} إلى ${preview.summary.to})`, actor);
    toast.success("تم حفظ الإحصائيات في قاعدة البيانات");
    setPreview(preview.drivers.length ? { ...preview, summary: null } : null);
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
    setPreview(preview.summary ? { ...preview, drivers: [] } : null);
  }

  const newPlates = preview?.drivers.filter((item) => !fleet.some((vehicle) => vehicle.plate === item.plate)).length ?? 0;

  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h3 className="flex items-center gap-2 font-bold"><Upload className="h-4 w-4 text-[#a61d2d]" /> استيراد ملف حركة السيارات (Excel)</h3>
        </div>
        <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => read(event.target.files?.[0])} />
        <button disabled={busy} onClick={() => input.current?.click()} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white disabled:opacity-60"><FileSpreadsheet className="h-4 w-4" /> {busy ? "جارٍ القراءة..." : hasHistory ? "رفع ملف جديد" : "اختيار الملف"}</button>
      </div>
      {preview && (
        <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex items-center justify-between"><b>{preview.fileName}</b><button onClick={() => setPreview(null)} aria-label="إغلاق"><X className="h-4 w-4 text-slate-400" /></button></div>
          {preview.error && <p className="font-bold text-red-700">{preview.error}</p>}
          {preview.summary && (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <p>{preview.summary.totalTrips.toLocaleString("en")} موعد ({preview.summary.completedTrips.toLocaleString("en")} منجز) من {preview.summary.from} إلى {preview.summary.to} · {preview.summary.destinations.filter((item) => item.hospitalId).length} مستشفى معروف · {preview.summary.unmatchedDestinations} رحلة لوجهات خارج الدليل</p>
              <button onClick={saveSummary} className="shrink-0 rounded-xl bg-[#10233f] px-4 py-2 text-xs font-bold text-white">{hasHistory ? "استبدال الإحصائيات الحالية" : "حفظ الإحصائيات"}</button>
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
