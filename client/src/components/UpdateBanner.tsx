import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AUTO_RELOAD_SECONDS, canReloadNow, useNewVersion } from "@/lib/appVersion";
import { btn } from "./ui-kit";

/** نُشرت نسخة جديدة من الموقع: شريط أسفل الصفحة مع «تحديث الآن»، وإعادة الصفحة وحدها بعد عدّ تنازلي حين يكون ذلك آمنًا */
export default function UpdateBanner() {
  const next = useNewVersion();
  const [left, setLeft] = useState(AUTO_RELOAD_SECONDS);
  useEffect(() => {
    if (!next) return;
    const timer = window.setInterval(() => {
      setLeft((current) => {
        if (current > 1) return current - 1;
        // لا تُعاد والمستخدم يكتب أو في نافذة مفتوحة: تنتظر حتى ينتهي
        if (canReloadNow()) window.location.reload();
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [next]);
  if (!next) return null;
  return (
    <div role="status" data-testid="update-banner" className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:p-4">
      <div className="flex w-full max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-navy-800 px-4 py-3 text-sm text-white shadow-raised">
        <RefreshCw className="h-5 w-5 shrink-0 text-emerald-300" />
        <p className="min-w-0 flex-1 leading-6">
          <span className="font-semibold">تم تحديث الموقع</span>
          <span className="text-white/75"> · {left > 0 ? `تُحدَّث الصفحة بعد ${left} ثانية` : "تُحدَّث الصفحة عند انتهائك مما تكتبه"}</span>
          <span className="block text-xs text-white/60" dir="ltr">A new version is available</span>
        </p>
        <button type="button" onClick={() => window.location.reload()} className={btn("primary", "sm")}>
          <RefreshCw className="h-4 w-4" /> تحديث الآن
        </button>
      </div>
    </div>
  );
}
