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
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4" dir="rtl">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-[#a61d2d]" />
          <p className="mt-4 font-bold text-slate-700">حدث خطأ غير متوقع في الصفحة.</p>
          <button onClick={() => window.location.reload()} className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-[#a61d2d] px-4 py-2 text-sm font-bold text-white">
            <RotateCcw className="h-4 w-4" /> إعادة تحميل الصفحة
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
