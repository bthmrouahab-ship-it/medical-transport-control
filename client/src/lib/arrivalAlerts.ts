import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Hospital } from "@shared/hospitals";
import type { ClinicAppointment, VehicleRequest } from "@shared/transport";
import { tripEndpoints, type Arrival, type ReturnRedirect } from "@shared/trips";
import { deviceNotify, goTo, reveal } from "./notify";

/** فتح مكان الإشعار: الصفحة تمرر طريقتها (مثل الرجوع من الخريطة إلى التوزيع أولًا)، وإلا ينقل إليه في الصفحة نفسها */
type Open = (target: string) => void;

/** تنبيه الجهاز عند الوصول (يفعّله مشرف السيارات من صفحته، ويُحفظ على هذا الجهاز). */
export const NOTIFY_KEY = "fox_arrival_notify";
/** الوصولات التي ظهرت رسالتها في هذه الجلسة، حتى لا تتكرر عند التنقل بين التوزيع والخريطة. */
const SEEN_KEY = "fox_seen_arrivals";

function readSeen(): Set<string> | null {
  try {
    const stored = sessionStorage.getItem(SEEN_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-500)));
  } catch {
    /* التخزين غير متاح */
  }
}

export function deviceNotificationsOn() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === "on" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * وصول أقدم من هذا حين تعرفه الصفحة (كانت مغلقة أو مجمّدة في الخلفية ثم عادت): يُذكر في رسالة واحدة
 * بوقت كل سيارة، لا كأنه وصل الآن.
 */
export const STALE_ARRIVAL_MINUTES = 5;

const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
const carsText = (count: number) => (count === 1 ? "سيارة واحدة" : count === 2 ? "سيارتان" : count <= 10 ? `${count} سيارات` : `${count} سيارة`);

/**
 * رسالة لمشرف السيارات عند وصول سيارة إلى وجهتها: في الصفحة دائمًا، وعلى الجهاز إن فعّله والصفحة في الخلفية.
 * العنوان يذكر وقت الوصول نفسه، لأن رسالة الصفحة تبقى معلّقة حتى يعود المشرف إليها (sonner يوقفها والصفحة مخفية).
 * الوصولات الموجودة عند أول فتح للصفحة لا تظهر لها رسالة (تظهر في قائمة الوصول فقط).
 */
export function useArrivalAlerts({ arrivals, appointments, hospitals, driverOf, enabled = true, onOpen = reveal }: {
  arrivals: Arrival[];
  appointments: ClinicAppointment[];
  hospitals: Hospital[];
  driverOf: (plate: string | undefined, fallback?: string) => string;
  enabled?: boolean;
  /** الضغط على الإشعار: الوصول في «وصول السيارات اليوم» */
  onOpen?: Open;
}) {
  const seen = useRef<Set<string> | null>(null);
  const latest = useRef({ appointments, hospitals, driverOf, onOpen });
  latest.current = { appointments, hospitals, driverOf, onOpen };

  useEffect(() => {
    if (!enabled) return;
    if (!seen.current) {
      const stored = readSeen();
      seen.current = stored ?? new Set(arrivals.map((item) => item.request.id));
      if (!stored) {
        writeSeen(seen.current);
        return;
      }
    }
    const fresh = arrivals.filter((item) => !seen.current!.has(item.request.id));
    if (!fresh.length) return;
    fresh.forEach((item) => seen.current!.add(item.request.id));
    writeSeen(seen.current);

    const { appointments, hospitals, driverOf, onOpen } = latest.current;
    const now = Date.now();
    const stale = fresh.filter((item) => now - item.at.getTime() > STALE_ARRIVAL_MINUTES * 60000);
    const recent = fresh.filter((item) => !stale.includes(item));
    const byPlate = new Map<string, Arrival[]>();
    for (const item of recent) byPlate.set(item.request.vehiclePlate ?? "", [...(byPlate.get(item.request.vehiclePlate ?? "") ?? []), item]);
    for (const [plate, items] of Array.from(byPlate)) {
      const source = items[0].source;
      const at = clock(items[0].at);
      const destinations = Array.from(new Set(items.map((item) => {
        const appointment = appointments.find((entry) => entry.id === item.request.appointmentId);
        return appointment ? tripEndpoints(appointment, item.request.direction, hospitals).destination : "";
      }).filter(Boolean))).join("، ");
      const driver = driverOf(plate, items[0].request.driver);
      const title = source === "estimate" ? `انتهت المدة التقديرية لرحلة السيارة ${plate} الساعة ${at}` : `وصلت السيارة ${plate} إلى وجهتها الساعة ${at}`;
      // بعد الذهاب تكون السيارة متاحة خارج المجمع (عائدة)، وبعد العودة متاحة داخله
      const place = items.some((item) => item.request.direction === "ذهاب") ? "السيارة متاحة خارج المجمع (عائدة إليه)" : "السيارة عادت إلى المجمع ومتاحة";
      const body = `${driver ? `السائق ${driver} · ` : ""}${destinations ? `${destinations} · ` : ""}${place}${source === "gps" ? " (GPS)" : source === "estimate" ? " (بلا GPS)" : ""}`;
      const open = () => onOpen(`arrival:${items[0].request.id}`);
      toast.success(title, { description: body, duration: 15000, ...goTo(open) });
      if (document.hidden && deviceNotificationsOn()) deviceNotify(title, body, `arrival-${plate}`, open);
    }

    // وصولات فاتت الصفحة: رسالة واحدة بوقت كل سيارة (الأحدث أولًا)، وهي كلها في قائمة الوصول
    if (stale.length) {
      const latestByPlate = Array.from(new Map(stale.map((item) => [item.request.vehiclePlate ?? "", item] as const).reverse()).values())
        .sort((a, b) => b.at.getTime() - a.at.getTime());
      const count = latestByPlate.length;
      const title = `وصلت ${carsText(count)} إلى ${count === 1 ? "وجهتها" : "وجهاتها"} أثناء غيابك عن الصفحة`;
      const shown = latestByPlate.slice(0, 5).map((item) => `${item.request.vehiclePlate ?? ""} الساعة ${clock(item.at)}`).join(" · ");
      const more = count > 5 ? ` · و${count - 5} أخرى` : "";
      const hint = deviceNotificationsOn() ? "" : " · لتصلك التنبيهات وأنت في صفحة أخرى فعّل زر الجرس في «وصول السيارات اليوم»";
      const body = `${shown}${more}${hint}`;
      const open = () => onOpen("fleet-arrivals");
      toast.info(title, { description: body, duration: 20000, ...goTo(open) });
      if (document.hidden && deviceNotificationsOn()) deviceNotify(title, body, "arrival-missed", open);
    }
  }, [arrivals, enabled]);
}

/** تنبيه الجهاز والصفحة في الخلفية (إن فعّله مشرف السيارات)، والضغط عليه ينقل إلى مكانه */
function notifyDevice(title: string, body: string, tag: string, open: () => void) {
  if (document.hidden && deviceNotificationsOn()) deviceNotify(title, body, tag, open);
}

/**
 * رسالة لمشرف السيارات عندما يلغي مشرف المبنى طلبًا في طريق سيارته إلى الاستلام (أو يلغي الموعد نفسه)،
 * حتى يبلغ السائق. تنتظر بضع ثوانٍ ليصل سبب إلغاء الموعد مع المزامنة.
 */
export function useCancellationAlerts({ requests, appointments, enabled = true, onOpen = reveal }: {
  requests: VehicleRequest[];
  appointments: ClinicAppointment[];
  enabled?: boolean;
  /** الضغط على الإشعار: السيارة (أصبحت متاحة) في قائمة السيارات */
  onOpen?: Open;
}) {
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  const tracked = useRef<Map<string, VehicleRequest> | null>(null);
  const latestAppointments = useRef(appointments);
  latestAppointments.current = appointments;
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);

  useEffect(() => {
    if (!enabled) return;
    const onTheWay = new Map(requests
      .filter((request) => request.vehiclePlate && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة"))
      .map((request) => [request.id, request]));
    const previous = tracked.current;
    tracked.current = onTheWay;
    if (!previous) return;
    const remaining = new Set(requests.map((request) => request.id));
    for (const request of Array.from(previous.values())) {
      if (remaining.has(request.id)) continue;
      timers.current.push(window.setTimeout(() => {
        const appointment = latestAppointments.current.find((item) => item.id === request.appointmentId);
        const title = `أُلغي طلب السيارة ${request.vehiclePlate}`;
        const reason = appointment?.status === "ملغي"
          ? `أُلغي موعد ${appointment.patientName}${appointment.cancelReason ? `: ${appointment.cancelReason}` : ""}`
          : `ألغى مشرف المبنى طلب ${appointment?.patientName ?? "الموعد"}`;
        const body = `${reason} · أبلغ السائق${request.driver ? ` ${request.driver}` : ""}، والسيارة متاحة الآن`;
        const open = () => latestOpen.current(`vehicle:${request.vehiclePlate}`);
        toast.warning(title, { description: body, duration: 20000, ...goTo(open) });
        notifyDevice(title, body, `cancel-${request.id}`, open);
      }, 5000));
    }
  }, [requests, enabled]);
}

/**
 * تنبيه لمشرف السيارات عندما ينفي مشرف المبنى ما سجّله السائق من تطبيقه (وصوله أو استلام الضيف)،
 * فالرحلة عادت إلى المرحلة السابقة ويجب التواصل مع السائق. ما كان منفيًا عند فتح الصفحة لا يُنبَّه له.
 */
export function useDenialAlerts({ requests, appointments, enabled = true, onOpen = reveal }: {
  requests: VehicleRequest[];
  appointments: ClinicAppointment[];
  enabled?: boolean;
  /** الضغط على الإشعار: الرحلة في «رحلات جارية» */
  onOpen?: Open;
}) {
  const latestOpen = useRef(onOpen);
  latestOpen.current = onOpen;
  const seen = useRef<Set<string> | null>(null);
  const latestAppointments = useRef(appointments);
  latestAppointments.current = appointments;
  const denials = requests.flatMap((request) => (["arrival", "pickup"] as const)
    .filter((kind) => (kind === "arrival" ? request.arrivalCheck : request.pickupCheck) === "denied")
    .map((kind) => ({ key: `${request.id}:${kind}:${kind === "arrival" ? request.arrivalCheckAt : request.pickupCheckAt}`, kind, request })));
  const signature = denials.map((item) => item.key).join("|");

  useEffect(() => {
    if (!enabled) return;
    if (!seen.current) {
      seen.current = new Set(denials.map((item) => item.key));
      return;
    }
    for (const { key, kind, request } of denials) {
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      const appointment = latestAppointments.current.find((item) => item.id === request.appointmentId);
      const by = (kind === "arrival" ? request.arrivalCheckBy : request.pickupCheckBy) ?? "مشرف المبنى";
      const title = kind === "arrival" ? `نفى ${by} وصول السيارة ${request.vehiclePlate ?? ""}` : `نفى ${by} استلام ${appointment?.patientName ?? "الضيف"}`;
      const body = `${appointment ? `${appointment.patientName} · ` : ""}السائق${request.driver ? ` ${request.driver}` : ""} سجّله من تطبيقه، وعادت الرحلة إلى المرحلة السابقة. تواصل مع السائق.`;
      const open = () => latestOpen.current(`trip:${request.id}`);
      toast.error(title, { description: body, duration: 30000, ...goTo(open) });
      notifyDevice(title, body, `denied-${request.id}-${kind}`, open);
    }
  }, [signature, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** اقتراحات التوجيه التي ظهر تنبيهها في هذه الجلسة. */
const SEEN_REDIRECTS_KEY = "fox_seen_redirects";

/**
 * تنبيه لمشرف السيارات عندما يمكن توجيه سيارة خارج المجمع إلى ضيف ينتظر العودة: في الصفحة مع زر
 * «توجيه»، وعلى الجهاز إن فعّله والصفحة في الخلفية. كل اقتراح (ضيف وسيارة) يُنبَّه له مرة واحدة.
 */
export function useRedirectAlerts({ redirects, driverOf, onDispatch, enabled = true, onOpen = reveal }: {
  redirects: ReturnRedirect[];
  driverOf: (plate: string | undefined, fallback?: string) => string;
  onDispatch: (redirect: ReturnRedirect) => void;
  enabled?: boolean;
  /** الضغط على الإشعار: الاقتراح في «توجيه سيارات خارج المجمع» */
  onOpen?: Open;
}) {
  const latest = useRef({ driverOf, onDispatch, onOpen });
  latest.current = { driverOf, onDispatch, onOpen };
  const key = (item: ReturnRedirect) => `${item.request.id}:${item.vehicle.plate}`;
  const signature = redirects.map(key).join("|");

  useEffect(() => {
    if (!enabled || !redirects.length) return;
    let seen: Set<string>;
    try {
      seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_REDIRECTS_KEY) ?? "[]") as string[]);
    } catch {
      seen = new Set();
    }
    const fresh = redirects.filter((item) => !seen.has(key(item)));
    if (!fresh.length) return;
    fresh.forEach((item) => seen.add(key(item)));
    try {
      sessionStorage.setItem(SEEN_REDIRECTS_KEY, JSON.stringify(Array.from(seen).slice(-300)));
    } catch {
      /* التخزين غير متاح */
    }
    for (const item of fresh) {
      const driver = latest.current.driverOf(item.vehicle.plate, item.vehicle.driver);
      const title = `وجّه السيارة ${item.vehicle.plate} إلى ${item.appointment.patientName}`;
      const body = `${driver ? `السائق ${driver} · ` : ""}عائدة من ${item.from || "الوجهة"} ولم تقطع نصف الطريق، والضيف ينتظر العودة من ${item.pickup} على بعد ${item.distanceKm} كم`;
      const open = () => latest.current.onOpen(`redirect:${item.request.id}`);
      toast.info(title, { description: body, duration: 30000, ...goTo(open, false), action: { label: "توجيه", onClick: () => latest.current.onDispatch(item) } });
      notifyDevice(title, body, `redirect-${item.request.id}`, open);
    }
  }, [signature, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
