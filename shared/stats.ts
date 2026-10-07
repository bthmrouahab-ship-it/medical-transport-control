import { DEFAULT_HOSPITALS, ORIGIN, matchHospital, normalizePlaceName, type Hospital } from "./hospitals";
import type { HistorySummary } from "./history";
import {
  SCHEDULED_ROLES,
  VEHICLE_ROLES,
  appointmentDateTime,
  appointmentHospital,
  isNonMedical,
  isAllDay,
  isReturnOnly,
  localDateString,
  scheduleOf,
  type RoleSchedules,
  type ScheduledRole,
  type VehicleRole,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "./transport";
import { LATE_MINUTES, UNKNOWN_TRAVEL_MINUTES, driveMinutes, neededAt, tripPhase } from "./trips";
import { appointmentOutcome, approvalInfo, returnOutcome, ridesOf, type ApprovalInfo, type Outcome, type ReturnOutcome, type Ride } from "./operations";

/**
 * سجلات الرحلات للإحصائيات: رحلة واحدة لكل موعد، بلا اسم المريض أو رقمه أو شقته.
 * مصادرها: ملفات Excel المستوردة (تُحفظ يومًا بيوم)، ورحلات النظام نفسه (تُحسب مباشرة من المواعيد والطلبات).
 */

export type TripKind = "سيدان" | "احتياجات خاصة" | "باص";
export const TRIP_KINDS: TripKind[] = ["سيدان", "احتياجات خاصة", "باص"];

export type TripStat = {
  /** تاريخ الرحلة YYYY-MM-DD */
  date: string;
  /** ساعة خروج السيارة */
  hour: number | null;
  /** نوع المركبة التي خرجت؛ null = لم تخرج سيارة */
  kind: TripKind | null;
  hospitalId: string | null;
  /** اسم الوجهة (للوجهات خارج دليل المستشفيات) */
  place: string;
  plate: string | null;
  driver: string | null;
  building: string | null;
  /** مدة الرحلة من خروج السيارة إلى عودتها */
  minutes: number | null;
  nonMedical: boolean;
  /** رحلات النظام: سيارات أخرى خدمت نفس الموعد (العودة أو النقل بسيارة غير سيارة الذهاب) */
  otherVehicles?: { plate: string; driver: string | null; kind: TripKind }[];
  /** ملفات Excel: خروج السيارة ودخولها بالدقائق منذ منتصف الليل (الملفات المرفوعة قبل هذه الخانة بلا وقت دقيق) */
  out?: number;
  back?: number;
  /** رحلات النظام: كل رحلة سيارة للموعد (ذهاب أو عودة أو نقل) من إرسالها حتى عودتها إلى المجمع */
  legs?: TripLeg[];
  /** من الملخص القديم: العدد اليومي ونوع المركبة فقط، بلا ساعة أو وجهة أو سيارة */
  legacy?: boolean;
  /** رحلات النظام: رقم الموعد (لجدول المواعيد بالتفصيل) */
  appointmentId?: string;
  /** رحلات النظام: رحلات السيارات المنجزة (أُرسلت لها سيارة) ذهابًا وعودة؛ النقل بين موعدين ذهاب */
  goTrips?: number;
  returnTrips?: number;
  /** رحلات النظام: سُجّل الموعد قبل يومه (مجدول) أو في يومه نفسه (عاجل)؛ بلا الخانة لما سُجّل قبل حفظ وقت التسجيل */
  booking?: Booking;
  /** رحلات النظام: مراحل كل رحلة سيارة للموعد وتأخيرها */
  timings?: RequestTiming[];
  /** رحلات النظام: مصير الموعد (أُرسلت سيارة، أُلغي، استُبعد، انتهت المهلة…) */
  outcome?: Outcome;
  /** رحلات النظام: سبب إلغاء الموعد ومن ألغاه */
  cancel?: { reason: string; by: string };
  /** رحلات النظام: العودة إلى المجمع لضيف استُلم في الذهاب */
  returnOutcome?: ReturnOutcome;
  /** رحلات النظام: رحلات السيارات للموعد بعدد الأشخاص ومقاعد السيارة (للجمع والإشغال) */
  rides?: Ride[];
  /** رحلات النظام: موافقة مسؤول العيادة على الموعد الطبي */
  approval?: ApprovalInfo;
};

/** المواعيد المجدولة (سُجّلت قبل يوم الموعد) والعاجلة (سُجّلت في يوم الموعد نفسه) */
export type Booking = "scheduled" | "sameDay";
export const BOOKING_LABELS: Record<Booking, string> = { scheduled: "مجدولة", sameDay: "عاجلة" };
export const BOOKING_HINTS: Record<Booking, string> = { scheduled: "سُجّلت قبل يوم الموعد", sameDay: "سُجّلت في يوم الموعد نفسه" };

/** نوع تسجيل الموعد من وقت إضافته (addedAt، يكتبه الخادم)، أو null إن لم يُعرف. */
export function bookingOf(appointment: Pick<ClinicAppointment, "addedAt" | "appointmentDate">): Booking | null {
  const added = appointment.addedAt ? new Date(appointment.addedAt) : null;
  if (!added || Number.isNaN(added.getTime())) return null;
  return localDateString(added) < appointment.appointmentDate ? "scheduled" : "sameDay";
}

/**
 * مراحل تأخير رحلة السيارة (رحلات النظام فقط):
 * - dispatch: أُرسلت السيارة بعد وقت الحاجة إليها (neededAt) لعدم وجود سيارة متاحة.
 * - fromComplex: رحلة عودة أو نقل تأخر وصول السيارة إلى المستشفى لأنها انطلقت من المجمع.
 * - unregistered: السيارة كانت عند المستشفى (GPS) قبل أن يُسجَّل وصولها.
 * - arrival: تأخر وصول السيارة إلى المبنى في رحلة الذهاب.
 * - guest: وصلت السيارة وتأخر الضيف في النزول.
 */
export type DelayStage = "dispatch" | "fromComplex" | "unregistered" | "arrival" | "guest";
export const DISPATCH_LATE_MINUTES = 15;
export const GUEST_LATE_MINUTES = 10;
export const UNREGISTERED_MINUTES = 5;
export const DELAY_STAGES: { stage: DelayStage; label: string; when: string; hint: string }[] = [
  { stage: "dispatch", label: "تأخر الإرسال", when: "عند الإرسال", hint: `لا توجد سيارة متاحة: أُرسلت السيارة بعد وقت الحاجة إليها بـ ${DISPATCH_LATE_MINUTES} دقيقة أو أكثر` },
  { stage: "fromComplex", label: "السيارة ذاهبة من المجمع إلى المستشفى", when: "عند الاستلام", hint: `رحلة عودة أو نقل: وصلت السيارة إلى المستشفى بعد ${LATE_MINUTES} دقيقة أو أكثر من إرسالها` },
  { stage: "unregistered", label: "السائق وصل ولم يسجّل وصوله", when: "عند الاستلام", hint: `موقع السيارة (GPS) عند المستشفى قبل تسجيل وصولها بـ ${UNREGISTERED_MINUTES} دقائق أو أكثر` },
  { stage: "arrival", label: "تأخر وصول السيارة إلى المبنى", when: "عند الاستلام", hint: `رحلة ذهاب: وصلت السيارة إلى المبنى بعد ${LATE_MINUTES} دقيقة أو أكثر من إرسالها` },
  { stage: "guest", label: "السائق وصل والضيف تأخر في النزول", when: "عند الاستلام", hint: `استُلم الضيف بعد وصول السيارة بـ ${GUEST_LATE_MINUTES} دقائق أو أكثر` },
];
export const DELAY_LABELS = Object.fromEntries(DELAY_STAGES.map((item) => [item.stage, item.label])) as Record<DelayStage, string>;

/** مراحل رحلة سيارة بالدقائق (null = لا يُعرف)، والمراحل المتأخرة منها. */
export type RequestTiming = {
  requestId: string;
  direction: "ذهاب" | "عودة" | "نقل";
  plate: string;
  /** من وقت الحاجة إلى السيارة حتى إرسالها */
  dispatchWait: number | null;
  /** من الإرسال حتى تسجيل وصول السيارة إلى نقطة الاستلام */
  toPickup: number | null;
  /** من وجود السيارة عند المستشفى (GPS) حتى تسجيل وصولها */
  unregistered: number | null;
  /** من وصول السيارة حتى استلام الضيف */
  guestWait: number | null;
  /** رحلة ذهاب طبية بوصول مسجل (GPS أو مؤكد): دقائق وصول الضيف بعد موعده (صفر أو أقل: في موعده) */
  lateToAppointment: number | null;
  stages: DelayStage[];
};

const toDate = (value: string | undefined) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};
const minutesBetween = (from: Date | null, to: Date | null) => (from && to ? Math.round((to.getTime() - from.getTime()) / 60000) : null);
const notNegative = (value: number | null) => (value === null ? null : Math.max(0, value));
/** وقت «HH:MM» في يوم الموعد */
function clockOn(date: string, time: string | undefined) {
  const match = time?.match(/^(\d{1,2}):(\d{2})$/);
  return match ? appointmentDateTime({ appointmentDate: date, appointmentAt: `${match[1].padStart(2, "0")}:${match[2]}` }) : null;
}

/** مراحل رحلة سيارة أُرسلت (للإحصائيات): الإرسال، والوصول إلى نقطة الاستلام، والاستلام، والوصول إلى الموعد. */
export function requestTiming(request: VehicleRequest, appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS): RequestTiming | null {
  if (!request.vehiclePlate) return null;
  const direction = request.fromAppointmentId ? "نقل" : request.direction;
  const sent = clockOn(appointment.appointmentDate, request.notificationSentAt);
  // وصول السيارة: كما سجّله السائق من تطبيقه (ما لم ينفه مشرف المبنى)، أو كما سجّله مشرف المبنى
  const arrival = (request.arrivalCheck === "denied" ? null : toDate(request.driverArrivedAt)) ?? toDate(request.pickupArrivedAt);
  const near = toDate(request.nearPickupAt);
  const pickedUp = toDate(request.pickedUpAt);
  const dispatchWait = notNegative(minutesBetween(neededAt(request, appointment, hospitals), sent));
  const toPickup = notNegative(minutesBetween(sent, arrival));
  const unregistered = near && arrival && arrival > near ? minutesBetween(near, arrival) : null;
  const guestWait = notNegative(minutesBetween(arrival, pickedUp));
  const arrived = pickedUp && (request.arrivalSource === "gps" || request.arrivalSource === "manual") ? toDate(request.arrivedAt) : null;
  const lateBy = direction === "ذهاب" && !isNonMedical(appointment) && !isReturnOnly(appointment) ? minutesBetween(appointmentDateTime(appointment), arrived) : null;
  const stages: DelayStage[] = [];
  if (dispatchWait !== null && dispatchWait >= DISPATCH_LATE_MINUTES) stages.push("dispatch");
  if (unregistered !== null && unregistered >= UNREGISTERED_MINUTES) stages.push("unregistered");
  else if (toPickup !== null && toPickup >= LATE_MINUTES) stages.push(direction === "ذهاب" ? "arrival" : "fromComplex");
  if (guestWait !== null && guestWait >= GUEST_LATE_MINUTES) stages.push("guest");
  return {
    requestId: request.id,
    direction,
    plate: request.vehiclePlate,
    dispatchWait,
    toPickup,
    unregistered,
    guestWait,
    lateToAppointment: lateBy,
    stages,
  };
}

/** دقائق المرحلة المتأخرة في رحلة */
export function stageMinutes(timing: RequestTiming, stage: DelayStage) {
  if (stage === "dispatch") return timing.dispatchWait;
  if (stage === "unregistered") return timing.unregistered;
  if (stage === "guest") return timing.guestWait;
  return timing.toPickup;
}

export type DelaySummary = {
  /** رحلات السيارات من النظام في الفترة (أُرسلت لها سيارة) */
  trips: number;
  /** رحلات فيها مرحلة متأخرة واحدة على الأقل */
  late: number;
  stages: { stage: DelayStage; trips: number; avgMinutes: number | null }[];
  /** رحلات ذهاب طبية وصل فيها الضيف بعد موعده، من الرحلات التي سُجّل وصولها */
  lateToAppointment: { trips: number; avgMinutes: number | null; measured: number };
  /** رحلات بلا وقت مسجل لوصول السيارة إلى نقطة الاستلام (قبل حفظه في النظام) */
  withoutArrival: number;
};

// ————— توفر السيارات في الخدمة —————

/** حالة سيارة في الخدمة عند تغيّرها (من الخادم: service-log) */
export type ServiceEvent = { at: string; plate: string; kind: string; available: boolean; hasDriver: boolean; busRole: string; driver: string };
/** وقت سيارة في الخدمة (متاحة ولها سائق) في يوم: الدقائق، وأول تشغيل وآخر إيقاف بالدقائق منذ منتصف الليل */
export type ServiceDay = { date: string; plate: string; kind: string; busRole: VehicleRole | null; driver: string; minutes: number; first: number; last: number };
export type ServiceVehicle = { plate: string; kind: string; busRoles: VehicleRole[]; driver: string; days: number; minutes: number; first: number | null; last: number | null };
export type ServiceSummary = { days: ServiceDay[]; vehicles: ServiceVehicle[]; totalMinutes: number };

const DAY_MS = 24 * 60 * 60000;
const roleOf = (value: string): VehicleRole | null => (VEHICLE_ROLES.includes(value as VehicleRole) ? value as VehicleRole : null);
/**
 * الباصات المخصصة وسيارات المدارس لا تُسجَّل لها رحلات، فتُعد سيارات عاملة في أيام خدمتها: باص العيادة وباص المجمع كل
 * يوم، وسيارة المدارس وباص الجامعة في أيام أوقاتهما المحجوزة (RoleSchedules).
 */
export const SERVICE_ROLES: VehicleRole[] = ["clinic", "shuttle", "nonMedical", "school"];

/**
 * وقت كل سيارة في الخدمة (متاحة ولها سائق) في كل يوم من الفترة، من تغيّرات حالتها.
 * الحالة قبل أول تغيير في الفترة هي آخر حالة قبلها (يرسلها الخادم أولًا)، والسيارة في الخدمة الآن حتى «الآن».
 */
export function serviceHours(events: ServiceEvent[], from: string, to: string, now = new Date()): ServiceSummary {
  const start = from ? appointmentDateTime({ appointmentDate: from, appointmentAt: "00:00" }).getTime() : -Infinity;
  const end = Math.min(now.getTime(), to ? appointmentDateTime({ appointmentDate: to, appointmentAt: "00:00" }).getTime() + DAY_MS : Infinity);
  const byPlate = new Map<string, ServiceEvent[]>();
  for (const event of [...events].sort((a, b) => a.at.localeCompare(b.at))) byPlate.set(event.plate, [...(byPlate.get(event.plate) ?? []), event]);
  const dayMap = new Map<string, ServiceDay>();
  const addInterval = (event: ServiceEvent, intervalStart: number, intervalEnd: number) => {
    let cursor = Math.max(intervalStart, start);
    const stop = Math.min(intervalEnd, end);
    while (cursor < stop) {
      const date = localDateString(new Date(cursor));
      const midnight = appointmentDateTime({ appointmentDate: date, appointmentAt: "00:00" }).getTime();
      const dayEnd = Math.min(stop, midnight + DAY_MS);
      const key = `${date}|${event.plate}`;
      const first = Math.round((cursor - midnight) / 60000);
      const last = Math.round((dayEnd - midnight) / 60000);
      const day = dayMap.get(key) ?? { date, plate: event.plate, kind: event.kind, busRole: null, driver: event.driver, minutes: 0, first, last };
      day.minutes += (dayEnd - cursor) / 60000;
      day.first = Math.min(day.first, first);
      day.last = Math.max(day.last, last);
      day.kind = event.kind || day.kind;
      day.driver = event.driver || day.driver;
      day.busRole = roleOf(event.busRole) ?? day.busRole;
      dayMap.set(key, day);
      cursor = dayEnd;
    }
  };
  for (const list of Array.from(byPlate.values())) {
    list.forEach((event, index) => {
      if (!event.available || !event.hasDriver) return;
      const next = list[index + 1];
      addInterval(event, Date.parse(event.at), next ? Date.parse(next.at) : Infinity);
    });
  }
  const days = Array.from(dayMap.values())
    .map((day) => ({ ...day, minutes: Math.round(day.minutes) }))
    .filter((day) => day.minutes > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || b.minutes - a.minutes);
  const vehicles = new Map<string, ServiceVehicle>();
  for (const day of days) {
    const vehicle = vehicles.get(day.plate) ?? { plate: day.plate, kind: day.kind, busRoles: [], driver: day.driver, days: 0, minutes: 0, first: day.first, last: day.last };
    vehicle.days += 1;
    vehicle.minutes += day.minutes;
    vehicle.driver = day.driver || vehicle.driver;
    if (day.busRole && !vehicle.busRoles.includes(day.busRole)) vehicle.busRoles.push(day.busRole);
    vehicles.set(day.plate, vehicle);
  }
  const list = Array.from(vehicles.values()).map((vehicle) => (vehicle.days === 1 ? vehicle : { ...vehicle, first: null, last: null }))
    .sort((a, b) => b.minutes - a.minutes);
  return { days, vehicles: list, totalMinutes: days.reduce((total, day) => total + day.minutes, 0) };
}

/** مستند يوم في المجموعة statsDays: رحلات يوم واحد من ملف Excel. */
export type StatsDay = { date: string; source: string; importedAt: string; trips: TripStat[] };

export type StatsSource = "all" | "excel" | "system";
export type StatsCategory = "all" | "medical" | "nonMedical";

export type StatsFilter = {
  /** "" = بلا حد */
  from: string;
  to: string;
  source: StatsSource;
  kind: TripKind | "all";
  zone: string;
  destination: string;
  plate: string;
  building: string;
  category: StatsCategory;
};

export const EMPTY_FILTER: StatsFilter = {
  from: "",
  to: "",
  source: "all",
  kind: "all",
  zone: "all",
  destination: "all",
  plate: "all",
  building: "all",
  category: "all",
};

export type DailyStat = {
  date: string;
  weekday: string;
  total: number;
  completed: number;
  sedan: number;
  special: number;
  bus: number;
  /** عدد السيارات التي عملت في اليوم (بلا تكرار)؛ لا يوجد لأيام الملخص القديم */
  vehicles?: number;
};
export type DestinationStat = { key: string; name: string; hospitalId: string | null; zone: string | null; trips: number; avgMinutes: number | null };

export type StatsSummary = {
  from: string;
  to: string;
  totalTrips: number;
  completedTrips: number;
  activeDays: number;
  avgTripMinutes: number | null;
  daily: DailyStat[];
  byWeekday: { weekday: string; trips: number; days: number }[];
  byHour: { hour: number; trips: number }[];
  byKind: { kind: TripKind; trips: number }[];
  destinations: DestinationStat[];
  zones: { zone: string; trips: number }[];
  /** kind: نوع السيارة من رحلاتها (السيارات في الملخص القديم بلا نوع) */
  vehicles: { plate: string; driver: string; trips: number; kind?: TripKind | null }[];
  /** السيارات التي عملت في الفترة: عددها بلا تكرار، وحسب نوعها، ومتوسطها وأعلاها في اليوم */
  workingVehicles?: WorkingVehicles;
  /** ساعات عمل السيارات في كل يوم وفي الفترة */
  workHours?: WorkHours;
  /** رحلات السيارات المنجزة ذهابًا وعودة (من النظام)، وما لا يُعرف اتجاهه (ملفات Excel والملخص القديم) */
  /** backOnly: مواعيد منجزة برحلة عودة فقط بلا رحلة ذهاب (طلب العودة فقط من المستشفى) */
  directions?: { go: number; back: number; unknown: number; backOnly: number };
  /** المواعيد المجدولة والعاجلة (من النظام)، وما لا يُعرف وقت تسجيله */
  booking?: Record<Booking | "unknown", number>;
  /** تأخير رحلات السيارات ومراحله (من النظام) */
  delays?: DelaySummary;
  buildings: { building: string; trips: number }[];
  unmatchedDestinations: number;
  /** رحلات منجزة من الملخص القديم لا تظهر في الساعات والوجهات والسيارات والمباني */
  withoutDetails?: number;
};

/**
 * رحلة سيارة لساعات العمل: من خروجها (إرسالها) حتى عودتها إلى المجمع، بالدقائق منذ منتصف ليل يوم الرحلة.
 * approx: من ملف Excel قديم بلا وقت خروج دقيق (البداية من ساعة الخروج)، فلا يُعرض منه أول خروج وآخر عودة.
 */
export type TripLeg = { plate: string; driver: string | null; kind: TripKind; start: number; end: number; approx?: true };

/** ساعات عمل سيارة في يوم: أول خروج وآخر عودة (بالدقائق منذ منتصف الليل) ومجموع وقتها في الرحلات بلا تداخل. */
export type VehicleDayHours = { date: string; plate: string; driver: string; kind: TripKind; first: number | null; last: number | null; minutes: number };
/** ساعات عمل سيارة في الفترة: أول خروج وآخر عودة لليوم الواحد فقط */
export type VehicleHours = { plate: string; driver: string; kind: TripKind; days: number; minutes: number; first: number | null; last: number | null };
export type WorkHours = {
  days: VehicleDayHours[];
  vehicles: VehicleHours[];
  totalMinutes: number;
  /** متوسط ساعات السيارة في اليوم الذي عملت فيه */
  avgDayMinutes: number | null;
};

/** أطول رحلة تُحسب (مثل مدة الرحلة في ملفات Excel)؛ الأطول خطأ في التسجيل */
export const MAX_LEG_MINUTES = 6 * 60;

/** «5 س 20 د» */
export function durationText(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours ? (rest ? `${hours} س ${rest} د` : `${hours} س`) : `${rest} د`;
}

/** «07:05»، وبعد منتصف الليل «00:30 (+1)» */
export function clockText(minutes: number | null) {
  if (minutes === null) return "";
  const day = Math.floor(minutes / (24 * 60));
  const inDay = Math.round(minutes - day * 24 * 60);
  const text = `${String(Math.floor(inDay / 60)).padStart(2, "0")}:${String(inDay % 60).padStart(2, "0")}`;
  return day ? `${text} (+${day})` : text;
}

/** رحلات السيارات لساعات العمل: رحلات النظام كما هي، وصف ملف Excel من خروج السيارة إلى دخولها. */
export function tripLegs(trip: TripStat): TripLeg[] {
  if (trip.legs) return trip.legs;
  if (!trip.plate || !trip.kind || trip.minutes === null) return [];
  if (trip.out !== undefined && trip.back !== undefined) return [{ plate: trip.plate, driver: trip.driver, kind: trip.kind, start: trip.out, end: trip.back }];
  if (trip.hour === null) return [];
  return [{ plate: trip.plate, driver: trip.driver, kind: trip.kind, start: trip.hour * 60, end: trip.hour * 60 + trip.minutes, approx: true }];
}

/** مجموع فترات متداخلة بلا تكرار (الرحلة المجمّعة، أو العودة التي تبدأ قبل وصول السيارة إلى المجمع). */
function unionMinutes(intervals: [number, number][]) {
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (current && start <= current[1]) current[1] = Math.max(current[1], end);
    else {
      if (current) total += current[1] - current[0];
      current = [start, end];
    }
  }
  return total + (current ? current[1] - current[0] : 0);
}

/**
 * رحلة سيارة من النظام: من إرسالها (notificationSentAt، ساعة يوم الموعد) حتى وصولها إلى الوجهة
 * (GPS أو التأكيد أو الوقت المتوقع)، ومعها بعد رحلة الذهاب طريق العودة الفارغة إلى المجمع تقديريًا
 * (مثل مكان السيارة في vehicleLocationState). الرحلة الجارية لا تُحسب حتى تصل.
 */
function systemLeg(request: VehicleRequest, appointment: ClinicAppointment, hospitals: Hospital[], kind: TripKind, now: Date): TripLeg | null {
  const sent = request.notificationSentAt?.match(/^(\d{1,2}):(\d{2})/);
  if (!request.vehiclePlate || !sent) return null;
  const phase = tripPhase(request, now);
  if (phase.kind !== "arrived" || !phase.at) return null;
  const start = Number(sent[1]) * 60 + Number(sent[2]);
  const midnight = appointmentDateTime({ appointmentDate: appointment.appointmentDate, appointmentAt: "00:00" });
  let end = Math.round((phase.at.getTime() - midnight.getTime()) / 60000);
  if (request.direction === "ذهاب") {
    const hospital = appointmentHospital(appointment, hospitals);
    const place = request.destLat !== undefined && request.destLng !== undefined
      ? { lat: request.destLat, lng: request.destLng }
      : hospital ? { lat: hospital.lat, lng: hospital.lng } : null;
    end += Math.ceil(place ? driveMinutes(place, { lat: ORIGIN.lat, lng: ORIGIN.lng }, phase.at) : UNKNOWN_TRAVEL_MINUTES - 10);
  }
  if (end <= start || end - start > MAX_LEG_MINUTES) return null;
  return { plate: request.vehiclePlate, driver: request.driver ?? null, kind, start, end };
}

export type WorkingVehicles = {
  total: number;
  /** حسب نوع المركبة، للسيارات التي يُعرف نوعها */
  byKind: { kind: TripKind; vehicles: number }[];
  /** من الأيام التي لها تفاصيل السيارات فقط */
  dailyAverage: number | null;
  dailyMax: number | null;
  /** الباصات المخصصة (العيادة والمجمع والرحلات غير الطبية) التي كانت في الخدمة، ومنها ما لم تُسجَّل له رحلات */
  roleBuses: { plate: string; busRole: VehicleRole }[];
};

/** كل السيارات التي خدمت الموعد: سيارة الذهاب ثم سيارات العودة أو النقل */
export function tripVehicles(trip: TripStat) {
  const main = trip.plate && trip.kind ? [{ plate: trip.plate, driver: trip.driver, kind: trip.kind }] : [];
  return [...main, ...(trip.otherVehicles ?? [])];
}

export const OTHER_ZONE = "وجهات أخرى";
const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function hospitalOf(trip: Pick<TripStat, "hospitalId">, hospitals: Hospital[]) {
  return trip.hospitalId ? hospitals.find((hospital) => hospital.id === trip.hospitalId) ?? null : null;
}

export function tripZone(trip: TripStat, hospitals: Hospital[]) {
  return hospitalOf(trip, hospitals)?.zone ?? OTHER_ZONE;
}

type Destination = { key: string; name: string; hospitalId: string | null; zone: string | null };

export function tripDestination(trip: TripStat, hospitals: Hospital[]): Destination {
  const hospital = hospitalOf(trip, hospitals);
  if (hospital) return { key: `h:${hospital.id}`, name: hospital.name, hospitalId: hospital.id, zone: hospital.zone };
  const name = trip.place || "غير محدد";
  return { key: trip.hospitalId ? `h:${trip.hospitalId}` : `t:${normalizePlaceName(name) || "غير محدد"}`, name, hospitalId: trip.hospitalId, zone: null };
}

// ————— رحلات النظام —————

function hourOf(time: string | undefined) {
  const match = time?.match(/^(\d{1,2}):\d{2}/);
  return match && Number(match[1]) < 24 ? Number(match[1]) : null;
}

/** رحلات النظام: كل موعد رحلة، وتُعتبر منجزة إذا أُرسلت لها سيارة. */
export function tripsFromSystem(
  appointments: ClinicAppointment[],
  requests: VehicleRequest[],
  fleet: (Pick<Vehicle, "plate" | "kind"> & Partial<Pick<Vehicle, "fullCapacity">>)[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
): TripStat[] {
  const byAppointment = new Map<string, VehicleRequest[]>();
  for (const request of requests) byAppointment.set(request.appointmentId, [...(byAppointment.get(request.appointmentId) ?? []), request]);
  // مواعيد نُقل ضيفها إلى موعده التالي (طلب ذهاب يبدأ من مستشفاها)
  const transfers = new Set(requests.flatMap((request) => (request.fromAppointmentId ? [request.fromAppointmentId] : [])));
  return appointments.map((appointment) => {
    const own = byAppointment.get(appointment.id) ?? [];
    const sent = own.filter((request) => request.vehiclePlate);
    const request = sent.find((item) => item.direction === "ذهاب") ?? sent[0];
    const nonMedical = appointment.category === "غير طبية";
    const hospital = nonMedical
      ? null
      : (appointment.hospitalId && hospitals.find((item) => item.id === appointment.hospitalId)) || matchHospital(appointment.clinic, hospitals);
    const kindOf = (plate: string): TripKind => fleet.find((vehicle) => vehicle.plate === plate)?.kind
      ?? (appointment.kind === "احتياجات خاصة" ? "احتياجات خاصة" : "سيدان");
    const kind: TripKind | null = request?.vehiclePlate ? kindOf(request.vehiclePlate) : null;
    // العودة أو النقل بسيارة أخرى: تُحسب السيارة بين السيارات التي عملت
    const otherVehicles: NonNullable<TripStat["otherVehicles"]> = [];
    for (const item of sent) {
      const plate = item.vehiclePlate!;
      if (plate !== request?.vehiclePlate && !otherVehicles.some((vehicle) => vehicle.plate === plate)) {
        otherVehicles.push({ plate, driver: item.driver ?? null, kind: kindOf(plate) });
      }
    }
    const legs = sent.flatMap((item) => systemLeg(item, appointment, hospitals, kindOf(item.vehiclePlate!), now) ?? []);
    const timings = sent.flatMap((item) => requestTiming(item, appointment, hospitals) ?? []);
    const booking = bookingOf(appointment);
    // مدة الرحلة: رحلة سيارة الذهاب من إرسالها حتى عودتها إلى المجمع
    const main = request ? systemLeg(request, appointment, hospitals, kindOf(request.vehiclePlate!), now) : null;
    const building = appointment.buildingNumber.trim();
    const outcome = appointmentOutcome(appointment, own, now);
    const back = returnOutcome(appointment, own, transfers, now);
    const rides = ridesOf(appointment, own, (plate) => fleet.find((vehicle) => vehicle.plate === plate) ?? { kind: kindOf(plate) });
    const approval = approvalInfo(appointment, now);
    return {
      date: appointment.appointmentDate,
      hour: hourOf(request?.notificationSentAt) ?? hourOf(appointment.appointmentAt),
      kind,
      hospitalId: hospital?.id ?? (nonMedical ? null : appointment.hospitalId ?? null),
      place: hospital?.name ?? appointment.clinic,
      plate: request?.vehiclePlate ?? null,
      driver: request?.driver ?? null,
      building: building && building !== "غير محدد" ? building : null,
      minutes: main ? main.end - main.start : null,
      nonMedical,
      ...(otherVehicles.length ? { otherVehicles } : {}),
      ...(legs.length ? { legs } : {}),
      appointmentId: appointment.id,
      goTrips: sent.filter((item) => item.direction === "ذهاب").length,
      returnTrips: sent.filter((item) => item.direction === "عودة").length,
      ...(booking ? { booking } : {}),
      ...(timings.length ? { timings } : {}),
      outcome,
      ...(outcome === "cancelled" ? { cancel: { reason: appointment.cancelReason?.trim() ?? "", by: appointment.cancelledBy?.trim() ?? "" } } : {}),
      ...(back ? { returnOutcome: back } : {}),
      ...(rides.length ? { rides } : {}),
      ...(approval ? { approval } : {}),
    };
  });
}

// ————— الملخص القديم (إجماليات فقط) —————

/** الملخص القديم يحفظ لكل يوم العدد ونوع المركبة فقط؛ يُحوَّل إلى سجلات بلا تفاصيل. */
export function legacyTrips(summary: HistorySummary): TripStat[] {
  const trips: TripStat[] = [];
  const make = (date: string, kind: TripKind | null): TripStat => ({
    date, hour: null, kind, hospitalId: null, place: "", plate: null, driver: null, building: null, minutes: null, nonMedical: false, legacy: true,
  });
  for (const day of summary.daily) {
    for (let index = 0; index < day.sedan; index += 1) trips.push(make(day.date, "سيدان"));
    for (let index = 0; index < day.special; index += 1) trips.push(make(day.date, "احتياجات خاصة"));
    for (let index = 0; index < day.bus; index += 1) trips.push(make(day.date, "باص"));
    for (let index = 0; index < day.total - day.completed; index += 1) trips.push(make(day.date, null));
  }
  return trips;
}

function groupByDate(trips: TripStat[]) {
  const days = new Map<string, TripStat[]>();
  for (const trip of trips) days.set(trip.date, [...(days.get(trip.date) ?? []), trip]);
  return days;
}

/**
 * يجمع المصادر. لكل يوم مصدر واحد حتى لا تُحسب الرحلة مرتين:
 * ملف Excel المستورد لذلك اليوم، ثم الملخص القديم، ثم رحلات النظام.
 * تفاصيل الملخص القديم (الساعات والوجهات والسيارات) لا تُستخدم إلا إذا لم يُستبدل أي يوم منه.
 */
export function selectTrips(
  sources: { imported: StatsDay[]; legacy: HistorySummary | null; system: TripStat[] },
  source: StatsSource,
) {
  const excelDays = new Map<string, TripStat[]>();
  for (const day of sources.imported) excelDays.set(day.date, day.trips);
  const importedDates = new Set(excelDays.keys());
  let legacyUsable = Boolean(sources.legacy);
  if (sources.legacy) {
    for (const [date, trips] of Array.from(groupByDate(legacyTrips(sources.legacy)))) {
      if (importedDates.has(date)) legacyUsable = false;
      else excelDays.set(date, trips);
    }
  }
  const systemDays = groupByDate(sources.system);
  const trips: TripStat[] = [];
  let excelCount = 0;
  let systemCount = 0;
  if (source !== "system") {
    for (const list of Array.from(excelDays.values())) trips.push(...list);
    excelCount = excelDays.size;
  }
  if (source !== "excel") {
    for (const [date, list] of Array.from(systemDays)) {
      if (source === "all" && excelDays.has(date)) continue;
      trips.push(...list);
      systemCount += 1;
    }
  }
  return {
    trips,
    legacy: source !== "system" && legacyUsable ? sources.legacy : null,
    days: { excel: excelCount, system: systemCount },
  };
}

// ————— الفلترة —————

export function inRange(date: string, filter: Pick<StatsFilter, "from" | "to">) {
  return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
}

/** فلاتر لا يستطيع الملخص القديم تطبيقها على الساعات والوجهات والسيارات. */
export function hasDetailFilters(filter: StatsFilter) {
  return filter.kind !== "all" || filter.zone !== "all" || filter.destination !== "all"
    || filter.plate !== "all" || filter.building !== "all" || filter.category !== "all";
}

export function matchesFilter(trip: TripStat, filter: StatsFilter, hospitals: Hospital[]) {
  if (!inRange(trip.date, filter)) return false;
  if (filter.kind !== "all" && trip.kind !== filter.kind) return false;
  if (filter.category === "medical" && trip.nonMedical) return false;
  if (filter.category === "nonMedical" && !trip.nonMedical) return false;
  if (filter.plate !== "all" && !tripVehicles(trip).some((vehicle) => vehicle.plate === filter.plate)) return false;
  if (filter.building !== "all" && trip.building !== filter.building) return false;
  if (filter.zone !== "all" && (trip.legacy || tripZone(trip, hospitals) !== filter.zone)) return false;
  if (filter.destination !== "all" && (trip.legacy || tripDestination(trip, hospitals).key !== filter.destination)) return false;
  return true;
}

/** قيم قوائم الفلترة من رحلات الفترة المختارة، الأكثر تكرارًا أولًا. */
export function filterOptions(trips: TripStat[], hospitals: Hospital[]) {
  const zones = new Map<string, number>();
  const destinations = new Map<string, { name: string; zone: string; trips: number }>();
  const plates = new Map<string, number>();
  const buildings = new Map<string, number>();
  for (const trip of trips) {
    if (trip.legacy) continue;
    const zone = tripZone(trip, hospitals);
    zones.set(zone, (zones.get(zone) ?? 0) + 1);
    const destination = tripDestination(trip, hospitals);
    const entry = destinations.get(destination.key) ?? { name: destination.name, zone, trips: 0 };
    entry.trips += 1;
    destinations.set(destination.key, entry);
    for (const { plate } of tripVehicles(trip)) plates.set(plate, (plates.get(plate) ?? 0) + 1);
    if (trip.building) buildings.set(trip.building, (buildings.get(trip.building) ?? 0) + 1);
  }
  const ranked = <T,>(map: Map<string, T>, count: (value: T) => number) =>
    Array.from(map).sort((a, b) => count(b[1]) - count(a[1]));
  return {
    zones: ranked(zones, (value) => value).map(([zone]) => zone),
    destinations: ranked(destinations, (value) => value.trips).map(([key, value]) => ({ key, name: value.name, zone: value.zone })),
    plates: ranked(plates, (value) => value).map(([plate]) => plate),
    buildings: Array.from(buildings.keys()).sort((a, b) => a.localeCompare(b, "ar", { numeric: true })),
  };
}

// ————— التجميع —————

const sortDesc = <T extends { trips: number }>(items: T[]) => items.sort((a, b) => b.trips - a.trips);

/**
 * يلخّص الرحلات للمخططات. الساعات والوجهات والسيارات والمباني ومدة الرحلة تُحسب للرحلات المنجزة فقط.
 * السيارات: كل سيارة خدمت الموعد (الذهاب والعودة والنقل)، وعدد السيارات التي عملت في الفترة وفي كل يوم بلا تكرار.
 * legacy: تفاصيل الملخص القديم تُضاف كما هي عندما تشمل الفترة المختارة كل أيامه ولا توجد فلاتر أخرى.
 */
const driverNames = (drivers: Map<string, number>) => Array.from(drivers).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3).join(" / ");

type VehicleDayEntry = { date: string; plate: string; kind: TripKind; drivers: Map<string, number>; intervals: [number, number][]; first: number | null; last: number | null };

/** ساعات العمل: لكل سيارة في كل يوم وقتها في الرحلات بلا تداخل، ثم مجموعها في الفترة (الأكثر عملًا أولًا). */
function summarizeWorkHours(entries: VehicleDayEntry[]): WorkHours {
  const sorted = [...entries].map((entry) => ({ entry, minutes: unionMinutes(entry.intervals) }))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || b.minutes - a.minutes);
  const byPlate = new Map<string, { kind: TripKind; drivers: Map<string, number>; days: number; minutes: number; first: number | null; last: number | null }>();
  for (const { entry, minutes } of sorted) {
    const vehicle = byPlate.get(entry.plate) ?? { kind: entry.kind, drivers: new Map<string, number>(), days: 0, minutes: 0, first: entry.first, last: entry.last };
    vehicle.days += 1;
    vehicle.minutes += minutes;
    for (const [name, count] of Array.from(entry.drivers)) vehicle.drivers.set(name, (vehicle.drivers.get(name) ?? 0) + count);
    byPlate.set(entry.plate, vehicle);
  }
  const days: VehicleDayHours[] = sorted.map(({ entry, minutes }) => ({
    date: entry.date, plate: entry.plate, driver: driverNames(entry.drivers), kind: entry.kind, first: entry.first, last: entry.last, minutes,
  }));
  const vehicles: VehicleHours[] = Array.from(byPlate, ([plate, vehicle]) => ({
    plate,
    driver: driverNames(vehicle.drivers),
    kind: vehicle.kind,
    days: vehicle.days,
    minutes: vehicle.minutes,
    // أول خروج وآخر عودة لليوم الواحد فقط
    first: vehicle.days === 1 ? vehicle.first : null,
    last: vehicle.days === 1 ? vehicle.last : null,
  })).sort((a, b) => b.minutes - a.minutes);
  const totalMinutes = days.reduce((total, day) => total + day.minutes, 0);
  return { days, vehicles, totalMinutes, avgDayMinutes: days.length ? Math.round(totalMinutes / days.length) : null };
}

/**
 * service: أيام الباصات المخصصة في الخدمة (serviceHours) تُعد سيارات عاملة ولو بلا رحلات في النظام
 * (باص العيادة وباص المجمع)، في أيامها وفي الفترة.
 */
export function summarizeTrips(
  trips: TripStat[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  legacy: HistorySummary | null = null,
  service: ServiceDay[] = [],
  schedules: RoleSchedules | null = null,
): StatsSummary {
  const daily = new Map<string, DailyStat>();
  const hours = new Map<number, number>();
  const kinds = new Map<TripKind, number>();
  const zones = new Map<string, number>();
  const vehicles = new Map<string, { drivers: Map<string, number>; trips: number }>();
  const buildings = new Map<string, number>();
  const destinations = new Map<string, DestinationStat & { minutesTotal: number; minutesCount: number }>();
  // السيارات التي عملت: نوع كل سيارة، وسيارات كل يوم له تفاصيل (لا أيام الملخص القديم)
  const plateKinds = new Map<string, TripKind>();
  const dayPlates = new Map<string, Set<string>>();
  // ساعات العمل: رحلات كل سيارة في كل يوم
  const vehicleDays = new Map<string, VehicleDayEntry>();
  let completedTrips = 0;
  const directions = { go: 0, back: 0, unknown: 0, backOnly: 0 };
  const booking: Record<Booking | "unknown", number> = { scheduled: 0, sameDay: 0, unknown: 0 };
  const timings: RequestTiming[] = [];
  let unmatched = 0;
  let withoutDetails = 0;
  let minutesTotal = 0;
  let minutesCount = 0;

  const addDestination = (destination: Destination, count: number, minutes: number, minutesWeight: number) => {
    const entry = destinations.get(destination.key) ?? { ...destination, trips: 0, avgMinutes: null, minutesTotal: 0, minutesCount: 0 };
    entry.trips += count;
    entry.minutesTotal += minutes;
    entry.minutesCount += minutesWeight;
    destinations.set(destination.key, entry);
  };
  const addVehicle = (plate: string, driver: string, count: number) => {
    const entry = vehicles.get(plate) ?? { drivers: new Map<string, number>(), trips: 0 };
    entry.trips += count;
    for (const name of driver.split(" / ").map((item) => item.trim()).filter(Boolean)) entry.drivers.set(name, (entry.drivers.get(name) ?? 0) + count);
    vehicles.set(plate, entry);
  };

  for (const trip of trips) {
    const day = daily.get(trip.date) ?? { date: trip.date, weekday: weekdayOf(trip.date), total: 0, completed: 0, sedan: 0, special: 0, bus: 0 };
    daily.set(trip.date, day);
    day.total += 1;
    if (!trip.legacy && !dayPlates.has(trip.date)) dayPlates.set(trip.date, new Set());
    if (trip.appointmentId) booking[trip.booking ?? "unknown"] += 1;
    if (trip.timings) timings.push(...trip.timings);
    if (trip.goTrips !== undefined || trip.returnTrips !== undefined) {
      directions.go += trip.goTrips ?? 0;
      directions.back += trip.returnTrips ?? 0;
      if (trip.kind && !trip.goTrips && trip.returnTrips) directions.backOnly += 1;
    } else if (trip.kind) directions.unknown += 1;
    if (!trip.kind) continue;
    completedTrips += 1;
    day.completed += 1;
    if (trip.kind === "سيدان") day.sedan += 1;
    else if (trip.kind === "احتياجات خاصة") day.special += 1;
    else day.bus += 1;
    kinds.set(trip.kind, (kinds.get(trip.kind) ?? 0) + 1);
    if (trip.legacy) {
      withoutDetails += 1;
      continue;
    }
    if (trip.hour !== null) hours.set(trip.hour, (hours.get(trip.hour) ?? 0) + 1);
    if (trip.minutes !== null) {
      minutesTotal += trip.minutes;
      minutesCount += 1;
    }
    const destination = tripDestination(trip, hospitals);
    if (!destination.hospitalId) unmatched += 1;
    addDestination(destination, 1, trip.minutes ?? 0, trip.minutes === null ? 0 : 1);
    const zone = tripZone(trip, hospitals);
    zones.set(zone, (zones.get(zone) ?? 0) + 1);
    for (const vehicle of tripVehicles(trip)) {
      addVehicle(vehicle.plate, vehicle.driver ?? "", 1);
      if (!plateKinds.has(vehicle.plate)) plateKinds.set(vehicle.plate, vehicle.kind);
      dayPlates.get(trip.date)!.add(vehicle.plate);
    }
    for (const leg of tripLegs(trip)) {
      const key = `${trip.date}|${leg.plate}`;
      const entry = vehicleDays.get(key) ?? { date: trip.date, plate: leg.plate, kind: leg.kind, drivers: new Map<string, number>(), intervals: [], first: null, last: null };
      entry.intervals.push([leg.start, leg.end]);
      if (leg.driver) entry.drivers.set(leg.driver, (entry.drivers.get(leg.driver) ?? 0) + 1);
      if (!leg.approx) {
        entry.first = entry.first === null ? leg.start : Math.min(entry.first, leg.start);
        entry.last = entry.last === null ? leg.end : Math.max(entry.last, leg.end);
      }
      vehicleDays.set(key, entry);
    }
    if (trip.building) buildings.set(trip.building, (buildings.get(trip.building) ?? 0) + 1);
  }

  if (legacy) {
    withoutDetails = 0;
    for (const item of legacy.byHour) hours.set(item.hour, (hours.get(item.hour) ?? 0) + item.trips);
    for (const item of legacy.destinations) {
      const hospital = item.hospitalId ? hospitals.find((entry) => entry.id === item.hospitalId) : undefined;
      const destination = hospital
        ? { key: `h:${hospital.id}`, name: hospital.name, hospitalId: hospital.id, zone: hospital.zone }
        : { key: item.key, name: item.name, hospitalId: item.hospitalId, zone: item.zone };
      addDestination(destination, item.trips, (item.avgMinutes ?? 0) * item.trips, item.avgMinutes === null ? 0 : item.trips);
    }
    for (const item of legacy.zones) zones.set(item.zone, (zones.get(item.zone) ?? 0) + item.trips);
    for (const item of legacy.vehicles) addVehicle(item.plate, item.driver, item.trips);
    for (const item of legacy.buildings) buildings.set(item.building, (buildings.get(item.building) ?? 0) + item.trips);
    if (legacy.avgTripMinutes !== null) {
      minutesTotal += legacy.avgTripMinutes * legacy.completedTrips;
      minutesCount += legacy.completedTrips;
    }
    unmatched += legacy.unmatchedDestinations;
  }

  // الباصات المخصصة وسيارات المدارس في الخدمة: سيارات عاملة في أيامها (ولو بلا رحلات)
  const roleBuses = new Map<string, VehicleRole>();
  for (const day of service) {
    if (!day.busRole || !SERVICE_ROLES.includes(day.busRole) || !dayPlates.has(day.date)) continue;
    if ((SCHEDULED_ROLES as VehicleRole[]).includes(day.busRole)) {
      // سيارة المدارس وباص الجامعة: في أيام أوقاتهما فقط (بالأوقات المحفوظة الآن)، وأوقاتهما في وقت خدمتها ذلك اليوم
      // من ساعات عملها؛ والمحجوزة طوال اليوم مثل باص العيادة: سيارة عاملة بلا ساعات عمل معروفة
      const schedule = scheduleOf(schedules, day.busRole as ScheduledRole);
      const [year, month, date] = day.date.split("-").map(Number);
      if (!schedule.days.includes(new Date(Date.UTC(year, month - 1, date)).getUTCDay())) continue;
      const runs = schedule.runs.map((run): [number, number] => [Math.max(run.from, day.first), Math.min(run.to, day.last)]).filter(([start, end]) => end > start);
      if (!runs.length) continue;
      if (!schedule.runs.some(isAllDay)) {
        const key = `${day.date}|${day.plate}`;
        const kind: TripKind = day.busRole === "school" ? "احتياجات خاصة" : "باص";
        const entry = vehicleDays.get(key) ?? { date: day.date, plate: day.plate, kind, drivers: new Map<string, number>(), intervals: [], first: null, last: null };
        for (const [start, end] of runs) {
          entry.intervals.push([start, end]);
          entry.first = entry.first === null ? start : Math.min(entry.first, start);
          entry.last = entry.last === null ? end : Math.max(entry.last, end);
        }
        if (day.driver) entry.drivers.set(day.driver, (entry.drivers.get(day.driver) ?? 0) + runs.length);
        vehicleDays.set(key, entry);
      }
    }
    dayPlates.get(day.date)!.add(day.plate);
    if (!plateKinds.has(day.plate)) plateKinds.set(day.plate, day.busRole === "school" ? "احتياجات خاصة" : "باص");
    roleBuses.set(day.plate, day.busRole);
  }
  for (const [date, plates] of Array.from(dayPlates)) daily.get(date)!.vehicles = plates.size;
  const days = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
  // متوسط السيارات في اليوم من الأيام التي عملت فيها سيارات (لا الأيام القادمة التي لم تُرسل لها سيارة بعد)
  const workingDays = days.map((day) => day.vehicles ?? 0).filter((count) => count > 0);
  const weekdayMap = new Map<string, { trips: number; days: number }>();
  for (const day of days) {
    const entry = weekdayMap.get(day.weekday) ?? { trips: 0, days: 0 };
    entry.trips += day.total;
    entry.days += 1;
    weekdayMap.set(day.weekday, entry);
  }

  return {
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    totalTrips: trips.length,
    completedTrips,
    activeDays: days.length,
    avgTripMinutes: minutesCount ? Math.round(minutesTotal / minutesCount) : null,
    daily: days,
    byWeekday: WEEKDAYS.map((weekday) => ({ weekday, trips: weekdayMap.get(weekday)?.trips ?? 0, days: weekdayMap.get(weekday)?.days ?? 0 })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, trips: hours.get(hour) ?? 0 })),
    byKind: TRIP_KINDS.map((kind) => ({ kind, trips: kinds.get(kind) ?? 0 })),
    destinations: sortDesc(Array.from(destinations.values()).map(({ minutesTotal: total, minutesCount: count, ...item }) => ({
      ...item,
      avgMinutes: count ? Math.round(total / count) : null,
    }))),
    zones: sortDesc(Array.from(zones, ([zone, count]) => ({ zone, trips: count }))),
    vehicles: sortDesc(Array.from(vehicles, ([plate, vehicle]) => ({
      plate,
      driver: Array.from(vehicle.drivers).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3).join(" / "),
      trips: vehicle.trips,
      kind: plateKinds.get(plate) ?? null,
    }))),
    workingVehicles: {
      total: new Set([...Array.from(vehicles.keys()), ...Array.from(roleBuses.keys())]).size,
      byKind: TRIP_KINDS.map((kind) => ({ kind, vehicles: Array.from(plateKinds.values()).filter((item) => item === kind).length })),
      dailyAverage: workingDays.length ? Math.round(workingDays.reduce((total, count) => total + count, 0) / workingDays.length) : null,
      dailyMax: workingDays.length ? Math.max(...workingDays) : null,
      roleBuses: Array.from(roleBuses, ([plate, busRole]) => ({ plate, busRole })),
    },
    directions,
    booking,
    delays: summarizeDelays(timings),
    workHours: summarizeWorkHours(Array.from(vehicleDays.values())),
    buildings: sortDesc(Array.from(buildings, ([building, count]) => ({ building, trips: count }))),
    unmatchedDestinations: unmatched,
    withoutDetails,
  };
}

/** تأخير رحلات السيارات: عدد الرحلات المتأخرة، ولكل مرحلة عددها ومتوسط دقائقها. */
export function summarizeDelays(timings: RequestTiming[]): DelaySummary {
  const average = (values: number[]) => (values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null);
  const measured = timings.flatMap((timing) => (timing.lateToAppointment === null ? [] : [timing.lateToAppointment]));
  const late = measured.filter((minutes) => minutes > 0);
  return {
    trips: timings.length,
    late: timings.filter((timing) => timing.stages.length > 0).length,
    stages: DELAY_STAGES.map(({ stage }) => {
      const matching = timings.filter((timing) => timing.stages.includes(stage));
      return { stage, trips: matching.length, avgMinutes: average(matching.flatMap((timing) => stageMinutes(timing, stage) ?? [])) };
    }),
    lateToAppointment: {
      trips: late.length,
      avgMinutes: average(late),
      measured: measured.length,
    },
    withoutArrival: timings.filter((timing) => timing.toPickup === null).length,
  };
}
