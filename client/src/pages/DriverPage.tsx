import { useEffect, useRef, useState } from "react";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { KeyRound, LocateFixed, LogOut, MapPin, Pause, Play, Truck } from "lucide-react";
import { toast } from "sonner";
import type { UserProfile } from "@shared/users";
import { distanceKm } from "@shared/hospitals";
import { firestore } from "@/lib/firebase";

/** أقل فترة بين إرسالين، وأقل مسافة تستدعي إرسالًا أسرع. */
const SEND_EVERY_MS = 20000;
const MIN_MOVE_KM = 0.05;

type Status = "idle" | "starting" | "sharing" | "error";

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
  const locationRef = doc(firestore, "vehicleLocations", plate || "_");

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
    if (plate) updateDoc(locationRef, { sharing: false, updatedAt: new Date().toISOString() }).catch(() => {});
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
        const previous = lastSent.current;
        const moved = previous ? distanceKm(previous, point) : Infinity;
        if (previous && now - previous.at < SEND_EVERY_MS && moved < MIN_MOVE_KM) return;
        if (previous && now - previous.at < 5000) return;
        lastSent.current = { ...point, at: now };
        setDoc(locationRef, {
          plate,
          lat: point.lat,
          lng: point.lng,
          accuracy: Math.round(position.coords.accuracy),
          speed: position.coords.speed === null ? null : Math.round(position.coords.speed * 3.6),
          heading: position.coords.heading === null ? null : Math.round(position.coords.heading),
          driver: profile.displayName,
          sharing: true,
          updatedAt: new Date(now).toISOString(),
        }).catch((sendError) => {
          console.error("[gps]", sendError);
          toast.error("تعذر إرسال الموقع. تحقق من الإنترنت.");
        });
      },
      (positionError) => {
        setStatus("error");
        setError(positionError.code === positionError.PERMISSION_DENIED
          ? "تم رفض إذن الموقع. اسمح للموقع من إعدادات المتصفح ثم حاول مرة أخرى."
          : "تعذر تحديد الموقع. تأكد من تشغيل GPS.");
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

  return (
    <div className="min-h-screen bg-[#f5f7fb]" dir="rtl">
      <header className="flex h-[72px] items-center justify-between border-b border-slate-200 px-5">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#10233f] text-[#e43846]"><Truck className="h-5 w-5" /></div>
          <div><p className="text-xs font-semibold text-[#a61d2d]">صفحة السائق</p><h1 className="text-lg font-bold">{profile.displayName}</h1></div>
        </div>
        <div className="flex gap-2">
          <button onClick={onChangePassword} aria-label="تغيير كلمة المرور" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><KeyRound className="h-4 w-4" /></button>
          <button onClick={() => { if (watchId.current !== null) stop(true); onLogout(); }} aria-label="تسجيل الخروج" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500"><LogOut className="h-4 w-4" /></button>
        </div>
      </header>
      <main className="mx-auto max-w-md p-5">
        {!plate ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-800">لم يربط مدير النظام حسابك بسيارة بعد.</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
            <p className="text-xs font-bold text-slate-400">السيارة</p>
            <p className="mt-1 text-3xl font-bold" dir="ltr">{plate}</p>
            <div className={`mx-auto mt-6 flex h-28 w-28 items-center justify-center rounded-full ${status === "sharing" ? "bg-emerald-50 text-emerald-600" : status === "error" ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-400"}`}>
              {status === "sharing" ? <LocateFixed className="h-12 w-12 animate-pulse" /> : <MapPin className="h-12 w-12" />}
            </div>
            <p className="mt-4 font-bold">
              {status === "sharing" ? "يتم إرسال موقعك إلى مشرف السيارات" : status === "starting" ? "جارٍ تحديد الموقع..." : status === "error" ? "المشاركة متوقفة" : "مشاركة الموقع متوقفة"}
            </p>
            {last && <p className="mt-1 text-xs text-slate-400">آخر تحديث {last.at.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} · دقة ±{last.accuracy} م</p>}
            {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
            <button onClick={() => (sharing ? stop() : start())} className={`mt-6 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold text-white ${sharing ? "bg-slate-700" : "bg-[#a61d2d]"}`}>
              {sharing ? <><Pause className="h-5 w-5" /> إيقاف المشاركة</> : <><Play className="h-5 w-5" /> بدء مشاركة الموقع</>}
            </button>
            <p className="mt-4 text-[11px] leading-5 text-slate-400">أبقِ هذه الصفحة مفتوحة والشاشة مضاءة أثناء الرحلة. يتوقف الإرسال عند إغلاق الصفحة أو قفل الهاتف.</p>
          </div>
        )}
      </main>
    </div>
  );
}
