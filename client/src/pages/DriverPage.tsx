import { useCallback, useEffect, useRef, useState } from "react";
import { Accessibility, ArrowLeftRight, Bell, BellOff, CarFront, CheckCircle2, Flag, History, LocateFixed, Lock, MapPin, Navigation, Pause, Play, RefreshCw, ShieldCheck, SunMedium, Timer, XCircle } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import GuestContact from "@/components/GuestContact";
import { Badge, EmptyState, Steps, TimeBlock, btn, cx, timeLabel } from "@/components/ui-kit";
import { toast } from "sonner";
import type { UserProfile } from "@shared/users";
import { DEFAULT_HOSPITALS, distanceKm, type Hospital } from "@shared/hospitals";
import {
  appointmentPickupLabel,
  isNonMedical,
  migrateAppointment,
  migrateRequest,
  statusText,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import { pickupDetails, tripEndpoints, tripPhase } from "@shared/trips";
import { checkStateText, countdownText, driverCheck, type CheckKind } from "@shared/driverChecks";
import { api, ApiError } from "@/lib/api";
import { beep } from "@/lib/beep";
import { disablePush, enablePush, pushState, refreshPush, type PushState } from "@/lib/push";
import { useNow } from "@/lib/useShared";

/** أقل فترة بين إرسالين، وأقل مسافة تستدعي إرسالًا أسرع. */
const SEND_EVERY_MS = 20000;
const MIN_MOVE_KM = 0.05;
/** تحديث قائمة الرحلات أثناء فتح التطبيق (والإشعار يصل ولو كان مغلقًا). */
const TRIPS_EVERY_MS = 8000;

type Status = "idle" | "starting" | "sharing" | "error";
type Position = { lat: number; lng: number; accuracy: number; at: number };
type TripsResponse = { plate: string; requests: unknown[]; appointments: unknown[]; hospitals: Hospital[]; sharing: boolean; serverTime: string };
type Trips = { requests: VehicleRequest[]; appointments: ClinicAppointment[]; hospitals: Hospital[] };

/** يحدد سبب رفض الموقع بدقة حتى يعرف السائق ما يجب تغييره. */
async function diagnoseDenied() {
  const policy = (document as Document & { featurePolicy?: { allowsFeature(feature: string): boolean } }).featurePolicy;
  if (policy && !policy.allowsFeature("geolocation")) {
    return "الموقع الجغرافي ممنوع من إعدادات الموقع الإلكتروني نفسه (Permissions-Policy). يجب إعادة نشر الموقع بالإعداد الصحيح.";
  }
  const state = await navigator.permissions?.query({ name: "geolocation" }).then((result) => result.state).catch(() => null);
  if (state === "denied") {
    return "الموقع محظور لهذا الموقع في Chrome: اضغط الأيقونة يسار شريط العنوان ← الأذونات ← الموقع الجغرافي ← السماح، ثم أعد تحميل الصفحة.";
  }
  return "لم يسمح الهاتف بالموقع. تأكد من: تشغيل الموقع (GPS) في الهاتف، وإذن الموقع لتطبيق Chrome، ثم أعد تحميل الصفحة واختر «السماح» عند ظهور الطلب."
    + (state ? ` (حالة الإذن: ${state})` : "");
}

const alertDevice = () => {
  beep(3);
  try {
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  } catch {
    /* الاهتزاز غير مدعوم */
  }
};

/** ترتيب الرحلات الجارية: في الطريق إلى الوجهة، ثم عند الاستلام، ثم المرسلة، والأقرب موعدًا أولًا. */
const ORDER: Record<string, number> = { "تم استلام المريض": 0, "وصلت السيارة": 1, "تم إرسال السيارة": 2 };

/**
 * تطبيق السائق: مشاركة موقع السيارة (GPS الهاتف) مع مشرف السيارات، ورحلات سيارته اليوم مع الملاحة
 * والاتصال بالضيف، وتسجيل وصوله واستلام الضيف (بشرط تشغيل الموقع)، وإشعارات الرحلات الجديدة.
 * المتصفح يوقف التتبع إذا أُغلقت الشاشة، لذلك نطلب إبقاءها مضاءة أثناء المشاركة.
 */
export default function DriverPage({ profile, onLogout, onChangePassword }: {
  profile: UserProfile;
  onLogout: () => void;
  onChangePassword: () => void;
}) {
  const plate = profile.vehiclePlate ?? "";
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [last, setLast] = useState<{ lat: number; lng: number; accuracy: number; at: Date } | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const lastPosition = useRef<Position | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const [trips, setTrips] = useState<Trips | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>(() => pushState());
  const known = useRef<{ active: Set<string>; denials: Set<string> } | null>(null);
  const now = useNow(1000);

  async function keepScreenOn() {
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen") ?? null;
    } catch {
      /* غير مدعوم في هذا المتصفح */
    }
  }

  function stop(silent = false) {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    lastSent.current = null;
    setStatus("idle");
    if (plate) api("location", { sharing: false }).catch(() => {});
    if (!silent) toast.success("تم إيقاف مشاركة الموقع");
  }

  function start() {
    if (!plate) return;
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("هذا المتصفح لا يدعم تحديد الموقع.");
      return;
    }
    setStatus("starting");
    setError("");
    keepScreenOn();
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        const now = Date.now();
        lastPosition.current = { ...point, accuracy: Math.round(position.coords.accuracy), at: now };
        setLast({ ...point, accuracy: Math.round(position.coords.accuracy), at: new Date(now) });
        setStatus("sharing");
        setError("");
        const previous = lastSent.current;
        const moved = previous ? distanceKm(previous, point) : Infinity;
        if (previous && now - previous.at < SEND_EVERY_MS && moved < MIN_MOVE_KM) return;
        if (previous && now - previous.at < 5000) return;
        lastSent.current = { ...point, at: now };
        // السيارة ووقت التحديث يحددهما الخادم من حساب السائق
        api<{ ok: boolean; arrived?: number }>("location", {
          sharing: true,
          lat: point.lat,
          lng: point.lng,
          accuracy: Math.round(position.coords.accuracy),
          speed: position.coords.speed === null ? null : Math.round(position.coords.speed * 3.6),
          heading: position.coords.heading === null ? null : Math.round(position.coords.heading),
        }).then((result) => {
          // الخادم اكتشف وصول السيارة إلى وجهة رحلة جارية
          if (result.arrived) {
            toast.success("تم تسجيل وصولك إلى الوجهة", { description: "وصلت رسالة لمشرف السيارات، والسيارة متاحة الآن لرحلة جديدة.", duration: 10000 });
            loadTrips();
          }
        }).catch((sendError) => {
          console.error("[gps]", sendError);
          toast.error("تعذر إرسال الموقع. تحقق من الإنترنت.");
        });
      },
      (positionError) => {
        setStatus("error");
        if (positionError.code !== positionError.PERMISSION_DENIED) {
          setError(positionError.code === positionError.TIMEOUT
            ? "انتهت مهلة تحديد الموقع. تأكد من تشغيل GPS وأنك في مكان مكشوف ثم حاول مرة أخرى."
            : "تعذر تحديد الموقع. تأكد من تشغيل GPS (الموقع) من إعدادات الهاتف.");
          return;
        }
        diagnoseDenied().then(setError);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
    );
  }

  /** رحلات السيارة اليوم من الخادم، مع تنبيه (صوت واهتزاز) عند رحلة جديدة أو إلغاء أو نفي من مشرف المبنى. */
  const loadTrips = useCallback(async () => {
    if (!plate) return;
    try {
      const data = await api<TripsResponse>("driver-trips");
      const requests = data.requests.map(migrateRequest).filter((request): request is VehicleRequest => request !== null);
      const appointments = data.appointments.map((item, index) => migrateAppointment(item, index)).filter((item): item is ClinicAppointment => item !== null);
      const hospitals = data.hospitals.filter((item) => typeof item?.lat === "number" && typeof item?.lng === "number");
      const active = new Set(requests.filter((request) => request.status in ORDER).map((request) => request.id));
      const denials = new Set(requests.flatMap((request) => [
        request.arrivalCheck === "denied" ? `${request.id}:arrival:${request.arrivalCheckAt}` : "",
        request.pickupCheck === "denied" ? `${request.id}:pickup:${request.pickupCheckAt}` : "",
      ].filter(Boolean)));
      const previous = known.current;
      if (previous) {
        const fresh = Array.from(active).filter((id) => !previous.active.has(id) && requests.find((request) => request.id === id)?.status === "تم إرسال السيارة");
        const cancelled = Array.from(previous.active).filter((id) => !requests.some((request) => request.id === id));
        const denied = Array.from(denials).filter((key) => !previous.denials.has(key));
        if (fresh.length) toast.success(fresh.length > 1 ? `${fresh.length} رحلات جديدة` : "رحلة جديدة", { description: "افتح الرحلة لمعرفة مكان الاستلام والملاحة إليه", duration: 15000 });
        if (cancelled.length) toast.warning(cancelled.length > 1 ? `أُلغيت ${cancelled.length} رحلات` : "أُلغيت رحلة", { duration: 15000 });
        if (denied.length) toast.error("مشرف المبنى لم يؤكد ما سجّلته", { description: "عادت الرحلة إلى المرحلة السابقة. تأكد من المكان وتواصل مع مشرف السيارات.", duration: 20000 });
        if (fresh.length || cancelled.length || denied.length) alertDevice();
      }
      known.current = { active, denials };
      setTrips({ requests, appointments, hospitals: hospitals.length ? hospitals : DEFAULT_HOSPITALS });
      setLoadError("");
    } catch (loadFailure) {
      setLoadError(loadFailure instanceof Error ? loadFailure.message : "تعذر تحميل الرحلات");
    }
  }, [plate]);

  // تحديث الرحلات كل بضع ثوانٍ والتطبيق ظاهر، وفورًا عند العودة إليه
  useEffect(() => {
    loadTrips();
    refreshPush();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadTrips();
    }, TRIPS_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [loadTrips]);

  // إعادة طلب إبقاء الشاشة مضاءة عند العودة للصفحة، وإيقاف المشاركة عند مغادرتها
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (watchId.current !== null) keepScreenOn();
      loadTrips();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watchId.current !== null) stop(true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sharing = status === "sharing" || status === "starting";
  const live = status === "sharing";

  /** موقع الهاتف الآن: آخر موقع من المشاركة إن كان حديثًا، وإلا يُطلب من جديد. */
  function currentPosition(): Promise<Position> {
    const recent = lastPosition.current;
    if (recent && Date.now() - recent.at < 60000) return Promise.resolve(recent);
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: Math.round(position.coords.accuracy), at: Date.now() }),
      reject,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 },
    ));
  }

  /** «وصلت» أو «تم استلام الضيف»: بموقع الهاتف لحظتها، وينتظر تأكيد مشرف المبنى. */
  async function act(request: VehicleRequest, action: "arrived" | "pickedUp") {
    if (!trips || busy) return;
    if (!live) {
      toast.error("شغّل مشاركة الموقع أولًا");
      return;
    }
    const question = action === "arrived" ? "تسجيل وصولك إلى نقطة الاستلام؟" : "تسجيل استلام الضيف وبدء الطريق إلى الوجهة؟";
    if (!window.confirm(`${question}\nيصل إلى مشرف المبنى ليؤكده، ويمكنك المتابعة قبل تأكيده.`)) return;
    setBusy(request.id);
    try {
      const position = await currentPosition().catch(() => {
        throw new Error("تعذر تحديد موقعك. تأكد من تشغيل الموقع (GPS) ثم حاول مرة أخرى.");
      });
      const body: Record<string, unknown> = { id: request.id, action, lat: position.lat, lng: position.lng, accuracy: position.accuracy };
      if (action === "pickedUp") {
        const appointment = trips.appointments.find((item) => item.id === request.appointmentId);
        if (!appointment) throw new Error("تعذر العثور على الموعد. حدّث الصفحة.");
        const from = request.fromAppointmentId ? trips.appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null;
        const passengers = request.groupId ? trips.requests.filter((item) => item.groupId === request.groupId).length : 1;
        const details = pickupDetails(request, appointment, trips.hospitals, new Date(), passengers, from);
        body.etaMinutes = Math.max(1, Math.round((Date.parse(details.etaAt ?? "") - Date.now()) / 60000));
        if (details.destLat !== undefined) Object.assign(body, { destLat: details.destLat, destLng: details.destLng });
      }
      await api("driver-action", body);
      toast.success(action === "arrived" ? "تم تسجيل وصولك" : "تم تسجيل استلام الضيف", { description: "وصل إلى مشرف المبنى ليؤكده خلال 5 دقائق" });
      await loadTrips();
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "تعذر التسجيل");
      if (actionError instanceof ApiError && actionError.status === 409) loadTrips();
    } finally {
      setBusy(null);
    }
  }

  async function turnOnPush() {
    try {
      const next = await enablePush();
      setPush(next);
      if (next === "on") toast.success("تم تفعيل إشعارات الرحلات على هذا الهاتف");
    } catch {
      toast.error("تعذر تفعيل الإشعارات. حاول مرة أخرى.");
    }
  }

  async function logout() {
    if (watchId.current !== null) stop(true);
    // لا تصل إشعارات هذه السيارة إلى الهاتف بعد الخروج
    await Promise.race([disablePush(), new Promise((resolve) => window.setTimeout(resolve, 3000))]);
    onLogout();
  }

  const tone = status === "sharing" ? "green" : status === "error" ? "red" : status === "starting" ? "blue" : "neutral";
  const title = status === "sharing" ? "يتم إرسال موقعك إلى مشرف السيارات" : status === "starting" ? "جارٍ تحديد الموقع..." : status === "error" ? "المشاركة متوقفة" : "مشاركة الموقع متوقفة";

  const activeTrips = (trips?.requests ?? [])
    .filter((request) => request.status in ORDER && tripPhase(request, now, live).kind !== "arrived")
    .map((request) => ({ request, appointment: trips!.appointments.find((item) => item.id === request.appointmentId) }))
    .filter((item): item is { request: VehicleRequest; appointment: ClinicAppointment } => Boolean(item.appointment))
    .sort((a, b) => ORDER[a.request.status] - ORDER[b.request.status] || a.appointment.appointmentAt.localeCompare(b.appointment.appointmentAt));
  const finished = (trips?.requests ?? [])
    .map((request) => ({ request, phase: tripPhase(request, now, live), appointment: trips!.appointments.find((item) => item.id === request.appointmentId) }))
    .filter((item) => item.phase.kind === "arrived" && item.appointment)
    .sort((a, b) => b.appointment!.appointmentAt.localeCompare(a.appointment!.appointmentAt));

  return (
    <div className="min-h-screen bg-page" dir="rtl">
      <AppHeader role="السائق" name={profile.displayName} onChangePassword={onChangePassword} onLogout={logout} />
      <main className="mx-auto max-w-md space-y-4 p-4 sm:p-6">
        {!plate ? (
          <p className="rounded-2xl bg-amber-50 p-5 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">لم يربط مدير النظام حسابك بسيارة بعد.</p>
        ) : (
          <>
            <section className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200/80">
              <div className="flex items-center justify-between gap-3 bg-navy-900 px-5 py-4 text-white">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><CarFront className="h-5 w-5" /></span>
                  <div className="leading-tight">
                    <p className="text-xs text-slate-300">السيارة</p>
                    <p className="text-2xl font-semibold tabular" dir="ltr">{plate}</p>
                  </div>
                </div>
                <Badge tone={tone}>{status === "sharing" ? "GPS مباشر" : status === "starting" ? "جارٍ التشغيل" : status === "error" ? "خطأ" : "متوقف"}</Badge>
              </div>
              <div className="p-5">
                <div className="flex items-center gap-3">
                  <span className={cx(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                    status === "sharing" ? "bg-emerald-50 text-emerald-600" : status === "error" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400",
                  )}>
                    {status === "sharing" ? <LocateFixed className="h-6 w-6 animate-pulse" /> : <MapPin className="h-6 w-6" />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{title}</p>
                    {last
                      ? <p className="text-xs text-slate-500">آخر تحديث <span dir="ltr" className="tabular">{last.at.toLocaleTimeString("en-GB")}</span> · دقة ±{last.accuracy} م</p>
                      : <p className="text-xs text-slate-500">شغّلها قبل بدء الرحلات: يُسجَّل وصولك إلى الوجهة تلقائيًا</p>}
                  </div>
                </div>
                {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-start text-sm leading-6 text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
                <button onClick={() => (sharing ? stop() : start())} className={cx(btn(sharing ? "dark" : "primary", "lg"), "mt-4 h-14 w-full rounded-2xl text-base")}>
                  {sharing ? <><Pause className="h-5 w-5" /> إيقاف المشاركة</> : <><Play className="h-5 w-5" /> بدء مشاركة الموقع</>}
                </button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-500"><SunMedium className="h-4 w-4" /> أبقِ الشاشة مضاءة والتطبيق مفتوحًا أثناء الرحلة</p>
              </div>
            </section>

            <PushCard state={push} onEnable={turnOnPush} />

            <section aria-label="رحلاتي" className="space-y-3">
              <div className="flex items-center justify-between gap-2 px-1">
                <h2 className="text-lg font-bold text-ink">رحلاتي {activeTrips.length > 0 && <span className="text-sm font-semibold text-slate-500">({activeTrips.length})</span>}</h2>
                <button type="button" onClick={() => loadTrips()} className={btn("ghost", "sm")} aria-label="تحديث الرحلات"><RefreshCw className="h-4 w-4" /> تحديث</button>
              </div>
              {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">{loadError}</p>}
              {!trips && !loadError && <p className="rounded-2xl bg-white p-5 text-center text-sm text-slate-500 ring-1 ring-slate-200/80">جارٍ تحميل الرحلات...</p>}
              {trips && (activeTrips.length ? activeTrips.map(({ request, appointment }) => (
                <TripCard
                  key={request.id}
                  request={request}
                  appointment={appointment}
                  from={request.fromAppointmentId ? trips.appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null}
                  hospitals={trips.hospitals}
                  group={request.groupId ? trips.requests.filter((item) => item.groupId === request.groupId).length : 1}
                  now={now}
                  live={live}
                  busy={busy === request.id}
                  onAction={(action) => act(request, action)}
                />
              )) : (
                <div className="rounded-2xl bg-white ring-1 ring-slate-200/80">
                  <EmptyState icon={CheckCircle2} title="لا توجد رحلات لسيارتك الآن" hint={push === "on" ? "تصلك الرحلة الجديدة بإشعار على الهاتف" : "تظهر هنا الرحلة عندما يرسلها مشرف السيارات"} />
                </div>
              ))}
            </section>

            {finished.length > 0 && (
              <details className="rounded-2xl bg-white ring-1 ring-slate-200/80">
                <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700">
                  <History className="h-4 w-4 text-slate-400" /> رحلات انتهت اليوم ({finished.length})
                </summary>
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {finished.map(({ request, phase, appointment }) => (
                    <li key={request.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate"><span dir="ltr" className="tabular text-slate-500">{appointment!.appointmentAt}</span> · {appointment!.patientName} · {tripEndpoints(appointment!, request.direction, trips!.hospitals).destination}</span>
                      {phase.kind === "arrived" && phase.at && <span className="shrink-0 text-xs text-emerald-700">وصلت <span dir="ltr" className="tabular">{timeLabel(phase.at)}</span></span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** تفعيل إشعارات الرحلات على هذا الهاتف، أو سبب عدم توفرها. */
function PushCard({ state, onEnable }: { state: PushState; onEnable: () => void }) {
  if (state === "on") {
    return <p className="flex items-center gap-1.5 px-1 text-xs font-medium text-emerald-700"><Bell className="h-4 w-4" /> إشعارات الرحلات مفعّلة على هذا الهاتف</p>;
  }
  const text: Record<Exclude<PushState, "on">, string> = {
    off: "تصلك الرحلة الجديدة بإشعار وصوت حتى لو كان التطبيق مغلقًا.",
    blocked: "الإشعارات ممنوعة لهذا التطبيق. فعّلها من إعدادات الهاتف: الإعدادات ← الإشعارات ← سيارات الثمامة (أو Chrome).",
    install: "على الآيفون تصل الإشعارات فقط بعد تثبيت التطبيق: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وافتحه من الأيقونة.",
    unsupported: "هذا المتصفح لا يدعم الإشعارات. افتح التطبيق من Chrome أو ثبّته على الشاشة الرئيسية.",
  };
  return (
    <section className={cx("rounded-2xl p-4 ring-1 ring-inset", state === "off" ? "bg-violet-50 ring-violet-200" : "bg-amber-50 ring-amber-200")}>
      <p className="flex items-center gap-2 font-semibold text-ink">{state === "off" ? <Bell className="h-5 w-5 text-violet-600" /> : <BellOff className="h-5 w-5 text-amber-600" />} إشعارات الرحلات الجديدة</p>
      <p className="mt-1 text-sm leading-6 text-slate-600">{text[state]}</p>
      {state === "off" && <button type="button" onClick={onEnable} className={cx(btn("primary"), "mt-3 w-full")}><Bell className="h-4 w-4" /> تفعيل الإشعارات</button>}
    </section>
  );
}

const DRIVER_STEPS = ["أُرسلت", "عند الاستلام", "في الطريق", "الوجهة"];

const mapsLink = (point: { lat: number; lng: number } | null, label: string) => point
  ? `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${label} قطر`)}`;
const wazeLink = (point: { lat: number; lng: number }) => `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`;

/** رحلة جارية للسائق: الضيف، ومن أين إلى أين، والملاحة، والاتصال بالضيف، وزر المرحلة التالية. */
function TripCard({ request, appointment, from, hospitals, group, now, live, busy, onAction }: {
  request: VehicleRequest;
  appointment: ClinicAppointment;
  from: ClinicAppointment | null;
  hospitals: Hospital[];
  group: number;
  now: Date;
  live: boolean;
  busy: boolean;
  onAction: (action: "arrived" | "pickedUp") => void;
}) {
  const returning = request.direction === "عودة";
  const endpoints = tripEndpoints(appointment, request.direction, hospitals, from);
  const home = `مجمع الثمامة · ${appointmentPickupLabel(appointment)}`;
  const pickupLabel = from ? from.clinic : returning ? appointment.clinic : home;
  const dropLabel = returning ? home : endpoints.destination;
  const beforePickup = request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة";
  const target = beforePickup ? { point: endpoints.from, label: pickupLabel } : { point: endpoints.to, label: dropLabel };
  const phase = tripPhase(request, now, live);
  const step = request.status === "تم إرسال السيارة" ? 0 : request.status === "وصلت السيارة" ? 1 : 2;
  const assistance = appointment.assistance.join("، ");
  const next = request.status === "تم إرسال السيارة"
    ? { action: "arrived" as const, label: "وصلت إلى نقطة الاستلام", icon: MapPin }
    : request.status === "وصلت السيارة"
      ? { action: "pickedUp" as const, label: "تم استلام الضيف", icon: CheckCircle2 }
      : null;
  const checks = (["arrival", "pickup"] as CheckKind[]).flatMap((kind) => {
    const check = driverCheck(request, kind, now);
    return check ? [check] : [];
  });

  return (
    <article className={cx("overflow-hidden rounded-2xl bg-white shadow-card ring-1", request.status === "تم إرسال السيارة" ? "ring-amber-300" : "ring-blue-200")}>
      <div className={cx("h-1", request.status === "تم إرسال السيارة" ? "bg-amber-400" : "bg-blue-500")} />
      <div className="p-4">
        <div className="flex gap-3">
          <TimeBlock time={appointment.appointmentAt} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="font-bold text-ink">{appointment.patientName}</p>
              {appointment.gender && <span className="text-xs text-slate-500">{appointment.gender}</span>}
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {from ? <Badge tone="cyan" icon={ArrowLeftRight}>نقل بين موعدين</Badge> : <Badge tone={returning ? "amber" : "neutral"}>{request.direction}</Badge>}
              {isNonMedical(appointment) && <Badge tone="violet">غير طبية</Badge>}
              {appointment.kind === "احتياجات خاصة" && <Badge icon={Accessibility}>احتياجات خاصة</Badge>}
              {group > 1 && <Badge tone="violet">رحلة مجمّعة · {group} ضيوف</Badge>}
            </div>
          </div>
        </div>

        <ol className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><span className="text-xs text-slate-500">الاستلام: </span><span className="font-medium text-ink">{pickupLabel}</span></span></li>
          <li className="flex items-start gap-2"><Flag className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" /><span><span className="text-xs text-slate-500">الوجهة: </span><span className="font-medium text-ink">{dropLabel}</span></span></li>
        </ol>
        {assistance && <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700"><Accessibility className="h-4 w-4 text-slate-500" /> {assistance}</p>}
        {appointment.mobile && appointment.mobile !== "-" && <div className="mt-3 text-sm text-slate-600"><GuestContact mobile={appointment.mobile} size="md" /></div>}

        <div className="mt-3"><Steps steps={DRIVER_STEPS} current={step} /></div>

        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <a href={mapsLink(target.point, target.label)} target="_blank" rel="noreferrer" className={cx(btn("secondary"), "w-full")}>
            <Navigation className="h-4 w-4" /> الملاحة إلى {beforePickup ? "الاستلام" : "الوجهة"}
          </a>
          {target.point && <a href={wazeLink(target.point)} target="_blank" rel="noreferrer" className={btn("secondary")}>Waze</a>}
        </div>

        {phase.kind === "toDestination" && (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
            <Timer className="h-4 w-4 shrink-0" /> الوصول المتوقع <span dir="ltr" className="font-semibold tabular">{timeLabel(phase.etaAt)}</span>
            <span className="text-xs text-blue-800/80">· {live ? "يُسجَّل وصولك تلقائيًا عند الاقتراب من الوجهة" : "شغّل مشاركة الموقع ليُسجَّل وصولك تلقائيًا"}</span>
          </p>
        )}

        {checks.length > 0 && (
          <ul className="mt-3 space-y-1">
            {checks.map((check) => (
              <li key={check.kind} className={cx(
                "flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs",
                check.state === "denied" ? "bg-red-50 font-semibold text-red-800 ring-1 ring-inset ring-red-200" : check.state === "pending" ? "bg-amber-50 text-amber-900" : "text-slate-500",
              )}>
                {check.state === "denied" ? <XCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : check.state === "pending" ? <Timer className="mt-px h-3.5 w-3.5 shrink-0" /> : <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />}
                <span>
                  {checkStateText(check)}
                  {check.state === "pending" && <> · <span dir="ltr" className="tabular">{countdownText(check.secondsLeft)}</span> (يمكنك المتابعة)</>}
                  {check.state === "denied" && " · تأكد من المكان وتواصل مع مشرف السيارات"}
                </span>
              </li>
            ))}
          </ul>
        )}

        {next && (
          <button
            type="button"
            disabled={busy || !live}
            onClick={() => onAction(next.action)}
            className={cx(btn(next.action === "arrived" ? "primary" : "success", "lg"), "mt-3 h-14 w-full rounded-2xl text-base")}
          >
            {busy ? "جارٍ التسجيل..." : !live ? <><Lock className="h-5 w-5" /> شغّل مشاركة الموقع أولًا</> : <><next.icon className="h-5 w-5" /> {next.label}</>}
          </button>
        )}
        {!live && next && <p className="mt-1.5 text-center text-xs text-slate-500">الحالة الآن: {statusText(request.status)} · تسجيل الوصول والاستلام يحتاج مشاركة الموقع</p>}
      </div>
    </article>
  );
}
