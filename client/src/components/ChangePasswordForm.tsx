import { useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { authErrorMessage, changeOwnPassword } from "@/lib/auth";

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

  const input = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]";
  return (
    <form onSubmit={submit} className="space-y-4" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fff1f2] text-[#a61d2d]"><KeyRound className="h-5 w-5" /></div>
        <div>
          <h2 className="text-xl font-bold">تغيير كلمة المرور</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            8 أحرف على الأقل، أحرف وأرقام
          </p>
        </div>
      </div>
      <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">كلمة المرور الحالية</span><input dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} className={input} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">كلمة المرور الجديدة</span><input dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} className={input} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-600">تأكيد كلمة المرور الجديدة</span><input dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} className={input} /></label>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button disabled={busy || !current || !next || !confirm} className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725] disabled:opacity-60">{busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">{required ? "تسجيل الخروج" : "إلغاء"}</button>}
      </div>
    </form>
  );
}
