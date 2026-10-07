/**
 * طبقة حفظ بيانات التطبيق.
 *
 * بشكل افتراضي تُحفظ البيانات في localStorage (كما كان سابقًا).
 * يمكن استبدال مصدر البيانات المشتركة (المواعيد، الطلبات، السيارات، السجل)
 * بقاعدة بيانات مشتركة عبر setSharedBackend، فتظهر تغييرات كل مستخدم
 * للآخرين مباشرة. بيانات الجلسة (تسجيل الدخول) تبقى محلية دائمًا.
 */

export const SHARED_KEYS = [
  "fox_appointments",
  "fox_requests",
  "fox_fleet",
  "fox_hospitals",
  "fox_history",
  "fox_locations",
  "fox_guests",
  "fox_drivers",
  "fox_private_cars",
  "fox_special_needs",
  "fox_schedules",
  "fox_complaints",
] as const;
export type SharedKey = (typeof SHARED_KEYS)[number];

export interface SharedBackend {
  /** يحمّل القيم الحالية لكل المفاتيح المشتركة (undefined = لا توجد بيانات بعد). */
  init(): Promise<Partial<Record<SharedKey, unknown>>>;
  /** يحفظ القيمة الجديدة لمفتاح مشترك. */
  write(key: SharedKey, next: unknown, previous: unknown): Promise<void>;
  /** يحفظ أكثر من مفتاح في دفعة واحدة بالترتيب (كلها أو لا شيء)، مثل طلب العودة وطلب سيارته معًا. */
  writeMany?(entries: { key: SharedKey; next: unknown; previous: unknown }[]): Promise<void>;
  /** يستدعي onChange عند وصول تغيير من مستخدم آخر. يعيد دالة لإلغاء الاشتراك. */
  watch(onChange: (key: SharedKey, value: unknown) => void): () => void;
}

type Listener = (key: string) => void;

const cache = new Map<string, unknown>();
const listeners = new Set<Listener>();
let backend: SharedBackend | null = null;
let stopWatching: (() => void) | null = null;
let onError: ((error: unknown) => void) | null = null;

function isShared(key: string): key is SharedKey {
  return (SHARED_KEYS as readonly string[]).includes(key);
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* التخزين المحلي غير متاح */
  }
}

/** يفعّل قاعدة بيانات مشتركة بدل التخزين المحلي، ويحمّل بياناتها قبل عرض الواجهة. */
export async function setSharedBackend(next: SharedBackend, handleError?: (error: unknown) => void) {
  clearSharedBackend();
  const initial = await next.init();
  for (const key of SHARED_KEYS) {
    if (initial[key] !== undefined) cache.set(key, initial[key]);
  }
  backend = next;
  onError = handleError ?? null;
  stopWatching = next.watch((key, value) => {
    if (JSON.stringify(cache.get(key)) === JSON.stringify(value)) return;
    if (value === undefined) cache.delete(key);
    else cache.set(key, value);
    listeners.forEach((listener) => listener(key));
  });
}

/** يوقف المزامنة ويمسح البيانات من الذاكرة (عند تسجيل الخروج). */
export function clearSharedBackend() {
  stopWatching?.();
  stopWatching = null;
  backend = null;
  onError = null;
  cache.clear();
}

/** هل توجد قيمة محفوظة لهذا المفتاح المشترك في قاعدة البيانات؟ */
export function hasSharedState(key: SharedKey) {
  return cache.has(key);
}

export function isUsingSharedBackend() {
  return backend !== null;
}

export function loadState<T>(key: string, fallback: T): T {
  if (backend && isShared(key)) {
    return cache.has(key) ? (cache.get(key) as T) : fallback;
  }
  return readLocal(key, fallback);
}

/**
 * يحفظ قيمة مفتاح. baseline هي القائمة التي عدّلها المستخدم كما رآها على الشاشة:
 * تُكتب الفروق عنها فقط، فلا تُعاد كتابة عناصر لم يلمسها ولا تُمحى تغييرات وصلت للتو من غيره.
 */
export function saveState<T>(key: string, value: T, baseline?: T) {
  if (backend && isShared(key)) {
    const previous = baseline !== undefined ? baseline : cache.get(key);
    cache.set(key, value);
    backend.write(key, value, previous).catch((error) => {
      console.error("[appStore] فشل الحفظ", error);
      onError?.(error);
    });
    // إبلاغ باقي أجزاء الصفحة التي تعرض نفس البيانات
    queueMicrotask(() => listeners.forEach((listener) => listener(key)));
    return;
  }
  writeLocal(key, value);
}

/**
 * يحفظ أكثر من قيمة في دفعة واحدة بالترتيب المعطى (مثل الموعد ثم طلب سيارته)، حتى يجد الخادم الموعد
 * محفوظًا قبل الطلب، ولا يُحفظ أحدهما دون الآخر.
 */
export function saveStates(entries: { key: SharedKey; value: unknown; baseline?: unknown }[]) {
  if (backend) {
    const writes = entries.map(({ key, value, baseline }) => {
      const previous = baseline !== undefined ? baseline : cache.get(key);
      cache.set(key, value);
      return { key, next: value, previous };
    });
    const saving = backend.writeMany
      ? backend.writeMany(writes)
      : writes.reduce((chain, { key, next, previous }) => chain.then(() => backend!.write(key, next, previous)), Promise.resolve());
    saving.catch((error) => {
      console.error("[appStore] فشل الحفظ", error);
      onError?.(error);
    });
    queueMicrotask(() => entries.forEach(({ key }) => listeners.forEach((listener) => listener(key))));
    return;
  }
  entries.forEach(({ key, value }) => writeLocal(key, value));
}

export function removeState(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* التخزين المحلي غير متاح */
  }
}

/** يستدعي listener كلما تغيّر أحد المفاتيح المشتركة (من هذا المستخدم أو من غيره). */
export function subscribeState(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
