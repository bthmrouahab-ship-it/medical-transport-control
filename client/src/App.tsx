import type { CSSProperties } from "react";
import { Toaster } from "sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import RolePortal from "./pages/RolePortal";

const toasterStyle = {
  "--normal-bg": "var(--popover)",
  "--normal-text": "var(--popover-foreground)",
  "--normal-border": "var(--border)",
} as CSSProperties;

// صفحة واحدة: كل الروابط تفتح بوابة الدخول، ومنها صفحة الدور المسجل في حساب المستخدم.
export default function App() {
  return (
    <ErrorBoundary>
      <Toaster position="top-center" richColors theme="light" className="toaster group" style={toasterStyle} />
      <RolePortal />
    </ErrorBoundary>
  );
}
