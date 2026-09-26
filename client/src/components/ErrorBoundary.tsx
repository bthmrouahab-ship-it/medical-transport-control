import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[app]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-page p-4" dir="rtl">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-card ring-1 ring-slate-200/80">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600"><AlertTriangle className="h-7 w-7" /></span>
          <p className="mt-4 font-semibold text-ink">حدث خطأ غير متوقع في الصفحة.</p>
          <button onClick={() => window.location.reload()} className="mx-auto mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
            <RotateCcw className="h-4 w-4" /> إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
