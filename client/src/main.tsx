import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// تسجيل الدخول وتحميل البيانات المشتركة يتمان داخل بوابة الدخول (RolePortal).
createRoot(document.getElementById("root")!).render(<App />);

// عامل الخدمة يجعل الموقع قابلًا للتثبيت على الشاشة الرئيسية للهاتف (في النسخة المنشورة فقط).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
