import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import InstallPrompt from "./components/InstallPrompt";
import RolePortal from "./pages/RolePortal";

const toasterStyle = {
  "--normal-bg": "#ffffff",
  "--normal-text": "#0f1f35",
  "--normal-border": "#e2e8f0",
  "--border-radius": "14px",
  fontFamily: "var(--font-sans)",
} as CSSProperties;

// صفحة واحدة: كل الروابط تفتح بوابة الدخول، ومنها صفحة الدور المسجل في حساب المستخدم.
export default function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-center" richColors theme="light" className="toaster group" style={toasterStyle} />
      <RolePortal />
      <InstallPrompt />
    </ErrorBoundary>
  );
}
