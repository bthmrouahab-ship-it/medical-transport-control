import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { authErrorMessage, changeOwnPassword } from "@/lib/auth";
import { btn, cx, inputClass, labelClass } from "./ui-kit";

export default function ChangePasswordForm({ required, onDone, onCancel }: {
  required?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (next !== confirm) {
      setError("تأكيد كلمة المرور غير مطابق");
      return;
    }
    setBusy(true);
    try {
      await changeOwnPassword(current, next);
      toast.success("تم تغيير كلمة المرور");
      onDone?.();
    } catch (changeError) {
      setError(authErrorMessage(changeError, "تعذر تغيير كلمة المرور"));
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, value: string, onChange: (value: string) => void, autoComplete: string) => (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input dir="ltr" type="password" autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass} />
    </label>
  );
  return (
    <form onSubmit={submit} className="space-y-4" dir="rtl">
      <div className="flex items-start gap-3 pb-1">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><KeyRound className="h-5 w-5" /></div>
        <div>
          <h2 className="text-xl font-semibold text-ink">تغيير كلمة المرور</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{required ? "يجب تغيير كلمة المرور المؤقتة قبل المتابعة. " : ""}8 أحرف على الأقل، أحرف وأرقام</p>
        </div>
      </div>
      {field("كلمة المرور الحالية", current, setCurrent, "current-password")}
      {field("كلمة المرور الجديدة", next, setNext, "new-password")}
      {field("تأكيد كلمة المرور الجديدة", confirm, setConfirm, "new-password")}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
      <div className="flex gap-3 pt-1">
        <button disabled={busy || !current || !next || !confirm} className={cx(btn("primary", "lg"), "flex-1")}>{busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}</button>
        {onCancel && <button type="button" onClick={onCancel} className={btn("secondary", "lg")}>{required ? "تسجيل الخروج" : "إلغاء"}</button>}
      </div>
    </form>
  );
}
