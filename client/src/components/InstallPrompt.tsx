import { useEffect, useState } from "react";
import { ExternalLink, Share, ShieldAlert, SquarePlus, X } from "lucide-react";
import { installNeedsChrome, openInChromeLink } from "@/lib/browser";
import { DRIVER_TEXT, storedDriverLang } from "@/lib/driverI18n";
import { btn, cx } from "./ui-kit";

// حدث التثبيت في أندرويد (Chrome)؛ غير موجود في أنواع TypeScript.
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "althumama.installDismissedAt";
const DISMISS_DAYS = 14;

function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

// الآيفون والآيباد (الآيباد الحديث يعرّف نفسه كجهاز Mac يعمل باللمس).
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isTouchDevice() {
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

function recentlyDismissed() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// شريط أسفل الشاشة يقترح إضافة الموقع إلى الشاشة الرئيسية للهاتف:
// في أندرويد من Chrome زر «تثبيت» يفتح نافذة التثبيت، ومن متصفح آخر (مثل Samsung Internet، الذي يحظر
// Play Protect تثبيته) زر «فتح في Chrome»، وفي الآيفون (بلا تثبيت تلقائي) شرح الخطوتين.
export default function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [ios] = useState(() => isIos() && !isStandalone());
  const [needsChrome] = useState(() => installNeedsChrome() && !isStandalone());
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      if (isTouchDevice() && !installNeedsChrome()) setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setHidden(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!installEvent && !ios && !needsChrome)) return null;
  // بلغة تطبيق السائق إن اختارها على هذا الهاتف، وإلا بالعربية
  const lang = storedDriverLang() ?? "ar";
  const t = DRIVER_TEXT[lang].install;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // التخزين غير متاح: يختفي الشريط لهذه الزيارة فقط
    }
    setHidden(true);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === "accepted") setHidden(true);
  };

  return (
    <>
      {/* مساحة أسفل الصفحة حتى لا يغطي الشريط آخر ما فيها (مثل زر الدخول) */}
      <div className="h-32" aria-hidden />
      <div
        role="dialog"
        aria-label={t.title}
        dir={DRIVER_TEXT[lang].dir}
        lang={lang}
        className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl bg-white p-3 shadow-xl ring-1 ring-slate-200"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-start gap-3">
          <img src="/icon-192.png" alt="" className="size-10 shrink-0 rounded-xl ring-1 ring-slate-200" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">{t.title}</p>
            <p className="mt-0.5 text-xs leading-6 text-slate-600">
              {needsChrome ? (
                <>
                  <ShieldAlert className="me-1 inline size-4 align-text-bottom text-amber-600" aria-hidden />
                  {t.chromeOnly}
                </>
              ) : installEvent ? (
                t.fullScreen
              ) : (
                <>
                  {t.iosShare} <Share className="mx-0.5 inline size-4 align-text-bottom text-sky-600" aria-hidden /> {t.iosThen}{" "}
                  <SquarePlus className="mx-0.5 inline size-4 align-text-bottom text-slate-700" aria-hidden />
                </>
              )}
            </p>
          </div>
          <button type="button" onClick={dismiss} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={t.close}>
            <X className="size-5" />
          </button>
        </div>
        {needsChrome && (
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={dismiss} className={btn("ghost", "sm")}>
              {t.later}
            </button>
            <a href={openInChromeLink()} className={cx(btn("primary", "sm"))}>
              <ExternalLink className="size-4" /> {t.openChrome}
            </a>
          </div>
        )}
        {installEvent && (
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={dismiss} className={btn("ghost", "sm")}>
              {t.later}
            </button>
            <button type="button" onClick={install} className={btn("primary", "sm")}>
              {t.install}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
