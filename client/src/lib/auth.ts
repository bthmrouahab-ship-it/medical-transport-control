import { deleteApp, initializeApp } from "firebase/app";
import {
  EmailAuthProvider,
  createUserWithEmailAndPassword,
  inMemoryPersistence,
  initializeAuth,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import {
  BOOTSTRAP_ADMIN_PASSWORD,
  BOOTSTRAP_ADMIN_USERNAME,
  internalEmail,
  normalizeUsername,
  validatePassword,
  validateUsername,
  type UserProfile,
  type UserRole,
} from "@shared/users";
import { auth, connectAuthToEmulator, firebaseConfig, firestore } from "./firebase";

const INVALID_LOGIN = "اسم المستخدم أو كلمة المرور غير صحيحة";

export class AuthError extends Error {}

type UsernameRecord = { uid: string; email: string };

const userRef = (uid: string) => doc(firestore, "users", uid);
const usernameRef = (username: string) => doc(firestore, "usernames", username);
const setupRef = doc(firestore, "meta", "setup");

function randomSuffix() {
  const buffer = new Uint32Array(2);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (value) => value.toString(36)).join("");
}

function describeFirebaseError(error: unknown) {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "auth/too-many-requests") return "تم إيقاف المحاولات مؤقتًا بسبب كثرة المحاولات الخاطئة. حاول لاحقًا.";
  if (code === "auth/network-request-failed" || code === "unavailable") return "تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.";
  if (code === "auth/operation-not-allowed") return "تسجيل الدخول بكلمة المرور غير مفعّل في إعدادات Firebase.";
  if (code === "auth/weak-password") return "كلمة المرور ضعيفة.";
  if (code === "auth/requires-recent-login") return "انتهت صلاحية الجلسة، سجّل الدخول مرة أخرى.";
  if (code === "permission-denied") return "ليست لديك صلاحية لتنفيذ هذا الإجراء.";
  return null;
}

export function authErrorMessage(error: unknown, fallback = "حدث خطأ غير متوقع. حاول مرة أخرى.") {
  if (error instanceof AuthError) return error.message;
  return describeFirebaseError(error) ?? fallback;
}

/** إنشاء حساب المدير الأول (مرة واحدة فقط، وتحميه قواعد Firestore). */
async function bootstrapAdmin(password: string) {
  const email = internalEmail(BOOTSTRAP_ADMIN_USERNAME, randomSuffix());
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;
  const now = new Date().toISOString();
  const batch = writeBatch(firestore);
  batch.set(userRef(uid), {
    username: BOOTSTRAP_ADMIN_USERNAME,
    displayName: "مدير النظام",
    role: "admin",
    active: true,
    mustChangePassword: true,
    createdAt: now,
    createdBy: "setup",
  });
  batch.set(usernameRef(BOOTSTRAP_ADMIN_USERNAME), { uid, email });
  batch.set(setupRef, { adminUid: uid, at: now });
  try {
    await batch.commit();
  } catch (error) {
    await credential.user.delete().catch(() => signOut(auth));
    throw error;
  }
}

let loginsInProgress = 0;

/** أثناء تسجيل الدخول قد يُنشأ الحساب قبل ملفه؛ لا نعتبر غياب الملف خطأ في هذه اللحظة. */
export function isLoginInProgress() {
  return loginsInProgress > 0;
}

export async function login(rawUsername: string, password: string) {
  loginsInProgress += 1;
  try {
    await performLogin(rawUsername, password);
  } finally {
    loginsInProgress -= 1;
  }
}

async function performLogin(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername);
  if (!username || !password || validateUsername(username)) throw new AuthError(INVALID_LOGIN);
  const record = await getDoc(usernameRef(username));
  if (!record.exists()) {
    if (username === BOOTSTRAP_ADMIN_USERNAME && password === BOOTSTRAP_ADMIN_PASSWORD && !(await getDoc(setupRef)).exists()) {
      await bootstrapAdmin(password);
      return;
    }
    throw new AuthError(INVALID_LOGIN);
  }
  const { email } = record.data() as UsernameRecord;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email", "auth/user-disabled"].includes(code)) {
      throw new AuthError(INVALID_LOGIN);
    }
    throw error;
  }
  const profile = await getDoc(userRef(auth.currentUser!.uid)).catch(() => null);
  if (!profile?.exists() || profile.data().active !== true) {
    await signOut(auth);
    throw new AuthError("هذا الحساب موقوف. تواصل مع مدير النظام.");
  }
}

export function logout() {
  return signOut(auth);
}

/** يتابع ملف المستخدم الحالي؛ أي تغيير من المدير (إيقاف/تغيير دور) يظهر فورًا. */
export function watchProfile(uid: string, onChange: (profile: UserProfile | null) => void, onError: (error: unknown) => void) {
  return onSnapshot(
    userRef(uid),
    (snap) => onChange(snap.exists() ? ({ uid, ...snap.data() } as UserProfile) : null),
    onError,
  );
}

export async function changeOwnPassword(currentPassword: string, nextPassword: string) {
  const user = auth.currentUser;
  if (!user?.email) throw new AuthError("انتهت الجلسة، سجّل الدخول مرة أخرى.");
  const passwordError = validatePassword(nextPassword);
  if (passwordError) throw new AuthError(passwordError);
  if (currentPassword === nextPassword) throw new AuthError("اختر كلمة مرور مختلفة عن الحالية.");
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  } catch (error) {
    const code = (error as { code?: string })?.code ?? "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password") throw new AuthError("كلمة المرور الحالية غير صحيحة.");
    throw error;
  }
  await updatePassword(user, nextPassword);
  await updateDoc(userRef(user.uid), { mustChangePassword: false });
}

// ————— عمليات المدير —————

export function watchUsers(onChange: (users: UserProfile[]) => void, onError: (error: unknown) => void) {
  return onSnapshot(
    collection(firestore, "users"),
    (snap) => onChange(snap.docs
      .map((item) => ({ uid: item.id, ...item.data() }) as UserProfile)
      .sort((a, b) => a.username.localeCompare(b.username))),
    onError,
  );
}

/**
 * ينشئ حساب دخول جديدًا دون تسجيل خروج المدير، عبر نسخة ثانوية مؤقتة من Firebase.
 */
async function createAuthAccount(username: string, password: string) {
  const secondary = initializeApp(firebaseConfig, `admin-create-${Date.now()}`);
  try {
    // ذاكرة مؤقتة فقط حتى لا تُحفظ جلسة الحساب الجديد في المتصفح
    const secondaryAuth = initializeAuth(secondary, { persistence: inMemoryPersistence });
    connectAuthToEmulator(secondaryAuth);
    const email = internalEmail(username, randomSuffix());
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    await signOut(secondaryAuth);
    return { uid: credential.user.uid, email };
  } finally {
    await deleteApp(secondary).catch(() => {});
  }
}

export async function createUser(input: { username: string; displayName: string; role: UserRole; password: string }, createdBy: string) {
  const username = normalizeUsername(input.username);
  const usernameError = validateUsername(username);
  if (usernameError) throw new AuthError(usernameError);
  const displayName = input.displayName.trim();
  if (displayName.length < 2 || displayName.length > 60) throw new AuthError("الاسم الظاهر يجب أن يكون من 2 إلى 60 حرفًا");
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AuthError(passwordError);
  if ((await getDoc(usernameRef(username))).exists()) throw new AuthError("اسم المستخدم مستخدم مسبقًا");

  const account = await createAuthAccount(username, input.password);
  const batch = writeBatch(firestore);
  batch.set(userRef(account.uid), {
    username,
    displayName,
    role: input.role,
    active: true,
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
    createdBy,
  });
  batch.set(usernameRef(username), account);
  await batch.commit();
}

export async function updateUser(uid: string, changes: Partial<Pick<UserProfile, "displayName" | "role" | "active">>) {
  if (changes.displayName !== undefined) {
    const displayName = changes.displayName.trim();
    if (displayName.length < 2 || displayName.length > 60) throw new AuthError("الاسم الظاهر يجب أن يكون من 2 إلى 60 حرفًا");
    changes = { ...changes, displayName };
  }
  await updateDoc(userRef(uid), changes);
}

/**
 * لا يمكن تغيير كلمة مرور مستخدم آخر من المتصفح مباشرة، لذلك يُنشأ حساب دخول جديد
 * لنفس اسم المستخدم بكلمة مؤقتة، ويُلغى الحساب القديم (يفقد كل الصلاحيات فورًا).
 */
export async function resetUserPassword(user: UserProfile, temporaryPassword: string) {
  const passwordError = validatePassword(temporaryPassword);
  if (passwordError) throw new AuthError(passwordError);
  const account = await createAuthAccount(user.username, temporaryPassword);
  const { uid: oldUid, ...profile } = user;
  const batch = writeBatch(firestore);
  batch.set(userRef(account.uid), { ...profile, mustChangePassword: true });
  batch.set(usernameRef(user.username), account);
  batch.delete(userRef(oldUid));
  await batch.commit();
}
