import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BriefcaseMedical,
  BellRing,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Download,
  Flag,
  Layers,
  Minus,
  Pencil,
  Trash2,
  History,
  Link2,
  MapPin,
  MessageCircle,
  Navigation,
  UsersRound,
  Phone,
  Plus,
  Radio,
  Repeat,
  Send,
  Sparkles,
  Timer,
  Truck,
  UserCog,
  UserMinus,
  UserPlus,
  Ribbon,
  Clock3,
  Wand2,
  School,
  CalendarClock,
} from "lucide-react";
import {
  BUS_ROLES,
  SHARED_BUS_ROLES,
  SCHOOL_ROLE,
  isSchoolCar,
  reservedRun,
  reservedSoon,
  reservedSoonWarning,
  reservedText,
  scheduleOf,
  scheduleText,
  scheduledRoleOf,
  vehicleRoleOf,
  BUS_ROLE_LABELS,
  CHANGE_VEHICLE_REASONS,
  REMOVE_FROM_TRIP_REASONS,
  VEHICLE_FAULT_REASONS,
  appointmentDateTime,
  appointmentPickupLabel,
  assignVehicleForTrips,
  buildDriverMessage,
  buildTripGroups,
  busRoleOf,
  calculateTripGroupingScore,
  canShareVehicle,
  findUnrequestedMatches,
  hasDriver,
  isApproved,
  isNonMedical,
  nonMedicalOpen,
  isPriority,
  isReturnOnly,
  regularForSpecialWarning,
  isRushHour,
  isTransfer,
  transferSource,
  transferLabels,
  localDateString,
  matchHospitalZone,
  needsAccessibleVehicle,
  personsText,
  planDispatch,
  requestPersons,
  RETURN_ONLY_LABEL,
  routeLabel,
  seatsFor,
  groupSeats,
  mergeVehicle,
  stoppableSeriesTrips,
  suggestJoinDispatched,
  vehicleLoad,
  vehicleRestriction,
  vehicleSeats,
  whatsappLink,
  type BusRole,
  type ClinicAppointment,
  type DispatchPlan,
  type RoleSchedules,
  type ScheduledRole,
  type Vehicle,
  type VehicleRequest,
  type VehicleRules,
} from "@shared/transport";
import type { Hospital } from "@shared/hospitals";
import { assignDrivers, shortDriverName } from "@shared/drivers";
import { LATE_MINUTES, arrivalsOn, incomingCars, minutesSince, neededAt, returningText, suggestReturnPickups, suggestReturnRedirects, tripEndpoints, tripPhase, vehicleAvailability, vehicleLocationState, type IncomingCar, type TripPhase, type VehicleLocationState } from "@shared/trips";
import {
  Badge,
  DateChooser,
  Dot,
  EmptyState,
  Modal,
  Panel,
  PageHeader,
  Segmented,
  StatusBadge,
  StatusBar,
  Steps,
  Switch,
  TimeBlock,
  btn,
  choiceClass,
  cx,
  formatDay,
  inputClass,
  labelClass,
  longDate,
  stamp,
  timeLabel,
  type Tone,
} from "@/components/ui-kit";
import NonMedicalTripForm from "./NonMedicalTripForm";
import { RecentActivity } from "@/components/ActivityLog";
import { AppointmentsOverview } from "@/components/AppointmentsOverview";
import { KindIcon, KindLabel, VehiclePicker } from "@/components/VehiclePicker";
import DriverAssignment from "@/components/DriverAssignment";
import RoleSchedulesDialog from "@/components/RoleSchedulesDialog";
import AddVehicleDialog from "@/components/AddVehicleDialog";
import { saveState } from "@/lib/appStore";
import { reveal } from "@/lib/notify";
import GuestContact from "@/components/GuestContact";
import { useDrivers, useGuests, useHospitals, useLiveVehicles, useNow, useSchedules, useSharedState } from "@/lib/useShared";
import { locationFreshness, type VehicleLocation } from "@/lib/vehicleLocation";
import { NOTIFY_KEY, deviceNotificationsOn, useArrivalAlerts, useCancellationAlerts, useDenialAlerts, useRedirectAlerts } from "@/lib/arrivalAlerts";
import { checkStateText, driverCheck } from "@shared/driverChecks";

/**
 * from: الموعد الأول في النقل بين موعدين (الاستلام من مستشفاه).
 * outboundAt: وقت طلب الذهاب لنفس الموعد (مع رحلة العودة).
 */
/** at: متى يحتاج الضيف السيارة (من وقت الطلب ووقت الموعد)، لجمع الرحلات */
/** persons: عدد الأشخاص في الرحلة (الضيف ومرافقه والـ Nurse، أو الـ Nurse وحدها في عودتها) */
type Trip = { request: VehicleRequest; appointment: ClinicAppointment; from?: ClinicAppointment | null; outboundAt?: string; at?: Date; persons: number };

const sumPersons = (trips: Pick<Trip, "persons">[]) => trips.reduce((total, trip) => total + trip.persons, 0);

/** من يركب: الضيف، أو الـ Nurse وحدها في «عودة الـ Nurse فقط» */
const riderName = (trip: Pick<Trip, "request" | "appointment">) => (trip.request.nurseOnly ? `الـ Nurse · ${trip.appointment.patientName}`
  : trip.appointment.nurse ? `${trip.appointment.patientName} (ممرضة)` : trip.appointment.patientName);

/** نوع الرحلة والجنس والاحتياجات وعدد الأشخاص (مع المرافق والـ Nurse) */
function riderDetails(trip: Trip) {
  if (trip.request.nurseOnly) return "الـ Nurse وحدها · شخص واحد · يبقى الضيف في موعده";
  const { kind, gender, assistance } = trip.appointment;
  return [kind, gender, assistance.join("، "), trip.persons > 1 ? personsText(trip.persons) : ""].filter(Boolean).join(" · ");
}

/** الطلب محجوز في يوم قبل يومه (رحلة متكررة أو رحلة ليوم قادم) */
const bookedAhead = (request: VehicleRequest) => Boolean(request.requestedOn && request.requestedOn < localDateString());

/** وقت طلب السيارة من مشرف المبنى: للذهاب، وللعودة (ومعه وقت طلب الذهاب)، وللنقل بين موعدين. */
/** أوقات الطلب ومن طلبه (اسم مشرف المبنى أو مسؤولهم، أو مسؤول العيادة للممرضة) */
function requestTimes(trip: Trip) {
  const times = requestTimeText(trip);
  return times && trip.request.requestedByName ? `${times} · طلبه ${trip.request.requestedByName}` : times;
}

function requestTimeText(trip: Trip) {
  const at = trip.request.createdAt;
  if (!at) return "";
  // العودة التلقائية للرحلة غير الطبية: أنشأها الخادم، والضيف جاهز في وقتها
  if (trip.request.autoReturn) return `عودة تلقائية ${at}${trip.outboundAt ? ` · طلب الذهاب ${trip.outboundAt}` : ""}`;
  // حجز مسبق: يوم الحجز ووقته (السيارة مطلوبة في يوم الرحلة من وقت الانطلاق)
  if (trip.request.requestedOn && trip.request.requestedOn < trip.appointment.appointmentDate) {
    return `حُجزت مسبقًا ${trip.request.requestedOn.slice(8, 10)}-${trip.request.requestedOn.slice(5, 7)} ${at}`;
  }
  if (trip.from) return `طلب النقل ${at}`;
  // طلب العودة فقط من المستشفى: بلا رحلة ذهاب
  if (trip.request.direction === "عودة") return `${isReturnOnly(trip.appointment) ? `${RETURN_ONLY_LABEL} · ` : trip.outboundAt ? `طلب الذهاب ${trip.outboundAt} · ` : ""}طلب العودة ${at}`;
  return `طلب الذهاب ${at}`;
}

/** كم مضى على الطلب (createdAt بصيغة HH:MM اليوم)، أو null إن لم يكن اليوم. */
function waitedText(createdAt: string, now: Date) {
  const minutes = minutesSince(createdAt, now);
  if (minutes === null) return null;
  return minutes < 1 ? "الآن" : `منذ ${minutesText(minutes)}`;
}

/** شارة الأولوية (حالة سرطان). */
const PriorityBadge = () => <Badge tone="red" icon={Ribbon}>أولوية · حالة سرطان</Badge>;
/** reserved: غير مخصصة للمواعيد (باص العيادة وباص المجمع، وسيارة المدارس وباص الجامعة في أوقاتهما) */
type VehicleFilter = "all" | "inside" | "outside" | "busy" | "reserved" | "off";

/** مرحلة رحلة سيارة كاملة (قد تحمل أكثر من مريض). */
function groupPhase(phases: TripPhase[]): TripPhase {
  const toPickup = phases.filter((phase) => phase.kind === "toPickup");
  if (toPickup.length) return { kind: "toPickup", atPickup: toPickup.every((phase) => phase.kind === "toPickup" && phase.atPickup) };
  const onRoad = phases.filter((phase): phase is Extract<TripPhase, { kind: "toDestination" }> => phase.kind === "toDestination");
  if (!onRoad.length) return phases[0];
  const last = onRoad.reduce((latest, phase) => (phase.etaAt > latest.etaAt ? phase : latest));
  return { ...last, tracking: onRoad.some((phase) => phase.tracking) };
}

/** عدد الضيوف: ضيف واحد، ضيفان، 3 ضيوف، 11 ضيفًا */
const guestsText = (count: number) => (count === 1 ? "ضيف واحد" : count === 2 ? "ضيفان" : count <= 10 ? `${count} ضيوف` : `${count} ضيفًا`);
const tripsText = (count: number) => (count === 0 ? "بلا رحلات اليوم" : count === 1 ? "رحلة اليوم" : count === 2 ? "رحلتان اليوم" : `${count} رحلات اليوم`);
const minutesText = (minutes: number) => (minutes <= 1 ? "دقيقة" : minutes <= 10 ? `${minutes} دقائق` : `${minutes} دقيقة`);

type DriverMessage = { vehicle: Vehicle; count: number; message: string };

/** تخصيص الباص («باص المجمع»...) إن وُجد */
const roleOf = (vehicle: Vehicle) => (vehicleRoleOf(vehicle) ? BUS_ROLE_LABELS[vehicleRoleOf(vehicle)!] : undefined);

/** خيار سيارة لرحلة: متاحة لها الآن، أو غير متاحة مع السبب (مشغولة، أو قاعدة الباصات والمقاعد) */
/**
 * why: لا تناسب الرحلة (معطّلة)، warning: تناسبها بعد موافقة المشرف (regular: سيارة عادية لضيف احتياجات خاصة،
 * reserved: سيارة المدارس أو باص الجامعة يخرج لوقته المحجوز خلال ساعة)
 */
type VehicleChoice = { vehicle: Vehicle; why: string | null; warning?: string | null; regular?: boolean; reserved?: boolean };

export function FleetSupervisorPage({ vehicles, appointments, requests, date, onDateChange, onManager, onUpdate, onDispatch, onDispatchMany, onArrived, onEndTrip, onChangeVehicle, onRemoveFromTrip, onAddToTrip, onExport, onAddTrips, onStopSeries, onEditTrip, onDeleteTrip }: {
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
  /** إنهاء رحلة عالقة قبل تسجيل الاستلام (تصبح السيارة متاحة) */
  onEndTrip: (requestIds: string[]) => void;
  /** سيارة أخرى لرحلة أُرسلت لها سيارة (عطل أو حادث أو تأخر)، مع السبب وإيقاف السابقة. يعيد رسالة السائق الجديد */
  onChangeVehicle: (requestIds: string[], vehicle: Vehicle, reason: string, stopOld: boolean) => DriverMessage[];
  /** إزالة ضيف من رحلة جارية (لم يركب أو سُجّل استلامه خطأً): يعود طلبه إلى «بانتظار التوزيع» */
  onRemoveFromTrip: (requestId: string, reason: string) => void;
  /** ضم ضيف ينتظر السيارة إلى رحلة جارية (استلمه السائق أو سيستلمه). يعيد رسالة السائق */
  onAddToTrip: (requestId: string, tripRequestIds: string[], vehicle: Vehicle, pickedUp: boolean) => DriverMessage[];
  onExport: () => void;
  /** رحلة غير طبية مع طلب سيارتها، أو رحلات متكررة بلا طلب (يطلبها مشرف المبنى في يومها)، في حفظ واحد */
  onAddTrips: (trips: { appointment: ClinicAppointment; request?: VehicleRequest }[]) => void;
  /** إيقاف رحلات متكررة قادمة لم تُرسل سيارتها: تُلغى بالسبب ويُحذف طلبها */
  onStopSeries: (appointmentIds: string[], reason: string) => void;
  /** تعديل رحلة غير طبية لم تُرسل سيارتها، أو حذفها مع طلبها */
  onEditTrip: (appointment: ClinicAppointment) => void;
  onDeleteTrip: (appointment: ClinicAppointment) => void;
}) {
  const [addingTrip, setAddingTrip] = useState(false);
  /** رحلة غير طبية قيد التعديل (قبل إرسال سيارتها) */
  const [editingTrip, setEditingTrip] = useState<ClinicAppointment | null>(null);
  const [selectedVehicles, setSelectedVehicles] = useState<Record<string, string>>({});
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>("all");
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [driverMessages, setDriverMessages] = useState<DriverMessage[] | null>(null);
  /** نافذة تعديل رحلة مجمّعة: الطلبات المختارة فيها أولًا */
  const [editing, setEditing] = useState<string[] | null>(null);
  /** توزيع السيارات، أو كل المواعيد للعرض فقط */
  const [view, setView] = useState<"dispatch" | "appointments">("dispatch");
  /** السيارة المعروضة تفاصيلها (الضغط عليها في قائمة السيارات) */
  const [shownPlate, setShownPlate] = useState<string | null>(null);
  /** نافذة تغيير سيارة رحلة جارية (عطل أو حادث أو تأخر) */
  const [changing, setChanging] = useState<Trip[] | null>(null);
  /** إزالة ضيف من رحلة جارية، وإضافة ضيف إليها */
  const [removing, setRemoving] = useState<{ trip: Trip; alone: boolean } | null>(null);
  // إيقاف رحلة متكررة: هذه الرحلة وحدها، أو هي وما بعدها
  const [stopping, setStopping] = useState<ClinicAppointment | null>(null);
  const [adding, setAdding] = useState<Trip[] | null>(null);
  /** نافذة السائقين في السيارات (بداية الشفت)، ومعها نص البحث الأول (رقم سيارة من تفاصيلها) */
  const [assigning, setAssigning] = useState<string | null>(null);
  /** نافذة أوقات سيارات المدارس وباص الجامعة */
  const [editingSchedules, setEditingSchedules] = useState(false);
  /** نافذة إضافة سيارة جديدة */
  const [addingVehicle, setAddingVehicle] = useState(false);
  const drivers = useDrivers();
  const schedules = useSchedules();
  const hospitals = useHospitals();
  const now = useNow(15000);
  const today = localDateString(now);
  // قواعد السيارات الآن: باص المجمع وقت الذروة، وأوقات المدارس وباص الجامعة
  const rules: VehicleRules = { now, hospitals, schedules };

  // السيارات التي يصل موقعها مباشرة الآن، واسم السائق الذي يقودها فعليًا
  const liveGps = useLiveVehicles(now);
  const gpsLive = (plate?: string) => Boolean(plate && liveGps.has(plate));
  const driverOf = (plate: string | undefined, fallback?: string) => (plate && liveGps.get(plate)?.driver) || fallback || vehicles.find((vehicle) => vehicle.plate === plate)?.driver || "";

  // رحلة تبدأ من مستشفى (نقل بين موعدين أو من مستشفى إلى مستشفى)
  const transferRequest = (request: VehicleRequest) => isTransfer(request, appointments.find((item) => item.id === request.appointmentId));
  const withAppointment = (request: VehicleRequest): Trip | null => {
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    const from = transferSource(request, appointments);
    const outboundAt = request.direction === "عودة"
      ? requests.filter((item) => item.appointmentId === request.appointmentId && item.direction === "ذهاب").at(-1)?.createdAt
      : undefined;
    return appointment ? { request, appointment, from, outboundAt, at: neededAt(request, appointment, hospitals), persons: requestPersons(request, appointment, requests) } : null;
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
  // باص العيادة في خدمتها، فلا يُحسب بين السيارات المتاحة للتوزيع
  const forClinic = (vehicle: Vehicle) => busRoleOf(vehicle) === "clinic";
  // سيارة المدارس وباص الجامعة في وقتهما المحجوز (أوقات المدارس، وباص الجامعة طوال اليوم ما لم تتغير): في الخدمة ولا يُرسلان
  const reservedNow = (vehicle: Vehicle) => reservedRun(vehicle, now, schedules);
  // غير مخصصة للمواعيد الآن: باص العيادة وباص المجمع، وسيارة المدارس وباص الجامعة في وقتهما
  const notForAppointments = (vehicle: Vehicle) => forClinic(vehicle) || busRoleOf(vehicle) === "shuttle" || Boolean(reservedNow(vehicle));
  // السيارة بلا سائق لا تُرسل حتى يختار مشرف السيارات سائقها
  const dispatchable = vehicles.filter((vehicle) => vehicle.available && hasDriver(vehicle) && !isBusy(vehicle.plate) && !forClinic(vehicle) && !reservedNow(vehicle));
  /** خارج الخدمة: موقوفة، أو بلا سائق وليست في رحلة */
  const offDuty = (vehicle: Vehicle) => !vehicle.available || (!hasDriver(vehicle) && !isBusy(vehicle.plate));
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
    .filter((request) => request.status === "بانتظار التوزيع" && (request.direction === "عودة" || transferRequest(request)))
    .map(withAppointment)
    .filter(isTrip);
  const redirects = suggestReturnRedirects(pendingReturns, dispatchable, locationStates, hospitals,
    (vehicle, trip) => !vehicleRestriction(vehicle, { appointments: [trip.appointment], transfer: isTransfer(trip.request, trip.appointment) }, rules));
  const redirectFor = new Map(redirects.map((item) => [item.request.id, item]));
  // تفضيل السيارة حسب مكانها: رحلة الذهاب تبدأ من المجمع (السيارات داخله أولًا)، والعودة تأخذ السيارة الموجَّهة إليها
  const transferIds = new Set(requests.filter(transferRequest).map((request) => request.id));
  /** السيارة المقترحة لرحلة (ضيف أو أكثر) من السيارات المتاحة الآن */
  const suggestFor = (trips: Trip[]) => assignVehicleForTrips(dispatchable, trips.map((trip) => trip.appointment), load,
    locationRank(trips[0]?.request.direction ?? "ذهاب", trips.map((trip) => trip.request.id)),
    { ...rules, transfer: trips.some((trip) => isTransfer(trip.request, trip.appointment)), persons: sumPersons(trips) });
  /**
   * كل السيارات في الخدمة لرحلة: المتاحة لها الآن أولًا (السيارة المجهزة آخرًا للرحلة العادية)، ثم غير المتاحة مع السبب.
   * لرحلة احتياجات خاصة: السيارات المجهزة أولًا، ثم العادية بتنبيه (يرسلها المشرف بعد الموافقة عليه). لا يظهر باص العيادة.
   */
  const choicesFor = (trips: Trip[]): VehicleChoice[] => {
    const riders = { appointments: trips.map((trip) => trip.appointment), transfer: trips.some((trip) => isTransfer(trip.request, trip.appointment)), persons: sumPersons(trips) };
    const accessible = needsAccessibleVehicle(riders.appointments);
    return vehicles
      .filter((vehicle) => vehicle.available && !forClinic(vehicle))
      .map((vehicle) => {
        const until = availability.get(vehicle.plate)?.until;
        const why = isBusy(vehicle.plate) ? `مشغولة${until ? ` حتى ${timeLabel(until)}` : ""}` : vehicleRestriction(vehicle, riders, { ...rules, regularForSpecial: true });
        const regular = why ? null : regularForSpecialWarning(vehicle, riders.appointments);
        const reserved = why ? null : reservedSoonWarning(vehicle, now, schedules);
        return { vehicle, why, warning: regular ?? reserved, regular: Boolean(regular), reserved: Boolean(reserved) };
      })
      .sort((a, b) => Number(Boolean(a.why)) - Number(Boolean(b.why)) || Number(Boolean(a.warning)) - Number(Boolean(b.warning))
        || (accessible ? 0 : Number(a.vehicle.kind === "احتياجات خاصة") - Number(b.vehicle.kind === "احتياجات خاصة")));
  };
  /** سيارة عادية لضيف احتياجات خاصة: تُرسل بعد موافقة المشرف على التنبيه */
  /** سيارة المدارس أو باص الجامعة يخرج لوقته المحجوز قريبًا: يُرسل بعد موافقة المشرف */
  const confirmReserved = (choice: VehicleChoice) => {
    const soon = choice.reserved ? reservedSoon(choice.vehicle, now, schedules) : null;
    return !soon || window.confirm(soon.role === SCHOOL_ROLE
      ? `السيارة ${choice.vehicle.plate} سيارة المدارس وتخرج لرحلتها ${soon.starts}.\nإرسالها في هذه الرحلة رغم ذلك؟`
      : `الباص ${choice.vehicle.plate} باص الجامعة ويخرج لرحلته ${soon.starts}.\nإرساله في هذه الرحلة رغم ذلك؟`);
  };
  const confirmRegular = (choice: VehicleChoice, trips: Trip[]) => confirmReserved(choice) && (!choice.regular || window.confirm(
    `${trips.filter((trip) => trip.appointment.kind === "احتياجات خاصة").map((trip) => trip.appointment.patientName).join("، ")} يحتاج سيارة احتياجات خاصة.\n`
    + `إرسال السيارة ${choice.vehicle.plate} (${choice.vehicle.kind}) رغم ذلك؟`,
  ));
  /**
   * رحلة عودة (أو نقل) لها سيارة ذاهبة الآن إلى نفس المكان أو قريب منه، وتناسب ضيفها (نوعها ومقاعدها):
   * بعد وصولها تُقترح للضيف («توجيه السيارة»)، فلا تُرسل سيارة من داخل المجمع إلا بعد تنبيه المشرف.
   */
  const incomingByRequest = new Map(pending.map((trip) => [trip.request.id, incomingCars(trip, requests, appointments, hospitals, now, gpsLive)
    .filter((car) => {
      const vehicle = vehicles.find((item) => item.plate === car.plate);
      return vehicle && !vehicleRestriction(vehicle, { appointments: [trip.appointment], transfer: isTransfer(trip.request, trip.appointment), persons: trip.persons }, rules);
    })] as const));
  const incomingFor = (requestIds: string[]) => {
    const cars = new Map<string, IncomingCar>();
    for (const id of requestIds) for (const car of incomingByRequest.get(id) ?? []) if (!cars.has(car.plate)) cars.set(car.plate, car);
    return Array.from(cars.values());
  };
  const incomingText = (car: IncomingCar) => `${car.plate} (${driverOf(car.plate, car.driver)}) ذاهبة إلى ${car.destination}${car.distanceKm ? ` على بعد ${car.distanceKm} كم` : ""}`
    + (car.etaAt ? ` · تصل ${timeLabel(car.etaAt)}` : " · في الطريق إلى استلام ضيفها");
  /** سيارة من داخل المجمع لرحلة عودة لها سيارة ذاهبة إلى نفس المكان: تُرسل بعد موافقة المشرف على التنبيه */
  const confirmIncoming = (vehicle: Vehicle, trips: Trip[]) => {
    const cars = incomingFor(trips.map((trip) => trip.request.id));
    if (!cars.length || isOutside(vehicle.plate)) return true;
    return window.confirm(
      `سيارة ذاهبة الآن إلى مكان عودة ${trips.map((trip) => trip.appointment.patientName).join("، ")} أو قريبة منه:\n`
      + `${cars.map(incomingText).join("\n")}\n`
      + "بعد وصولها تظهر في «توجيه سيارات خارج المجمع» لاستلام الضيف، بدل إرسال سيارة من المجمع.\n\n"
      + `إرسال السيارة ${vehicle.plate} من داخل المجمع رغم ذلك؟`,
    );
  };
  const locationRank = (direction: VehicleRequest["direction"], requestIds: string[]) => (vehicle: Vehicle) => {
    // العودة والنقل بين موعدين يبدآن من مستشفى: السيارة الموجَّهة إليهما أولًا
    if (direction === "عودة" || requestIds.some((id) => transferIds.has(id))) return requestIds.some((id) => redirectFor.get(id)?.vehicle.plate === vehicle.plate) ? 0 : 1;
    return isOutside(vehicle.plate) ? 1 : 0;
  };

  // النقل بين موعدين يبدأ من مستشفى، فلا يُجمع مع رحلات تبدأ من المجمع
  const groupable = pending.filter((trip) => !isTransfer(trip.request, trip.appointment));
  // الجمع حسب وقت الحاجة إلى السيارة (وقت الطلب)، لا وقت الموعد وحده
  // حتى 14 ضيفًا إن كان باص متاح يناسبهم (رحلات غير طبية مع باصها، ومستشفى الثمامة وقت الذروة مع باص المجمع)
  const groups = buildTripGroups(groupable.map((trip) => ({ appointment: trip.appointment, direction: trip.request.direction, at: trip.at, persons: trip.persons })), hospitals, seatsFor(dispatchable, rules));
  const groupedIds = new Set(groups.flatMap((group) => group.appointmentIds));
  // ضم ضيف إلى سيارة في رحلة: لم تستلم ضيوفها بعد، أو استلمت ضيف الذهاب من المجمع قبل 5 دقائق أو أقل (joinWindow)
  const joins = suggestJoinDispatched(groupable.filter((trip) => !groupedIds.has(trip.appointment.id)), active.filter((trip) => onDate(trip) && !isTransfer(trip.request, trip.appointment)), hospitals, vehicles, rules);
  // سيارة عائدة إلى المجمع فيها مقاعد فارغة، وطلب عودة قريب منها (GPS المباشر)
  const joinedIds = new Set(joins.map((join) => join.requestId));
  const returnPickups = suggestReturnPickups(
    pending.filter((trip) => !groupedIds.has(trip.appointment.id) && !joinedIds.has(trip.request.id)),
    active,
    vehicles,
    new Map(Array.from(liveGps, ([plate, location]) => [plate, { lat: location.lat, lng: location.lng }])),
    hospitals,
    rules,
  );
  const unrequested = findUnrequestedMatches(appointments.filter(isApproved), requests, hospitals, now).filter((match) => match.appointment.appointmentDate === date);

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
  // الضغط على إشعار ينقل إلى مكانه في «توزيع السيارات» (ولو كان المشرف في «كل المواعيد»)
  const openTarget = (target: string) => {
    setView("dispatch");
    if (target.startsWith("vehicle:")) setVehicleFilter("all");
    reveal(target);
  };
  useArrivalAlerts({ arrivals, appointments, hospitals, driverOf, onOpen: openTarget });
  useCancellationAlerts({ requests, appointments, onOpen: openTarget });
  useDenialAlerts({ requests, appointments, onOpen: openTarget });
  useRedirectAlerts({ redirects, driverOf, onDispatch: redirectVehicle, onOpen: openTarget });
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
    const plate = selectedVehicles[trip.request.id] || suggestFor([trip])?.plate;
    const choice = choicesFor([trip]).find((item) => item.vehicle.plate === plate && !item.why);
    if (!choice) {
      toast.error("اختر سيارة متاحة ومناسبة للرحلة");
      return;
    }
    if (!confirmRegular(choice, [trip]) || !confirmIncoming(choice.vehicle, [trip])) return;
    onDispatch([trip.request.id], choice.vehicle);
  }

  function dispatchGroup(appointmentIds: string[]) {
    const members = pending.filter((trip) => appointmentIds.includes(trip.appointment.id));
    const vehicle = suggestFor(members);
    if (!vehicle || members.length < 2) {
      toast.error("لا توجد سيارة مناسبة ومتاحة لجمع هذه الرحلات");
      return;
    }
    if (!confirmIncoming(vehicle, members)) return;
    onDispatch(members.map((trip) => trip.request.id), vehicle);
  }

  /** إرسال رحلة عدّلها المشرف (ضيوف اختارهم وسيارة) من نافذة التعديل. */
  function dispatchEdited(requestIds: string[], plate: string) {
    const members = pending.filter((trip) => requestIds.includes(trip.request.id));
    const choice = choicesFor(members).find((item) => item.vehicle.plate === plate);
    if (members.length !== requestIds.length || !choice || choice.why) {
      toast.error("تغيّرت الطلبات أو السيارة، راجع الرحلة");
      return;
    }
    if (!confirmRegular(choice, members) || !confirmIncoming(choice.vehicle, members)) return;
    onDispatch(requestIds, choice.vehicle);
    setEditing(null);
  }

  /**
   * تخصيص الباص: باص المجمع أو باص العيادة (باص واحد لكل تخصيص)، أو باص الجامعة (أكثر من باص: SHARED_BUS_ROLES)،
   * أو باص عادي.
   */
  function setBusRole(bus: Vehicle, role: BusRole | "") {
    const clear = ({ busRole: _busRole, ...vehicle }: Vehicle): Vehicle => vehicle;
    const single = role && !SHARED_BUS_ROLES.includes(role);
    onUpdate(vehicles.map((vehicle) => vehicle.plate === bus.plate ? (role ? { ...vehicle, busRole: role } : clear(vehicle))
      : single && vehicle.busRole === role ? clear(vehicle) : vehicle));
    toast.success(role ? `الباص ${bus.plate} أصبح ${BUS_ROLE_LABELS[role]}` : `الباص ${bus.plate} أصبح باصًا عاديًا`, {
      description: role === "nonMedical" ? `لا يُرسل في أي رحلة ${scheduleText(scheduleOf(schedules, "nonMedical"))}، ويمكن تغيير أوقاته من «الأوقات»` : undefined,
    });
  }

  /** سيارة المدارس: سيارة احتياجات خاصة محجوزة في أوقات المدارس (لا تُرسل فيها) وتبقى في الخدمة. */
  function setSchoolCar(car: Vehicle, school: boolean) {
    const clear = ({ busRole: _busRole, ...vehicle }: Vehicle): Vehicle => vehicle;
    onUpdate(vehicles.map((vehicle) => (vehicle.plate === car.plate ? (school ? { ...vehicle, busRole: SCHOOL_ROLE } : clear(vehicle)) : vehicle)));
    toast.success(school ? `السيارة ${car.plate} أصبحت سيارة المدارس` : `السيارة ${car.plate} لم تعد سيارة المدارس`, {
      description: school ? `لا تُرسل ${scheduleText(scheduleOf(schedules, SCHOOL_ROLE))}، وتبقى في الخدمة` : undefined,
    });
  }

  /** فتح نموذج تعديل رحلة غير طبية (أعلى الصفحة) */
  function editTrip(appointment: ClinicAppointment) {
    setAddingTrip(false);
    setEditingTrip(appointment);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** حذف رحلة غير طبية لم تُرسل سيارتها، مع طلبها (رحلة متكررة: هذه الرحلة فقط) */
  function deleteTrip(appointment: ClinicAppointment) {
    if (!nonMedicalOpen(appointment, requests)) {
      toast.error("أُرسلت سيارة لهذه الرحلة، فلا يمكن حذفها");
      return;
    }
    if (!window.confirm(`حذف الرحلة غير الطبية لـ ${appointment.patientName} (${appointment.clinic}، ${appointment.appointmentDate} ${appointment.appointmentAt})${appointment.seriesId ? "\nهذه الرحلة فقط، وتبقى باقي الرحلات المتكررة" : ""}؟`)) return;
    if (editingTrip?.id === appointment.id) setEditingTrip(null);
    onDeleteTrip(appointment);
  }

  /** سيارة جديدة برقم غير مسجل: متاحة للخدمة، ومعها سائقها إن اختاره (ينتقل من سيارته السابقة) في حفظ واحد */
  function addVehicle(vehicle: Pick<Vehicle, "plate" | "kind">, driverId: string | null) {
    if (vehicles.some((item) => item.plate === vehicle.plate)) {
      toast.error(`رقم السيارة ${vehicle.plate} مسجل مسبقًا`);
      return;
    }
    const added: Vehicle = { ...vehicle, driver: "", phone: "", available: true };
    const next = driverId ? assignDrivers([...vehicles, added], drivers, new Map([[added.plate, driverId]]), new Date()) : [...vehicles, added];
    onUpdate(next);
    setAddingVehicle(false);
    const driver = drivers.find((item) => item.id === driverId);
    toast.success(`تمت إضافة السيارة ${vehicle.plate} (${vehicle.kind})`, {
      description: driver ? `يقودها ${driver.name}` : "بلا سائق: اختر سائقها من «السائقون» قبل إرسالها في الرحلات",
    });
  }

  /** حفظ أوقات سيارات المدارس وباص الجامعة للجميع */
  function saveSchedules(next: RoleSchedules) {
    saveState("fox_schedules", next, schedules);
    setEditingSchedules(false);
    toast.success("حُفظت الأوقات", {
      description: `سيارات المدارس: ${scheduleText(scheduleOf(next, SCHOOL_ROLE))} · باص الجامعة: ${scheduleText(scheduleOf(next, "nonMedical"))}`,
    });
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
    const partners = active.filter((trip) => trip.request.vehiclePlate === plate && (groupId ? trip.request.groupId === groupId : !trip.request.groupId)).map((trip) => trip.request.id);
    onDispatch([requestId], vehicle, partners);
  }

  // أقرب سيارة مناسبة تتفرغ (لرحلة لا توجد لها سيارة متاحة الآن)
  function nextFree(appointments: ClinicAppointment[]) {
    const soonest = vehicles
      .filter((vehicle) => isBusy(vehicle.plate) && !vehicleRestriction(vehicle, { appointments }, rules))
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
    if (!hasDriver(vehicle) && !state?.busy) return { tone: "amber" as const, text: "بلا سائق · اختر سائقها من «السائقون»" };
    if (!state?.busy) {
      if (forClinic(vehicle)) return { tone: "neutral" as const, text: "في خدمة العيادة" };
      const reserved = reservedNow(vehicle);
      if (reserved) return { tone: "violet" as const, text: reservedText(reserved) };
      if (busRoleOf(vehicle) === "shuttle") {
        return { tone: "violet" as const, text: isRushHour(now) ? "يلف داخل المجمع · وقت الذروة: يمكن إرساله إلى مستشفى الثمامة" : "يلف داخل المجمع" };
      }
      const place = locationStates.get(vehicle.plate);
      // سيارة المدارس أو باص الجامعة قبل وقته: متاحة، مع وقت خروجها
      const soon = reservedSoon(vehicle, now, schedules);
      const schoolNote = soon ? (soon.role === SCHOOL_ROLE ? ` · تخرج للمدارس ${soon.starts}` : ` · يخرج للجامعة ${soon.starts}`) : "";
      if (place?.kind === "outside") {
        return { tone: "cyan" as const, text: `متاحة خارج المجمع · عائدة من ${place.from || "الوجهة"} · تصل ${timeLabel(place.backAt)}${place.canRedirect ? "" : " · قطعت نصف الطريق"}${schoolNote}` };
      }
      return { tone: soon ? "amber" as const : "green" as const, text: `متاحة داخل المجمع${schoolNote}` };
    }
    if (state.toPickup) return { tone: "blue" as const, text: "في الطريق إلى الاستلام" };
    return { tone: "blue" as const, text: state.until ? `في رحلة · تتفرغ ${timeLabel(state.until)}` : "في رحلة" };
  };
  /** تصنيف كل سيارة في قائمة السيارات: موقوفة، في رحلة، غير مخصصة للمواعيد، أو متاحة داخل المجمع أو خارجه */
  const vehicleGroup = (vehicle: Vehicle): Exclude<VehicleFilter, "all"> => (offDuty(vehicle) ? "off" : isBusy(vehicle.plate) ? "busy"
    : notForAppointments(vehicle) ? "reserved" : isOutside(vehicle.plate) ? "outside" : "inside");
  const groupCount = (group: VehicleFilter) => vehicles.filter((vehicle) => vehicleGroup(vehicle) === group).length;
  // السيارات المتاحة للمواعيد الآن (بلا باص المجمع وباص الجامعة وسيارة المدارس في وقتها)، داخل المجمع وخارجه
  const forAppointments = dispatchable.filter((vehicle) => !notForAppointments(vehicle));
  const vehicleCounts = {
    all: vehicles.length,
    inside: forAppointments.filter((vehicle) => !isOutside(vehicle.plate)).length,
    outside: forAppointments.filter((vehicle) => isOutside(vehicle.plate)).length,
    reserved: groupCount("reserved"),
  };
  const shownVehicles = vehicles.filter((vehicle) => vehicleFilter === "all" || vehicleGroup(vehicle) === vehicleFilter);
  // عدد السيارات المخصصة لكل تخصيص له أوقات (لنافذة الأوقات)
  const scheduledCounts = { school: 0, nonMedical: 0 } as Record<ScheduledRole, number>;
  for (const vehicle of vehicles) {
    const role = scheduledRoleOf(vehicle);
    if (role) scheduledCounts[role] += 1;
  }
  const withoutDriver = vehicles.filter((vehicle) => !hasDriver(vehicle)).length;
  const trackingCount = activeGroups.filter((trips) => trips.some((trip) => {
    const phase = phases.get(trip.request.id)!;
    return phase.kind === "toDestination" && phase.tracking;
  })).length;
  // المتأخر: طلب ينتظر السيارة LATE_MINUTES بعد وقت حاجته، أو سيارة أُرسلت ولم تصل إلى الاستلام، أو تجاوزت الوقت المتوقع للوصول
  const pendingLate = (trip: Trip) => Boolean(trip.at && now.getTime() - trip.at.getTime() >= LATE_MINUTES * 60000);
  const tripLate = (trips: Trip[]) => trips.some((trip) => {
    const phase = phases.get(trip.request.id)!;
    return (phase.kind === "toPickup" && !phase.atPickup && (minutesSince(trip.request.notificationSentAt, now) ?? 0) >= LATE_MINUTES)
      || (phase.kind === "toDestination" && phase.late);
  });
  const latePending = pending.filter(pendingLate);
  const lateTrips = activeGroups.filter(tripLate);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  // تفاصيل السيارة المعروضة: رحلاتها في اليوم المختار (الرحلة المجمّعة رحلة واحدة)
  const shownVehicle = vehicles.find((vehicle) => vehicle.plate === shownPlate);
  const tripsOfDay = (plate: string) => Array.from(requests
    .filter((request) => request.vehiclePlate === plate)
    .map(withAppointment)
    .filter(isTrip)
    .filter(onDate)
    .reduce((map, trip) => {
      const key = trip.request.groupId ?? trip.request.id;
      return map.set(key, [...(map.get(key) ?? []), trip]);
    }, new Map<string, Trip[]>())
    .values());

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

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <DateChooser value={date} onChange={onDateChange} />
        <Segmented
          label="العرض"
          value={view}
          onChange={setView}
          options={[
            { value: "dispatch", label: "توزيع السيارات" },
            { value: "appointments", label: `كل المواعيد ${appointments.filter((appointment) => appointment.appointmentDate === date).length}` },
          ]}
        />
      </div>

      {addingTrip && <NonMedicalTripForm defaultDate={date} onCancel={() => setAddingTrip(false)} onSave={(trips) => { onAddTrips(trips); setAddingTrip(false); }} />}
      {editingTrip && (
        <NonMedicalTripForm
          key={editingTrip.id}
          defaultDate={date}
          editing={editingTrip}
          onCancel={() => setEditingTrip(null)}
          onUpdate={(appointment) => {
            // أُرسلت سيارتها من جهاز آخر منذ فتح النموذج
            if (!nonMedicalOpen(appointments.find((item) => item.id === appointment.id) ?? appointment, requests)) {
              toast.error("أُرسلت سيارة لهذه الرحلة، فلا يمكن تعديلها");
              return;
            }
            onEditTrip(appointment);
            setEditingTrip(null);
          }}
        />
      )}

      {view === "appointments" ? <AppointmentsOverview appointments={appointments} requests={requests} date={date} now={now} onStopSeries={setStopping} onEditTrip={editTrip} onDeleteTrip={deleteTrip} /> : (<>
      {/* شريط الحالة: عدادات حية ملونة، والضغط ينقل إلى القسم */}
      <div className="mb-6">
        <StatusBar
          label="حالة التوزيع الآن"
          items={[
            { key: "available", label: "سيارات متاحة", value: forAppointments.length, tone: "green", hint: `${vehicleCounts.inside} داخل المجمع · ${vehicleCounts.outside} خارجه${vehicleCounts.reserved ? ` · ${vehicleCounts.reserved} غير مخصصة للمواعيد` : ""}`, onClick: () => jump("fleet-vehicles") },
            { key: "active", label: "رحلات جارية", value: activeGroups.length, tone: "blue", hint: trackingCount ? `${trackingCount} بمتابعة GPS` : "من الإرسال حتى الوجهة", onClick: () => jump("fleet-active") },
            { key: "pending", label: "بانتظار التوزيع", value: pending.length, tone: "amber", hint: date === today ? "طلبات اليوم" : "طلبات التاريخ المحدد", onClick: () => jump("fleet-pending") },
            { key: "late", label: "متأخرة", value: latePending.length + lateTrips.length, tone: "red", hint: `${latePending.length} تنتظر سيارة · ${lateTrips.length} في الطريق`, onClick: () => jump(latePending.length ? "fleet-pending" : "fleet-active") },
          ]}
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {redirects.length > 0 && (
            <Panel tone="violet" icon={Navigation} title="توجيه سيارات خارج المجمع" count={redirects.length} description="سيارة عائدة من وجهتها لم تقطع نصف الطريق إلى المجمع، وهي أقرب إلى ضيف ينتظر العودة من المجمع">
              <div className="divide-y divide-slate-100">
                {redirects.map((item) => (
                  <div key={item.request.id} data-target={`redirect:${item.request.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
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
            id="fleet-pending"
            tone="amber"
            icon={BellRing}
            title="طلبات بانتظار التوزيع"
            count={pending.length}
            description="اختر السيارة المناسبة ثم أرسلها، أو وزّع الكل تلقائيًا على السيارات المتاحة"
            actions={pending.length > 0 && (
              <button
                disabled={!dispatchable.length}
                onClick={() => setPlan(planDispatch(pending, dispatchable, load, hospitals, (unit, vehicle) => locationRank(unit.direction, unit.requestIds)(vehicle), rules))}
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
                  const suggested = suggestFor([trip]);
                  const redirect = redirectFor.get(trip.request.id);
                  const incoming = incomingByRequest.get(trip.request.id) ?? [];
                  const selectedPlate = selectedVehicles[trip.request.id] || suggested?.plate || "";
                  // المتاحة لها أولًا، ثم المشغولة وما لا يناسبها (الباصات: الساعات والتخصيص) مع السبب
                  const choices = choicesFor([trip]);
                  const ready = choices.filter((choice) => !choice.why).map((choice) => choice.vehicle);
                  const zone = matchHospitalZone(trip.appointment, hospitals);
                  return (
                    <div key={trip.request.id} data-target={`request:${trip.request.id}`} className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
                      <div className="flex min-w-0 flex-1 gap-4">
                        <TimeBlock time={trip.appointment.appointmentAt} day={formatDay(trip.appointment.appointmentDate, now)} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{trip.appointment.patientName}</p>
                            {trip.from ? <Badge tone="cyan">{transferLabels(trip.appointment).ar}</Badge> : trip.request.nurseOnly ? <Badge tone="amber">عودة الـ Nurse فقط</Badge> : <Badge tone={trip.request.direction === "عودة" ? "amber" : "neutral"}>{trip.request.direction}</Badge>}
                            {isNonMedical(trip.appointment) && <Badge tone="violet">غير طبية</Badge>}
                            {trip.appointment.seriesId && <Badge tone="blue" icon={Repeat}>متكررة</Badge>}
                            {trip.appointment.nurse && <Badge tone="violet" icon={BriefcaseMedical}>ممرضة</Badge>}
                            {isPriority(trip.appointment) && <PriorityBadge />}
                            {pendingLate(trip) && <Badge tone="red" icon={AlertTriangle}>متأخر</Badge>}
                            {groupedIds.has(trip.appointment.id) && <Badge tone="violet" icon={Sparkles}>قابلة للجمع</Badge>}
                            {redirect && <Badge tone="cyan" icon={Navigation}>سيارة قريبة {redirect.vehicle.plate} · {redirect.distanceKm} كم</Badge>}
                            {incoming.length > 0 && <Badge tone="amber" icon={Navigation}>سيارة ذاهبة إلى نفس المكان</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-slate-600">{routeLabel(trip.appointment, trip.from)}{zone && <span className="text-slate-400"> · {zone}</span>}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{riderDetails(trip)}</p>
                          {/* سيارة ذاهبة إلى مكان العودة: الأفضل انتظارها بدل إرسال سيارة من المجمع */}
                          {incoming.map((car) => (
                            <p key={car.plate} className="mt-1 text-xs font-medium leading-5 text-amber-800">
                              <Navigation className="me-1 inline h-3.5 w-3.5 align-[-3px]" />{incomingText(car)} · بعد وصولها تُقترح لهذا الضيف
                            </p>
                          ))}
                          {trip.appointment.returnAt && trip.request.direction === "ذهاب" && (
                            <p className="mt-0.5 text-xs text-slate-500">العودة تلقائيًا {trip.appointment.returnAt}</p>
                          )}
                          {/* أُزيل من رحلة جارية: ينتظر سيارة أخرى */}
                          {trip.request.removedFrom && (
                            <p className="mt-1 text-xs font-medium leading-5 text-red-700">
                              <UserMinus className="me-1 inline h-3.5 w-3.5 align-[-3px]" />أُزيل من رحلة السيارة <span dir="ltr">{trip.request.removedFrom}</span>{trip.request.removeReason ? ` · ${trip.request.removeReason}` : ""}{trip.request.removedAt ? ` · ${timeLabel(new Date(trip.request.removedAt))}` : ""}
                            </p>
                          )}
                          {trip.request.createdAt && (
                            <p className="mt-1 flex flex-wrap items-center gap-1 text-xs font-medium text-amber-800">
                              <Clock3 className="h-3.5 w-3.5" /> {requestTimes(trip)}
                              {!bookedAhead(trip.request) && waitedText(trip.request.createdAt, now) && <span className="font-normal text-amber-700">· {waitedText(trip.request.createdAt, now)}</span>}
                            </p>
                          )}
                          {isNonMedical(trip.appointment) && (
                            <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                              {nonMedicalOpen(trip.appointment, requests) && (
                                <>
                                  <button type="button" onClick={() => editTrip(trip.appointment)} aria-label={`تعديل رحلة ${trip.appointment.patientName}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-ink hover:underline">
                                    <Pencil className="h-3.5 w-3.5" /> تعديل
                                  </button>
                                  <button type="button" onClick={() => deleteTrip(trip.appointment)} aria-label={`حذف رحلة ${trip.appointment.patientName}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-700 hover:underline">
                                    <Trash2 className="h-3.5 w-3.5" /> حذف
                                  </button>
                                </>
                              )}
                              {trip.appointment.seriesId && (
                                <button type="button" onClick={() => setStopping(trip.appointment)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-700 hover:underline">
                                  <Repeat className="h-3.5 w-3.5" /> إيقاف الرحلات المتكررة…
                                </button>
                              )}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row lg:w-[440px]">
                        <VehiclePicker
                          label={`سيارة رحلة ${trip.appointment.patientName}`}
                          options={choices}
                          value={ready.some((vehicle) => vehicle.plate === selectedPlate) ? selectedPlate : ""}
                          onChange={(plate) => setSelectedVehicles((current) => ({ ...current, [trip.request.id]: plate }))}
                          placeholder={!ready.length ? "لا توجد سيارة متاحة" : choices.some((choice) => !choice.why && !choice.regular) ? "اختر سيارة" : "لا سيارة احتياجات خاصة متاحة · اختر سيارة عادية"}
                          driverOf={(vehicle) => driverOf(vehicle.plate)}
                          details={(vehicle) => `${placeText(vehicle.plate)} · ${tripsText(load.get(vehicle.plate) ?? 0)}`}
                          roleOf={roleOf}
                        />
                        <div className="flex gap-2">
                          <button disabled={!ready.length} onClick={() => dispatchSingle(trip)} className={cx(btn("primary"), "flex-1")}><Send className="h-4 w-4" /> إرسال</button>
                          {/* النقل بين موعدين يبدأ من مستشفى فلا يُجمع مع غيره */}
                          {!trip.from && <button onClick={() => setEditing([trip.request.id])} title="جمع هذه الرحلة مع رحلات أخرى في سيارة واحدة" className={cx(btn("secondary"), "flex-1")}><Layers className="h-4 w-4" /> جمع</button>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState icon={CheckCircle2} title="لا توجد طلبات بانتظار التوزيع" hint="تظهر هنا طلبات مشرفي المباني فور وصولها" />}
          </Panel>

          {(groups.length > 0 || joins.length > 0 || returnPickups.length > 0) && (
            <Panel tone="violet" icon={Sparkles} title="اقتراحات جمع الرحلات" count={groups.length + joins.length + returnPickups.length} description="ضيوف لنفس الوجهة أو وجهات متجاورة في نفس التوقيت، وسيارات فيها مقاعد فارغة قريبة منهم">
              <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
                {groups.map((group) => {
                  const members = pending.filter((trip) => group.appointmentIds.includes(trip.appointment.id));
                  const vehicle = suggestFor(members);
                  return (
                    <div key={group.appointmentIds.join("-")} className="flex flex-col rounded-xl bg-violet-50/50 p-4 ring-1 ring-violet-100">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-medium text-violet-800">{group.direction} · {group.reason}</p>
                        <Badge tone="violet">{guestsText(members.length)}{group.persons > members.length ? ` · ${personsText(group.persons)}` : ""}</Badge>
                      </div>
                      <TripList trips={members} hospitals={hospitals} />
                      <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">السيارة المقترحة: {vehicle
                        ? <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><KindIcon vehicle={vehicle} size="sm" /><span dir="ltr">{vehicle.plate}</span> · {driverOf(vehicle.plate)} · <KindLabel vehicle={vehicle} extra={roleOf(vehicle)} /></span>
                        : <span className="font-semibold text-slate-700">لا توجد سيارة متاحة</span>}</p>
                      <div className="mt-3 flex gap-2">
                        <button disabled={!vehicle} onClick={() => dispatchGroup(group.appointmentIds)} className={cx(btn("dark", "sm"), "flex-1")}><Send className="h-4 w-4" /> إرسال السيارة · {guestsText(members.length)}</button>
                        <button onClick={() => setEditing(members.map((trip) => trip.request.id))} title="إضافة ضيوف أو إزالتهم أو تغيير السيارة" className={btn("secondary", "sm")}><Pencil className="h-4 w-4" /> تعديل</button>
                      </div>
                    </div>
                  );
                })}
                {joins.map((join) => {
                  const trip = pending.find((item) => item.request.id === join.requestId)!;
                  const left = join.openUntil ? Math.max(0, Math.ceil((Date.parse(join.openUntil) - now.getTime()) / 60000)) : null;
                  return (
                    <div key={join.requestId} className="flex flex-col rounded-xl bg-emerald-50/50 p-4 ring-1 ring-emerald-100">
                      <p className="text-xs font-medium text-emerald-800">{join.reason}</p>
                      {left !== null && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
                          <Clock3 className="h-3.5 w-3.5" /> يمكن الضم حتى <span dir="ltr" className="tabular">{timeLabel(new Date(join.openUntil!))}</span>{left > 0 ? ` (${minutesText(left)})` : ""}
                        </p>
                      )}
                      <TripList trips={[trip]} hospitals={hospitals} />
                      <button onClick={() => joinTrip(join.requestId, join.plate, join.groupId)} className={cx(btn("success", "sm"), "mt-3 w-full")}><Link2 className="h-4 w-4" /> ضم إلى السيارة {join.plate}</button>
                    </div>
                  );
                })}
                {returnPickups.map((pickup) => {
                  const trip = pending.find((item) => item.request.id === pickup.request.id)!;
                  return (
                    <div key={pickup.request.id} className="flex flex-col rounded-xl bg-cyan-50/60 p-4 ring-1 ring-cyan-100">
                      <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-cyan-900">
                        <Navigation className="h-3.5 w-3.5" /> السيارة <KindIcon vehicle={pickup.vehicle} size="sm" /> <span dir="ltr" className="font-semibold">{pickup.vehicle.plate}</span> · {driverOf(pickup.vehicle.plate)}
                      </p>
                      <p className="mt-1 text-xs text-cyan-900">{returningText(pickup)} · على بعد {pickup.distanceKm} كم من {pickup.pickup} (GPS)</p>
                      <TripList trips={[trip]} hospitals={hospitals} />
                      <button onClick={() => joinTrip(pickup.request.id, pickup.vehicle.plate, pickup.groupId)} className={cx(btn("success", "sm"), "mt-3 w-full")}><Link2 className="h-4 w-4" /> ضم إلى السيارة العائدة {pickup.vehicle.plate}</button>
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

          <Panel id="fleet-active" tone="blue" icon={Truck} title="رحلات جارية" count={activeGroups.length} description="من إرسال السيارة حتى وصولها إلى الوجهة">
            {activeGroups.length ? (
              <div className="divide-y divide-slate-100">
                {activeGroups.map((trips) => (
                  <ActiveTrip
                    key={trips[0].request.groupId ?? trips[0].request.id}
                    trips={trips}
                    phase={groupPhase(trips.map((trip) => phases.get(trip.request.id)!))}
                    late={tripLate(trips)}
                    vehicle={vehicles.find((item) => item.plate === trips[0].request.vehiclePlate)}
                    driver={driverOf(trips[0].request.vehiclePlate, trips[0].request.driver)}
                    hospitals={hospitals}
                    onArrived={() => onArrived(trips.map((trip) => trip.request.id), "manual")}
                    onEnd={() => onEndTrip(trips.map((trip) => trip.request.id))}
                    onChangeVehicle={() => setChanging(trips)}
                    onRemove={(trip) => setRemoving({ trip, alone: trips.length === 1 })}
                    onAdd={() => setAdding(trips)}
                  />
                ))}
              </div>
            ) : <EmptyState icon={Truck} title="لا توجد رحلات جارية" />}
          </Panel>
        </div>

        <aside className="min-w-0 space-y-6">
          <Panel
            id="fleet-arrivals"
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
                    <li key={request.id} data-target={`arrival:${request.id}`} className="flex items-start gap-3 px-5 py-3">
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

          <Panel
            id="fleet-vehicles"
            icon={CarFront}
            title="السيارات"
            count={vehicles.length}
            bodyClassName="p-0"
            description={withoutDriver ? `${withoutDriver === 1 ? "سيارة واحدة" : `${withoutDriver} سيارات`} بلا سائق` : undefined}
            actions={(
              <div className="flex flex-wrap justify-end gap-2">
                {/* أوقات سيارات المدارس وباص الجامعة: يعدّلها المشرف متى تغيّرت */}
                <button type="button" onClick={() => setEditingSchedules(true)} title="أوقات سيارات المدارس وباص الجامعة" className={btn("secondary", "sm")}><CalendarClock className="h-4 w-4" /> الأوقات</button>
                <button type="button" onClick={() => setAssigning("")} className={btn(withoutDriver ? "primary" : "secondary", "sm")}><UserCog className="h-4 w-4" /> السائقون</button>
                <button type="button" onClick={() => setAddingVehicle(true)} aria-label="إضافة سيارة" title="إضافة سيارة برقم غير مسجل" className={btn("secondary", "sm")}><Plus className="h-4 w-4" /> سيارة</button>
              </div>
            )}
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <Segmented
                full
                label="تصفية السيارات"
                size="sm"
                value={vehicleFilter}
                onChange={setVehicleFilter}
                columns={4}
                options={[
                  { value: "all", label: `الكل ${vehicleCounts.all}` },
                  { value: "inside", label: `داخل ${groupCount("inside")}` },
                  { value: "outside", label: `خارج ${groupCount("outside")}` },
                  { value: "busy", label: `رحلة ${groupCount("busy")}` },
                  { value: "reserved", label: `غير مخصصة للمواعيد ${vehicleCounts.reserved}`, span: 3 },
                  { value: "off", label: `موقوف ${groupCount("off")}` },
                ]}
              />
            </div>
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {shownVehicles.map((vehicle) => {
                const state = availabilityText(vehicle);
                const live = liveGps.get(vehicle.plate);
                const driverName = live?.driver ?? vehicle.driver;
                return (
                  <li key={vehicle.plate} data-target={`vehicle:${vehicle.plate}`} className="flex items-center gap-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      {/* الضغط على السيارة يفتح تفاصيلها: السائق ورقمه، والحالة، ومن فيها، ورحلاتها اليوم */}
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-label={`تفاصيل السيارة ${vehicle.plate} · ${live?.driver ?? (vehicle.driver || "بلا سائق")}`}
                        onClick={() => setShownPlate(vehicle.plate)}
                        className="group flex w-full items-center gap-3 rounded-xl px-1 py-1 text-start transition hover:bg-slate-50"
                      >
                        <Dot tone={state.tone} pulse={Boolean(live)} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                            <KindIcon vehicle={vehicle} size="sm" />
                            {/* أول كلمة من اسم السائق، والاسم الكامل عند المرور وفي تفاصيل السيارة */}
                            <span className="truncate" title={driverName || undefined}><span dir="ltr" className="font-semibold">{vehicle.plate}</span> · {driverName ? shortDriverName(driverName) : <span className="text-amber-700">بلا سائق</span>}</span>
                          </p>
                          <p className="text-xs leading-5 text-slate-500"><KindLabel vehicle={vehicle} extra={roleOf(vehicle)} /> · {state.text}{live ? " · GPS مباشر" : ""}</p>
                        </div>
                        <div className="shrink-0 text-center" title="رحلات اليوم المختار">
                          <p className="text-sm font-semibold text-ink tabular">{load.get(vehicle.plate) ?? 0}</p>
                          <p className="text-[11px] leading-none text-slate-400">رحلة</p>
                        </div>
                        <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500" aria-hidden="true" />
                      </button>
                      {vehicle.kind === "سيدان" && (
                        <button
                          type="button"
                          aria-pressed={Boolean(vehicle.fullCapacity)}
                          aria-label={vehicle.fullCapacity ? `إعادة السيارة ${vehicle.plate} إلى 3 أشخاص` : `تشغيل السيارة ${vehicle.plate} بطاقتها الكاملة (4 أشخاص)`}
                          title={vehicle.fullCapacity ? "إعادتها إلى 3 أشخاص" : "السيدان تحمل 4 أشخاص، ويُفضل 3"}
                          onClick={() => onUpdate(vehicles.map((item) => (item.plate === vehicle.plate ? mergeVehicle(item, { fullCapacity: !item.fullCapacity }) : item)))}
                          className={cx("ms-[26px] inline-flex h-7 max-w-[calc(100%-26px)] items-center gap-1 rounded-lg px-2 text-[11px] font-medium ring-1 ring-inset transition",
                            vehicle.fullCapacity ? "bg-blue-50 text-blue-800 ring-blue-200 hover:bg-blue-100" : "bg-white text-slate-500 ring-slate-300 hover:bg-slate-50 hover:text-ink")}
                        >
                          <UsersRound className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{vehicle.fullCapacity ? "بطاقتها الكاملة: 4 أشخاص" : "3 أشخاص · تشغيل بـ 4"}</span>
                        </button>
                      )}
                      {vehicle.kind === "باص" && (
                        <select
                          aria-label={`تخصيص الباص ${vehicle.plate}`}
                          value={busRoleOf(vehicle) ?? ""}
                          onChange={(event) => setBusRole(vehicle, event.target.value as BusRole | "")}
                          className="ms-[26px] h-8 max-w-[calc(100%-26px)] rounded-lg border border-slate-300 bg-white px-2 text-xs text-ink outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
                        >
                          <option value="">باص عادي</option>
                          {BUS_ROLES.map((role) => <option key={role} value={role}>{BUS_ROLE_LABELS[role]}{role === "shuttle" ? " (يلف داخل المجمع)" : role === "clinic" ? " (في خدمة العيادة)" : " (لا يُرسل في أوقاته)"}</option>)}
                        </select>
                      )}
                      {vehicle.kind === "احتياجات خاصة" && (
                        <button
                          type="button"
                          aria-pressed={isSchoolCar(vehicle)}
                          aria-label={isSchoolCar(vehicle) ? `إلغاء تخصيص السيارة ${vehicle.plate} للمدارس` : `تخصيص السيارة ${vehicle.plate} للمدارس`}
                          title={`سيارة المدارس: لا تُرسل ${scheduleText(scheduleOf(schedules, SCHOOL_ROLE))}، وتبقى في الخدمة`}
                          onClick={() => setSchoolCar(vehicle, !isSchoolCar(vehicle))}
                          className={cx("ms-[26px] inline-flex h-7 max-w-[calc(100%-26px)] items-center gap-1 rounded-lg px-2 text-[11px] font-medium ring-1 ring-inset transition",
                            isSchoolCar(vehicle) ? "bg-violet-50 text-violet-800 ring-violet-200 hover:bg-violet-100" : "bg-white text-slate-500 ring-slate-300 hover:bg-slate-50 hover:text-ink")}
                        >
                          <School className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{isSchoolCar(vehicle) ? "سيارة المدارس" : "تخصيص للمدارس"}</span>
                        </button>
                      )}
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
      </>)}

      {plan && <AutoDispatchDialog plan={plan} free={dispatchable} load={load} rules={rules} transferIds={transferIds} incomingFor={(requestIds, plate) => (isOutside(plate) ? [] : incomingFor(requestIds))} incomingText={incomingText} personsOf={new Map(pending.map((trip) => [trip.request.id, trip.persons]))} driverOf={driverOf} placeText={placeText} nextFree={nextFree} onConfirm={confirmPlan} onClose={() => setPlan(null)} />}
      {editing && (
        <GroupEditor
          initial={editing}
          pending={pending}
          hospitals={hospitals}
          load={load}
          choicesFor={choicesFor}
          suggestFor={suggestFor}
          driverOf={driverOf}
          placeText={placeText}
          onDispatch={dispatchEdited}
          onClose={() => setEditing(null)}
        />
      )}
      {driverMessages && <DriverMessagesDialog messages={driverMessages} driverOf={driverOf} onClose={() => setDriverMessages(null)} />}
      {shownVehicle && (
        <VehicleDetailsDialog
          vehicle={shownVehicle}
          driver={driverOf(shownVehicle.plate)}
          state={availabilityText(shownVehicle)}
          place={locationStates.get(shownVehicle.plate)}
          current={active.filter((trip) => trip.request.vehiclePlate === shownVehicle.plate)}
          dayTrips={tripsOfDay(shownVehicle.plate)}
          phaseOf={(request) => phases.get(request.id) ?? tripPhase(request, now, gpsLive(request.vehiclePlate))}
          date={date}
          now={now}
          hospitals={hospitals}
          onChangeDriver={() => { setShownPlate(null); setAssigning(shownVehicle.plate); }}
          onClose={() => setShownPlate(null)}
        />
      )}
      {stopping && (
        <StopSeriesDialog
          appointment={stopping}
          trips={stoppableSeriesTrips(appointments, requests, stopping.seriesId!, stopping.appointmentDate).map((item) => item.appointment)}
          onConfirm={(appointmentIds, reason) => {
            onStopSeries(appointmentIds, reason);
            setStopping(null);
          }}
          onClose={() => setStopping(null)}
        />
      )}
      {removing && (
        <RemoveFromTripDialog
          trip={removing.trip}
          alone={removing.alone}
          onConfirm={(reason) => {
            onRemoveFromTrip(removing.trip.request.id, reason);
            setRemoving(null);
          }}
          onClose={() => setRemoving(null)}
        />
      )}
      {adding && (() => {
        const vehicle = vehicles.find((item) => item.plate === adding[0].request.vehiclePlate);
        const day = adding[0].appointment.appointmentDate;
        // الضيوف الذين ينتظرون سيارة في يوم الرحلة: نفس الاتجاه أولًا، ثم الأقرب وقتًا
        const candidates = requests
          .filter((request) => request.status === "بانتظار التوزيع")
          .map(withAppointment)
          .filter(isTrip)
          .filter((trip) => trip.appointment.appointmentDate === day)
          .sort((a, b) => Number(a.request.direction !== adding[0].request.direction) - Number(b.request.direction !== adding[0].request.direction)
            || Math.abs((a.at?.getTime() ?? 0) - (adding[0].at?.getTime() ?? 0)) - Math.abs((b.at?.getTime() ?? 0) - (adding[0].at?.getTime() ?? 0)));
        return vehicle && (
          <AddToTripDialog
            trips={adding}
            vehicle={vehicle}
            candidates={candidates}
            pickedUpDefault={adding.some((trip) => trip.request.status === "تم استلام المريض")}
            warningFor={(candidate) => vehicleRestriction({ ...vehicle, available: true }, {
              appointments: [...adding, candidate].map((trip) => trip.appointment),
              persons: sumPersons([...adding, candidate]),
            }, { ...rules, regularForSpecial: true }) ?? regularForSpecialWarning(vehicle, [candidate.appointment])}
            hospitals={hospitals}
            onConfirm={(candidate, pickedUp) => {
              const messages = onAddToTrip(candidate.request.id, adding.map((trip) => trip.request.id), vehicle, pickedUp);
              setAdding(null);
              if (messages.length) setDriverMessages(messages);
            }}
            onClose={() => setAdding(null)}
          />
        );
      })()}
      {changing && (
        <ChangeVehicleDialog
          trips={changing}
          choices={choicesFor(changing).filter((choice) => choice.vehicle.plate !== changing[0].request.vehiclePlate)}
          driverOf={(vehicle) => driverOf(vehicle.plate, vehicle.driver)}
          details={(vehicle) => `${placeText(vehicle.plate)} · ${tripsText(load.get(vehicle.plate) ?? 0)}`}
          onConfirm={(choice, reason, stopOld) => {
            if (!confirmRegular(choice, changing)) return;
            const messages = onChangeVehicle(changing.map((trip) => trip.request.id), choice.vehicle, reason, stopOld);
            setChanging(null);
            if (messages.length) setDriverMessages(messages);
          }}
          onClose={() => setChanging(null)}
        />
      )}
      {assigning !== null && (
        <DriverAssignment
          vehicles={vehicles}
          drivers={drivers}
          busy={isBusy}
          initialQuery={assigning}
          onSave={(next) => {
            onUpdate(next);
            setAssigning(null);
            toast.success("تم حفظ السائقين في السيارات", { description: "يبقى هذا التخصيص حتى تغيّره" });
          }}
          onClose={() => setAssigning(null)}
        />
      )}
      {addingVehicle && <AddVehicleDialog vehicles={vehicles} drivers={drivers} onSave={addVehicle} onClose={() => setAddingVehicle(false)} />}
      {editingSchedules && <RoleSchedulesDialog schedules={schedules} counts={scheduledCounts} onSave={saveSchedules} onClose={() => setEditingSchedules(false)} />}
    </>
  );
}

function TripList({ trips, hospitals }: { trips: Trip[]; hospitals: Hospital[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {trips.map((trip) => (
        <li key={trip.request.id} className="rounded-lg bg-white px-3 py-2 text-xs ring-1 ring-slate-200/70">
          <p className="font-semibold text-ink">{riderName(trip)} <span dir="ltr" className="font-medium text-slate-500 tabular">{trip.appointment.appointmentAt}</span>{trip.persons > 1 && <span className="ms-1.5 font-normal text-slate-500">· {personsText(trip.persons)}</span>}{isPriority(trip.appointment) && <span className="ms-1.5 text-red-700">· أولوية</span>}</p>
          <p className="mt-0.5 text-slate-500">{routeLabel(trip.appointment, trip.from)}{matchHospitalZone(trip.appointment, hospitals) ? ` · ${matchHospitalZone(trip.appointment, hospitals)}` : ""}</p>
          {trip.request.createdAt && <p className="mt-0.5 text-slate-400">{requestTimes(trip)}</p>}
        </li>
      ))}
    </ul>
  );
}

const STEPS = ["أُرسلت", "عند الاستلام", "في الطريق", "الوجهة"];

/** رحلة سيارة جارية: مرحلتها، والوقت المتوقع للوصول، ومتابعة GPS، ورسالة السائق. */
function ActiveTrip({ trips, phase, late = false, vehicle, driver, hospitals, onArrived, onEnd, onChangeVehicle, onRemove, onAdd }: {
  trips: Trip[];
  phase: TripPhase;
  /** تأخرت: لم تصل إلى الاستلام بعد LATE_MINUTES من إرسالها، أو تجاوزت الوقت المتوقع للوصول */
  late?: boolean;
  vehicle?: Vehicle;
  driver: string;
  hospitals: Hospital[];
  onArrived: () => void;
  onEnd: () => void;
  onChangeVehicle: () => void;
  /** إزالة ضيف من الرحلة، وإضافة ضيف إليها */
  onRemove: (trip: Trip) => void;
  onAdd: () => void;
}) {
  const plate = trips[0].request.vehiclePlate ?? "";
  const changed = trips.find((trip) => trip.request.previousPlate)?.request;
  // النصف الإنجليزي من الرسالة باسم الضيف الإنجليزي من قائمة ضيوف المجمع
  const guests = useGuests();
  const message = buildDriverMessage(trips, { plate, driver }, hospitals, guests);
  const phone = vehicle?.phone;
  // المقاعد الباقية: الباص 14، وسيارة الاحتياجات الخاصة 4، والسيدان 3 (أو 4 بطاقتها الكاملة)
  const seatsLeft = vehicleSeats(vehicle ?? { kind: "سيدان" }) - sumPersons(trips);
  const step = phase.kind === "toPickup" ? (phase.atPickup ? 1 : 0) : phase.kind === "toDestination" ? 2 : 3;
  const destinations = Array.from(new Set(trips.map((trip) => tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from).destination)));
  return (
    <article data-target={trips.map((trip) => `trip:${trip.request.id}`).join(" ")} className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Truck className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink"><span dir="ltr">{plate}</span> · {driver}</p>
            <p className="truncate text-xs text-slate-500">{trips[0].from ? `نقل من ${trips[0].from.clinic}` : trips[0].request.direction} إلى {destinations.join("، ")}{trips.length > 1 ? ` · ${trips.length} ضيوف` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {late && <Badge tone="red" icon={AlertTriangle}>متأخرة</Badge>}
          {phase.kind === "toDestination" && (phase.tracking ? <Badge tone="green" icon={Radio}>GPS مباشر</Badge> : <Badge icon={Timer}>وقت تقديري</Badge>)}
          {seatsLeft > 0 && phase.kind === "toPickup" && <Badge tone="green">{seatsLeft === 1 ? "مقعد متاح" : seatsLeft === 2 ? "مقعدان متاحان" : `${seatsLeft} مقاعد متاحة`}</Badge>}
          <StatusBadge status={trips[0].request.status} />
        </div>
      </div>

      <div className="mt-3"><Steps steps={STEPS} current={step} /></div>

      {/* تغيّرت سيارة هذه الرحلة بعد إرسالها */}
      {changed && (
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          <span>بدل السيارة <span dir="ltr" className="font-semibold tabular">{changed.previousPlate}</span>{changed.changeReason ? ` · ${changed.changeReason}` : ""}{changed.changedAt ? ` · ${timeLabel(new Date(changed.changedAt))}` : ""}</span>
        </p>
      )}

      <ul className="mt-3 space-y-1 text-sm text-slate-600">
        {trips.map((trip) => (
          <li key={trip.request.id} className="flex flex-wrap gap-x-2">
            <span className="font-medium text-ink">{riderName(trip)}</span>
            <span dir="ltr" className="text-slate-500 tabular">{trip.appointment.appointmentAt}</span>
            {trip.persons > 1 && <span className="text-slate-500">· {personsText(trip.persons)}</span>}
            <span className="text-slate-500">{routeLabel(trip.appointment, trip.from)}</span>
            {isPriority(trip.appointment) && <span className="font-medium text-red-700">· أولوية</span>}
            {trip.request.createdAt && <span className="text-slate-400">· {requestTimes(trip)}</span>}
            {/* لم يركب السيارة، أو سجّل السائق استلامه خطأً */}
            <button type="button" onClick={() => onRemove(trip)} aria-label={`إزالة ${riderName(trip)} من الرحلة`} className="ms-auto inline-flex items-center gap-1 rounded-md px-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
              <UserMinus className="h-3.5 w-3.5" /> إزالة
            </button>
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
        {/* السائق استلم ضيفًا آخر ينتظر السيارة (أو سيستلمه في طريقه) */}
        <button onClick={onAdd} className={btn("secondary", "sm")}><UserPlus className="h-4 w-4" /> إضافة ضيف</button>
        {/* عطل أو حادث أو تأخر: سيارة أخرى للرحلة قبل وصولها إلى الوجهة */}
        <button onClick={onChangeVehicle} className={cx(btn("secondary", "sm"), "text-amber-800")}><ArrowLeftRight className="h-4 w-4" /> تغيير السيارة</button>
        {/* رحلة عالقة: أُرسلت السيارة ولم يُسجَّل استلام الضيف */}
        {phase.kind === "toPickup" && (
          <button
            onClick={() => window.confirm(`إنهاء رحلة السيارة ${plate}؟\nاستخدمه إذا انتهت الرحلة ولم يُسجَّل استلام الضيف. تُعتبر الرحلة منتهية وتصبح السيارة متاحة، ويُسجَّل ذلك باسمك.`) && onEnd()}
            className={cx(btn("secondary", "sm"), "text-slate-700")}
          >
            <Flag className="h-4 w-4" /> إنهاء الرحلة
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * تغيير سيارة رحلة جارية (عطل أو حادث أو تأخر): سيارة أخرى متاحة تناسب الرحلة (الرحلة المجمّعة كلها)، والسبب،
 * وإيقاف السيارة السابقة عن الخدمة (مقترح عند العطل والحادث). قبل استلام الضيف تعود الرحلة إلى «تم إرسال السيارة»،
 * وبعده تكمل السيارة الجديدة الطريق إلى الوجهة.
 */
function ChangeVehicleDialog({ trips, choices, driverOf, details, onConfirm, onClose }: {
  trips: Trip[];
  choices: VehicleChoice[];
  driverOf: (vehicle: Vehicle) => string;
  details: (vehicle: Vehicle) => string;
  onConfirm: (choice: VehicleChoice, reason: string, stopOld: boolean) => void;
  onClose: () => void;
}) {
  const current = trips[0].request.vehiclePlate ?? "";
  const [plate, setPlate] = useState("");
  const [reason, setReason] = useState<string>(CHANGE_VEHICLE_REASONS[0]);
  const [other, setOther] = useState("");
  const [stopOld, setStopOld] = useState(VEHICLE_FAULT_REASONS.includes(CHANGE_VEHICLE_REASONS[0]));
  const text = reason === "أخرى" ? other.trim() : reason;
  const choice = choices.find((item) => item.vehicle.plate === plate && !item.why);
  const pickedUp = trips.some((trip) => trip.request.status === "تم استلام المريض");
  const ready = choices.filter((item) => !item.why);
  function chooseReason(next: string) {
    setReason(next);
    setStopOld(VEHICLE_FAULT_REASONS.includes(next));
  }
  return (
    <Modal
      tone="amber"
      icon={ArrowLeftRight}
      title="تغيير سيارة الرحلة"
      description={<>{trips.map(riderName).join("، ")} · السيارة الحالية <span dir="ltr" className="font-semibold">{current}</span></>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!choice || !text} onClick={() => choice && onConfirm(choice, text, stopOld)} className={btn("primary")}><ArrowLeftRight className="h-4 w-4" /> تغيير السيارة</button>
        </>
      )}
    >
      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200/70">
        {pickedUp
          ? "الضيف في السيارة الحالية: تكمل السيارة الجديدة الطريق إلى الوجهة. اتصل بالسائقين لتحديد مكان الالتقاء."
          : "تعود الرحلة إلى «تم إرسال السيارة» بالسيارة الجديدة، وتُلغى عند سائق السيارة الحالية."}
      </p>
      <div className="mt-4">
        <p className={labelClass}>السيارة الجديدة</p>
        <VehiclePicker
          label="السيارة الجديدة"
          options={choices}
          value={choice ? plate : ""}
          onChange={setPlate}
          placeholder={ready.length ? "اختر سيارة" : "لا توجد سيارة متاحة تناسب الرحلة الآن"}
          driverOf={driverOf}
          details={details}
          roleOf={roleOf}
        />
      </div>
      <fieldset className="mt-4">
        <legend className={labelClass}>سبب التغيير</legend>
        <div className="flex flex-wrap gap-2">
          {[...CHANGE_VEHICLE_REASONS, "أخرى"].map((item) => (
            <button key={item} type="button" aria-pressed={reason === item} onClick={() => chooseReason(item)} className={cx(choiceClass(reason === item), "h-9 px-3 text-sm")}>{item}</button>
          ))}
        </div>
        {reason === "أخرى" && <input aria-label="سبب آخر" value={other} onChange={(event) => setOther(event.target.value)} maxLength={120} placeholder="اكتب السبب" className={cx(inputClass, "mt-2")} />}
      </fieldset>
      <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-700">
        <input type="checkbox" checked={stopOld} onChange={(event) => setStopOld(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
        <span>إيقاف السيارة <span dir="ltr" className="font-semibold">{current}</span> عن الخدمة <span className="text-xs text-slate-500">(تعود متاحة من مفتاحها في قائمة السيارات)</span></span>
      </label>
    </Modal>
  );
}

/** أسباب جاهزة مع «أخرى» مكتوب: أزرار اختيار ونص السبب الآخر */
function ReasonChoice({ reasons, value, other, onChange, onOther, legend }: {
  reasons: readonly string[];
  value: string;
  other: string;
  onChange: (reason: string) => void;
  onOther: (text: string) => void;
  legend: string;
}) {
  return (
    <fieldset>
      <legend className={labelClass}>{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {[...reasons, "أخرى"].map((item) => (
          <button key={item} type="button" aria-pressed={value === item} onClick={() => onChange(item)} className={cx(choiceClass(value === item), "h-9 px-3 text-sm")}>{item}</button>
        ))}
      </div>
      {value === "أخرى" && <input aria-label="سبب آخر" value={other} onChange={(event) => onOther(event.target.value)} maxLength={120} placeholder="اكتب السبب" className={cx(inputClass, "mt-2")} />}
    </fieldset>
  );
}

/**
 * إزالة ضيف من رحلة جارية (لم يركب السيارة، أو سجّل السائق استلامه خطأً): يعود طلبه إلى «بانتظار التوزيع» لترسل له
 * سيارة أخرى، وحالة موعده كما قبل الاستلام، وتبقى الرحلة لباقي الركاب.
 */
/**
 * إيقاف رحلة غير طبية متكررة: هذه الرحلة وحدها، أو هي وكل ما بعدها مما لم تُرسل سيارته، بسبب إلزامي.
 * trips: رحلات السلسلة القابلة للإيقاف من يوم هذه الرحلة فصاعدًا (stoppableSeriesTrips).
 */
function StopSeriesDialog({ appointment, trips, onConfirm, onClose }: { appointment: ClinicAppointment; trips: ClinicAppointment[]; onConfirm: (appointmentIds: string[], reason: string) => void; onClose: () => void }) {
  const [scope, setScope] = useState<"one" | "rest">("rest");
  const [reason, setReason] = useState("");
  const chosen = scope === "one" ? trips.filter((item) => item.id === appointment.id) : trips;
  const last = trips[trips.length - 1];
  const day = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}`;
  return (
    <Modal
      tone="red"
      icon={Repeat}
      title="إيقاف الرحلات المتكررة"
      description={<>{appointment.patientName} · {appointment.clinic} · {appointment.appointmentAt}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>تراجع</button>
          <button type="button" disabled={reason.trim().length < 3 || !chosen.length} onClick={() => onConfirm(chosen.map((item) => item.id), reason.trim())} className={btn("danger")}>
            <Repeat className="h-4 w-4" /> إلغاء {chosen.length.toLocaleString("en")} رحلة
          </button>
        </>
      )}
    >
      <fieldset className="grid gap-2">
        <legend className="sr-only">ما يُلغى</legend>
        <label className={cx(choiceClass(scope === "one"), "cursor-pointer")}>
          <input type="radio" name="series-scope" checked={scope === "one"} onChange={() => setScope("one")} className="h-4 w-4 accent-brand-600" />
          هذه الرحلة فقط ({day(appointment.appointmentDate)})
        </label>
        <label className={cx(choiceClass(scope === "rest"), "cursor-pointer")}>
          <input type="radio" name="series-scope" checked={scope === "rest"} onChange={() => setScope("rest")} className="h-4 w-4 accent-brand-600" />
          هذه الرحلة وكل ما بعدها ({trips.length.toLocaleString("en")} رحلة{last && last.id !== appointment.id ? ` حتى ${day(last.appointmentDate)}` : ""})
        </label>
      </fieldset>
      {!chosen.length && <p className="mt-3 text-sm text-red-700">هذه الرحلة أُرسلت سيارتها أو انتهت، فلا تُلغى من هنا.</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">الرحلات التي أُرسلت سيارتها لا تُلغى من هنا. تبقى الرحلات الملغاة في «كل المواعيد» بحالة «ملغي» مع السبب.</p>
      <label className="mt-4 block">
        <span className={labelClass}>السبب</span>
        <input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثل: انتهى الفصل الدراسي" className={inputClass} />
      </label>
    </Modal>
  );
}

function RemoveFromTripDialog({ trip, alone, onConfirm, onClose }: { trip: Trip; alone: boolean; onConfirm: (reason: string) => void; onClose: () => void }) {
  const pickedUp = trip.request.status === "تم استلام المريض";
  const [reason, setReason] = useState<string>(pickedUp ? "لم يركب السيارة" : "الضيف غير جاهز");
  const [other, setOther] = useState("");
  const text = reason === "أخرى" ? other.trim() : reason;
  return (
    <Modal
      tone="red"
      icon={UserMinus}
      title="إزالة من الرحلة"
      description={<>{riderName(trip)} · السيارة <span dir="ltr" className="font-semibold">{trip.request.vehiclePlate}</span></>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!text} onClick={() => onConfirm(text)} className={btn("danger")}><UserMinus className="h-4 w-4" /> إزالة من الرحلة</button>
        </>
      )}
    >
      <ul className="space-y-1.5 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200/70">
        <li>يعود طلبه إلى «بانتظار التوزيع» لترسل له سيارة أخرى، وتُلغى عند السائق.</li>
        {pickedUp && <li>سُجّل استلامه، فتعود حالة موعده إلى ما قبل الاستلام.</li>}
        <li>{alone ? "هو الراكب الوحيد: تنتهي رحلة السيارة وتصبح متاحة." : "تبقى الرحلة لباقي الركاب."}</li>
      </ul>
      <div className="mt-4"><ReasonChoice legend="السبب" reasons={REMOVE_FROM_TRIP_REASONS} value={reason} other={other} onChange={setReason} onOther={setOther} /></div>
    </Modal>
  );
}

/**
 * ضم ضيف ينتظر السيارة إلى رحلة جارية: السائق استلمه (يُسجَّل استلامه الآن) أو سيستلمه في طريقه. الضيوف في نفس الاتجاه
 * أولًا ثم الأقرب وقتًا، وما لا يناسب السيارة (المقاعد أو الاحتياجات الخاصة) يظهر بتنبيه ويُسأل عنه قبل الإضافة.
 */
function AddToTripDialog({ trips, vehicle, candidates, pickedUpDefault, warningFor, hospitals, onConfirm, onClose }: {
  trips: Trip[];
  vehicle: Vehicle;
  candidates: Trip[];
  pickedUpDefault: boolean;
  warningFor: (candidate: Trip) => string | null;
  hospitals: Hospital[];
  onConfirm: (candidate: Trip, pickedUp: boolean) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [pickedUp, setPickedUp] = useState(pickedUpDefault);
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = candidates.filter((trip) => words.every((word) => `${trip.appointment.patientName} ${trip.appointment.buildingNumber} ${trip.appointment.clinic}`.toLowerCase().includes(word)));
  const candidate = candidates.find((trip) => trip.request.id === selected);
  const warning = candidate ? warningFor(candidate) : null;
  function confirm() {
    if (!candidate) return;
    if (warning && !window.confirm(`${warning}\nإضافة ${riderName(candidate)} إلى السيارة ${vehicle.plate} رغم ذلك؟`)) return;
    onConfirm(candidate, pickedUp);
  }
  return (
    <Modal
      tone="blue"
      icon={UserPlus}
      title="إضافة ضيف إلى الرحلة"
      description={<>السيارة <span dir="ltr" className="font-semibold">{vehicle.plate}</span> · {trips.map(riderName).join("، ")}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!candidate} onClick={confirm} className={btn("primary")}><UserPlus className="h-4 w-4" /> إضافة إلى الرحلة</button>
        </>
      )}
    >
      <p className="text-sm leading-6 text-slate-600">اختر الضيف الذي استلمه السائق (أو سيستلمه في طريقه) من الضيوف الذين ينتظرون سيارة. إن لم يكن في القائمة يطلب له مشرف المبنى سيارة أولًا.</p>
      {candidates.length > 4 && (
        <input aria-label="بحث في الضيوف" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو المبنى أو الوجهة..." className={cx(inputClass, "mt-3 h-10")} />
      )}
      <ul className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200" role="radiogroup" aria-label="الضيوف الذين ينتظرون سيارة">
        {shown.map((trip) => {
          const checked = trip.request.id === selected;
          const why = warningFor(trip);
          return (
            <li key={trip.request.id}>
              <label className={cx("flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm", checked ? "bg-blue-50" : "hover:bg-slate-50")}>
                <input type="radio" name="guest" checked={checked} onChange={() => setSelected(trip.request.id)} className="mt-1 h-4 w-4 accent-brand-600" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{riderName(trip)} <span dir="ltr" className="font-normal text-slate-500 tabular">{trip.appointment.appointmentAt}</span></span>
                  <span className="block text-xs leading-5 text-slate-500">{trip.request.direction} · {tripRoute(trip, hospitals)} · {personsText(trip.persons)}</span>
                  {why && <span className="block text-xs font-medium text-amber-700">{why}</span>}
                </span>
              </label>
            </li>
          );
        })}
        {!shown.length && <li className="p-6 text-center text-sm text-slate-400">{candidates.length ? "لا يوجد ضيوف مطابقون" : "لا يوجد ضيوف ينتظرون سيارة في يوم هذه الرحلة"}</li>}
      </ul>
      <label className="mt-4 flex items-start gap-2.5 text-sm text-slate-700">
        <input type="checkbox" checked={pickedUp} onChange={(event) => setPickedUp(event.target.checked)} className="mt-0.5 h-4 w-4 accent-brand-600" />
        <span>استلمه السائق الآن <span className="text-xs text-slate-500">(يُسجَّل استلامه ووقت وصوله المتوقع؛ بلا تحديد يستلمه السائق في طريقه)</span></span>
      </label>
    </Modal>
  );
}

const freeSeatsText = (count: number) => (count <= 0 ? "لا مقاعد فارغة" : count === 1 ? "مقعد فارغ" : count === 2 ? "مقعدان فارغان" : `${count} مقاعد فارغة`);
const SOURCE_TEXT: Record<string, string> = { gps: "GPS", manual: "تأكيد يدوي", estimate: "تقديري" };

/** مقاعد السيارة: السيدان 3 (أو 4 بطاقتها الكاملة)، وسيارة الاحتياجات الخاصة ضيف واحد منهم و3 أشخاص، والباص 14 */
function seatsText(vehicle: Vehicle) {
  const seats = vehicleSeats(vehicle);
  if (vehicle.kind === "احتياجات خاصة") return `${personsText(seats)}: ضيف احتياجات خاصة واحد و${personsText(seats - 1)} عاديين`;
  if (vehicle.kind === "سيدان") return vehicle.fullCapacity ? `${personsText(seats)} (بطاقتها الكاملة)` : `${personsText(seats)} (تحمل 4 بطاقتها الكاملة)`;
  return personsText(seats);
}

/** من أين إلى أين: الذهاب من المبنى، والعودة من المستشفى إلى المجمع، والنقل من المستشفى الأول */
function tripRoute(trip: Trip, hospitals: Hospital[]) {
  const from = trip.from ? trip.from.clinic : trip.request.direction === "عودة" ? trip.appointment.clinic : appointmentPickupLabel(trip.appointment);
  return `${from} ← ${tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from).destination}`;
}

const directionText = (trip: Trip) => (trip.from ? transferLabels(trip.appointment).ar : trip.request.nurseOnly ? "عودة الـ Nurse" : trip.request.direction);

function Info({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[11px] font-medium text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm leading-6 text-ink">{children}</dd>
    </div>
  );
}

/**
 * تفاصيل سيارة عند الضغط عليها في قائمة السيارات: حالتها، والسائق ورقمه، ومن فيها الآن والمقاعد الفارغة،
 * وآخر موقع GPS، ورحلتها الجارية، ورحلاتها في اليوم المختار.
 */
function VehicleDetailsDialog({ vehicle, driver, state, place, current, dayTrips, phaseOf, date, now, hospitals, onChangeDriver, onClose }: {
  vehicle: Vehicle;
  /** السائق الذي يقودها الآن (من هاتفه) أو المسجل للسيارة */
  driver: string;
  state: { tone: Tone; text: string };
  place?: VehicleLocationState;
  /** رحلتها الجارية الآن (ضيف أو أكثر) */
  current: Trip[];
  /** رحلاتها في اليوم المختار، كل رحلة مجمّعة معًا */
  dayTrips: Trip[][];
  phaseOf: (request: VehicleRequest) => TripPhase;
  date: string;
  now: Date;
  hospitals: Hospital[];
  /** نافذة السائقين في السيارات على هذه السيارة */
  onChangeDriver: () => void;
  onClose: () => void;
}) {
  const locations = useSharedState<VehicleLocation[]>("fox_locations", []);
  const location = locations.find((item) => item.plate === vehicle.plate);
  const fresh = location ? locationFreshness(location, now.getTime()) : null;
  const seats = vehicleSeats(vehicle);
  const riding = sumPersons(current);
  const phase = current.length ? groupPhase(current.map((trip) => phaseOf(trip.request))) : null;
  const sentAt = (trips: Trip[]) => trips.find((trip) => trip.request.notificationSentAt)?.request.notificationSentAt;
  const pickedUpAt = (trips: Trip[]) => trips.find((trip) => trip.request.pickedUpAt)?.request.pickedUpAt;
  const trips = [...dayTrips].sort((a, b) => (sentAt(a) ?? a[0].appointment.appointmentAt).localeCompare(sentAt(b) ?? b[0].appointment.appointmentAt));
  const dayPersons = dayTrips.reduce((total, group) => total + sumPersons(group), 0);
  // اليوم، غدًا، أمس، أو التاريخ كاملًا
  const relative = formatDay(date, now);
  const dayLabel = relative === date ? longDate(date) : relative;

  const since = vehicle.driverSince ? new Date(vehicle.driverSince) : null;
  const driverSince = since && !Number.isNaN(since.getTime()) ? (localDateString(since) === localDateString(now) ? timeLabel(since) : stamp(since)) : "";
  const lastSeen = location ? new Date(location.updatedAt) : null;
  const lastSeenText = lastSeen ? (localDateString(lastSeen) === localDateString(now) ? timeLabel(lastSeen) : stamp(lastSeen)) : "";
  const locationText = !location || !lastSeen
    ? "لم يشارك السائق موقعه بعد"
    : fresh?.state === "live"
      ? [`GPS مباشر · آخر تحديث ${lastSeenText}`, location.accuracy ? `دقة ${Math.round(location.accuracy)} م` : "", location.speed ? `${location.speed} كم/س` : ""].filter(Boolean).join(" · ")
      : `${location.sharing === false ? "أوقف السائق مشاركة الموقع" : "لا يصل موقعها الآن"} · آخر موقع ${lastSeenText}`;
  const heading = Array.from(new Set(current.map((trip) => tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from).destination))).join("، ");
  const placeText = phase?.kind === "toPickup" ? (phase.atPickup ? "عند نقطة الاستلام" : "في الطريق إلى الاستلام")
    : phase?.kind === "toDestination" ? `في الطريق إلى ${heading}`
    : place?.kind === "outside" ? `خارج المجمع · عائدة من ${place.from || "الوجهة"} · تصل ${timeLabel(place.backAt)}`
    : "داخل المجمع";
  const ridingText = !phase
    ? `لا ركاب الآن · تتسع لـ ${personsText(seats)}`
    : `${personsText(riding)} ${phase.kind === "toPickup" ? "في الطريق إلى استلامهم" : "في السيارة"} · ${freeSeatsText(seats - riding)}`;
  const step = phase?.kind === "toPickup" ? (phase.atPickup ? 1 : 0) : phase?.kind === "toDestination" ? 2 : 3;

  return (
    <Modal
      tone={state.tone}
      title={(
        <span className="flex items-center gap-2">
          <KindIcon vehicle={vehicle} size="sm" />
          <span className="min-w-0 truncate"><span dir="ltr">{vehicle.plate}</span> · {driver}</span>
        </span>
      )}
      description={<><KindLabel vehicle={vehicle} extra={roleOf(vehicle)} /> · {seatsText(vehicle)}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onChangeDriver} className={btn("secondary")}><UserCog className="h-4 w-4" /> تغيير السائق</button>
          <button type="button" onClick={onClose} className={btn("secondary")}>إغلاق</button>
        </>
      )}
    >
      <p className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-medium text-ink ring-1 ring-inset ring-slate-200/70">
        <Dot tone={state.tone} pulse={fresh?.state === "live"} />
        <span>{state.text}</span>
      </p>

      <dl className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        <Info label="السائق">
          {driver || <span className="text-amber-700">بلا سائق</span>}
          {driver !== vehicle.driver && vehicle.driver && <span className="block text-xs text-slate-500">السائق المخصص للسيارة: {vehicle.driver}</span>}
          {/* منذ متى يقودها (من تخصيص مشرف السيارات) */}
          {vehicle.driver && driverSince && <span className="block text-xs text-slate-500">يقودها منذ {driverSince}</span>}
        </Info>
        <Info label="رقم السائق">
          {vehicle.phone ? <GuestContact mobile={vehicle.phone} labels={{ call: "اتصال بالسائق", whatsapp: "واتساب" }} /> : <span className="text-slate-400">غير مسجل</span>}
        </Info>
        <Info label="الركاب الآن">{ridingText}</Info>
        <Info label="المكان">{placeText}</Info>
        <Info label="الموقع (GPS)">{locationText}</Info>
        <Info label={`رحلات ${dayLabel}`}>
          {trips.length ? `${trips.length === 1 ? "رحلة واحدة" : trips.length === 2 ? "رحلتان" : `${trips.length} رحلات`} · ${personsText(dayPersons)}` : "لا رحلات"}
        </Info>
      </dl>

      {phase && (
        <section className="mt-5" aria-label="الرحلة الجارية">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">الرحلة الجارية</h3>
            <StatusBadge status={current[0].request.status} />
          </div>
          <div className="mt-2"><Steps steps={STEPS} current={step} /></div>
          <ul className="mt-2 space-y-1.5">
            {current.map((trip) => (
              <li key={trip.request.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <p className="font-medium text-ink">{riderName(trip)} <span className="font-normal text-slate-500">· {personsText(trip.persons)}</span></p>
                <p className="text-xs leading-5 text-slate-500">{directionText(trip)} · {tripRoute(trip, hospitals)} · الموعد <span dir="ltr" className="tabular">{trip.appointment.appointmentAt}</span></p>
                {/* رقم الضيف الذي يركب السيارة، للاتصال به أو مراسلته */}
                {trip.appointment.mobile && trip.appointment.mobile !== "-" && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">
                    <span className="font-medium text-slate-500">{trip.request.nurseOnly ? "هاتف الضيف (مرافقة الـ Nurse)" : "هاتف الضيف"}</span>
                    <GuestContact mobile={trip.appointment.mobile} />
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {[
              sentAt(current) ? `أُرسلت ${sentAt(current)}` : "",
              pickedUpAt(current) ? `استُلم الضيف ${timeLabel(new Date(pickedUpAt(current)!))}` : "",
              phase.kind === "toDestination" ? `الوصول المتوقع ${timeLabel(phase.etaAt)}${phase.late ? " (متأخرة)" : ""}` : "",
            ].filter(Boolean).join(" · ")}
          </p>
        </section>
      )}

      <section className="mt-5" aria-label={`رحلات ${dayLabel}`}>
        <h3 className="text-sm font-semibold text-ink">رحلات {dayLabel}</h3>
        {trips.length ? (
          <ol className="mt-2 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200/70">
            {trips.map((group) => {
              const groupState = groupPhase(group.map((trip) => phaseOf(trip.request)));
              const destinations = Array.from(new Set(group.map((trip) => tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from).destination)));
              return (
                <li key={group[0].request.groupId ?? group[0].request.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span dir="ltr" className="mt-0.5 w-11 shrink-0 text-sm font-semibold text-ink tabular">{sentAt(group) ?? group[0].appointment.appointmentAt}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{group.map(riderName).join("، ")}</p>
                    <p className="text-xs leading-5 text-slate-500">
                      {directionText(group[0])} إلى {destinations.join("، ")} · {personsText(sumPersons(group))}
                    </p>
                  </div>
                  {groupState.kind === "arrived"
                    ? <Badge tone="green" icon={CheckCircle2}>وصلت{groupState.at ? ` ${timeLabel(groupState.at)}` : ""}{SOURCE_TEXT[groupState.source] ? ` · ${SOURCE_TEXT[groupState.source]}` : ""}</Badge>
                    : <StatusBadge status={group[0].request.status} />}
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-2 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">لا رحلات لهذه السيارة {relative === date ? "في هذا اليوم" : dayLabel}</p>}
      </section>
    </Modal>
  );
}

/**
 * خطة التوزيع التلقائي قبل الإرسال: كل رحلة وسيارتها المقترحة (الأقل رحلات اليوم)، ويمكن تغيير السيارة
 * أو استبعاد رحلة أو فصل ضيف عن رحلة مجمّعة (يأخذ سيارة وحده)، ثم تُرسل كل السيارات معًا.
 */
function AutoDispatchDialog({ plan, free, load, rules, transferIds, incomingFor, incomingText, personsOf, driverOf, placeText, nextFree, onConfirm, onClose }: {
  plan: DispatchPlan;
  free: Vehicle[];
  load: Map<string, number>;
  rules: VehicleRules;
  transferIds: Set<string>;
  /** سيارات ذاهبة إلى مكان رحلة العودة، إن كانت السيارة المختارة لها من داخل المجمع */
  incomingFor: (requestIds: string[], plate: string) => IncomingCar[];
  incomingText: (car: IncomingCar) => string;
  /** عدد الأشخاص في كل طلب (مع المرافق والـ Nurse) */
  personsOf: Map<string, number>;
  driverOf: (plate?: string, fallback?: string) => string;
  placeText: (plate: string) => string;
  nextFree: (appointments: ClinicAppointment[]) => string;
  onConfirm: (items: { requestIds: string[]; vehicle: Vehicle }[]) => void;
  onClose: () => void;
}) {
  // رحلة عودة لها سيارة ذاهبة إلى نفس المكان: غير مختارة حتى يختارها المشرف بعد التنبيه
  const [rows, setRows] = useState(() => plan.assignments.map(({ vehicle: _vehicle, ...item }) => ({
    ...item, plate: _vehicle.plate, include: !incomingFor(item.requestIds, _vehicle.plate).length,
  })));
  const chosen = rows.filter((row) => row.include);
  const used = new Map<string, number>();
  chosen.forEach((row) => used.set(row.plate, (used.get(row.plate) ?? 0) + 1));
  const conflict = Array.from(used.values()).some((count) => count > 1);
  // السيارات التي تناسب الرحلة (المقاعد، والاحتياجات الخاصة، وقواعد الباصات)
  const optionsFor = (row: (typeof rows)[number]) => free.filter((vehicle) => !vehicleRestriction(vehicle, { appointments: row.appointments, transfer: row.requestIds.some((id) => transferIds.has(id)), persons: row.persons }, rules));
  const missing = chosen.some((row) => !optionsFor(row).some((vehicle) => vehicle.plate === row.plate));
  const update = (index: number, change: Partial<(typeof rows)[number]>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  const names = (appointments: ClinicAppointment[]) => appointments.map((appointment) => appointment.patientName).join("، ");
  const destinations = (appointments: ClinicAppointment[]) => Array.from(new Set(appointments.map((appointment) => appointment.clinic))).join("، ");

  /** فصل ضيف عن رحلة مجمّعة: يصبح رحلة وحده بأنسب سيارة لم تُختر لرحلة أخرى (أو بلا سيارة) */
  function split(index: number, requestId: string) {
    setRows((current) => {
      const row = current[index];
      const at = row.requestIds.indexOf(requestId);
      if (at < 0 || row.requestIds.length < 2) return current;
      const appointment = row.appointments[at];
      const persons = personsOf.get(requestId) ?? 1;
      const rest = { ...row, requestIds: row.requestIds.filter((_, i) => i !== at), appointments: row.appointments.filter((_, i) => i !== at), persons: row.persons - persons };
      const taken = new Set(current.filter((item) => item.include).map((item) => item.plate));
      const vehicle = assignVehicleForTrips(free.filter((item) => !taken.has(item.plate)), [appointment], load, undefined, { ...rules, transfer: transferIds.has(requestId), persons });
      const alone = { requestIds: [requestId], appointments: [appointment], direction: row.direction, persons, plate: vehicle?.plate ?? "", include: vehicle ? !incomingFor([requestId], vehicle.plate).length : false };
      return [...current.slice(0, index), rest, alone, ...current.slice(index + 1)];
    });
  }

  return (
    <Modal
      tone="violet"
      icon={Wand2}
      title="التوزيع التلقائي"
      description="كل رحلة على السيارة المناسبة الأقل رحلات اليوم، والرحلات القابلة للجمع في سيارة واحدة (حتى 14 في الباص). راجع الخطة ثم أرسل."
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button
            type="button"
            disabled={!chosen.length || conflict || missing}
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
        {missing && <p className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" /> اختر سيارة مناسبة لكل رحلة مختارة، أو استبعدها</p>}
        {rows.length ? (
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {rows.map((row, index) => {
              const accessible = needsAccessibleVehicle(row.appointments);
              const options = optionsFor(row);
              const first = [...row.appointments].sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt))[0];
              const grouped = row.appointments.length > 1;
              const incoming = row.plate ? incomingFor(row.requestIds, row.plate) : [];
              return (
                <li key={row.requestIds.join()} className={cx("space-y-2 p-3", !row.include && "opacity-50")}>
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input type="checkbox" checked={row.include} onChange={(event) => update(index, { include: event.target.checked })} className="mt-1 h-4 w-4 accent-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span dir="ltr" className="font-semibold text-ink tabular">{first.appointmentAt}</span>
                        {!grouped && <span className="font-medium text-ink">{names(row.appointments)}</span>}
                        {grouped && <Badge tone="violet" icon={Sparkles}>مجمّعة · {guestsText(row.appointments.length)}</Badge>}
                        {row.persons > row.appointments.length && <Badge>{personsText(row.persons)}</Badge>}
                        {accessible && <Badge tone="amber">احتياجات خاصة</Badge>}
                      </span>
                      <span className="block truncate text-xs text-slate-500">{destinations(row.appointments)}</span>
                    </span>
                  </label>
                  {/* سيارة ذاهبة إلى مكان العودة: لا تُرسل سيارة من المجمع إلا إذا اختارها المشرف بعد التنبيه */}
                  {incoming.length > 0 && (
                    <p className="ms-6 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">
                      <AlertTriangle className="me-1 inline h-3.5 w-3.5 align-[-3px]" />
                      {incoming.map(incomingText).join("، ")}. بعد وصولها تُقترح لهذا الضيف، {row.include ? "وستُرسل سيارة من داخل المجمع رغم ذلك." : "لذلك لم تُختر هذه الرحلة؛ اخترها لإرسال سيارة من داخل المجمع."}
                    </p>
                  )}
                  {grouped && (
                    <ul className="flex flex-wrap gap-1.5 ps-6">
                      {row.appointments.map((appointment, at) => (
                        <li key={row.requestIds[at]} className="inline-flex items-center gap-1 rounded-full bg-slate-50 py-0.5 pe-1 ps-2.5 text-xs text-ink ring-1 ring-slate-200">
                          {appointment.patientName} <span dir="ltr" className="text-slate-500 tabular">{appointment.appointmentAt}</span>
                          <button type="button" onClick={() => split(index, row.requestIds[at])} aria-label={`فصل ${appointment.patientName} عن الرحلة المجمّعة`} title="فصل عن الرحلة المجمّعة (سيارة وحده)" className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-ink">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex">
                    <VehiclePicker
                      label={`سيارة رحلة ${names(row.appointments)}`}
                      options={options.map((vehicle) => ({ vehicle, why: null }))}
                      value={options.some((vehicle) => vehicle.plate === row.plate) ? row.plate : ""}
                      disabled={!row.include}
                      invalid={row.include && (used.get(row.plate) ?? 0) > 1}
                      onChange={(plate) => update(index, { plate })}
                      placeholder="اختر سيارة"
                      driverOf={(vehicle) => driverOf(vehicle.plate, vehicle.driver)}
                      details={(vehicle) => `${placeText(vehicle.plate)} · ${tripsText(load.get(vehicle.plate) ?? 0)}`}
                      roleOf={roleOf}
                    />
                  </div>
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

/**
 * تعديل رحلة مجمّعة قبل إرسالها (من اقتراحات الجمع، أو «جمع» بجانب أي طلب): إضافة ضيوف ينتظرون السيارة
 * في نفس الاتجاه أو إزالتهم، واختيار السيارة. عدد الضيوف لا يتجاوز مقاعد السيارة (الباص 14).
 */
function GroupEditor({ initial, pending, hospitals, load, choicesFor, suggestFor, driverOf, placeText, onDispatch, onClose }: {
  initial: string[];
  pending: Trip[];
  hospitals: Hospital[];
  load: Map<string, number>;
  choicesFor: (trips: Trip[]) => VehicleChoice[];
  suggestFor: (trips: Trip[]) => Vehicle | null;
  driverOf: (plate?: string, fallback?: string) => string;
  placeText: (plate: string) => string;
  onDispatch: (requestIds: string[], plate: string) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState(initial);
  const [plate, setPlate] = useState("");
  // الطلبات التي ما زالت تنتظر التوزيع (قد يوزّعها أو يلغيها مستخدم آخر أثناء التعديل)
  const members = ids.flatMap((id) => pending.filter((trip) => trip.request.id === id));
  const direction = members[0]?.request.direction;
  const timeOf = (trip: Trip) => trip.at ?? appointmentDateTime(trip.appointment);
  /** هل يناسب الضيف الرحلة: قرب الوجهة والتوقيت مع كل ضيوفها (كما في اقتراحات الجمع) */
  const fit = (trip: Trip) => {
    // لا يُجمع ضيفا احتياجات خاصة في سيارة واحدة
    if (trip.appointment.kind === "احتياجات خاصة" && members.some((member) => member.appointment.kind === "احتياجات خاصة")) {
      return { ok: false, blocked: true, text: "ضيف احتياجات خاصة آخر" };
    }
    const details = members.map((member) => calculateTripGroupingScore(member.appointment, trip.appointment, hospitals, [timeOf(member), timeOf(trip)]));
    const far = details.some((item) => !item.sameDestination && !item.nearbyDestination && !item.sameDirection);
    const gap = Math.max(0, ...details.map((item) => item.timeGapMinutes));
    return { ok: details.every((item) => canShareVehicle(item, 45)), blocked: false, text: far ? "وجهة بعيدة" : `فارق ${gap} د` };
  };
  const candidates = pending
    .filter((trip) => !ids.includes(trip.request.id) && !isTransfer(trip.request, trip.appointment) && (!direction || trip.request.direction === direction))
    .map((trip) => ({ trip, fit: fit(trip) }))
    .sort((a, b) => Number(b.fit.ok) - Number(a.fit.ok) || timeOf(a.trip).getTime() - timeOf(b.trip).getTime());
  const choices = members.length ? choicesFor(members) : [];
  const ready = choices.filter((choice) => !choice.why).map((choice) => choice.vehicle);
  const suggested = members.length ? suggestFor(members) : null;
  const vehicle = ready.find((item) => item.plate === plate) ?? suggested;
  // المقاعد بالأشخاص: الضيف ومرافقه والـ Nurse
  const persons = sumPersons(members);
  const seats = vehicle ? vehicleSeats(vehicle) : null;
  // لا توجد سيارة تتسع للرحلة: السيدان 3 (أو 4 بطاقتها الكاملة)، وسيارة الاحتياجات الخاصة ضيف احتياجات خاصة و3 عاديون
  const special = members.some((trip) => trip.appointment.kind === "احتياجات خاصة");
  const tooMany = members.length > 1 && !ready.length && persons > groupSeats(members.map((trip) => trip.appointment));
  const row = (trip: Trip) => (
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span dir="ltr" className="font-semibold text-ink tabular">{trip.appointment.appointmentAt}</span>
        <span className="font-medium text-ink">{riderName(trip)}</span>
        {trip.persons > 1 && <Badge>{personsText(trip.persons)}</Badge>}
        {trip.appointment.kind === "احتياجات خاصة" && <Badge tone="amber">احتياجات خاصة</Badge>}
        {isNonMedical(trip.appointment) && <Badge tone="violet">غير طبية</Badge>}
        {trip.appointment.nurse && <Badge tone="violet">ممرضة</Badge>}
        {isPriority(trip.appointment) && <span className="text-xs font-medium text-red-700">أولوية</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">{routeLabel(trip.appointment, trip.from)}{trip.request.createdAt ? ` · ${requestTimes(trip)}` : ""}</span>
    </span>
  );

  return (
    <Modal
      tone="violet"
      icon={Layers}
      title="تعديل الرحلة المجمّعة"
      description="أضف ضيوفًا أو أزلهم واختر السيارة، ثم أرسلها. السيارة 3 ضيوف، والباص 14، وسيارة الاحتياجات الخاصة ضيفان."
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!members.length || !vehicle} onClick={() => vehicle && onDispatch(members.map((trip) => trip.request.id), vehicle.plate)} className={btn("primary")}>
            <Send className="h-4 w-4" /> إرسال السيارة{members.length ? ` · ${guestsText(members.length)}` : ""}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <section>
          <p className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
            <span>في هذه الرحلة{direction ? ` (${direction})` : ""}</span>
            {seats !== null && <span className={cx("text-xs font-medium", members.length > 1 && persons > seats ? "text-red-700" : "text-slate-500")}>{personsText(persons)} من {seats} {seats > 10 ? "مقعدًا" : "مقاعد"}</span>}
          </p>
          {members.length ? (
            <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-violet-200">
              {members.map((trip) => (
                <li key={trip.request.id} className="flex items-center gap-2 p-3">
                  {row(trip)}
                  <button type="button" onClick={() => setIds((current) => current.filter((id) => id !== trip.request.id))} aria-label={`إزالة ${trip.appointment.patientName} من الرحلة`} className={cx(btn("ghost", "sm"), "text-red-700")}>
                    <Minus className="h-4 w-4" /> إزالة
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">أضف ضيفًا واحدًا على الأقل من القائمة أدناه</p>}
        </section>

        <section>
          <p className="mb-1.5 block text-sm font-semibold text-ink">السيارة</p>
          <div className="flex">
            <VehiclePicker
              label="سيارة الرحلة المجمّعة"
              options={choices}
              value={vehicle?.plate ?? ""}
              disabled={!members.length}
              onChange={setPlate}
              placeholder={members.length ? "لا توجد سيارة تناسب هذه الرحلة الآن" : "—"}
              driverOf={(item) => driverOf(item.plate, item.driver)}
              details={(item) => `${placeText(item.plate)} · ${tripsText(load.get(item.plate) ?? 0)}`}
              roleOf={roleOf}
            />
          </div>
          {tooMany && (
            <p className="mt-1.5 text-xs text-red-700">
              {special
                ? "سيارة الاحتياجات الخاصة تتسع لضيف احتياجات خاصة و3 أشخاص عاديين (مع المرافقين والـ Nurse)؛ أزل بعض الضيوف"
                : "أكثر من 3 أشخاص (مع المرافقين والـ Nurse) يحتاجون سيدان بطاقتها الكاملة (4) أو باصًا متاحًا، أو أزل بعض الضيوف"}
            </p>
          )}
        </section>

        <section>
          <p className="mb-2 text-sm font-semibold text-ink">إضافة ضيف <span className="font-normal text-slate-500">(ينتظرون السيارة{direction ? ` · ${direction}` : ""})</span></p>
          {candidates.length ? (
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl ring-1 ring-slate-200">
              {candidates.map(({ trip, fit: match }) => (
                <li key={trip.request.id} className="flex items-center gap-2 p-3">
                  {row(trip)}
                  <Badge tone={match.ok ? "violet" : "neutral"}>{match.ok ? "مناسب للجمع" : match.text}</Badge>
                  <button type="button" disabled={match.blocked} title={match.blocked ? "لا يُجمع ضيفا احتياجات خاصة في سيارة واحدة" : undefined} onClick={() => setIds((current) => [...current, trip.request.id])} aria-label={`إضافة ${trip.appointment.patientName} إلى الرحلة`} className={btn("secondary", "sm")}>
                    <Plus className="h-4 w-4" /> إضافة
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="rounded-lg bg-slate-50 px-3 py-3 text-center text-sm text-slate-500">لا توجد طلبات أخرى بانتظار التوزيع في هذا الاتجاه</p>}
        </section>
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
