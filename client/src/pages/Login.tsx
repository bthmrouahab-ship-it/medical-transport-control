import { useState } from "react";
import { ChevronLeft, Eye, EyeOff, LockKeyhole, Truck } from "lucide-react";
import { authErrorMessage, login } from "@/lib/auth";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await login(username, password);
    } catch (loginError) {
      setError(authErrorMessage(loginError, "تعذر تسجيل الدخول. حاول مرة أخرى."));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] p-4" dir="rtl">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(16,35,63,.12)] lg:grid-cols-[.9fr_1.1fr]">
        <div className="hidden bg-[#10233f] p-10 text-white lg:block">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e43846] text-[#10233f]"><Truck className="h-6 w-6" /></div>
            <div className="flex items-center gap-2">
              <img src="/manus-storage/qrc-logo_b418c07b.png" alt="الهلال الأحمر القطري" className="h-10 w-28 rounded-lg bg-white p-1 object-contain" />
              <div><p className="font-bold">الهلال الأحمر القطري</p><p className="text-xs text-slate-300">سيارات مجمع الثمامة</p></div>
            </div>
          </div>
          <div className="mt-24">
            <p className="text-sm font-bold text-[#ff9ba3]">دخول الموظفين المصرّح لهم</p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.25]">الموعد أولًا،<br />والسيارة في وقتها.</h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">يفتح النظام الصفحة المناسبة لدورك تلقائيًا بعد تسجيل الدخول.</p>
          </div>
          <div className="mt-24 flex items-center gap-2 text-xs text-slate-400"><LockKeyhole className="h-4 w-4 text-[#e43846]" /> الحسابات يُنشئها مدير النظام فقط</div>
        </div>
        <div className="p-6 sm:p-10">
          <div className="lg:hidden"><img src="/manus-storage/qrc-logo_b418c07b.png" alt="الهلال الأحمر القطري" className="h-14 w-40 object-contain" /></div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">سيارات مجمع الثمامة</h1>
          <p className="mt-1 text-sm text-slate-500">سجّل الدخول باسم المستخدم وكلمة المرور.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">اسم المستخدم</span>
              <input dir="ltr" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-slate-600">كلمة المرور</span>
              <div className="relative">
                <input dir="ltr" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pl-11 text-sm outline-none focus:border-[#e6a1aa]" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</p>}
            <button disabled={busy || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white shadow-lg shadow-[#a61d2d]/20 hover:bg-[#8b1725] disabled:opacity-60">
              {busy ? "جارٍ التحقق..." : <>دخول <ChevronLeft className="h-4 w-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
