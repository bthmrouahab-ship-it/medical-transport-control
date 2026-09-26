import { useEffect, useRef, useState } from "react";
import { CarFront, LocateFixed, MapPin, Pause, Play, SunMedium } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { Badge, btn, cx } from "@/components/ui-kit";
import { toast } from "sonner";
import type { UserProfile } from "@shared/users";
import { distanceKm } from "@shared/hospitals";
import { api } from "@/lib/api";

/** أقل فترة بين إرسالين، وأقل مسافة تستدعي إرسالًا أسرع. */
const SEND_EVERY_MS = 20000;
const MIN_MOVE_KM = 0.05;

type Status = "idle" | "starting" | "sharing" | "error";

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

/**
 * صفحة السائق: مشاركة موقع السيارة (GPS الهاتف) مع مشرف السيارات.
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
  const wakeLock = useRef<WakeLockSentinel | null>(null);

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
          if (result.arrived) toast.success("تم تسجيل وصولك إلى الوجهة", { description: "وصلت رسالة لمشرف السيارات، والسيارة متاحة الآن لرحلة جديدة.", duration: 10000 });
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

  // إعادة طلب إبقاء الشاشة مضاءة عند العودة للصفحة، وإيقاف المشاركة عند مغادرتها
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && watchId.current !== null) keepScreenOn();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (watchId.current !== null) stop(true);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sharing = status === "sharing" || status === "starting";

  const tone = status === "sharing" ? "green" : status === "error" ? "red" : status === "starting" ? "blue" : "neutral";
  const title = status === "sharing" ? "يتم إرسال موقعك إلى مشرف السيارات" : status === "starting" ? "جارٍ تحديد الموقع..." : status === "error" ? "المشاركة متوقفة" : "مشاركة الموقع متوقفة";

  return (
    <div className="min-h-screen bg-page" dir="rtl">
      <AppHeader role="السائق" name={profile.displayName} onChangePassword={onChangePassword} onLogout={() => { if (watchId.current !== null) stop(true); onLogout(); }} />
      <main className="mx-auto max-w-md p-4 sm:p-6">
        {!plate ? (
          <p className="rounded-2xl bg-amber-50 p-5 text-sm font-medium text-amber-900 ring-1 ring-inset ring-amber-200">لم يربط مدير النظام حسابك بسيارة بعد.</p>
        ) : (
          <div className="overflow-hidden rounded-3xl bg-white shadow-card ring-1 ring-slate-200/80">
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
            <div className="p-6 text-center">
              <div className={cx(
                "mx-auto flex h-32 w-32 items-center justify-center rounded-full ring-8",
                status === "sharing" ? "bg-emerald-50 text-emerald-600 ring-emerald-50/60" : status === "error" ? "bg-red-50 text-red-600 ring-red-50/60" : "bg-slate-100 text-slate-400 ring-slate-100/60",
              )}>
                {status === "sharing" ? <LocateFixed className="h-14 w-14 animate-pulse" /> : <MapPin className="h-14 w-14" />}
              </div>
              <p className="mt-5 text-lg font-semibold text-ink">{title}</p>
              {last
                ? <p className="mt-1 text-sm text-slate-500">آخر تحديث <span dir="ltr" className="tabular">{last.at.toLocaleTimeString("en-GB")}</span> · دقة ±{last.accuracy} م</p>
                : <p className="mt-1 text-sm text-slate-500">يُسجَّل وصولك إلى الوجهة تلقائيًا أثناء المشاركة</p>}
              {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-start text-sm leading-6 text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
              <button onClick={() => (sharing ? stop() : start())} className={cx(btn(sharing ? "dark" : "primary", "lg"), "mt-6 h-14 w-full rounded-2xl text-base")}>
                {sharing ? <><Pause className="h-5 w-5" /> إيقاف المشاركة</> : <><Play className="h-5 w-5" /> بدء مشاركة الموقع</>}
              </button>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500"><SunMedium className="h-4 w-4" /> أبقِ الشاشة مضاءة والصفحة مفتوحة أثناء الرحلة</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
