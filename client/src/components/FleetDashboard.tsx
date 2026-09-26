import { lazy, Suspense, useMemo, useState } from "react";
import { BarChart3, Hospital as HospitalIcon, Loader2, Map as MapIcon, Radio, Truck } from "lucide-react";
import { matchHospital, type Hospital } from "@shared/hospitals";
import type { HistorySummary } from "@shared/history";
import { DEFAULT_VEHICLES, migrateAppointment, migrateRequest, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { saveState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import { useHospitals, useNow, useSharedState } from "@/lib/useShared";
import { locationFreshness, type ActiveTrip, type VehicleLocation } from "@/lib/vehicleLocation";

// الخريطة (Leaflet) والمخططات (recharts) تُحمَّل عند فتح القسم فقط
const LiveMap = lazy(() => import("./LiveMap"));
const HospitalManager = lazy(() => import("./HospitalManager"));
const StatsPanel = lazy(() => import("./StatsPanel"));

type Tab = "map" | "stats" | "hospitals";

function SectionLoading() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>;
}

/** لوحة السيارات: خريطة مباشرة، إحصائيات الرحلات، ودليل المستشفيات (للمدير). */
export default function FleetDashboard({ canEdit = false, actor }: { canEdit?: boolean; actor: string }) {
  const [tab, setTab] = useState<Tab>("map");
  const hospitals = useHospitals();
  const history = useSharedState<HistorySummary | null>("fox_history", null);
  const locations = useSharedState<VehicleLocation[]>("fox_locations", []);
  const fleet = useSharedState<Vehicle[]>("fox_fleet", DEFAULT_VEHICLES);
  const rawRequests = useSharedState<unknown[]>("fox_requests", []);
  const rawAppointments = useSharedState<unknown[]>("fox_appointments", []);
  const now = useNow(15000);

  const appointments = useMemo(
    () => rawAppointments.map((item, index) => migrateAppointment(item, index)).filter((item): item is ClinicAppointment => Boolean(item)),
    [rawAppointments],
  );
  const requests = useMemo(
    () => rawRequests.map(migrateRequest).filter((request): request is VehicleRequest => Boolean(request)),
    [rawRequests],
  );

  const tripCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of history?.destinations ?? []) if (item.hospitalId) counts[item.hospitalId] = item.trips;
    return counts;
  }, [history]);

  const activeTrips = useMemo<ActiveTrip[]>(() => requests
    .filter((request) => request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة")
    .flatMap((request) => {
      const appointment = appointments.find((item) => item.id === request.appointmentId);
      const hospitalId = appointment && (appointment.hospitalId || matchHospital(appointment.clinic, hospitals)?.id);
      return hospitalId ? [{ id: request.id, hospitalId, plate: request.vehiclePlate, label: `${request.vehiclePlate ?? ""} → ${appointment!.clinic} (${request.status})` }] : [];
    }), [requests, appointments, hospitals]);

  const liveCount = locations.filter((location) => locationFreshness(location, now.getTime()).state === "live").length;

  function saveHospitals(next: Hospital[], message: string) {
    saveState("fox_hospitals", next);
    appendAudit(message, actor);
  }

  const tabs: { id: Tab; label: string; icon: typeof MapIcon }[] = [
    { id: "map", label: "الخريطة المباشرة", icon: MapIcon },
    { id: "stats", label: "الإحصائيات", icon: BarChart3 },
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

      <Suspense fallback={<SectionLoading />}>
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
          <StatsPanel canEdit={canEdit} actor={actor} hospitals={hospitals} fleet={fleet} appointments={appointments} requests={requests} history={history} />
        )}

        {tab === "hospitals" && canEdit && <HospitalManager hospitals={hospitals} tripCounts={tripCounts} onSave={saveHospitals} />}
      </Suspense>
    </div>
  );
}
