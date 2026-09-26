import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// تسجيل الدخول وتحميل البيانات المشتركة يتمان داخل بوابة الدخول (RolePortal).
createRoot(document.getElementById("root")!).render(<App />);
