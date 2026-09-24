import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// إعدادات تطبيق الويب في Firebase (مشروع althumama-complex-car).
// هذه القيم ليست سرية بطبيعتها؛ الحماية الفعلية تتم عبر قواعد Firestore (firestore.rules).
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

/** تسجيل دخول مجهول حتى تسمح قواعد Firestore بالقراءة والكتابة. */
export async function connectFirebase() {
  const auth = getAuth(firebaseApp);
  if (!auth.currentUser) await signInAnonymously(auth);
  return firestore;
}
