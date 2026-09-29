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
  Navigation,
  PauseCircle,
  Phone,
  Plus,
  Radio,
  Send,
  Sparkles,
  Timer,
  Truck,
  Ribbon,
  Clock3,
  Wand2,
} from "lucide-react";
import {
  appointmentPickupLabel,
  assignVehicleForTrips,
  buildDriverMessage,
  buildTripGroups,
  findUnrequestedMatches,
  groupCapacity,
  isNonMedical,
  isPriority,
  isTransfer,
  localDateString,
  matchHospitalZone,
  needsAccessibleVehicle,
  planDispatch,
  routeLabel,
  suggestJoinDispatched,
  vehicleLoad,
  whatsappLink,
  type ClinicAppointment,
  type DispatchPlan,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import type { Hospital } from "@shared/hospitals";
import { arrivalsOn, neededAt, suggestReturnRedirects, tripEndpoints, tripPhase, vehicleAvailability, vehicleLocationState, type TripPhase } from "@shared/trips";
import {
  Badge,
  DateChooser,
  Dot,
  EmptyState,
  Modal,
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
import { NOTIFY_KEY, deviceNotificationsOn, useArrivalAlerts, useCancellationAlerts, useDenialAlerts, useRedirectAlerts } from "@/lib/arrivalAlerts";
import { checkStateText, driverCheck } from "@shared/driverChecks";

/**
 * from: الموعد الأول في النقل بين موعدين (الاستلام من مستشفاه).
 * outboundAt: وقت طلب الذهاب لنفس الموعد (مع رحلة العودة).
 */
/** at: متى يحتاج الضيف السيارة (من وقت الطلب ووقت الموعد)، لجمع الرحلات */
type Trip = { request: VehicleRequest; appointment: ClinicAppointment; from?: ClinicAppointment | null; outboundAt?: string; at?: Date };

/** وقت طلب السيارة من مشرف المبنى: للذهاب، وللعودة (ومعه وقت طلب الذهاب)، وللنقل بين موعدين. */
function requestTimes(trip: Trip) {
  const at = trip.request.createdAt;
  if (!at) return "";
  if (trip.from) return `طلب النقل ${at}`;
  if (trip.request.direction === "عودة") return `${trip.outboundAt ? `طلب الذهاب ${trip.outboundAt} · ` : ""}طلب العودة ${at}`;
  return `طلب الذهاب ${at}`;
}

/** كم مضى على الطلب (createdAt بصيغة HH:MM اليوم)، أو null إن لم يكن اليوم. */
function waitedText(createdAt: string, now: Date) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(createdAt);
  if (!match) return null;
  const minutes = now.getHours() * 60 + now.getMinutes() - (Number(match[1]) * 60 + Number(match[2]));
  if (minutes < 0 || minutes > 12 * 60) return null;
  return minutes < 1 ? "الآن" : `منذ ${minutesText(minutes)}`;
}

/** شارة الأولوية (حالة سرطان). */
const PriorityBadge = () => <Badge tone="red" icon={Ribbon}>أولوية · حالة سرطان</Badge>;
type VehicleFilter = "all" | "inside" | "outside" | "busy" | "off";

/** مرحلة رحلة سيارة كاملة (قد تحمل أكثر من مريض). */
function groupPhase(phases: TripPhase[]): TripPhase {
  const toPickup = phases.filter((phase) => phase.kind === "toPickup");
  if (toPickup.length) return { kind: "toPickup", atPickup: toPickup.every((phase) => phase.kind === "toPickup" && phase.atPickup) };
  const onRoad = phases.filter((phase): phase is Extract<TripPhase, { kind: "toDestination" }> => phase.kind === "toDestination");
  if (!onRoad.length) return phases[0];
  const last = onRoad.reduce((latest, phase) => (phase.etaAt > latest.etaAt ? phase : latest));
  return { ...last, tracking: onRoad.some((phase) => phase.tracking) };
}

const tripsText = (count: number) => (count === 0 ? "بلا رحلات اليوم" : count === 1 ? "رحلة اليوم" : count === 2 ? "رحلتان اليوم" : `${count} رحلات اليوم`);
const minutesText = (minutes: number) => (minutes <= 1 ? "دقيقة" : minutes <= 10 ? `${minutes} دقائق` : `${minutes} دقيقة`);

type DriverMessage = { vehicle: Vehicle; count: number; message: string };

export function FleetSupervisorPage({ vehicles, appointments, requests, date, onDateChange, onManager, onUpdate, onDispatch, onDispatchMany, onArrived, onExport, onAddTrip }: {
  vehicles: Vehicle[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  date: string;
  onDateChange: (date: string) => void;
  onManager: () => void;
  onUpdate: (vehicles: Vehicle[]) => void;
  onDispatch: (requestIds: string[], vehicle: Vehicle, joinRequestIds?: string[]) => void;
  onDispatchMany: (items: { requestIds: string[]; vehicle: Vehicle }[]) => DriverMessage[];
  onArrived: (requestIds: string[], source: "manual" | "estimate") => void;
  onExport: () => void;
  onAddTrip: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [addingTrip, setAddingTrip] = useState(false);
  const [selectedVehicles, setSelectedVehicles] = useState<Record<string, string>>({});
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>("all");
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [driverMessages, setDriverMessages] = useState<DriverMessage[] | null>(null);
  const hospitals = useHospitals();
  const now = useNow(15000);
  const today = localDateString(now);

  // السيارات التي يصل موقعها مباشرة الآن، واسم السائق الذي يقودها فعليًا
  const liveGps = useLiveVehicles(now);
  const gpsLive = (plate?: string) => Boolean(plate && liveGps.has(plate));
  const driverOf = (plate: string | undefined, fallback?: string) => (plate && liveGps.get(plate)?.driver) || fallback || vehicles.find((vehicle) => vehicle.plate === plate)?.driver || "";

  const withAppointment = (request: VehicleRequest): Trip | null => {
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    const from = request.fromAppointmentId ? appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null;
    const outboundAt = request.direction === "عودة"
      ? requests.filter((item) => item.appointmentId === request.appointmentId && item.direction === "ذهاب").at(-1)?.createdAt
      : undefined;
    return appointment ? { request, appointment, from, outboundAt, at: neededAt(request, appointment, hospitals) } : null;
  };
  const isTrip = (trip: Trip | null): trip is Trip => Boolean(trip);
  const onDate = (trip: Trip) => trip.appointment.appointmentDate === date;

  const pending = requests.filter((request) => request.status === "بانتظار التوزيع").map(withAppointment).filter(isTrip).filter(onDate);
  // حالات السرطان أولًا، ثم حسب وقت الموعد
  const pendingShown = [...pending].sort((a, b) => Number(isPriority(b.appointment)) - Number(isPriority(a.appointment))
    || a.appointment.appointmentAt.localeCompare(b.appointment.appointmentAt));
  const phases = new Map(requests.map((request) => [request.id, tripPhase(request, now, gpsLive(request.vehiclePlate))]));
  // الرحلات الجارية الآن (إلى الاستلام أو إلى الوجهة) مهما كان تاريخ الموعد
  const active = requests
    .filter((request) => ["toPickup", "toDestination"].includes(phases.get(request.id)!.kind))
    .map(withAppointment)
    .filter(isTrip);
  const availability = new Map(vehicles.map((vehicle) => [vehicle.plate, vehicleAvailability(vehicle.plate, requests, now, gpsLive(vehicle.plate))]));
  const isBusy = (plate: string) => Boolean(availability.get(plate)?.busy);
  const dispatchable = vehicles.filter((vehicle) => vehicle.available && !isBusy(vehicle.plate));
  // رحلات كل سيارة في اليوم المختار: السيارة الأقل رحلات تُقترح أولًا حتى يتوزع العمل
  const load = vehicleLoad(requests, appointments, date);

  // مكان كل سيارة: في رحلة، أو متاحة داخل المجمع، أو متاحة خارجه (عائدة من الوجهة)
  const locationStates = new Map(vehicles.map((vehicle) => {
    const gps = liveGps.get(vehicle.plate);
    return [vehicle.plate, vehicleLocationState(vehicle.plate, requests, appointments, hospitals, now, gps ? { lat: gps.lat, lng: gps.lng } : null)] as const;
  }));
  const isOutside = (plate: string) => locationStates.get(plate)?.kind === "outside";
  const placeText = (plate: string) => {
    const place = locationStates.get(plate);
    return place?.kind === "outside" ? `خارج المجمع${place.from ? ` (${place.from})` : ""}` : "داخل المجمع";
  };
  // سيارة خارج المجمع لم تقطع نصف طريق العودة تُوجَّه إلى أقرب ضيف ينتظر العودة (أي تاريخ)
  const pendingReturns = requests
    .filter((request) => request.status === "بانتظار التوزيع" && (request.direction === "عودة" || isTransfer(request)))
    .map(withAppointment)
    .filter(isTrip);
  const redirects = suggestReturnRedirects(pendingReturns, dispatchable, locationStates, hospitals);
  const redirectFor = new Map(redirects.map((item) => [item.request.id, item]));
  // تفضيل السيارة حسب مكانها: رحلة الذهاب تبدأ من المجمع (السيارات داخله أولًا)، والعودة تأخذ السيارة الموجَّهة إليها
  const transferIds = new Set(requests.filter(isTransfer).map((request) => request.id));
  const locationRank = (direction: VehicleRequest["direction"], requestIds: string[]) => (vehicle: Vehicle) => {
    // العودة والنقل بين موعدين يبدآن من مستشفى: السيارة الموجَّهة إليهما أولًا
    if (direction === "عودة" || requestIds.some((id) => transferIds.has(id))) return requestIds.some((id) => redirectFor.get(id)?.vehicle.plate === vehicle.plate) ? 0 : 1;
    return isOutside(vehicle.plate) ? 1 : 0;
  };
  const toPickupTrips = active.filter((trip) => phases.get(trip.request.id)!.kind === "toPickup");

  // النقل بين موعدين يبدأ من مستشفى، فلا يُجمع مع رحلات تبدأ من المجمع
  const groupable = pending.filter((trip) => !isTransfer(trip.request));
  // الجمع حسب وقت الحاجة إلى السيارة (وقت الطلب)، لا وقت الموعد وحده
  const groups = buildTripGroups(groupable.map((trip) => ({ appointment: trip.appointment, direction: trip.request.direction, at: trip.at })), hospitals);
  const groupedIds = new Set(groups.flatMap((group) => group.appointmentIds));
  const joins = suggestJoinDispatched(groupable.filter((trip) => !groupedIds.has(trip.appointment.id)), toPickupTrips.filter((trip) => onDate(trip) && !isTransfer(trip.request)), hospitals);
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
  useDenialAlerts({ requests, appointments });
  useRedirectAlerts({ redirects, driverOf, onDispatch: redirectVehicle });
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
    const suggested = assignVehicleForTrips(dispatchable, [trip.appointment], load, locationRank(trip.request.direction, [trip.request.id]));
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
    const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment), load, locationRank(members[0]?.request.direction ?? "ذهاب", members.map((trip) => trip.request.id)));
    if (!vehicle || members.length < 2) {
      toast.error("لا توجد سيارة مناسبة ومتاحة لجمع هذه الرحلات");
      return;
    }
    onDispatch(members.map((trip) => trip.request.id), vehicle);
  }

  /** توجيه سيارة خارج المجمع إلى ضيف ينتظر العودة (من القائمة أو من زر التنبيه). */
  function redirectVehicle(redirect: { request: VehicleRequest; vehicle: Vehicle }) {
    const stillPending = requests.some((request) => request.id === redirect.request.id && request.status === "بانتظار التوزيع");
    if (!stillPending || !dispatchable.some((vehicle) => vehicle.plate === redirect.vehicle.plate)) {
      toast.error("تغيّر الطلب أو السيارة منذ التنبيه، راجع القائمة");
      return;
    }
    onDispatch([redirect.request.id], redirect.vehicle);
  }

  function joinTrip(requestId: string, plate: string, groupId?: string) {
    const vehicle = vehicles.find((item) => item.plate === plate);
    if (!vehicle) return;
    const partners = toPickupTrips.filter((trip) => trip.request.vehiclePlate === plate && (groupId ? trip.request.groupId === groupId : !trip.request.groupId)).map((trip) => trip.request.id);
    onDispatch([requestId], vehicle, partners);
  }

  // أقرب سيارة مناسبة تتفرغ (لرحلة لا توجد لها سيارة متاحة الآن)
  function nextFree(appointments: ClinicAppointment[]) {
    const accessible = needsAccessibleVehicle(appointments);
    const soonest = vehicles
      .filter((vehicle) => vehicle.available && isBusy(vehicle.plate) && (!accessible || vehicle.kind === "احتياجات خاصة"))
      .flatMap((vehicle) => {
        const until = availability.get(vehicle.plate)?.until;
        return until ? [{ vehicle, until }] : [];
      })
      .sort((a, b) => a.until.getTime() - b.until.getTime())[0];
    return soonest ? `أقرب سيارة تتفرغ ${timeLabel(soonest.until)} (${soonest.vehicle.plate})` : "لا توجد سيارة مناسبة متاحة الآن";
  }

  function confirmPlan(items: { requestIds: string[]; vehicle: Vehicle }[]) {
    // السيارة قد تكون انشغلت أو الطلب قد وُزّع من جهاز آخر بعد فتح الخطة
    const stillPending = new Set(pending.map((trip) => trip.request.id));
    const valid = items.filter((item) => dispatchable.some((vehicle) => vehicle.plate === item.vehicle.plate) && item.requestIds.every((id) => stillPending.has(id)));
    if (valid.length < items.length) toast.warning("تغيّرت بعض الطلبات أو السيارات منذ فتح الخطة، فأُرسل الباقي فقط");
    setPlan(null);
    if (!valid.length) return;
    const messages = onDispatchMany(valid);
    toast.success(`تم إرسال ${valid.length} سيارة`);
    setDriverMessages(messages);
  }

  const availabilityText = (vehicle: Vehicle) => {
    if (!vehicle.available) return { tone: "neutral" as const, text: "خارج الخدمة" };
    const state = availability.get(vehicle.plate);
    if (!state?.busy) {
      const place = locationStates.get(vehicle.plate);
      if (place?.kind === "outside") {
        return { tone: "cyan" as const, text: `متاحة خارج المجمع · عائدة من ${place.from || "الوجهة"} · تصل ${timeLabel(place.backAt)}${place.canRedirect ? "" : " · قطعت نصف الطريق"}` };
      }
      return { tone: "green" as const, text: "متاحة داخل المجمع" };
    }
    if (state.toPickup) return { tone: "blue" as const, text: "في الطريق إلى الاستلام" };
    return { tone: "blue" as const, text: state.until ? `في رحلة · تتفرغ ${timeLabel(state.until)}` : "في رحلة" };
  };
  const vehicleCounts = {
    all: vehicles.length,
    inside: dispatchable.filter((vehicle) => !isOutside(vehicle.plate)).length,
    outside: dispatchable.filter((vehicle) => isOutside(vehicle.plate)).length,
    busy: vehicles.filter((vehicle) => vehicle.available && isBusy(vehicle.plate)).length,
    off: vehicles.filter((vehicle) => !vehicle.available).length,
  };
  const shownVehicles = vehicles.filter((vehicle) => vehicleFilter === "all"
    || (vehicleFilter === "inside" && vehicle.available && !isBusy(vehicle.plate) && !isOutside(vehicle.plate))
    || (vehicleFilter === "outside" && vehicle.available && !isBusy(vehicle.plate) && isOutside(vehicle.plate))
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
        <Stat icon={CheckCircle2} tone="green" label="سيارات متاحة" value={dispatchable.length} hint={`${vehicleCounts.inside} داخل المجمع · ${vehicleCounts.outside} خارجه`} />
        <Stat icon={PauseCircle} tone="neutral" label="خارج الخدمة" value={vehicleCounts.off} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {redirects.length > 0 && (
            <Panel tone="violet" icon={Navigation} title="توجيه سيارات خارج المجمع" count={redirects.length} description="سيارة عائدة من وجهتها لم تقطع نصف الطريق إلى المجمع، وهي أقرب إلى ضيف ينتظر العودة من المجمع">
              <div className="divide-y divide-slate-100">
                {redirects.map((item) => (
                  <div key={item.request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">
                        <span dir="ltr">{item.vehicle.plate}</span> · {driverOf(item.vehicle.plate, item.vehicle.driver)} ← {item.appointment.patientName}
                        {item.appointment.kind === "احتياجات خاصة" && <Badge tone="amber" className="ms-2">احتياجات خاصة</Badge>}
                      </p>
                      <p className="mt-0.5 text-sm text-slate-600">عائدة من {item.from || "الوجهة"} · الضيف في {item.pickup} على بعد {item.distanceKm} كم</p>
                    </div>
                    <button onClick={() => redirectVehicle(item)} className={btn("primary")}><Navigation className="h-4 w-4" /> توجيه السيارة</button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel
            tone="amber"
            icon={BellRing}
            title="طلبات بانتظار التوزيع"
            count={pending.length}
            description="اختر السيارة المناسبة ثم أرسلها، أو وزّع الكل تلقائيًا على السيارات المتاحة"
            actions={pending.length > 0 && (
              <button
                disabled={!dispatchable.length}
                onClick={() => setPlan(planDispatch(pending, dispatchable, load, hospitals, (unit, vehicle) => locationRank(unit.direction, unit.requestIds)(vehicle)))}
                title={dispatchable.length ? "توزيع الطلبات على السيارات المتاحة بالتساوي" : "لا توجد سيارة متاحة الآن"}
                className={btn("primary", "sm")}
              >
                <Wand2 className="h-4 w-4" /> توزيع تلقائي
              </button>
            )}
          >
            {pending.length ? (
              <div className="divide-y divide-slate-100">
                {pendingShown.map((trip) => {
                  const suggested = assignVehicleForTrips(dispatchable, [trip.appointment], load, locationRank(trip.request.direction, [trip.request.id]));
                  const redirect = redirectFor.get(trip.request.id);
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
                            {trip.from ? <Badge tone="cyan">نقل بين موعدين</Badge> : <Badge tone={trip.request.direction === "عودة" ? "amber" : "neutral"}>{trip.request.direction}</Badge>}
                            {isNonMedical(trip.appointment) && <Badge tone="violet">غير طبية</Badge>}
                            {isPriority(trip.appointment) && <PriorityBadge />}
                            {groupedIds.has(trip.appointment.id) && <Badge tone="violet" icon={Sparkles}>قابلة للجمع</Badge>}
                            {redirect && <Badge tone="cyan" icon={Navigation}>سيارة قريبة {redirect.vehicle.plate} · {redirect.distanceKm} كم</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{routeLabel(trip.appointment, trip.from)}{zone && <span className="text-slate-400"> · {zone}</span>}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{trip.appointment.kind}{trip.appointment.gender ? ` · ${trip.appointment.gender}` : ""}{trip.appointment.assistance.length ? ` · ${trip.appointment.assistance.join("، ")}` : ""}</p>
                          {trip.request.createdAt && (
                            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs font-medium text-amber-800">
                              <Clock3 className="h-3.5 w-3.5" /> {requestTimes(trip)}
                              {waitedText(trip.request.createdAt, now) && <span className="font-normal text-amber-700">· {waitedText(trip.request.createdAt, now)}</span>}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row lg:w-[360px]">
                        <select aria-label="السيارة" value={ready.some((vehicle) => vehicle.plate === selectedPlate) ? selectedPlate : ""} onChange={(event) => setSelectedVehicles((current) => ({ ...current, [trip.request.id]: event.target.value }))} className={cx(inputClass, "h-10 min-w-0 flex-1")}>
                          {!ready.length && <option value="">لا توجد سيارة متاحة</option>}
                          {ready.map((vehicle) => <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {driverOf(vehicle.plate)} · {vehicle.kind} · {placeText(vehicle.plate)} · {tripsText(load.get(vehicle.plate) ?? 0)}</option>)}
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
                  const vehicle = assignVehicleForTrips(dispatchable, members.map((trip) => trip.appointment), load, locationRank(members[0]?.request.direction ?? "ذهاب", members.map((trip) => trip.request.id)));
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
                  { value: "inside", label: `داخل ${vehicleCounts.inside}` },
                  { value: "outside", label: `خارج ${vehicleCounts.outside}` },
                  { value: "busy", label: `رحلة ${vehicleCounts.busy}` },
                  { value: "off", label: `موقوف ${vehicleCounts.off}` },
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
                      <p className="text-xs leading-5 text-slate-500">{vehicle.kind} · {state.text}{live ? " · GPS مباشر" : ""}</p>
                    </div>
                    <div className="shrink-0 text-center" title="رحلات اليوم المختار">
                      <p className="text-sm font-semibold text-ink tabular">{load.get(vehicle.plate) ?? 0}</p>
                      <p className="text-[11px] leading-none text-slate-400">رحلة</p>
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

      {plan && <AutoDispatchDialog plan={plan} free={dispatchable} load={load} driverOf={driverOf} placeText={placeText} nextFree={nextFree} onConfirm={confirmPlan} onClose={() => setPlan(null)} />}
      {driverMessages && <DriverMessagesDialog messages={driverMessages} driverOf={driverOf} onClose={() => setDriverMessages(null)} />}
    </>
  );
}

function TripList({ trips, hospitals }: { trips: Trip[]; hospitals: Hospital[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {trips.map((trip) => (
        <li key={trip.request.id} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200/70">
          <p className="font-semibold text-ink">{trip.appointment.patientName} <span dir="ltr" className="font-medium text-slate-500 tabular">{trip.appointment.appointmentAt}</span>{isPriority(trip.appointment) && <span className="ms-1.5 text-red-700">· أولوية</span>}</p>
          <p className="mt-0.5 text-slate-500">{routeLabel(trip.appointment, trip.from)}{matchHospitalZone(trip.appointment, hospitals) ? ` · ${matchHospitalZone(trip.appointment, hospitals)}` : ""}</p>
          {trip.request.createdAt && <p className="mt-0.5 text-slate-400">{requestTimes(trip)}</p>}
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
  const destinations = Array.from(new Set(trips.map((trip) => tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from).destination)));
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Truck className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink"><span dir="ltr">{plate}</span> · {driver}</p>
            <p className="truncate text-xs text-slate-500">{trips[0].from ? `نقل من ${trips[0].from.clinic}` : trips[0].request.direction} إلى {destinations.join("، ")}{trips.length > 1 ? ` · ${trips.length} ضيوف` : ""}</p>
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
            <span className="text-slate-500">{routeLabel(trip.appointment, trip.from)}</span>
            {isPriority(trip.appointment) && <span className="font-medium text-red-700">· أولوية</span>}
            {trip.request.createdAt && <span className="text-slate-400">· {requestTimes(trip)}</span>}
            {(["arrival", "pickup"] as const).map((kind) => {
              // ما سجّله السائق من تطبيقه ورد مشرف المبنى عليه
              const check = driverCheck(trip.request, kind);
              return check && <span key={kind} className={cx("w-full text-xs", check.state === "denied" ? "font-semibold text-red-700" : check.state === "pending" ? "text-amber-700" : "text-slate-400")}>{checkStateText(check)}</span>;
            })}
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

/**
 * خطة التوزيع التلقائي قبل الإرسال: كل رحلة وسيارتها المقترحة (الأقل رحلات اليوم)، ويمكن تغيير السيارة
 * أو استبعاد رحلة، ثم تُرسل كل السيارات معًا.
 */
function AutoDispatchDialog({ plan, free, load, driverOf, placeText, nextFree, onConfirm, onClose }: {
  plan: DispatchPlan;
  free: Vehicle[];
  load: Map<string, number>;
  driverOf: (plate?: string, fallback?: string) => string;
  placeText: (plate: string) => string;
  nextFree: (appointments: ClinicAppointment[]) => string;
  onConfirm: (items: { requestIds: string[]; vehicle: Vehicle }[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => plan.assignments.map((item) => ({ ...item, plate: item.vehicle.plate, include: true })));
  const chosen = rows.filter((row) => row.include);
  const used = new Map<string, number>();
  chosen.forEach((row) => used.set(row.plate, (used.get(row.plate) ?? 0) + 1));
  const conflict = Array.from(used.values()).some((count) => count > 1);
  const update = (index: number, change: Partial<(typeof rows)[number]>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const names = (appointments: ClinicAppointment[]) => appointments.map((appointment) => appointment.patientName).join("، ");
  const destinations = (appointments: ClinicAppointment[]) => Array.from(new Set(appointments.map((appointment) => appointment.clinic))).join("، ");

  return (
    <Modal
      tone="violet"
      icon={Wand2}
      title="التوزيع التلقائي"
      description="كل رحلة على السيارة المناسبة الأقل رحلات اليوم، والرحلات القابلة للجمع في سيارة واحدة. راجع الخطة ثم أرسل."
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button
            type="button"
            disabled={!chosen.length || conflict}
            onClick={() => onConfirm(chosen.map((row) => ({ requestIds: row.requestIds, vehicle: free.find((vehicle) => vehicle.plate === row.plate)! })))}
            className={btn("primary")}
          >
            <Send className="h-4 w-4" /> إرسال {chosen.length} {chosen.length === 1 ? "سيارة" : "سيارات"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        {conflict && <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" /> نفس السيارة مختارة لأكثر من رحلة</p>}
        {rows.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {rows.map((row, index) => {
              const accessible = needsAccessibleVehicle(row.appointments);
              const options = free.filter((vehicle) => !accessible || vehicle.kind === "احتياجات خاصة");
              const first = [...row.appointments].sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))[0];
              return (
                <li key={row.requestIds.join()} className={cx("space-y-2 p-3", !row.include && "opacity-50")}>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={row.include} onChange={(event) => update(index, { include: event.target.checked })} className="mt-1 h-4 w-4 accent-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span dir="ltr" className="font-semibold text-ink tabular">{first.appointmentAt}</span>
                        <span className="font-medium text-ink">{names(row.appointments)}</span>
                        {row.appointments.length > 1 && <Badge tone="violet" icon={Sparkles}>مجمّعة {row.appointments.length}</Badge>}
                        {accessible && <Badge tone="amber">احتياجات خاصة</Badge>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{destinations(row.appointments)}</span>
                    </span>
                  </label>
                  <select
                    aria-label={`سيارة رحلة ${names(row.appointments)}`}
                    value={row.plate}
                    disabled={!row.include}
                    onChange={(event) => update(index, { plate: event.target.value })}
                    className={cx(inputClass, "h-10 w-full", row.include && (used.get(row.plate) ?? 0) > 1 && "border-red-400 bg-red-50")}
                  >
                    {options.map((vehicle) => (
                      <option key={vehicle.plate} value={vehicle.plate}>{vehicle.plate} · {driverOf(vehicle.plate, vehicle.driver)} · {vehicle.kind} · {placeText(vehicle.plate)} · {tripsText(load.get(vehicle.plate) ?? 0)}</option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        ) : <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">لا توجد سيارة مناسبة متاحة الآن</p>}

        {plan.waiting.length > 0 && (
          <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-800"><Timer className="h-4 w-4" /> بانتظار سيارة ({plan.waiting.length})</p>
            <ul className="mt-2 space-y-1.5 text-sm text-amber-900">
              {plan.waiting.map((item) => (
                <li key={item.requestIds.join()}>
                  <span dir="ltr" className="tabular">{item.appointments[0].appointmentAt}</span> · {names(item.appointments)}
                  <span className="block text-xs text-amber-700">{nextFree(item.appointments)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** رسائل السائقين بعد التوزيع التلقائي: زر واتساب لكل سيارة. */
function DriverMessagesDialog({ messages, driverOf, onClose }: {
  messages: DriverMessage[];
  driverOf: (plate?: string, fallback?: string) => string;
  onClose: () => void;
}) {
  const [opened, setOpened] = useState<Set<string>>(new Set());
  return (
    <Modal
      tone="green"
      icon={MessageCircle}
      title="رسائل السائقين"
      description="أُرسلت السيارات. أرسل لكل سائق رسالته عبر واتساب."
      onClose={onClose}
      footer={<button type="button" onClick={onClose} className={btn("primary")}>تم</button>}
    >
      <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
        {messages.map(({ vehicle, count, message }) => (
          <li key={vehicle.plate} className="flex flex-wrap items-center gap-2 p-3">
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink"><span dir="ltr">{vehicle.plate}</span> · {driverOf(vehicle.plate, vehicle.driver)}</span>
              <span className="text-xs text-slate-500">{count > 1 ? `رحلة مجمّعة · ${count} ضيوف` : "ضيف واحد"}</span>
            </span>
            {vehicle.phone && (
              <a
                href={whatsappLink(vehicle.phone, message)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpened((current) => new Set(current).add(vehicle.plate))}
                className={cx(btn("secondary", "sm"), opened.has(vehicle.plate) ? "text-slate-500" : "text-emerald-700")}
              >
                {opened.has(vehicle.plate) ? <CheckCircle2 className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />} واتساب
              </a>
            )}
            <button type="button" onClick={() => navigator.clipboard?.writeText(message).then(() => toast.success("تم نسخ الرسالة"), () => toast.error("تعذر النسخ"))} className={btn("ghost", "sm")}><Copy className="h-4 w-4" /> نسخ</button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
