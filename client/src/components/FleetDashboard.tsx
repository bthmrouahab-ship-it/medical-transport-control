import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { BarChart3, CarFront, EyeOff, FilterX, Hospital as HospitalIcon, Loader2, Map as MapIcon, Radio, Search, Truck } from "lucide-react";
import type { Hospital } from "@shared/hospitals";
import { shortDriverName } from "@shared/drivers";
import type { HistorySummary } from "@shared/history";
import { DEFAULT_VEHICLES, activeWaiting, localDateString, migrateAppointment, migrateRequest, transferSource, waitingText, type ClinicAppointment, type Vehicle, type VehicleRequest } from "@shared/transport";
import { arrivalsOn, stoppedVehicles, tripEndpoints, tripPhase, vehicleLocationState } from "@shared/trips";
import { stoppedText, useArrivalAlerts, useCancellationAlerts, useStoppedAlerts } from "@/lib/arrivalAlerts";
import { useTripRoutes, type RouteLeg } from "@/lib/roads";
import type { VehicleBadge } from "./LiveMap";
import { saveState } from "@/lib/appStore";
import { useHospitals, useNow, useSharedState } from "@/lib/useShared";
import { MAP_COLORS, MAP_HIDE_AFTER_MINUTES, ageText, hiddenOnMap, locationFreshness, type MapTrack, type MapTrip, type VehicleLocation, type VehicleTrack } from "@/lib/vehicleLocation";
import { Dot, EmptyState, Panel, PageHeader, Segmented, Stat, btn, cx, inputClass, timeLabel, type Tone } from "./ui-kit";

// الخريطة (Leaflet) والمخططات (recharts) تُحمَّل عند فتح القسم فقط
const LiveMap = lazy(() => import("./LiveMap"));
const HospitalManager = lazy(() => import("./HospitalManager"));
const StatsPanel = lazy(() => import("./StatsPanel"));

type Tab = "map" | "stats" | "hospitals";

function SectionLoading() {
  return <div className="flex min-h-64 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-card ring-1 ring-slate-200/80"><Loader2 className="h-6 w-6 animate-spin" /><span className="sr-only">جارٍ التحميل</span></div>;
}

const FRESH_TONE: Record<string, Tone> = { live: "green", stale: "amber", offline: "neutral" };

/** عدد السائقين المخفيين من الخريطة (غير متصلين منذ أكثر من 5 دقائق) */
function hiddenText(count: number) {
  const since = `منذ أكثر من ${MAP_HIDE_AFTER_MINUTES} دقائق`;
  if (count === 1) return `سائق واحد غير متصل ${since}، مخفي من الخريطة · ابحث عنه لإظهار آخر موقع له`;
  const who = count === 2 ? `سائقان غير متصلين ${since}، مخفيان` : `${count} ${count <= 10 ? "سائقين" : "سائقًا"} غير متصلين ${since}، مخفيون`;
  return `${who} من الخريطة · ابحث عن السائق لإظهار آخر موقع له`;
}

/**
 * لوحة السيارات: خريطة قطر المباشرة، إحصائيات الرحلات، ودليل المستشفيات (للمدير).
 * alerts: رسالة عند وصول سيارة إلى وجهتها (لمشرف السيارات وهو على الخريطة).
 */
export default function FleetDashboard({ canEdit = false, alerts = false, actor, onOpen }: {
  canEdit?: boolean;
  alerts?: boolean;
  actor: string;
  /** الضغط على إشعار (مشرف السيارات على الخريطة): الرجوع إلى التوزيع ثم مكان الإشعار */
  onOpen?: (target: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("map");
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  // البحث عن سائق أو سيارة: يفلتر قائمة السيارات ويُظهر على الخريطة آخر موقع للسائق غير المتصل
  const [query, setQuery] = useState("");
  // السيارة التي اختيرت من القائمة (تظهر على الخريطة ولو كان موقعها قديمًا)
  const [picked, setPicked] = useState<string | null>(null);
  const hospitals = useHospitals();
  const history = useSharedState<HistorySummary | null>("fox_history", null);
  const locations = useSharedState<VehicleLocation[]>("fox_locations", []);
  // مسار كل سيارة في رحلتها (المدير ومشرف السيارات)
  const rawTracks = useSharedState<VehicleTrack[]>("fox_tracks", []);
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

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (plate: string) => {
    const text = `${plate} ${mapLocations.find((location) => location.plate === plate)?.driver ?? ""} ${fleet.find((vehicle) => vehicle.plate === plate)?.driver ?? ""}`.toLowerCase();
    return words.every((word) => text.includes(word));
  };
  // على الخريطة: من وصل موقعه خلال آخر 5 دقائق، والسائق غير المتصل عند البحث عنه أو اختياره من القائمة فقط
  const onMap = (location: VehicleLocation) => !hiddenOnMap(location, now.getTime()) || (words.length > 0 && matches(location.plate)) || location.plate === picked;
  const visibleLocations = mapLocations.filter(onMap);
  const clock = (iso?: string | number) => (iso === undefined ? "" : timeLabel(new Date(typeof iso === "number" ? iso * 1000 : iso)));
  const hiddenCount = mapLocations.length - visibleLocations.length;
  function search(value: string) {
    setQuery(value);
    setPicked(null);
  }
  const driverOf = (plate?: string, fallback?: string) => mapLocations.find((location) => location.plate === plate && isLive(plate))?.driver || fallback || fleet.find((vehicle) => vehicle.plate === plate)?.driver || "";

  // الرحلات الجارية الآن: إلى نقطة الاستلام، أو مع المريض إلى الوجهة
  const baseTrips = useMemo<MapTrip[]>(() => requests.flatMap((request) => {
    const phase = tripPhase(request, now, isLive(request.vehiclePlate));
    if (phase.kind !== "toPickup" && phase.kind !== "toDestination") return [];
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    if (!appointment) return [];
    const firstAppointment = transferSource(request, appointments);
    const { from, to, destination } = tripEndpoints(appointment, request.direction, hospitals, firstAppointment);
    const who = `${request.vehiclePlate ?? ""} · ${driverOf(request.vehiclePlate, request.driver)}`;
    const label = phase.kind === "toPickup"
      ? `${who}: في الطريق لاستلام ضيف (${request.direction} إلى ${destination})`
      : `${who}: مع الضيف إلى ${destination} · الوصول المتوقع ${timeLabel(phase.etaAt)}`;
    return [{ id: request.id, plate: request.vehiclePlate, phase: phase.kind, from, to, label }];
  }), [requests, appointments, hospitals, now, freshness]); // eslint-disable-line react-hooks/exhaustive-deps

  // مسار الطريق الفعلي لكل رحلة جارية: من موقع السيارة الآن (GPS) إلى نقطة الاستلام أو الوجهة، وبلا موقع من نقطة البداية
  const legOf = (trip: MapTrip): RouteLeg | null => {
    const location = trip.plate ? mapLocations.find((item) => item.plate === trip.plate && freshness.get(item.plate)?.state !== "offline") : undefined;
    const car = location ? { lat: location.lat, lng: location.lng } : null;
    const [start, end] = trip.phase === "toDestination" ? [car ?? trip.from, trip.to] : car ? [car, trip.from] : [trip.from, trip.to];
    if (!start || !end) return null;
    return { key: `${trip.plate ?? trip.id}|${trip.phase}|${end.lat.toFixed(4)},${end.lng.toFixed(4)}`, from: start, to: end };
  };
  const legs = new Map(baseTrips.flatMap((trip) => {
    const leg = legOf(trip);
    return leg ? [[trip.id, leg] as const] : [];
  }));
  const routes = useTripRoutes(Array.from(new Map(Array.from(legs.values()).map((leg) => [leg.key, leg])).values()));
  const trips = useMemo<MapTrip[]>(() => baseTrips.map((trip) => {
    const route = routes.get(legs.get(trip.id)?.key ?? "");
    return route ? { ...trip, path: route.path, roadText: `${route.km} كم بالطريق · ${route.minutes} د` } : trip;
  }), [baseTrips, routes]); // eslint-disable-line react-hooks/exhaustive-deps

  useArrivalAlerts({ arrivals: arrivalsOn(localDateString(now), requests, now, isLive), appointments, hospitals, driverOf, enabled: alerts, onOpen });
  useCancellationAlerts({ requests, appointments, enabled: alerts, onOpen });
  // السيارة التي لم تتحرك 10 دقائق خارج المجمع (ولا تنتظر في المستشفى بأمر المشرف)
  const stopped = stoppedVehicles(fleet, mapLocations, hospitals, now, (vehicle) => Boolean(activeWaiting(vehicle, now)));
  useStoppedAlerts({ stopped, enabled: alerts, onOpen });
  // بطاقة السيارة على الخريطة: تنتظر في المستشفى، أو متوقفة خارج المجمع
  const badges = new Map<string, VehicleBadge>();
  for (const vehicle of fleet) {
    const waiting = activeWaiting(vehicle, now);
    if (waiting) badges.set(vehicle.plate, { text: `تنتظر في ${waiting.place}`, tone: "waiting" });
  }
  for (const item of stopped) badges.set(item.vehicle.plate, { text: `متوقفة ${item.minutes} د`, tone: "stopped" });

  // مسار الرحلة: للسيارة في رحلة جارية دائمًا، ومسار آخر رحلة لها عند البحث عنها أو اختيارها
  const mapTracks: MapTrack[] = rawTracks.flatMap((track) => {
    if (!Array.isArray(track.points) || track.points.length < 2) return [];
    const current = baseTrips.some((trip) => trip.plate === track.plate && track.requestIds?.includes(trip.id));
    if (!current && track.plate !== picked && !(words.length && matches(track.plate))) return [];
    const last = track.points[track.points.length - 1];
    const label = current
      ? `مسار السيارة ${track.plate} في رحلتها منذ ${clock(track.startedAt)}`
      : `مسار آخر رحلة للسيارة ${track.plate} (${clock(track.startedAt)}–${clock(last[2])})`;
    return [{ plate: track.plate, path: track.points.map(([lat, lng]) => [lat, lng] as [number, number]), label }];
  });

  const liveCount = fleet.filter((vehicle) => isLive(vehicle.plate)).length;
  const busyPlates = new Set(trips.map((trip) => trip.plate));

  // تعديلات الدليل يسجّلها الخادم في سجل العمليات
  const saveHospitals = (next: Hospital[]) => saveState("fox_hospitals", next);

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
      const location = mapLocations.find((item) => item.plate === vehicle.plate);
      // المتاحة: داخل المجمع، أو خارجه عائدة من وجهتها
      const place = !vehicle.available || !vehicle.driver || phase ? null
        : vehicleLocationState(vehicle.plate, requests, appointments, hospitals, now, location && isLive(vehicle.plate) ? { lat: location.lat, lng: location.lng } : null, activeWaiting(vehicle, now));
      const still = stopped.find((item) => item.vehicle.plate === vehicle.plate);
      const status = !vehicle.available ? "خارج الخدمة"
        : !phase && !vehicle.driver ? "بلا سائق"
        : phase?.kind === "toDestination" ? `مع الضيف · تصل ${timeLabel(phase.etaAt)}`
          : phase?.kind === "toPickup" ? "في الطريق للاستلام"
            : place?.kind === "outside" ? (place.waiting ? waitingText(place.waiting) : `متاحة خارج المجمع · تصل المجمع ${timeLabel(place.backAt)}`) : "متاحة داخل المجمع";
      return { vehicle, fresh, status: still ? `${status} · ${stoppedText(still)}` : status, location, rank: (fresh?.state === "live" ? 0 : 2) + (busyPlates.has(vehicle.plate) ? 0 : 1) };
    })
    .sort((a, b) => a.rank - b.rank || a.vehicle.plate.localeCompare(b.vehicle.plate));
  const shownRows = words.length ? vehicleRows.filter((row) => matches(row.vehicle.plate)) : vehicleRows;

  // سيارة واحدة مطابقة للبحث: تنتقل الخريطة إليها
  const soleMatch = words.length ? shownRows.filter((row) => row.location) : [];
  const soleKey = soleMatch.length === 1 ? soleMatch[0].vehicle.plate : "";
  useEffect(() => {
    const location = soleKey ? mapLocations.find((item) => item.plate === soleKey) : undefined;
    if (location) setFocus({ lat: location.lat, lng: location.lng, key: Date.now() });
  }, [soleKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="relative block sm:w-80">
                  <span className="sr-only">بحث عن سائق أو سيارة</span>
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => search(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      const first = shownRows.find((row) => row.location)?.location;
                      if (first) setFocus({ lat: first.lat, lng: first.lng, key: Date.now() });
                    }}
                    placeholder="بحث: اسم السائق أو رقم السيارة..."
                    className={cx(inputClass, "h-10 bg-white ps-9 shadow-card")}
                  />
                </label>
                <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs leading-5 text-slate-500" aria-live="polite">
                  {words.length ? (
                    <>
                      <span>{!shownRows.length ? "لا توجد سيارة مطابقة" : shownRows.length === 1 ? "سيارة واحدة مطابقة، ويظهر آخر موقع لها على الخريطة" : `${shownRows.length} سيارات مطابقة، ويظهر آخر موقع لكل منها على الخريطة`}</span>
                      <button type="button" onClick={() => search("")} className={cx(btn("ghost", "sm"), "shrink-0")}><FilterX className="h-4 w-4" /> مسح البحث</button>
                    </>
                  ) : hiddenCount > 0 && (
                    <><EyeOff className="h-3.5 w-3.5 shrink-0" /><span>{hiddenText(hiddenCount)}</span></>
                  )}
                </p>
              </div>
              <LiveMap hospitals={hospitals} locations={visibleLocations} trips={trips} tracks={mapTracks} badges={badges} tripCounts={tripCounts} focus={focus} height={600} />
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-white px-4 py-2.5 text-xs text-slate-600 shadow-card ring-1 ring-slate-200/80" aria-label="مفتاح الخريطة">
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: MAP_COLORS.origin }} /> مجمع الثمامة</li>
                <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full opacity-75" style={{ background: MAP_COLORS.hospital }} /> مستشفى (الحجم حسب الرحلات)</li>
                <li className="flex items-center gap-2"><span className="w-5 border-t-[3px] border-dashed" style={{ borderColor: MAP_COLORS.toPickup }} /> في الطريق للاستلام</li>
                <li className="flex items-center gap-2"><span className="w-5 border-t-[3px]" style={{ borderColor: MAP_COLORS.toDestination }} /> مع الضيف إلى الوجهة (بمسار الطريق)</li>
                <li className="flex items-center gap-2"><span className="w-5 border-t-[3px]" style={{ borderColor: MAP_COLORS.track }} /> ما قطعته السيارة في رحلتها</li>
                <li className="flex items-center gap-2"><span className="h-3 w-5 rounded ring-2 ring-inset" style={{ ["--tw-ring-color" as string]: MAP_COLORS.waiting }} /> تنتظر في المستشفى</li>
                <li className="flex items-center gap-2"><span className="h-3 w-5 rounded ring-2 ring-inset" style={{ ["--tw-ring-color" as string]: MAP_COLORS.stopped }} /> متوقفة خارج المجمع 10 دقائق أو أكثر</li>
                <li className="flex items-center gap-2"><Dot tone="green" /> GPS مباشر</li>
                <li className="flex items-center gap-2"><Dot tone="amber" /> آخر موقع قبل دقائق</li>
                <li className="flex items-center gap-2"><Dot /> غير متصل (يُخفى بعد {MAP_HIDE_AFTER_MINUTES} دقائق إلا بالبحث)</li>
              </ul>
            </div>
            <aside className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat icon={Radio} tone="green" label="GPS مباشر" value={<>{liveCount}<span className="text-sm font-normal text-slate-400"> / {fleet.length}</span></>} />
                <Stat icon={Truck} tone="blue" label="في رحلة" value={busyPlates.size} />
              </div>
              <Panel icon={CarFront} title="السيارات" count={words.length ? shownRows.length : fleet.length} description="اضغط على سيارة لعرضها على الخريطة">
                <ul className="max-h-[470px] divide-y divide-slate-100 overflow-y-auto">
                  {!shownRows.length && <li><EmptyState icon={Search} title="لا توجد سيارة مطابقة" /></li>}
                  {shownRows.map(({ vehicle, fresh, status, location }) => {
                    const shown = location && fresh && fresh.state !== "offline";
                    const hidden = location && !onMap(location);
                    return (
                      <li key={vehicle.plate}>
                        <button
                          type="button"
                          disabled={!location}
                          onClick={() => {
                            if (!location) return;
                            setPicked(vehicle.plate);
                            setFocus({ lat: location.lat, lng: location.lng, key: Date.now() });
                          }}
                          className={cx("flex w-full items-center gap-3 px-4 py-3 text-start transition", location ? "hover:bg-slate-50" : "cursor-default")}
                        >
                          <Dot tone={FRESH_TONE[fresh?.state ?? "offline"]} pulse={fresh?.state === "live"} />
                          <span className="min-w-0 flex-1">
                            {/* أول كلمة من اسم السائق، والاسم الكامل عند المرور */}
                            <span title={driverOf(vehicle.plate, vehicle.driver) || undefined} className="block truncate text-sm font-medium text-ink">{shortDriverName(driverOf(vehicle.plate, vehicle.driver)) || "بلا سائق"} <span dir="ltr" className="text-xs font-normal text-slate-400">{vehicle.plate}</span></span>
                            <span className="block truncate text-xs text-slate-500">{status}</span>
                          </span>
                          <span className={cx("flex shrink-0 items-center gap-1 text-xs", shown ? "text-slate-600" : "text-slate-400")}>
                            {hidden && <EyeOff className="h-3.5 w-3.5" aria-label="مخفية من الخريطة" />}
                            {!fresh ? "لا يوجد GPS" : fresh.state === "offline" ? `غير متصل ${ageText(fresh.ageMinutes)}` : fresh.label}
                          </span>
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
