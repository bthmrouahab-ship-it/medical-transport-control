import { lazy, Suspense, useMemo, useState } from "react";
import { BarChart3, CarFront, Hospital as HospitalIcon, Loader2, Map as MapIcon, Radio, Truck } from "lucide-react";
import type { Hospital } from "@shared/hospitals";
import type { HistorySummary } from "@shared/history";
import { DEFAULT_VEHICLES, localDateString, migrateAppointment, migrateRequest, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { arrivalsOn, tripEndpoints, tripPhase } from "@shared/trips";
import { useArrivalAlerts, useCancellationAlerts } from "@/lib/arrivalAlerts";
import { saveState } from "@/lib/appStore";
import { appendAudit } from "@/lib/audit";
import { useHospitals, useNow, useSharedState } from "@/lib/useShared";
import { MAP_COLORS, locationFreshness, type MapTrip, type VehicleLocation } from "@/lib/vehicleLocation";
import { Dot, Panel, PageHeader, Segmented, Stat, cx, timeLabel, type Tone } from "./ui-kit";

// الخريطة (Leaflet) والمخططات (recharts) تُحمَّل عند فتح القسم فقط
const LiveMap = lazy(() => import("./LiveMap"));
const HospitalManager = lazy(() => import("./HospitalManager"));
const StatsPanel = lazy(() => import("./StatsPanel"));

type Tab = "map" | "stats" | "hospitals";

function SectionLoading() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-card ring-1 ring-slate-200/80"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>;
}

const FRESH_TONE: Record<string, Tone> = { live: "green", stale: "amber", offline: "neutral" };

/**
 * لوحة السيارات: خريطة قطر المباشرة، إحصائيات الرحلات، ودليل المستشفيات (للمدير).
 * alerts: رسالة عند وصول سيارة إلى وجهتها (لمشرف السيارات وهو على الخريطة).
 */
export default function FleetDashboard({ canEdit = false, alerts = false, actor }: { canEdit?: boolean; alerts?: boolean; actor: string }) {
  const [tab, setTab] = useState<Tab>("map");
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
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

  // اسم السائق على الخريطة: من حسابه في صفحة السائق (من يقود السيارة فعلًا)، وإلا من بيانات السيارة
  const mapLocations = useMemo(() => {
    const drivers = new Map(fleet.map((vehicle) => [vehicle.plate, vehicle.driver]));
    return locations.map((location) => ({ ...location, driver: location.driver?.trim() || drivers.get(location.plate) }));
  }, [locations, fleet]);
  const freshness = useMemo(() => new Map(mapLocations.map((location) => [location.plate, locationFreshness(location, now.getTime())])), [mapLocations, now]);
  const isLive = (plate?: string) => Boolean(plate && freshness.get(plate)?.state === "live");
  const driverOf = (plate?: string, fallback?: string) => mapLocations.find((location) => location.plate === plate && isLive(plate))?.driver || fallback || fleet.find((vehicle) => vehicle.plate === plate)?.driver || "";

  // الرحلات الجارية الآن: إلى نقطة الاستلام، أو مع المريض إلى الوجهة
  const trips = useMemo<MapTrip[]>(() => requests.flatMap((request) => {
    const phase = tripPhase(request, now, isLive(request.vehiclePlate));
    if (phase.kind !== "toPickup" && phase.kind !== "toDestination") return [];
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    if (!appointment) return [];
    const { from, to, destination } = tripEndpoints(appointment, request.direction, hospitals);
    const who = `${request.vehiclePlate ?? ""} · ${driverOf(request.vehiclePlate, request.driver)}`;
    const label = phase.kind === "toPickup"
      ? `${who}: في الطريق لاستلام مريض (${request.direction} إلى ${destination})`
      : `${who}: مع المريض إلى ${destination} · الوصول المتوقع ${timeLabel(phase.etaAt)}`;
    return [{ id: request.id, plate: request.vehiclePlate, phase: phase.kind, from, to, label }];
  }), [requests, appointments, hospitals, now, freshness]); // eslint-disable-line react-hooks/exhaustive-deps

  useArrivalAlerts({ arrivals: arrivalsOn(localDateString(now), requests, now, isLive), appointments, hospitals, driverOf, enabled: alerts });
  useCancellationAlerts({ requests, appointments, enabled: alerts });

  const liveCount = fleet.filter((vehicle) => isLive(vehicle.plate)).length;
  const busyPlates = new Set(trips.map((trip) => trip.plate));

  function saveHospitals(next: Hospital[], message: string) {
    saveState("fox_hospitals", next);
    appendAudit(message, actor);
  }

  const tabs: { value: Tab; label: string; icon: typeof MapIcon }[] = [
    { value: "map", label: "الخريطة المباشرة", icon: MapIcon },
    { value: "stats", label: "الإحصائيات", icon: BarChart3 },
    ...(canEdit ? [{ value: "hospitals" as const, label: "دليل المستشفيات", icon: HospitalIcon }] : []),
  ];

  // السيارات بترتيب: GPS مباشر، ثم في رحلة، ثم البقية
  const vehicleRows = fleet
    .map((vehicle) => {
      const fresh = freshness.get(vehicle.plate);
      const trip = trips.find((item) => item.plate === vehicle.plate && item.phase === "toDestination") ?? trips.find((item) => item.plate === vehicle.plate);
      const phase = trip ? tripPhase(requests.find((request) => request.id === trip.id)!, now, isLive(vehicle.plate)) : null;
      const status = !vehicle.available ? "خارج الخدمة"
        : phase?.kind === "toDestination" ? `مع المريض · تصل ${timeLabel(phase.etaAt)}`
          : phase?.kind === "toPickup" ? "في الطريق للاستلام" : "متاحة";
      const location = mapLocations.find((item) => item.plate === vehicle.plate);
      return { vehicle, fresh, status, location, rank: (fresh?.state === "live" ? 0 : 2) + (busyPlates.has(vehicle.plate) ? 0 : 1) };
    })
    .sort((a, b) => a.rank - b.rank || a.vehicle.plate.localeCompare(b.vehicle.plate));

  return (
    <div>
      <PageHeader
        title="الخريطة والإحصائيات"
        subtitle="السيارات مباشرة على خريطة قطر، وإحصائيات الرحلات"
        actions={<Segmented label="أقسام لوحة السيارات" value={tab} onChange={setTab} options={tabs} />}
      />

      <Suspense fallback={<SectionLoading />}>
        {tab === "map" && (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-3">
              <LiveMap hospitals={hospitals} locations={mapLocations} trips={trips} tripCounts={tripCounts} focus={focus} height={600} />
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white px-4 py-2.5 text-xs text-slate-600 shadow-card ring-1 ring-slate-200/80" aria-label="مفتاح الخريطة">
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: MAP_COLORS.origin }} /> مجمع الثمامة</li>
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full opacity-75" style={{ background: MAP_COLORS.hospital }} /> مستشفى (الحجم حسب الرحلات)</li>
                <li className="flex items-center gap-2"><span className="w-5 border-t-[3px] border-dashed" style={{ borderColor: MAP_COLORS.toPickup }} /> في الطريق للاستلام</li>
                <li className="flex items-center gap-2"><span className="w-5 border-t-[3px]" style={{ borderColor: MAP_COLORS.toDestination }} /> مع المريض إلى الوجهة</li>
                <li className="flex items-center gap-2"><Dot tone="green" /> GPS مباشر</li>
                <li className="flex items-center gap-2"><Dot tone="amber" /> آخر موقع قبل دقائق</li>
                <li className="flex items-center gap-2"><Dot /> غير متصل</li>
              </ul>
            </div>
            <aside className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat icon={Radio} tone="green" label="GPS مباشر" value={<>{liveCount}<span className="text-sm font-normal text-slate-400"> / {fleet.length}</span></>} />
                <Stat icon={Truck} tone="blue" label="في رحلة" value={busyPlates.size} />
              </div>
              <Panel icon={CarFront} title="السيارات" count={fleet.length} description="اضغط على سيارة لعرضها على الخريطة">
                <ul className="max-h-[470px] divide-y divide-slate-100 overflow-y-auto">
                  {vehicleRows.map(({ vehicle, fresh, status, location }) => {
                    const shown = location && fresh && fresh.state !== "offline";
                    return (
                      <li key={vehicle.plate}>
                        <button
                          type="button"
                          disabled={!location}
                          onClick={() => location && setFocus({ lat: location.lat, lng: location.lng, key: Date.now() })}
                          className={cx("flex w-full items-center gap-3 px-4 py-3 text-start transition", location ? "hover:bg-slate-50" : "cursor-default")}
                        >
                          <Dot tone={FRESH_TONE[fresh?.state ?? "offline"]} pulse={fresh?.state === "live"} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">{driverOf(vehicle.plate, vehicle.driver)} <span dir="ltr" className="text-xs font-normal text-slate-400">{vehicle.plate}</span></span>
                            <span className="block truncate text-xs text-slate-500">{status}</span>
                          </span>
                          <span className={cx("shrink-0 text-xs", shown ? "text-slate-600" : "text-slate-400")}>{fresh ? fresh.label : "لا يوجد GPS"}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
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
