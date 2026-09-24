import { initializeApp } from "firebase/app";
import { browserSessionPersistence, connectAuthEmulator, getAuth, setPersistence, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

// إعدادات تطبيق الويب في Firebase (مشروع althumama-complex-car).
// هذه القيم ليست سرية بطبيعتها؛ الحماية الفعلية تتم عبر تسجيل الدخول وقواعد Firestore (firestore.rules).
// يمكن تجاوزها بمتغيرات VITE_FIREBASE_* في ملف .env عند الحاجة.
const env = import.meta.env;
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDpCSS7ZBJ12iF6-MBrJoipzScbLFxRwHg",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "althumama-complex-car.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "althumama-complex-car",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "althumama-complex-car.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "722569244744",
  appId: env.VITE_FIREBASE_APP_ID || "1:722569244744:web:4bd80ad44b819f7e8de87d",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firestore = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);

// للتجربة المحلية فقط: `firebase emulators:start` ثم VITE_USE_FIREBASE_EMULATORS=true
const usingEmulators = env.DEV && env.VITE_USE_FIREBASE_EMULATORS === "true";

export function connectAuthToEmulator(target: Auth) {
  if (usingEmulators) connectAuthEmulator(target, "http://127.0.0.1:9099", { disableWarnings: true });
}

connectAuthToEmulator(auth);
if (usingEmulators) connectFirestoreEmulator(firestore, "127.0.0.1", 8080);

// تنتهي الجلسة بإغلاق المتصفح حتى لا يبقى الحساب مفتوحًا على الأجهزة المشتركة.
export const authReady = setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.error("[Firebase] تعذر ضبط مدة الجلسة", error);
});
