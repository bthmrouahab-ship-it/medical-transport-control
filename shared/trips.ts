import { DEFAULT_HOSPITALS, ORIGIN, distanceKm, type Hospital } from "./hospitals";
import { appointmentHospital, localDateString, type ArrivalSource, type ClinicAppointment, type VehicleRequest } from "./transport";

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

/** وقت الذروة في قطر: من الأحد إلى الخميس، صباحًا 6:30–8:30 وظهرًا 13:00–16:00. */
export function isRushHour(at: Date) {
  const day = at.getDay();
  if (day === 5 || day === 6) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return (minutes >= 390 && minutes <= 510) || (minutes >= 780 && minutes <= 960);
}

/**
 * تقدير مدة الطريق بالدقائق، مقرّبة لأعلى إلى 5 دقائق:
 * - طول الطريق: المسافة المستقيمة × 1.4 داخل المدينة (أقل من 10 كم) و× 1.25 للمسافات الأطول.
 * - متوسط السرعة حسب طول الطريق: 30 كم/س حتى 5 كم، و40 حتى 15 كم، و60 حتى 40 كم، و80 بعدها.
 * - وقت الذروة × 1.35، ثم هامش 15% (5 دقائق على الأقل).
 * - التسليم في الوجهة: 10 دقائق، و15 لاحتياجات خاصة، و5 دقائق لكل مريض إضافي في نفس السيارة.
 */
export function estimateTravelMinutes(from: Point, to: Point, at = new Date(), options: { special?: boolean; extraStops?: number } = {}) {
  const straight = distanceKm(from, to);
  const roadKm = straight * (straight < 10 ? 1.4 : 1.25);
  const speed = roadKm <= 5 ? 30 : roadKm <= 15 ? 40 : roadKm <= 40 ? 60 : 80;
  let minutes = (roadKm / speed) * 60;
  if (isRushHour(at)) minutes *= 1.35;
  minutes += Math.max(5, minutes * 0.15);
  minutes += options.special ? 15 : 10;
  minutes += Math.max(0, options.extraStops ?? 0) * 5;
  return Math.ceil(minutes / 5) * 5;
}

/** بداية الطريق ونهايته: من المجمع إلى المستشفى في الذهاب، ومن المستشفى إلى المجمع في العودة. */
export function tripEndpoints(appointment: ClinicAppointment, direction: VehicleRequest["direction"], hospitals: Hospital[] = DEFAULT_HOSPITALS) {
  const hospital = appointmentHospital(appointment, hospitals);
  const origin: Point = { lat: ORIGIN.lat, lng: ORIGIN.lng };
  const place: Point | null = hospital ? { lat: hospital.lat, lng: hospital.lng } : null;
  return direction === "عودة"
    ? { from: place, to: origin, destination: ORIGIN.name }
    : { from: origin, to: place, destination: hospital?.name ?? appointment.clinic };
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/** ما يُحفظ مع الطلب لحظة استلام المريض: الوقت، والوقت المتوقع للوصول، وإحداثيات الوجهة. */
export function pickupDetails(
  request: Pick<VehicleRequest, "direction">,
  appointment: ClinicAppointment,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
  now = new Date(),
  passengers = 1,
): Pick<VehicleRequest, "pickedUpAt" | "etaAt" | "destLat" | "destLng"> {
  const { from, to } = tripEndpoints(appointment, request.direction, hospitals);
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
