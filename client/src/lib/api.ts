/** الاتصال بخادم PHP على Hostinger (api/index.php). */

const API_URL = `${import.meta.env.VITE_API_BASE ?? "/api"}/index.php`;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

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
    /* رد غير JSON (مثل صفحة خطأ من الاستضافة) */
  }
  if (!response.ok) {
    const error = new ApiError(data.error ?? "حدث خطأ في الخادم. حاول مرة أخرى.", response.status, data.code ?? "error");
    if (response.status === 401 && route !== "login") sessionEndListeners.forEach((listener) => listener(error.message));
    throw error;
  }
  return data as T;
}
