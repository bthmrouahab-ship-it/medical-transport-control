import { DEFAULT_HOSPITALS, ORIGIN, distanceKm, type Hospital } from "./hospitals";
import { appointmentDateTime, appointmentHospital, isRushHour, localDateString, type ArrivalSource, type ClinicAppointment, type Vehicle, type VehicleRequest } from "./transport";

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
  if (fromAppointment) {
    const first = appointmentHospital(fromAppointment, hospitals);
    return { from: first ? { lat: first.lat, lng: first.lng } : null, to: place, destination: hospital?.name ?? appointment.clinic };
  }
  return direction === "عودة"
    ? { from: place, to: origin, destination: ORIGIN.name }
    : { from: origin, to: place, destination: hospital?.name ?? appointment.clinic };
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** وقت طلب السيارة (createdAt «HH:MM») في يوم الموعد، أو null لطلب قديم بلا وقت. */
export function requestedAt(request: Pick<VehicleRequest, "createdAt">, appointment: Pick<ClinicAppointment, "appointmentDate">) {
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
  if (request.direction === "عودة") return requested ?? appointmentAt;
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
): VehicleLocationState {
  const own = requests.filter((request) => request.vehiclePlate === plate);
  const phases = own.map((request) => ({ request, phase: tripPhase(request, now, Boolean(gps)) }));
  if (phases.some((item) => isActivePhase(item.phase))) return { kind: "trip" };

  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const atComplex = gps ? distanceKm(gps, origin) <= COMPLEX_RADIUS_KM : false;
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
    const pickupAppointment = trip.request.direction === "عودة" ? trip.appointment : trip.request.fromAppointmentId ? trip.from : null;
    if (!pickupAppointment) continue;
    const hospital = appointmentHospital(pickupAppointment, hospitals);
    if (!hospital) continue;
    const special = trip.appointment.kind === "احتياجات خاصة";
    for (const vehicle of vehicles) {
      const state = states.get(vehicle.plate);
      if (!vehicle.available || state?.kind !== "outside" || !state.canRedirect || !state.position) continue;
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
