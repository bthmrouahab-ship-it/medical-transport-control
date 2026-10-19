/** الاتصال بخادم PHP على Hostinger (api/index.php). */

const API_URL = `${import.meta.env.VITE_API_BASE ?? "/api"}/index.php`;

/** رابط طلب GET يُفتح مباشرة في المتصفح (مثل ملف): الكوكي نفسها، بلا ترويسة */
export const apiUrl = (route: string, query: Record<string, string> = {}) => `${API_URL}?${new URLSearchParams({ r: route, ...query })}`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

/** الخادم لا يستجيب (انقطاع الاتصال، أو خطأ مؤقت في الاستضافة أو قاعدة البيانات)، لا رفض للطلب نفسه */
export const serverUnavailable = (error: unknown) => error instanceof ApiError && (error.status === 0 || error.status >= 500);
/**
 * صفحة «Checking your browser…» من حماية استضافة Hostinger (hcdn) بدل رد الخادم: تظهر حين ترى الاستضافة طلبات كثيرة،
 * وتُجتاز بفتح الصفحة نفسها في المتصفح (إعادة تحميلها)، لا بطلبات fetch.
 */
export const HOSTING_CHECK = "hosting_check";
export const hostingCheck = (error: unknown) => error instanceof ApiError && error.code === HOSTING_CHECK;
export const SERVER_DOWN_MESSAGE = "الخادم لا يستجيب الآن (العطل في الخادم، لا في اسم المستخدم أو كلمة المرور). انتظر دقيقة ثم حاول مرة أخرى.";

type SessionEndListener = (message: string) => void;
const sessionEndListeners = new Set<SessionEndListener>();

/** يُستدعى عندما يرفض الخادم الجلسة (انتهت، أو أُوقف الحساب، أو غُيّرت كلمة المرور من المدير). */
export function onSessionEnded(listener: SessionEndListener) {
  sessionEndListeners.add(listener);
  return () => {
    sessionEndListeners.delete(listener);
  };
}

export async function api<T>(route: string, body?: unknown, query: Record<string, string | number> = {}): Promise<T> {
  const params = new URLSearchParams({ r: route, ...Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])) });
  let response: Response;
  try {
    response = await fetch(`${API_URL}?${params}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      // ترويسة لا يستطيع موقع آخر إرسالها: تحمي الطلبات من CSRF
      headers: body === undefined ? { "X-Requested-With": "fetch" } : { "X-Requested-With": "fetch", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.", 0, "network");
  }
  let data: { error?: string; code?: string } & Record<string, unknown> = {};
  try {
    data = await response.json();
  } catch {
    // رد غير JSON: صفحة فحص المتصفح من حماية الاستضافة (ولو برمز 200) أو صفحة خطأ منها
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      throw new ApiError("حماية الاستضافة تفحص الاتصال الآن. يعيد التطبيق المحاولة وحده.", response.ok ? 503 : response.status, HOSTING_CHECK);
    }
  }
  if (!response.ok) {
    const error = new ApiError(data.error ?? "حدث خطأ في الخادم. حاول مرة أخرى.", response.status, data.code ?? "error");
    if (response.status === 401 && route !== "login") sessionEndListeners.forEach((listener) => listener(error.message));
    throw error;
  }
  return data as T;
}
