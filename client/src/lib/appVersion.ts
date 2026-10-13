import { useEffect, useState } from "react";

/**
 * نسخة الموقع: كل بناء له رقم (BUILD_ID، من vite.config.ts) ويُكتب معه /version.json.
 * الصفحة المفتوحة تسأل عنه كل دقيقة وعند الرجوع إليها، فإن نُشرت نسخة جديدة يظهر شريط «تم تحديث الموقع»
 * وتُعاد الصفحة وحدها بعد عدّ تنازلي، ما لم يكن المستخدم يكتب في حقل أو في نافذة مفتوحة (أو السائق يشارك موقعه من المتصفح).
 */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
export const VERSION_CHECK_MS = 60_000;
export const AUTO_RELOAD_SECONDS = 30;

let holds = 0;
/** يمنع إعادة الصفحة تلقائيًا ما دام مفعّلًا (مشاركة الموقع من متصفح السائق تتوقف بإعادة الصفحة) */
export function holdAutoReload(on: boolean) {
  holds = Math.max(0, holds + (on ? 1 : -1));
}

/** هل يمكن إعادة الصفحة الآن بلا ضياع ما يكتبه المستخدم */
export function canReloadNow() {
  if (holds > 0) return false;
  const active = document.activeElement;
  if (active && (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || (active as HTMLElement).isContentEditable)) {
    // الصفحة مخفية: لا أحد يكتب الآن
    if (document.visibilityState === "visible") return false;
  }
  return !document.querySelector('[role="dialog"], [aria-modal="true"]');
}

async function latestBuild(): Promise<string | null> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as { build?: unknown };
    return typeof data.build === "string" ? data.build : null;
  } catch {
    return null;
  }
}

/** رقم النسخة الجديدة المنشورة إن اختلف عن نسخة الصفحة المفتوحة (في النسخة المنشورة فقط) */
export function useNewVersion(): string | null {
  const [next, setNext] = useState<string | null>(null);
  useEffect(() => {
    if (!import.meta.env.PROD || BUILD_ID === "dev") return;
    let stopped = false;
    const check = async () => {
      const build = await latestBuild();
      if (!stopped && build && build !== BUILD_ID) setNext(build);
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const timer = window.setInterval(check, VERSION_CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  return next;
}
