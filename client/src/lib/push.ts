import { api } from "./api";

/**
 * إشعارات الرحلات على هاتف السائق (Web Push): رحلة جديدة، وإلغاء رحلة، ونفي مشرف المبنى.
 * تصل ولو كان التطبيق مغلقًا. في الآيفون تحتاج iOS 16.4 أو أحدث، وأن يكون الموقع مثبتًا على الشاشة الرئيسية.
 */

export type PushState =
  /** المتصفح لا يدعم الإشعارات */
  | "unsupported"
  /** آيفون من المتصفح: يجب تثبيت الموقع على الشاشة الرئيسية أولًا */
  | "install"
  /** لم يُطلب الإذن بعد */
  | "off"
  /** رفض المستخدم الإذن (يُفعَّل من إعدادات الهاتف) */
  | "blocked"
  | "on";

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function pushState(): PushState {
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!supported) return isIos() && !standalone() ? "install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string) {
  const text = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** عامل الخدمة المسجل (في النسخة المنشورة فقط)، أو null إن لم يجهز خلال ثوانٍ. */
async function registration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
  ]);
}

/** يسجّل هذا الهاتف لإشعارات سيارة السائق (ويجدد التسجيل إن تغيّر). */
async function subscribe() {
  const worker = await registration();
  if (!worker) throw new Error("عامل الخدمة غير جاهز");
  const { key } = await api<{ key: string }>("push-key");
  let subscription = await worker.pushManager.getSubscription();
  // اشتراك قديم بمفتاح موقع آخر لا يصلح
  const current = subscription?.options.applicationServerKey;
  const currentKey = current ? btoa(Array.from(new Uint8Array(current), (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null;
  if (subscription && currentKey && currentKey !== key) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api("push-subscribe", subscription.toJSON());
}

/** زر «تفعيل الإشعارات»: يطلب الإذن ثم يسجّل الهاتف. */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  await subscribe();
  return "on";
}

/** عند فتح صفحة السائق والإذن ممنوح: يجدد التسجيل بصمت (هاتف جديد أو دخول سائق آخر). */
export async function refreshPush() {
  if (pushState() !== "on") return;
  try {
    await subscribe();
  } catch {
    /* يُعاد المحاولة عند الفتح التالي */
  }
}

/** عند خروج السائق: لا تصل إشعارات سيارته إلى هذا الهاتف. */
export async function disablePush() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const worker = await registration();
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) return;
    await api("push-unsubscribe", { endpoint: subscription.endpoint }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    /* لا شيء */
  }
}
