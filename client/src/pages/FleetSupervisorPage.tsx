import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CarFront,
  CheckCircle2,
  Copy,
  Download,
  History,
  Link2,
  MapPin,
  MessageCircle,
  PauseCircle,
  Phone,
  Plus,
  Radio,
  Send,
  Sparkles,
  Timer,
  Truck,
} from "lucide-react";
import {
  appointmentPickupLabel,
  assignVehicleForTrips,
  buildDriverMessage,
  buildTripGroups,
  findUnrequestedMatches,
  groupCapacity,
  isNonMedical,
  localDateString,
  matchHospitalZone,
  suggestJoinDispatched,
  whatsappLink,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import type { Hospital } from "@shared/hospitals";
import { arrivalsOn, tripEndpoints, tripPhase, vehicleAvailability, type TripPhase } from "@shared/trips";
import {
  Badge,
  DateChooser,
  Dot,
  EmptyState,
  Panel,
  PageHeader,
  Segmented,
  Stat,
  StatusBadge,
  Steps,
  Switch,
  TimeBlock,
  btn,
  cx,
  formatDay,
  inputClass,
  longDate,
  timeLabel,
} from "@/components/ui-kit";
import NonMedicalTripForm from "./NonMedicalTripForm";
import { RecentActivity } from "@/components/ActivityLog";
import { useHospitals, useLiveVehicles, useNow } from "@/lib/useShared";
import { NOTIFY_KEY, deviceNotificationsOn, useArrivalAlerts, useCancellationAlerts } from "@/lib/arrivalAlerts";

type Trip = { request: VehicleRequest; appointment: ClinicAppointment };
type VehicleFilter = "all" | "available" | "busy" | "off";

/** مرحلة رحلة سيارة كاملة (قد تحمل أكثر من مريض). */
function groupPhase(phases: TripPhase[]): TripPhase {
  const toPickup = phases.filter((phase) => phase.kind === "toPickup");
  if (toPickup.length) return { kind: "toPickup", atPickup: toPickup.every((phase) => phase.kind === "toPickup" && phase.atPickup) };
  const onRoad = phases.filter((phase): phase is Extract<TripPhase, { kind: "toDestination" }> => phase.kind === "toDestination");
  if (!onRoad.length) return phases[0];
  const last = onRoad.reduce((latest, phase) => (phase.etaAt > latest.etaAt ? phase : latest));
  return { ...last, tracking: onRoad.some((phase) => phase.tracking) };
}

const minutesText = (minutes: number) => (minutes <= 1 ? "دقيقة" : minutes <= 10 ? `${minutes} دقائق` : `${minutes} دقيقة`);

export function FleetSupervisorPage({ vehicles, appointments, requests, date, onDateChange, onManager, onUpdate, onDispatch, onArrived, onExport, onAddTrip }: {
  vehicles: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  date: string;
  onDateChange: (date: string) => void;
  onManager: () => void;
  onUpdate: (vehicles: Vehicle[]) => void;
  onDispatch: (requestIds: string[], vehicle: Vehicle, joinRequestIds?: string[]) => void;
  onArrived: (requestIds: string[], source: "manual" | "estimate") => void;
  onExport: () => void;
  onAddTrip: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [addingTrip, setAddingTrip] = useState(false);
  const [selectedVehicles, setSelectedVehicles] = useState<Record<string, string>>({});
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>("all");
  const hospitals = useHospitals();
  const now = useNow(15000);
  const today = localDateString(now);

  // السيارات التي يصل موقعها مباشرة الآن، واسم السائق الذي يقودها فعليًا
  const liveGps = useLiveVehicles(now);
  const gpsLive = (plate?: string) => Boolean(plate && liveGps.has(plate));
  const driverOf = (plate: string | undefined, fallback?: string) => (plate && liveGps.get(plate)?.driver) || fallback || vehicles.find((vehicle) => vehicle.plate === plate)?.driver || "";

  const withAppointment = (request: VehicleRequest): Trip | null => {
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    return appointment ? { request, appointment } : null;
  };
  const isTrip = (trip: Trip | null): trip is Trip => Boolean(trip);
  const onDate = (trip: Trip) => trip.appointment.appointmentDate === date;

  const pending = requests.filter((request) => request.status === "بانتظار التوزيع").map(withAppointment).filter(isTrip).filter(onDate);
  const phases = new Map(requests.map((request) => [request.id, tripPhase(request, now, gpsLive(request.vehiclePlate))]));
  // الرحلات الجارية الآن (إلى الاستلام أو إلى الوجهة) مهما كان تاريخ الموعد
  const active = requests
    .filter((request) => ["toPickup", "toDestination"].includes(phases.get(request.id)!.kind))
    .map(withAppointment)
    .filter(isTrip);
  const availability = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicleAvailability(vehicle.plate, requests, now, gpsLive(vehicle.plate))]));
  const isBusy = (plate: string) => Boolean(availability.get(plate)?.busy);
  const dispatchable = vehicles.filter((vehicle) => vehicle.available && !isBusy(vehicle.plate));
  const toPickupTrips = active.filter((trip) => phases.get(trip.request.id)!.kind === "toPickup");

  const groups = buildTripGroups(pending.map((trip) => ({ appointment: trip.appointment, direction: trip.request.direction })), hospitals);
  const groupedIds = new Set(groups.flatMap((group) => group.appointmentIds));
  const joins = suggestJoinDispatched(pending.filter((trip) => !groupedIds.has(trip.appointment.id)), toPickupTrips.filter(onDate), hospitals);
  const unrequested = findUnrequestedMatches(appointments, requests, hospitals, now).filter((match) => match.appointment.appointmentDate === date);

  // الرحلات الجارية مجمّعة حسب السيارة (groupId أو الطلب نفسه)
  const activeGroups = Array.from(active.reduce((map, trip) => {
    const key = trip.request.groupId ?? trip.request.id;
    map.set(key, [...(map.get(key) ?? []), trip]);
    return map;
  }, new Map<string, Trip[]>()).values());

  // الوصول إلى الوجهة اليوم (GPS أو تأكيد يدوي أو انتهاء المدة التقديرية)
  const arrivals = arrivalsOn(today, requests, now, gpsLive);

  // تسجيل انتهاء المدة التقديرية لسيارة بلا GPS، حتى تظهر الرحلة منتهية لكل المستخدمين
  const recorded = useRef(new Set<string>());
  useEffect(() => {
    const due = requests.filter((request) => request.status === "تم استلام المريض" && request.etaAt && !recorded.current.has(request.id)
      && phases.get(request.id)?.kind === "arrived");
    if (!due.length) return;
    due.forEach((request) => recorded.current.add(request.id));
    onArrived(due.map((request) => request.id), "estimate");
  }, [requests, now, liveGps]); // eslint-disable-line react-hooks/exhaustive-deps

  // رسالة لمشرف السيارات عند وصول سيارة، وتنبيه على الجهاز إن فعّله
  useArrivalAlerts({ arrivals, appointments, hospitals, driverOf });
  useCancellationAlerts({ requests, appointments });
  const [notifyDevice, setNotifyDevice] = useState(deviceNotificationsOn);

  async function toggleDeviceNotifications() {
    if (notifyDevice) {
      setNotifyDevice(false);
      try { localStorage.setItem(NOTIFY_KEY, "off"); } catch { /* غير متاح */ }
      return;
    }
    if (!("Notification" in window)) {
      toast.error("هذا المتصفح لا يدعم التنبيهات");
      return;
    }
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      toast.error("لم يسمح المتصفح بالتنبيهات. فعّلها من إعدادات الموقع في المتصفح.");
      return;
    }
    setNotifyDevice(true);
    try { localStorage.setItem(NOTIFY_KEY, "on"); } catch { /* غير متاح */ }
    toast.success("ستصلك تنبيهات الوصول على الجهاز عندما تكون الصفحة في الخلفية");
  }

  function dispatchSingle(trip: Trip) {
    const suggested = assignVehicleForTrips(dispatchable, [trip.appointment]);
    const plate = selectedVehicles[trip.request.id] || suggested?.plate;
    const vehicle = dispatchable.find((item) => item.plate === plate);
    if (!vehicle) {
      toast.error("اختر سيارة متاحة ومناسبة للرحلة");
      return;
    }
    onDispatch([trip.request.id], vehicle);
  }

  function dispatchGroup(appointmentIds: string[]) {
    const members = pending.filter((trip) => appointmentIds.includes(trip.appointment.id));
    const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment));
    if (!vehicle || members.length < 2) {
      toast.error("لا توجد سيارة مناسبة ومتاحة لجمع هذه الرحلات");
      return;
    }
    onDispatch(members.map((trip) => trip.request.id), vehicle);
  }

  function joinTrip(requestId: string, plate: string, groupId?: string) {
    const vehicle = vehicles.find((item) => item.plate === plate);
    if (!vehicle) return;
    const partners = toPickupTrips.filter((trip) => trip.request.vehiclePlate === plate && (groupId ? trip.request.groupId === groupId : !trip.request.groupId)).map((trip) => trip.request.id);
    onDispatch([requestId], vehicle, partners);
  }

  const availabilityText = (vehicle: Vehicle) => {
    if (!vehicle.available) return { tone: "neutral" as const, text: "خارج الخدمة" };
    const state = availability.get(vehicle.plate);
    if (!state?.busy) return { tone: "green" as const, text: "متاحة" };
    if (state.toPickup) return { tone: "blue" as const, text: "في الطريق إلى الاستلام" };
    return { tone: "blue" as const, text: state.until ? `في رحلة · تتفرغ ${timeLabel(state.until)}` : "في رحلة" };
  };
  const vehicleCounts = {
    all: vehicles.length,
    available: dispatchable.length,
    busy: vehicles.filter((vehicle) => vehicle.available && isBusy(vehicle.plate)).length,
    off: vehicles.filter((vehicle) => !vehicle.available).length,
  };
  const shownVehicles = vehicles.filter((vehicle) => vehicleFilter === "all"
    || (vehicleFilter === "available" && vehicle.available && !isBusy(vehicle.plate))
    || (vehicleFilter === "busy" && vehicle.available && isBusy(vehicle.plate))
    || (vehicleFilter === "off" && !vehicle.available));
  const trackingCount = activeGroups.filter((trips) => trips.some((trip) => {
    const phase = phases.get(trip.request.id)!;
    return phase.kind === "toDestination" && phase.tracking;
  })).length;

  return (
    <>
      <PageHeader
        title="توزيع السيارات"
        subtitle={<>{longDate(date)}{date === today ? " · اليوم" : ""}</>}
        actions={(
          <>
            <button onClick={() => setAddingTrip(true)} className={btn("primary")}><Plus className="h-4 w-4" /> رحلة غير طبية</button>
            <button onClick={onExport} className={btn("secondary")}><Download className="h-4 w-4" /> Excel</button>
            <button onClick={onManager} className={btn("dark")}><MapPin className="h-4 w-4" /> الخريطة والإحصائيات</button>
          </>
        )}
      />

      <div className="mb-6"><DateChooser value={date} onChange={onDateChange} /></div>

      {addingTrip && <NonMedicalTripForm defaultDate={date} onCancel={() => setAddingTrip(false)} onSave={(appointment, request) => { onAddTrip(appointment, request); setAddingTrip(false); }} />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat icon={BellRing} tone="amber" label="بانتظار التوزيع" value={pending.length} hint={date === today ? "طلبات اليوم" : "طلبات التاريخ المحدد"} />
        <Stat icon={Truck} tone="blue" label="رحلات جارية" value={activeGroups.length} hint={trackingCount ? `${trackingCount} بمتابعة GPS` : "الآن"} />
        <Stat icon={CheckCircle2} tone="green" label="سيارات متاحة" value={dispatchable.length} hint={`من ${vehicles.length} سيارة`} />
        <Stat icon={PauseCircle} tone="neutral" label="خارج الخدمة" value={vehicleCounts.off} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Panel tone="amber" icon={BellRing} title="طلبات بانتظار التوزيع" count={pending.length} description="اختر السيارة المناسبة ثم أرسلها">
            {pending.length ? (
              <div className="divide-y divide-slate-100">
                {pending.map((trip) => {
                  const suggested = assignVehicleForTrips(dispatchable, [trip.appointment]);
                  const selectedPlate = selectedVehicles[trip.request.id] || suggested?.plate || "";
                  // الرحلة العادية تقبل أي سيارة (سيدان وباص أولًا)، واحتياجات خاصة تحتاج سيارة مجهزة
                  const compatible = (trip.appointment.kind === "احتياجات خاصة" ? vehicles.filter((vehicle) => vehicle.kind === "احتياجات خاصة") : [...vehicles]
                    .sort((a, b) => Number(a.kind === "احتياجات خاصة") - Number(b.kind === "احتياجات خاصة")))
                    .filter((vehicle) => vehicle.available);
                  const ready = compatible.filter((vehicle) => !isBusy(vehicle.plate));
                  const zone = matchHospitalZone(trip.appointment, hospitals);
                  return (
                    <div key={trip.request.id} className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
                      <div className="flex min-w-0 flex-1 gap-4">
                        <TimeBlock time={trip.appointment.appointmentAt} day={formatDay(trip.appointment.appointmentDate, now)} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{trip.appointment.patientName}</p>
                            <Badge tone={trip.request.direction === "عودة" ? "amber" : "neutral"}>{trip.request.direction}</Badge>
                            {isNonMedical(trip.appointment) && <Badge tone="violet">غير طبية</Badge>}
                            {groupedIds.has(trip.appointment.id) && <Badge tone="violet" icon={Sparkles}>قابلة للجمع</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{appointmentPickupLabel(trip.appointment)} ← {trip.appointment.clinic}{zone && <span className="text-slate-400"> · {zone}</span>}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{trip.appointment.kind}{trip.appointment.assistance.length ? ` · ${trip.appointment.assistance.join("، ")}` : ""}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row lg:w-[360px]">
                        <select aria-label="السيارة" value={ready.some((vehicle) => vehicle.plate === selectedPlate) ? selectedPlate : ""} onChange={(event) => setSelectedVehicles((current) => ({ ...current, [trip.request.id]: event.target.value }))} className={cx(inputClass, "h-10 min-w-0 flex-1")}>
                          {!ready.length && <option value="">لا توجد سيارة متاحة</option>}
                          {ready.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {driverOf(vehicle.plate)} · {vehicle.kind}</option>)}
                          {compatible.filter((vehicle) => isBusy(vehicle.plate)).map((vehicle) => {
                            const until = availability.get(vehicle.plate)?.until;
                            return <option key={vehicle.plate} value={vehicle.plate} disabled>{vehicle.plate} · مشغولة{until ? ` حتى ${timeLabel(until)}` : ""}</option>;
                          })}
                        </select>
                        <button disabled={!ready.length} onClick={() => dispatchSingle(trip)} className={btn("primary")}><Send className="h-4 w-4" /> إرسال</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState icon={CheckCircle2} title="لا توجد طلبات بانتظار التوزيع" hint="تظهر هنا طلبات مشرفي المباني فور وصولها" />}
          </Panel>

          {(groups.length > 0 || joins.length > 0) && (
            <Panel tone="violet" icon={Sparkles} title="اقتراحات جمع الرحلات" count={groups.length + joins.length} description="ضيوف لنفس الوجهة أو وجهات متجاورة في نفس التوقيت">
              <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
                {groups.map((group) => {
                  const members = pending.filter((trip) => group.appointmentIds.includes(trip.appointment.id));
                  const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment));
                  return (
                    <div key={group.appointmentIds.join("-")} className="flex flex-col rounded-xl bg-violet-50/50 p-4 ring-1 ring-violet-100">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-medium text-violet-800">{group.direction} · {group.reason}</p>
                        <Badge tone="violet">{members.length} رحلات</Badge>
                      </div>
                      <TripList trips={members} hospitals={hospitals} />
                      <p className="mt-3 text-xs text-slate-500">السيارة المقترحة: <span className="font-semibold text-slate-700">{vehicle ? `${vehicle.plate} · ${driverOf(vehicle.plate)}` : "لا توجد سيارة متاحة"}</span></p>
                      <button disabled={!vehicle} onClick={() => dispatchGroup(group.appointmentIds)} className={cx(btn("dark", "sm"), "mt-3 w-full")}><Send className="h-4 w-4" /> جمع {members.length} رحلات وإرسال السيارة</button>
                    </div>
                  );
                })}
                {joins.map((join) => {
                  const trip = pending.find((item) => item.request.id === join.requestId)!;
                  return (
                    <div key={join.requestId} className="flex flex-col rounded-xl bg-emerald-50/50 p-4 ring-1 ring-emerald-100">
                      <p className="text-xs font-medium text-emerald-800">{join.reason}</p>
                      <TripList trips={[trip]} hospitals={hospitals} />
                      <button onClick={() => joinTrip(join.requestId, join.plate, join.groupId)} className={cx(btn("success", "sm"), "mt-3 w-full")}><Link2 className="h-4 w-4" /> ضم إلى السيارة {join.plate}</button>
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {unrequested.length > 0 && (
            <Panel tone="red" icon={AlertTriangle} title="مواعيد لم يُطلب لها سيارة" count={unrequested.length} description="لنفس وجهة رحلة قائمة وفي نفس التوقيت">
              <ul className="divide-y divide-slate-100">
                {unrequested.map((match) => (
                  <li key={match.appointment.id} className="flex gap-4 p-4 sm:px-5">
                    <TimeBlock time={match.appointment.appointmentAt} />
                    <div className="min-w-0 text-sm">
                      <p className="font-semibold text-ink">{match.appointment.patientName} <span className="font-normal text-slate-500">· {appointmentPickupLabel(match.appointment)} · {match.appointment.clinic}</span></p>
                      <p className="mt-1 text-xs text-slate-500">{match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} {match.matchedAppointment.patientName} ({match.matchedRequest.status}{match.matchedRequest.vehiclePlate ? ` · ${match.matchedRequest.vehiclePlate}` : ""}) · فارق {match.gapMinutes} د</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel tone="blue" icon={Truck} title="رحلات جارية" count={activeGroups.length} description="من إرسال السيارة حتى وصولها إلى الوجهة">
            {activeGroups.length ? (
              <div className="divide-y divide-slate-100">
                {activeGroups.map((trips) => (
                  <ActiveTrip
                    key={trips[0].request.groupId ?? trips[0].request.id}
                    trips={trips}
                    phase={groupPhase(trips.map((trip) => phases.get(trip.request.id)!))}
                    vehicle={vehicles.find((item) => item.plate === trips[0].request.vehiclePlate)}
                    driver={driverOf(trips[0].request.vehiclePlate, trips[0].request.driver)}
                    hospitals={hospitals}
                    onArrived={() => onArrived(trips.map((trip) => trip.request.id), "manual")}
                  />
                ))}
              </div>
            ) : <EmptyState icon={Truck} title="لا توجد رحلات جارية" />}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel
            tone="green"
            icon={CheckCircle2}
            title="وصول السيارات اليوم"
            count={arrivals.length}
            description="تصبح السيارة متاحة فور وصولها"
            actions={(
              <button
                onClick={toggleDeviceNotifications}
                aria-pressed={notifyDevice}
                aria-label={notifyDevice ? "إيقاف تنبيه الجهاز عند الوصول" : "تفعيل تنبيه الجهاز عند الوصول"}
                title={notifyDevice ? "تنبيه الجهاز مفعّل" : "تنبيه على الجهاز عند الوصول"}
                className={cx(btn(notifyDevice ? "success" : "secondary", "sm"), "w-9 px-0")}
              >
                {notifyDevice ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
              </button>
            )}
          >
            {arrivals.length ? (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {arrivals.map(({ request, at, source }) => {
                  const appointment = appointments.find((item) => item.id === request.appointmentId);
                  const destination = appointment ? tripEndpoints(appointment, request.direction, hospitals).destination : "";
                  return (
                    <li key={request.id} className="flex items-start gap-3 px-5 py-3">
                      <span dir="ltr" className="mt-0.5 w-12 shrink-0 text-sm font-semibold text-ink tabular">{timeLabel(at)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink"><span dir="ltr">{request.vehiclePlate}</span> · {driverOf(request.vehiclePlate, request.driver)}</p>
                        <p className="truncate text-xs text-slate-500">{destination}{appointment ? ` · ${appointment.patientName}` : ""}</p>
                      </div>
                      <Badge tone={source === "gps" ? "green" : source === "manual" ? "blue" : "neutral"} icon={source === "gps" ? Radio : source === "manual" ? CheckCircle2 : Timer}>
                        {source === "gps" ? "GPS" : source === "manual" ? "يدوي" : "تقديري"}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            ) : <EmptyState icon={Radio} title="لم تصل سيارات اليوم بعد" hint="مع GPS يُكتشف الوصول تلقائيًا، وبدونه تنتهي الرحلة عند الوقت المتوقع" />}
          </Panel>

          <Panel icon={CarFront} title="السيارات" count={vehicles.length} bodyClassName="p-0">
            <div className="border-b border-slate-100 px-4 py-3">
              <Segmented
                full
                label="تصفية السيارات"
                size="sm"
                value={vehicleFilter}
                onChange={setVehicleFilter}
                options={[
                  { value: "all", label: `الكل ${vehicleCounts.all}` },
                  { value: "available", label: `متاحة ${vehicleCounts.available}` },
                  { value: "busy", label: `في رحلة ${vehicleCounts.busy}` },
                  { value: "off", label: `موقوفة ${vehicleCounts.off}` },
                ]}
              />
            </div>
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {shownVehicles.map((vehicle) => {
                const state = availabilityText(vehicle);
                const live = liveGps.get(vehicle.plate);
                return (
                  <li key={vehicle.plate} className="flex items-center gap-3 px-4 py-3">
                    <Dot tone={state.tone} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink"><span dir="ltr">{vehicle.plate}</span> · {live?.driver ?? vehicle.driver}</p>
                      <p className="truncate text-xs text-slate-500">{vehicle.kind} · {state.text}{live ? " · GPS مباشر" : ""}</p>
                    </div>
                    <Switch
                      checked={vehicle.available}
                      label={vehicle.available ? `إيقاف السيارة ${vehicle.plate}` : `إتاحة السيارة ${vehicle.plate}`}
                      onChange={(available) => onUpdate(vehicles.map((item) => item.plate === vehicle.plate ? { ...item, available } : item))}
                    />
                  </li>
                );
              })}
              {!shownVehicles.length && <li><EmptyState icon={CarFront} title="لا توجد سيارات في هذا التصنيف" /></li>}
            </ul>
          </Panel>

          <Panel icon={History} title="آخر العمليات" description="السجل الكامل في الخريطة والإحصائيات">
            <RecentActivity limit={15} />
          </Panel>
        </aside>
      </div>
    </>
  );
}

function TripList({ trips, hospitals }: { trips: Trip[]; hospitals: Hospital[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {trips.map((trip) => (
        <li key={trip.request.id} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200/70">
          <p className="font-semibold text-ink">{trip.appointment.patientName} <span dir="ltr" className="font-medium text-slate-500 tabular">{trip.appointment.appointmentAt}</span></p>
          <p className="mt-0.5 text-slate-500">{appointmentPickupLabel(trip.appointment)} ← {trip.appointment.clinic}{matchHospitalZone(trip.appointment, hospitals) ? ` · ${matchHospitalZone(trip.appointment, hospitals)}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}

const STEPS = ["أُرسلت", "عند الاستلام", "في الطريق", "الوجهة"];

/** رحلة سيارة جارية: مرحلتها، والوقت المتوقع للوصول، ومتابعة GPS، ورسالة السائق. */
function ActiveTrip({ trips, phase, vehicle, driver, hospitals, onArrived }: {
  trips: Trip[];
  phase: TripPhase;
  vehicle?: Vehicle;
  driver: string;
  hospitals: Hospital[];
  onArrived: () => void;
}) {
  const plate = trips[0].request.vehiclePlate ?? "";
  const message = buildDriverMessage(trips, { plate, driver }, hospitals);
  const phone = vehicle?.phone;
  const seatsLeft = Math.min(...trips.map((trip) => groupCapacity(trip.appointment.kind))) - trips.length;
  const step = phase.kind === "toPickup" ? (phase.atPickup ? 1 : 0) : phase.kind === "toDestination" ? 2 : 3;
  const destinations = Array.from(new Set(trips.map((trip) => tripEndpoints(trip.appointment, trip.request.direction, hospitals).destination)));
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Truck className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink"><span dir="ltr">{plate}</span> · {driver}</p>
            <p className="truncate text-xs text-slate-500">{trips[0].request.direction} إلى {destinations.join("، ")}{trips.length > 1 ? ` · ${trips.length} ضيوف` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {phase.kind === "toDestination" && (phase.tracking ? <Badge tone="green" icon={Radio}>GPS مباشر</Badge> : <Badge icon={Timer}>وقت تقديري</Badge>)}
          {seatsLeft > 0 && phase.kind === "toPickup" && <Badge tone="green">{seatsLeft} مقعد متاح</Badge>}
          <StatusBadge status={trips[0].request.status} />
        </div>
      </div>

      <div className="mt-3"><Steps steps={STEPS} current={step} /></div>

      <ul className="mt-3 space-y-1 text-sm text-slate-600">
        {trips.map((trip) => (
          <li key={trip.request.id} className="flex flex-wrap gap-x-2">
            <span className="font-medium text-ink">{trip.appointment.patientName}</span>
            <span dir="ltr" className="text-slate-500 tabular">{trip.appointment.appointmentAt}</span>
            <span className="text-slate-500">{appointmentPickupLabel(trip.appointment)} ← {trip.appointment.clinic}</span>
          </li>
        ))}
      </ul>

      {phase.kind === "toDestination" && (
        <p className={cx("mt-3 flex flex-wrap items-center gap-x-2 rounded-lg px-3 py-2 text-sm", phase.late ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>
          <Timer className="h-4 w-4 shrink-0" />
          <span>الوصول المتوقع <span dir="ltr" className="font-semibold tabular">{timeLabel(phase.etaAt)}</span></span>
          <span className="text-slate-500">·</span>
          <span>{phase.late ? `متأخرة ${minutesText(-phase.minutesLeft)} عن الوقت المتوقع` : `بعد ${minutesText(phase.minutesLeft)}`}</span>
          {phase.tracking && <span className="text-xs text-slate-500">· يُسجَّل الوصول تلقائيًا عند اقتراب السيارة من الوجهة</span>}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {phone && <a href={whatsappLink(phone, message)} target="_blank" rel="noreferrer" className={cx(btn("secondary", "sm"), "text-emerald-700")}><MessageCircle className="h-4 w-4" /> واتساب</a>}
        {phone && <a href={`tel:${phone}`} className={btn("secondary", "sm")}><Phone className="h-4 w-4" /> اتصال</a>}
        <button onClick={() => navigator.clipboard?.writeText(message).then(() => toast.success("تم نسخ الرسالة"), () => toast.error("تعذر النسخ"))} className={btn("secondary", "sm")}><Copy className="h-4 w-4" /> نسخ الرسالة</button>
        {phase.kind === "toDestination" && (
          <button onClick={() => window.confirm(`تأكيد وصول السيارة ${plate} إلى الوجهة؟ ستصبح متاحة لرحلة جديدة.`) && onArrived()} className={btn("success", "sm")}><CheckCircle2 className="h-4 w-4" /> تأكيد الوصول</button>
        )}
      </div>
    </article>
  );
}
