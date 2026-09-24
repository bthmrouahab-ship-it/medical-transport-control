export type UserRole = "admin" | "clinic" | "buildingSupervisor" | "fleetSupervisor" | "driver";

export type UserProfile = {
  uid: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  /** يُطلب من المستخدم تغيير كلمة المرور المؤقتة عند أول دخول. */
  mustChangePassword: boolean;
  /** للسائق فقط: رقم السيارة التي يرسل موقعها */
  vehiclePlate?: string;
  createdAt: string;
  createdBy: string;
};

export const USER_ROLES: UserRole[] = ["admin", "clinic", "buildingSupervisor", "fleetSupervisor", "driver"];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "مدير النظام",
  clinic: "العيادة",
  buildingSupervisor: "مشرف المبنى",
  fleetSupervisor: "مشرف السيارات",
  driver: "سائق",
};

/**
 * حساب المدير الأول يُنشأ تلقائيًا عند أول دخول بهذه البيانات فقط، ثم يُطلب تغيير كلمة المرور فورًا.
 * بعد إنشائه (مستند meta/setup) لا تعود هذه الكلمة صالحة لإنشاء أي حساب.
 */
export const BOOTSTRAP_ADMIN_USERNAME = "admin";
export const BOOTSTRAP_ADMIN_PASSWORD = "Admin123";

/** Firebase Auth يحتاج بريدًا؛ نولّد بريدًا داخليًا لا يُرسل إليه شيء. */
export const INTERNAL_EMAIL_DOMAIN = "althumama-complex-car.firebaseapp.com";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 32) return "اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا";
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(username)) {
    return "اسم المستخدم يقبل الأحرف الإنجليزية والأرقام والنقطة والشرطة فقط";
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < 8) return "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
  if (value.length > 128) return "كلمة المرور طويلة جدًا";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "كلمة المرور يجب أن تحتوي على أحرف وأرقام";
  return null;
}

/** بريد داخلي فريد لكل حساب؛ اللاحقة تسمح بإعادة تعيين كلمة المرور بحساب جديد لنفس الاسم. */
export function internalEmail(username: string, suffix: string) {
  return `${normalizeUsername(username)}.${suffix}@${INTERNAL_EMAIL_DOMAIN}`;
}

function secureRandom() {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  return buffer[0] / 2 ** 32;
}

export function generateTemporaryPassword(random: () => number = secureRandom) {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const pick = (source: string) => source[Math.floor(random() * source.length)];
  const chars = [pick(letters), pick(digits)];
  while (chars.length < 10) chars.push(pick(letters + digits));
  return chars.join("");
}
