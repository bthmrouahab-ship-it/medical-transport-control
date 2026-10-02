import { createRoot } from "react-dom/client";
import { installToastLinks } from "./lib/notify";
import App from "./App";
import { installNeedsChrome } from "./lib/browser";
import "./index.css";

// ملف التثبيت (manifest) لكل المتصفحات ما عدا متصفحات أندرويد غير Chrome: تثبيتها يحظره Google Play Protect،
// فيُقترح فيها فتح الموقع في Chrome (InstallPrompt)
if (!installNeedsChrome()) {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "/manifest.json";
  document.head.appendChild(manifest);
}

// تسجيل الدخول وتحميل البيانات المشتركة يتمان داخل بوابة الدخول (RolePortal).
createRoot(document.getElementById("root")!).render(<App />);
// الضغط على إشعار له مكان ينقل إليه
installToastLinks();

// عامل الخدمة يجعل الموقع قابلًا للتثبيت على الشاشة الرئيسية للهاتف (في النسخة المنشورة فقط).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
