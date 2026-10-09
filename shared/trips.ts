import { DEFAULT_HOSPITALS, ORIGIN, distanceKm, type Hospital } from "./hospitals";
import {
  NEARBY_KM,
  appointmentDateTime,
  appointmentHospital,
  inService,
  isRushHour,
  isReturnOnly,
  isHospitalTransfer,
  hospitalTransferSource,
  isTransfer,
  localDateString,
  personsText,
  tripPersons,
  vehicleRestriction,
  vehicleSeats,
  type ArrivalSource,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
  type VehicleRules,
  type VehicleWaiting,
} from "./transport";

/**
 * الرحلة بعد استلام المريض: تقدير مدة الطريق، ومعرفة متى تصل السيارة وتعود متاحة.
 * - مع GPS (ووجهة معروفة على الخريطة): الخادم يكتشف الوصول عندما تقترب السيارة من الوجهة.
 * - بلا GPS: تنتهي الرحلة تقديريًا عند الوقت المتوقع للوصول، فتصبح السيارة متاحة.
 */

type Point = { lat: number; lng: number };

/** السيارة تُعتبر واصلة إذا اقتربت من الوجهة هذه المسافة (نفس القيمة في الخادم api/index.php). */
export const ARRIVAL_RADIUS_KM = 0.3;
/** مدة الرحلة إن لم تكن الوجهة على الخريطة (رحلة غير طبية أو وجهة خارج الدليل). */
export const UNKNOWN_TRAVEL_MINUTES = 35;
/**
 * سيارة متابَعة بـ GPS ولم يُكتشف وصولها (مثلًا توقفت خارج نطاق الوجهة في حرم مستشفى كبير)
 * تُعتبر واصلة تقديريًا بعد تأخرها هذه المدة عن الوقت المتوقع، حتى لا تبقى محجوزة.
 */
export const GPS_GRACE_MINUTES = 45;

// وقت الذروة (isRushHour) في shared/transport.ts: يحتاجه أيضًا باص المجمع
export { isRushHour };

/**
 * تقدير مدة الطريق بالدقائق، مقرّبة لأعلى إلى 5 دقائق:
 * - طول الطريق: المسافة المستقيمة × 1.4 داخل المدينة (أقل من 10 كم) و× 1.25 للمسافات الأطول.
 * - متوسط السرعة حسب طول الطريق: 30 كم/س حتى 5 كم، و40 حتى 15 كم، و60 حتى 40 كم، و80 بعدها.
 * - وقت الذروة × 1.35، ثم هامش 15% (5 دقائق على الأقل).
 * - التسليم في الوجهة: 10 دقائق، و15 لاحتياجات خاصة، و5 دقائق لكل مريض إضافي في نفس السيارة.
 */
export function estimateTravelMinutes(from: Point, to: Point, at = new Date(), options: { special?: boolean; extraStops?: number } = {}) {
  let minutes = driveMinutes(from, to, at);
  minutes += options.special ? 15 : 10;
  minutes += Math.max(0, options.extraStops ?? 0) * 5;
  return Math.ceil(minutes / 5) * 5;
}

/** مدة القيادة وحدها (بلا وقت التسليم ولا التقريب): الطريق والسرعة والذروة والهامش كما في estimateTravelMinutes. */
export function driveMinutes(from: Point, to: Point, at = new Date()) {
  const straight = distanceKm(from, to);
  const roadKm = straight * (straight < 10 ? 1.4 : 1.25);
  const speed = roadKm <= 5 ? 30 : roadKm <= 15 ? 40 : roadKm <= 40 ? 60 : 80;
  let minutes = (roadKm / speed) * 60;
  if (isRushHour(at)) minutes *= 1.35;
  return minutes + Math.max(5, minutes * 0.15);
}

/**
 * بداية الطريق ونهايته: من المجمع إلى المستشفى في الذهاب، ومن المستشفى إلى المجمع في العودة،
 * ومن مستشفى الموعد الأول إلى مستشفى الموعد الثاني في النقل بين موعدين (fromAppointment).
 */
export function tripEndpoints(
  appointment: ClinicAppointment,
  direction: VehicleRequest["direction"],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  fromAppointment: ClinicAppointment | null = null,
) {
  const hospital = appointmentHospital(appointment, hospitals);
  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const place: Point | null = hospital ? { lat: hospital.lat, lng: hospital.lng } : null;
  // النقل من مستشفى إلى مستشفى: الذهاب من مستشفى الاستلام
  const source = fromAppointment ?? (direction === "ذهاب" && isHospitalTransfer(appointment) ? hospitalTransferSource(appointment) : null);
  if (source) {
    const first = appointmentHospital(source, hospitals);
    return { from: first ? { lat: first.lat, lng: first.lng } : null, to: place, destination: hospital?.name ?? appointment.clinic };
  }
  return direction === "عودة"
    ? { from: place, to: origin, destination: ORIGIN.name }
    : { from: origin, to: place, destination: hospital?.name ?? appointment.clinic };
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * التأخر: طلب ينتظر السيارة بعد وقت حاجته، أو سيارة أُرسلت ولم تصل إلى الاستلام، هذه الدقائق أو أكثر
 * (يظهر أحمر لمشرف السيارات، ولمشرف المبنى مع اقتراح الاتصال بالسائق).
 */
export const LATE_MINUTES = 15;

/** الدقائق منذ وقت «HH:MM» اليوم (وقت بعد الآن يعني قبل منتصف الليل)، أو null إن لم يُعرف أو مضى أكثر من 12 ساعة. */
export function minutesSince(time: string | undefined, now = new Date()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!match) return null;
  let minutes = now.getHours() * 60 + now.getMinutes() - (Number(match[1]) * 60 + Number(match[2]));
  if (minutes < 0) minutes += 24 * 60;
  return minutes <= 12 * 60 ? minutes : null;
}

/**
 * وقت طلب السيارة (createdAt «HH:MM») في يوم الموعد، أو null لطلب قديم بلا وقت، أو لطلب حُجز في يوم قبل الرحلة
 * (requestedOn): السيارة مطلوبة عندها من وقت الانطلاق.
 */
export function requestedAt(request: Pick<VehicleRequest, "createdAt" | "requestedOn">, appointment: Pick<ClinicAppointment, "appointmentDate">) {
  if (request.requestedOn && request.requestedOn < appointment.appointmentDate) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(request.createdAt ?? "");
  return match ? appointmentDateTime({ appointmentDate: appointment.appointmentDate, appointmentAt: `${match[1].padStart(2, "0")}:${match[2]}` }) : null;
}

/**
 * متى يحتاج الضيف السيارة (لجمع الرحلات بحسب وقت الطلب):
 * - العودة: وقت طلبها، فالضيف جاهز عند الطلب.
 * - الذهاب: وقت الانطلاق اللازم للوصول قبل الموعد (مدة الطريق من المجمع)، أو وقت الطلب إن جاء بعده.
 * فطلبان متأخران في نفس اللحظة لموعدين متباعدين يحتاجان السيارة معًا.
 */
export function neededAt(request: VehicleRequest, appointment: ClinicAppointment, hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  const requested = requestedAt(request, appointment);
  const appointmentAt = appointmentDateTime(appointment);
  // طلب العودة فقط من المستشفى: تحتاجه من وقت العودة الذي حددته العيادة (ولو أُضيف قبله)
  if (request.direction === "عودة") return isReturnOnly(appointment) ? appointmentAt : requested ?? appointmentAt;
  const { from, to } = tripEndpoints(appointment, request.direction, hospitals);
  const travel = from && to ? estimateTravelMinutes(from, to, appointmentAt) : UNKNOWN_TRAVEL_MINUTES;
  const departure = new Date(appointmentAt.getTime() - travel * 60000);
  return requested && requested > departure ? requested : departure;
}

/** ما يُحفظ مع الطلب لحظة استلام المريض: الوقت، والوقت المتوقع للوصول، وإحداثيات الوجهة. */
export function pickupDetails(
  request: Pick<VehicleRequest, "direction">,
  appointment: ClinicAppointment,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
  passengers = 1,
  fromAppointment: ClinicAppointment | null = null,
): Pick<VehicleRequest, "pickedUpAt" | "etaAt" | "destLat" | "destLng"> {
  const { from, to } = tripEndpoints(appointment, request.direction, hospitals, fromAppointment);
  const extraStops = Math.max(0, passengers - 1);
  const minutes = from && to
    ? estimateTravelMinutes(from, to, now, { special: appointment.kind === "احتياجات خاصة", extraStops })
    : UNKNOWN_TRAVEL_MINUTES + extraStops * 5;
  return {
    pickedUpAt: now.toISOString(),
    etaAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    ...(to ? { destLat: round6(to.lat), destLng: round6(to.lng) } : {}),
  };
}

export type TripPhase =
  | { kind: "pending" }
  | { kind: "toPickup"; atPickup: boolean }
  | { kind: "toDestination"; etaAt: Date; minutesLeft: number; tracking: boolean; late: boolean }
  | { kind: "arrived"; at: Date | null; source: ArrivalSource | "legacy" };

/**
 * مرحلة الطلب الآن. gpsLive: موقع السيارة يصل مباشرة من هاتف السائق.
 * - مع GPS ووجهة معروفة: تبقى الرحلة جارية حتى يكتشف الخادم الوصول أو يؤكده مشرف السيارات
 *   (وإن تأخرت أكثر من GPS_GRACE_MINUTES عن الوقت المتوقع تُعتبر واصلة تقديريًا).
 * - بلا GPS أو بلا وجهة على الخريطة: تنتهي الرحلة تقديريًا عند الوقت المتوقع للوصول.
 * - طلب استُلم مريضه قبل هذه الميزة (بلا وقت متوقع) يُعتبر منتهيًا.
 */
export function tripPhase(request: VehicleRequest, now = new Date(), gpsLive = false): TripPhase {
  if (request.status === "بانتظار التوزيع") return { kind: "pending" };
  if (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") {
    return { kind: "toPickup", atPickup: request.status === "وصلت السيارة" };
  }
  if (request.status === "وصلت الوجهة" || request.arrivedAt) {
    return { kind: "arrived", at: request.arrivedAt ? new Date(request.arrivedAt) : null, source: request.arrivalSource ?? "manual" };
  }
  if (!request.etaAt) return { kind: "arrived", at: null, source: "legacy" };
  const etaAt = new Date(request.etaAt);
  const minutesLeft = Math.ceil((etaAt.getTime() - now.getTime()) / 60000);
  const tracking = gpsLive && request.destLat !== undefined && request.destLng !== undefined;
  if (minutesLeft <= 0 && (!tracking || minutesLeft < -GPS_GRACE_MINUTES)) return { kind: "arrived", at: etaAt, source: "estimate" };
  return { kind: "toDestination", etaAt, minutesLeft, tracking, late: minutesLeft < 0 };
}

export const isActivePhase = (phase: TripPhase) => phase.kind === "toPickup" || phase.kind === "toDestination";

/** حالة السيارة الآن: مشغولة برحلة (ومتى يُتوقع أن تتفرغ) أو متاحة. */
export function vehicleAvailability(plate: string, requests: VehicleRequest[], now = new Date(), gpsLive = false) {
  const active = requests
    .filter((request) => request.vehiclePlate === plate)
    .map((request) => ({ request, phase: tripPhase(request, now, gpsLive) }))
    .filter((item) => isActivePhase(item.phase));
  // إلى الاستلام: لا وقت معروف للتفرغ؛ في الطريق إلى الوجهة: أبعد وقت متوقع للوصول
  const toPickup = active.some((item) => item.phase.kind === "toPickup");
  const etas = active.flatMap((item) => (item.phase.kind === "toDestination" ? [item.phase.etaAt.getTime()] : []));
  return {
    busy: active.length > 0,
    until: !toPickup && etas.length ? new Date(Math.max(...etas)) : null,
    toPickup,
    tracking: active.some((item) => item.phase.kind === "toDestination" && item.phase.tracking),
    active,
  };
}

export type Arrival = { request: VehicleRequest; at: Date; source: ArrivalSource };

/** الطلبات التي وصلت إلى وجهتها في هذا اليوم (GPS أو تأكيد يدوي أو انتهاء المدة التقديرية)، الأحدث أولًا. */
export function arrivalsOn(date: string, requests: VehicleRequest[], now = new Date(), gpsLive: (plate?: string) => boolean = () => false): Arrival[] {
  return requests
    .flatMap((request) => {
      const phase = tripPhase(request, now, gpsLive(request.vehiclePlate));
      return phase.kind === "arrived" && phase.source !== "legacy" && phase.at && localDateString(phase.at) === date
        ? [{ request, at: phase.at, source: phase.source }]
        : [];
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ————— مكان السيارة المتاحة: داخل المجمع أو خارجه —————

/** السيارة داخل المجمع إذا كان موقعها (GPS) على هذا البعد منه أو أقل. */
export const COMPLEX_RADIUS_KM = 0.4;

export type VehicleLocationState =
  | { kind: "trip" }
  | { kind: "inside"; since: Date | null; source: "gps" | "estimate" | "default" }
  | {
    kind: "outside";
    /** وقت وصولها إلى الوجهة التي تعود منها */
    since: Date;
    /** الوجهة التي تعود منها */
    from: string;
    /** الوقت المتوقع لعودتها إلى المجمع */
    backAt: Date;
    /** نسبة ما قطعته من طريق العودة (0 عند الوجهة، 1 عند المجمع) */
    progress: number;
    /** موقعها الآن: من GPS، أو تقديري على خط العودة (null إن كانت الوجهة غير معروفة) */
    position: Point | null;
    source: "gps" | "estimate";
    /** لم تقطع نصف طريق العودة بعد، فيمكن توجيهها إلى ضيف ينتظر العودة */
    canRedirect: boolean;
    /** تنتظر في المستشفى (اختاره مشرف السيارات)، فلا تعود إلى المجمع */
    waiting?: VehicleWaiting;
  };

/**
 * مكان السيارة الآن، من آخر رحلة وصلت (بالـ GPS أو تقديريًا):
 * - في رحلة: لها رحلة جارية.
 * - خارج المجمع: آخر رحلة ذهاب وصلت إلى المستشفى، ولم تعد إلى المجمع بعد. تعود تقديريًا بعد مدة
 *   القيادة من الوجهة إلى المجمع، أو عندما يصبح موقعها (GPS) قرب المجمع.
 * - داخل المجمع: آخر رحلة كانت عودة إلى المجمع، أو عادت بعد رحلة ذهاب، أو لا رحلات لها.
 */
export function vehicleLocationState(
  plate: string,
  requests: VehicleRequest[],
  appointments: ClinicAppointment[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
  gps: Point | null = null,
  /** انتظار السيارة في المستشفى (activeWaiting): تبقى خارج المجمع في مكان انتظارها */
  waiting: VehicleWaiting | null = null,
): VehicleLocationState {
  const own = requests.filter((request) => request.vehiclePlate === plate);
  const phases = own.map((request) => ({ request, phase: tripPhase(request, now, Boolean(gps)) }));
  if (phases.some((item) => isActivePhase(item.phase))) return { kind: "trip" };

  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const atComplex = gps ? distanceKm(gps, origin) <= COMPLEX_RADIUS_KM : false;
  if (waiting && !atComplex) {
    const place: Point = { lat: waiting.lat, lng: waiting.lng };
    const since = waiting.since ? new Date(waiting.since) : now;
    return {
      kind: "outside", since, from: waiting.place, backAt: new Date(now.getTime() + Math.ceil(driveMinutes(gps ?? place, origin, now)) * 60000),
      progress: 0, position: gps ?? place, source: gps ? "gps" : "estimate", canRedirect: true, waiting,
    };
  }
  let last: { request: VehicleRequest; at: Date } | null = null;
  for (const { request, phase } of phases) {
    if (phase.kind === "arrived" && phase.at && phase.at <= now && (!last || phase.at > last.at)) last = { request, at: phase.at };
  }
  if (!last) return { kind: "inside", since: null, source: "default" };
  if (last.request.direction === "عودة") {
    return { kind: "inside", since: last.at, source: last.request.arrivalSource === "gps" ? "gps" : "estimate" };
  }

  const appointment = appointments.find((item) => item.id === last!.request.appointmentId);
  const hospital = appointment ? appointmentHospital(appointment, hospitals) : null;
  const place: Point | null = last.request.destLat !== undefined && last.request.destLng !== undefined
    ? { lat: last.request.destLat, lng: last.request.destLng }
    : hospital ? { lat: hospital.lat, lng: hospital.lng } : null;
  const from = hospital?.name ?? appointment?.clinic ?? "";
  const drive = place ? driveMinutes(place, origin, last.at) : UNKNOWN_TRAVEL_MINUTES - 10;
  const backAt = new Date(last.at.getTime() + Math.ceil(drive) * 60000);

  if (gps) {
    if (atComplex) return { kind: "inside", since: null, source: "gps" };
    const total = place ? distanceKm(place, origin) : 0;
    const progress = total > 0 ? Math.min(1, Math.max(0, 1 - distanceKm(gps, origin) / total)) : 0;
    return { kind: "outside", since: last.at, from, backAt, progress, position: gps, source: "gps", canRedirect: progress < 0.5 };
  }
  if (now >= backAt) return { kind: "inside", since: backAt, source: "estimate" };
  const progress = Math.min(1, Math.max(0, (now.getTime() - last.at.getTime()) / (backAt.getTime() - last.at.getTime())));
  const position = place ? { lat: place.lat + (origin.lat - place.lat) * progress, lng: place.lng + (origin.lng - place.lng) * progress } : null;
  return { kind: "outside", since: last.at, from, backAt, progress, position, source: "estimate", canRedirect: progress < 0.5 };
}

// ————— السيارة المتوقفة خارج المجمع —————

/** السيارة التي لم تتحرك من مكانها (خارج المجمع) هذه المدة: تنبيه لمشرف السيارات */
export const STOPPED_MINUTES = 10;
/** لم تتحرك: بقيت على هذا البعد من مكان وقوفها (نفس القيمة STILL_RADIUS_M في api/lib/tracking.php) */
export const STILL_RADIUS_KM = 0.1;
/** المكان المعروف (مستشفى أو وجهة) على هذا البعد من السيارة يُذكر اسمه */
export const STOPPED_PLACE_KM = 0.5;

/** موقع السيارة كما يحفظه الخادم: stillSince بداية وقوفها في مكانها (يكتبه الخادم من مواقع السائق) */
export type StillLocation = Point & { plate: string; sharing?: boolean; updatedAt: string; stillSince?: string; driver?: string };

export type StoppedVehicle = {
  vehicle: Vehicle;
  position: Point;
  /** منذ متى لم تتحرك */
  since: Date;
  minutes: number;
  /** أقرب مستشفى أو وجهة معروفة (على بعد STOPPED_PLACE_KM أو أقل)، وإلا null */
  place: Hospital | null;
  driver: string;
};

/** أقرب مكان معروف إلى نقطة على هذا البعد أو أقل */
export function nearestPlace(point: Point, places: Hospital[], maxKm = STOPPED_PLACE_KM): Hospital | null {
  let best: { place: Hospital; km: number } | null = null;
  for (const place of places) {
    const km = distanceKm(point, place);
    if (km <= maxKm && (!best || km < best.km)) best = { place, km };
  }
  return best?.place ?? null;
}

/**
 * السيارات التي لم تتحرك من مكانها STOPPED_MINUTES دقائق أو أكثر خارج المجمع، وموقعها يصل مباشرة (GPS):
 * لمشرف السيارات أن يجعلها تنتظر في المستشفى أو يستفسر من السائق عن سبب التأخير.
 * السيارة التي تنتظر في المستشفى بأمره (activeWaiting) والموقوفة عن الخدمة لا تُذكر.
 */
export function stoppedVehicles(vehicles: Vehicle[], locations: StillLocation[], places: Hospital[], now = new Date(),
  isWaiting: (vehicle: Vehicle) => boolean = () => false): StoppedVehicle[] {
  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  return locations.flatMap((location) => {
    const vehicle = vehicles.find((item) => item.plate === location.plate);
    if (!vehicle || !vehicle.available || isWaiting(vehicle) || !location.sharing || !location.stillSince) return [];
    // الموقع يصل مباشرة (آخر دقيقتين، كما في GPS المباشر)
    if (now.getTime() - Date.parse(location.updatedAt) > 2 * 60000) return [];
    if (distanceKm(location, origin) <= COMPLEX_RADIUS_KM) return [];
    const since = new Date(location.stillSince);
    const minutes = Math.floor((now.getTime() - since.getTime()) / 60000);
    if (!(minutes >= STOPPED_MINUTES)) return [];
    const position = { lat: location.lat, lng: location.lng };
    return [{ vehicle, position, since, minutes, place: nearestPlace(position, places), driver: location.driver?.trim() || vehicle.driver }];
  }).sort((a, b) => b.minutes - a.minutes);
}

export type ReturnRedirect = {
  request: VehicleRequest;
  appointment: ClinicAppointment;
  vehicle: Vehicle;
  /** بُعد السيارة عن مكان الضيف (كم) */
  distanceKm: number;
  /** الوجهة التي تعود منها السيارة */
  from: string;
  /** مكان استلام الضيف (المستشفى) */
  pickup: string;
};

/**
 * توجيه السيارات الخارجة من المجمع إلى ضيوف ينتظرون العودة: سيارة متاحة خارج المجمع لم تقطع نصف طريق
 * عودتها تُوجَّه إلى أقرب ضيف طلب العودة، إذا كانت أقرب إليه من المجمع. الاحتياجات الخاصة تحتاج سيارة مجهزة.
 * كل سيارة لضيف واحد، والأقرب أولًا.
 */
export function suggestReturnRedirects(
  /** طلبات العودة، وطلبات النقل بين موعدين ومعها موعدها الأول (from) */
  pendingReturns: { request: VehicleRequest; appointment: ClinicAppointment; from?: ClinicAppointment | null }[],
  vehicles: Vehicle[],
  states: Map<string, VehicleLocationState>,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  /** قواعد السيارة الأخرى (الباصات: vehicleRestriction)، وإلا كل سيارة تناسب */
  fits: (vehicle: Vehicle, trip: { request: VehicleRequest; appointment: ClinicAppointment }) => boolean = () => true,
): ReturnRedirect[] {
  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const pairs: (ReturnRedirect & { special: boolean })[] = [];
  for (const trip of pendingReturns) {
    // مكان استلام الضيف: مستشفى الموعد في العودة، أو مستشفى الموعد الأول في النقل
    const pickupAppointment = trip.request.direction === "عودة" ? trip.appointment
      : trip.request.fromAppointmentId ? trip.from : isTransfer(trip.request, trip.appointment) ? hospitalTransferSource(trip.appointment) : null;
    if (!pickupAppointment) continue;
    const hospital = appointmentHospital(pickupAppointment, hospitals);
    if (!hospital) continue;
    const special = trip.appointment.kind === "احتياجات خاصة";
    for (const vehicle of vehicles) {
      const state = states.get(vehicle.plate);
      if (!inService(vehicle) || state?.kind !== "outside" || !state.canRedirect || !state.position) continue;
      if ((special && vehicle.kind !== "احتياجات خاصة") || !fits(vehicle, trip)) continue;
      const distance = distanceKm(state.position, hospital);
      if (distance >= distanceKm(origin, hospital)) continue;
      pairs.push({ ...trip, vehicle, distanceKm: Math.round(distance * 10) / 10, from: state.from, pickup: hospital.name, special });
    }
  }
  // حالات السرطان أولًا، ثم الاحتياجات الخاصة (سياراتها أقل)، ثم الأقرب
  pairs.sort((a, b) => Number(Boolean(b.appointment.cancer)) - Number(Boolean(a.appointment.cancer)) || Number(b.special) - Number(a.special) || a.distanceKm - b.distanceKm);
  const usedVehicles = new Set<string>();
  const usedRequests = new Set<string>();
  const result: ReturnRedirect[] = [];
  for (const { special: _special, ...pair } of pairs) {
    if (usedVehicles.has(pair.vehicle.plate) || usedRequests.has(pair.request.id)) continue;
    usedVehicles.add(pair.vehicle.plate);
    usedRequests.add(pair.request.id);
    result.push(pair);
  }
  return result.sort((a, b) => a.distanceKm - b.distanceKm);
}

// ————— ضم ضيف عودة إلى سيارة عائدة —————

/** طلب عودة على هذه المسافة (كم) من سيارة عائدة إلى المجمع (GPS) يُقترح لضم ضيفه إليها. */
export const RETURN_PICKUP_KM = 3;

export type ReturnPickup = {
  request: VehicleRequest;
  appointment: ClinicAppointment;
  vehicle: Vehicle;
  /** بُعد السيارة الآن (GPS) عن مستشفى الضيف */
  distanceKm: number;
  /** مستشفى الضيف */
  pickup: string;
  /** الأشخاص في السيارة الآن، والمقاعد الفارغة قبل الضم */
  onBoard: number;
  seatsLeft: number;
  /** رحلة السيارة الحالية (للضم إليها) */
  groupId?: string;
  memberIds: string[];
};

type RiderTrip = { request: VehicleRequest; appointment: ClinicAppointment; persons?: number };

/**
 * سيارة في طريق العودة إلى المجمع (استلمت ضيوف العودة ولم تصل) وفيها مقاعد فارغة، وموقعها مباشر (GPS):
 * تُقترح لضيف ينتظر العودة من مستشفى على بعد RETURN_PICKUP_KM كم منها أو أقل، إن كانت تناسبه
 * (المقاعد مع المرافقين والـ Nurse، وسيارة الاحتياجات الخاصة لضيف احتياجات خاصة واحد). لكل ضيف أقرب سيارة،
 * وتُملأ مقاعد كل سيارة بالأقرب أولًا.
 */
export function suggestReturnPickups(
  pendingReturns: RiderTrip[],
  /** الطلبات الجارية (تُختار منها رحلات العودة التي استلمت ضيوفها) */
  active: RiderTrip[],
  vehicles: Vehicle[],
  /** موقع كل سيارة الآن (GPS المباشر فقط) */
  positions: Map<string, Point>,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  rules: VehicleRules = {},
): ReturnPickup[] {
  const personsOf = (trip: RiderTrip) => trip.persons ?? tripPersons(trip.appointment, trip.request);
  const byTrip = new Map<string, RiderTrip[]>();
  for (const trip of active) {
    if (!trip.request.vehiclePlate) continue;
    const key = `${trip.request.vehiclePlate}|${trip.request.groupId ?? trip.request.id}`;
    byTrip.set(key, [...(byTrip.get(key) ?? []), trip]);
  }
  const cars = Array.from(byTrip.values()).flatMap((members) => {
    // كل ركاب السيارة عائدون إلى المجمع بعد استلامهم ولم يصلوا
    if (!members.every((member) => member.request.direction === "عودة" && member.request.status === "تم استلام المريض" && !member.request.arrivedAt)) return [];
    const vehicle = vehicles.find((item) => item.plate === members[0].request.vehiclePlate);
    const position = vehicle && positions.get(vehicle.plate);
    if (!vehicle || !position) return [];
    return [{ vehicle, position, members, onBoard: members.reduce((sum, member) => sum + personsOf(member), 0) }];
  });
  const pairs: { car: (typeof cars)[number]; trip: RiderTrip; distance: number; pickup: string }[] = [];
  for (const trip of pendingReturns) {
    if (trip.request.status !== "بانتظار التوزيع" || trip.request.direction !== "عودة" || isTransfer(trip.request, trip.appointment)) continue;
    const hospital = appointmentHospital(trip.appointment, hospitals);
    if (!hospital) continue;
    for (const car of cars) {
      const distance = distanceKm(car.position, hospital);
      if (distance > RETURN_PICKUP_KM) continue;
      const riders = [...car.members.map((member) => member.appointment), trip.appointment];
      if (vehicleRestriction({ ...car.vehicle, available: true }, { appointments: riders, persons: car.onBoard + personsOf(trip) }, { ...rules, hospitals })) continue;
      pairs.push({ car, trip, distance, pickup: hospital.name });
    }
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const taken = new Map<string, RiderTrip[]>();
  const done = new Set<string>();
  const result: ReturnPickup[] = [];
  for (const { car, trip, distance, pickup } of pairs) {
    if (done.has(trip.request.id)) continue;
    // المقاعد بعد من اقتُرح لهذه السيارة قبله
    const added = taken.get(car.vehicle.plate) ?? [];
    const riders = [...car.members, ...added, trip].map((item) => item.appointment);
    const persons = car.onBoard + [...added, trip].reduce((sum, item) => sum + personsOf(item), 0);
    if (vehicleRestriction({ ...car.vehicle, available: true }, { appointments: riders, persons }, { ...rules, hospitals })) continue;
    taken.set(car.vehicle.plate, [...added, trip]);
    done.add(trip.request.id);
    result.push({
      request: trip.request,
      appointment: trip.appointment,
      vehicle: car.vehicle,
      distanceKm: Math.round(distance * 10) / 10,
      pickup,
      onBoard: car.onBoard,
      seatsLeft: Math.max(0, vehicleSeats(car.vehicle) - car.onBoard),
      groupId: car.members[0].request.groupId,
      memberIds: car.members.map((member) => member.request.id),
    });
  }
  return result;
}

/** وصف السيارة العائدة في الاقتراح: «عائدة إلى المجمع وفيها شخصان · مقعدان فارغان» */
export const returningText = (pickup: Pick<ReturnPickup, "onBoard" | "seatsLeft">) =>
  `عائدة إلى المجمع وفيها ${personsText(pickup.onBoard)} · ${pickup.seatsLeft === 1 ? "مقعد فارغ" : pickup.seatsLeft === 2 ? "مقعدان فارغان" : `${pickup.seatsLeft} مقاعد فارغة`}`;

// ————— سيارة ذاهبة إلى مكان العودة —————

/** سيارة في طريقها الآن (أُرسلت ولم تصل) إلى مكان استلام رحلة عودة أو إلى مكان قريب منه */
export type IncomingCar = {
  plate: string;
  driver: string;
  /** وجهة السيارة الذاهبة */
  destination: string;
  /** بعد وجهتها عن مكان استلام ضيف العودة (كم) */
  distanceKm: number;
  /** وقت وصولها المتوقع (بعد استلام ضيفها)، وnull إن كانت في الطريق إلى الاستلام */
  etaAt: Date | null;
};

/**
 * رحلة العودة (أو النقل بين موعدين) تبدأ من مستشفى: السيارات الذاهبة الآن إلى نفس المكان أو إلى مكان على بعد
 * NEARBY_KM (3 كم) منه أو أقل، الأقرب ثم الأسبق وصولًا. بعد وصول السيارة الذاهبة تصبح متاحة خارج المجمع
 * فيقترحها suggestReturnRedirects لضيف العودة، فلا تُرسل سيارة من المجمع إلا بعد تنبيه مشرف السيارات.
 */
export function incomingCars(
  trip: { request: VehicleRequest; appointment: ClinicAppointment; from?: ClinicAppointment | null },
  requests: VehicleRequest[],
  appointments: ClinicAppointment[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
  gpsLive: (plate?: string) => boolean = () => false,
): IncomingCar[] {
  const fromHospital = trip.request.direction === "عودة" || isTransfer(trip.request, trip.appointment);
  const pickup = fromHospital ? tripEndpoints(trip.appointment, trip.request.direction, hospitals, trip.from ?? null).from : null;
  if (!pickup) return [];
  const cars = new Map<string, IncomingCar>();
  for (const request of requests) {
    if (!request.vehiclePlate || request.direction !== "ذهاب" || request.id === trip.request.id) continue;
    const phase = tripPhase(request, now, gpsLive(request.vehiclePlate));
    if (phase.kind !== "toPickup" && phase.kind !== "toDestination") continue;
    const appointment = appointments.find((item) => item.id === request.appointmentId);
    const hospital = appointment ? appointmentHospital(appointment, hospitals) : null;
    const place: Point | null = request.destLat !== undefined && request.destLng !== undefined
      ? { lat: request.destLat, lng: request.destLng }
      : hospital ? { lat: hospital.lat, lng: hospital.lng } : null;
    if (!place || !appointment) continue;
    const km = distanceKm(place, pickup);
    if (km > NEARBY_KM) continue;
    const car: IncomingCar = {
      plate: request.vehiclePlate,
      driver: request.driver ?? "",
      destination: hospital?.name ?? appointment.clinic,
      distanceKm: Math.round(km * 10) / 10,
      etaAt: phase.kind === "toDestination" ? phase.etaAt : null,
    };
    const known = cars.get(car.plate);
    if (!known || car.distanceKm < known.distanceKm) cars.set(car.plate, car);
  }
  return Array.from(cars.values()).sort((a, b) => a.distanceKm - b.distanceKm
    || (a.etaAt?.getTime() ?? Infinity) - (b.etaAt?.getTime() ?? Infinity));
}
