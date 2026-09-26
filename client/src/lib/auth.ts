import { normalizeUsername, validatePassword, validateUsername, type UserProfile, type UserRole } from "@shared/users";
import { ApiError, api, onSessionEnded } from "./api";

const INVALID_LOGIN = "اسم المستخدم أو كلمة المرور غير صحيحة";

export class AuthError extends Error {}

export function authErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع. حاول مرة أخرى.") {
  if (error instanceof AuthError || error instanceof ApiError) return error.message;
  return fallback;
}

// ————— الجلسة —————

type SessionListener = (profile: UserProfile | null, message?: string) => void;

/** undefined = لم يُعرف بعد */
let currentProfile: UserProfile | null | undefined;
const listeners = new Set<SessionListener>();

function setProfile(profile: UserProfile | null, message?: string) {
  currentProfile = profile;
  listeners.forEach((listener) => listener(profile, message));
}

onSessionEnded((message) => {
  if (currentProfile) setProfile(null, message);
});

async function refreshSession() {
  const { user } = await api<{ user: UserProfile | null }>("session");
  // تحديث الملف (تغيير الاسم أو الدور أو الإيقاف من المدير) يصل لكل الصفحات
  if (JSON.stringify(user) !== JSON.stringify(currentProfile)) setProfile(user);
}

/** كل كم ثانية يُتحقق من الحساب: إيقافه أو تغيير دوره من المدير يظهر خلال هذه المدة. */
const SESSION_CHECK_MS = 30000;

/**
 * يتابع المستخدم الحالي: null عند عدم تسجيل الدخول أو انتهاء الجلسة (مع سبب إن وُجد).
 * onError: تعذر الوصول إلى الخادم عند فتح الصفحة.
 */
export function watchSession(listener: SessionListener, onError: (error: unknown) => void) {
  listeners.add(listener);
  if (currentProfile !== undefined) listener(currentProfile);
  else refreshSession().catch(onError);
  const timer = window.setInterval(() => {
    if (currentProfile) refreshSession().catch(() => {});
  }, SESSION_CHECK_MS);
  return () => {
    listeners.delete(listener);
    window.clearInterval(timer);
  };
}

export async function login(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername);
  if (!username || !password || validateUsername(username)) throw new AuthError(INVALID_LOGIN);
  const { user } = await api<{ user: UserProfile }>("login", { username, password });
  setProfile(user);
}

export async function logout() {
  try {
    await api("logout", {});
  } finally {
    if (currentProfile !== null) setProfile(null);
  }
}

export async function changeOwnPassword(currentPassword: string, nextPassword: string) {
  const passwordError = validatePassword(nextPassword);
  if (passwordError) throw new AuthError(passwordError);
  if (currentPassword === nextPassword) throw new AuthError("اختر كلمة مرور مختلفة عن الحالية.");
  const { user } = await api<{ user: UserProfile }>("change-password", { current: currentPassword, next: nextPassword });
  setProfile(user);
}

// ————— عمليات المدير —————

const USERS_REFRESH_MS = 15000;
const usersListeners = new Set<() => void>();

/** قائمة المستخدمين للمدير، تتحدث بعد كل تعديل وكل فترة. */
export function watchUsers(onChange: (users: UserProfile[]) => void, onError: (error: unknown) => void) {
  let stopped = false;
  const load = () => api<{ users: UserProfile[] }>("users")
    .then(({ users }) => { if (!stopped) onChange(users); })
    .catch((error) => { if (!stopped) onError(error); });
  load();
  usersListeners.add(load);
  const timer = window.setInterval(load, USERS_REFRESH_MS);
  return () => {
    stopped = true;
    usersListeners.delete(load);
    window.clearInterval(timer);
  };
}

const reloadUsers = () => usersListeners.forEach((load) => load());

export async function createUser(input: { username: string; displayName: string; role: UserRole; password: string; vehiclePlate?: string }, _createdBy: string) {
  const username = normalizeUsername(input.username);
  const usernameError = validateUsername(username);
  if (usernameError) throw new AuthError(usernameError);
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 60) throw new AuthError("الاسم الظاهر يجب أن يكون من 2 إلى 60 حرفًا");
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AuthError(passwordError);
  if (input.role === "driver" && !input.vehiclePlate) throw new AuthError("اختر السيارة المرتبطة بالسائق");
  await api("users.create", { ...input, username, displayName });
  reloadUsers();
}

export async function updateUser(uid: string, changes: Partial<Pick<UserProfile, "displayName" | "role" | "active" | "vehiclePlate">>) {
  if (changes.displayName !== undefined) {
    const displayName = changes.displayName.trim();
    if (displayName.length < 2 || displayName.length > 60) throw new AuthError("الاسم الظاهر يجب أن يكون من 2 إلى 60 حرفًا");
    changes = { ...changes, displayName };
  }
  await api("users.update", { uid, changes });
  reloadUsers();
}

/** كلمة مرور مؤقتة جديدة: تتوقف القديمة فورًا ويخرج المستخدم من كل أجهزته. */
export async function resetUserPassword(user: UserProfile, temporaryPassword: string) {
  const passwordError = validatePassword(temporaryPassword);
  if (passwordError) throw new AuthError(passwordError);
  await api("users.reset-password", { uid: user.uid, password: temporaryPassword });
  reloadUsers();
}
