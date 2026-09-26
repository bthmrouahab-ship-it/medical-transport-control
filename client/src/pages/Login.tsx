import { useState } from "react";
import { CalendarClock, ChevronLeft, Eye, EyeOff, LockKeyhole, MapPinned, Truck } from "lucide-react";
import BrandLogo, { Crescent } from "@/components/BrandLogo";
import { btn, cx, inputClass } from "@/components/ui-kit";
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

  const label = "mb-1.5 flex justify-between text-[13px] font-medium text-slate-700";
  return (
    <div className="flex min-h-screen items-center justify-center bg-page p-4" dir="rtl">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-[0_24px_70px_-20px_rgba(15,39,66,.35)] ring-1 ring-slate-200/80 lg:min-h-[540px] lg:grid-cols-[.9fr_1.1fr]">
        <div className="relative hidden flex-col justify-between gap-10 overflow-hidden bg-navy-900 p-10 text-white lg:flex">
          <div className="absolute inset-x-0 top-0 h-1 bg-brand-600" />
          <Crescent className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 opacity-[0.07]" />
          <BrandLogo tone="dark" />
          <div>
            <h1 className="text-3xl font-bold leading-snug">سيارات مجمع الثمامة</h1>
            <p className="mt-3 text-lg font-medium text-slate-300" dir="ltr">Al Thumama Complex Transport</p>
            <ul className="mt-8 space-y-3 text-sm text-slate-300">
              <li className="flex items-center gap-3"><CalendarClock className="h-4 w-4 text-slate-400" /> مواعيد المرضى وطلبات السيارات</li>
              <li className="flex items-center gap-3"><Truck className="h-4 w-4 text-slate-400" /> توزيع السيارات وجمع الرحلات</li>
              <li className="flex items-center gap-3"><MapPinned className="h-4 w-4 text-slate-400" /> متابعة السيارات على الخريطة</li>
            </ul>
          </div>
          <p className="flex items-center gap-2 text-xs text-slate-400"><LockKeyhole className="h-4 w-4 text-brand-200" /> <span>دخول الموظفين</span><span className="text-slate-600">·</span><span dir="ltr">Staff only</span></p>
        </div>
        <div className="flex flex-col justify-center p-6 sm:p-10">
          <div className="mb-8 lg:hidden"><BrandLogo /></div>
          <h2 className="text-2xl font-bold text-ink">تسجيل الدخول <span className="text-base font-medium text-slate-400" dir="ltr">Sign in</span></h2>
          <p className="mt-1 text-sm text-slate-500">ادخل بالحساب الذي أنشأه لك مدير النظام</p>
          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <label className="block">
              <span className={label}><span>اسم المستخدم</span><span dir="ltr" className="text-slate-400">Username</span></span>
              <input dir="ltr" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required className={cx(inputClass, "h-12")} />
            </label>
            <label className="block">
              <span className={label}><span>كلمة المرور</span><span dir="ltr" className="text-slate-400">Password</span></span>
              <div className="relative">
                <input dir="ltr" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className={cx(inputClass, "h-12 pr-11")} />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">{error}</p>}
            <button disabled={busy || !username || !password} className={cx(btn("primary", "lg"), "w-full")}>
              {busy ? "جارٍ التحقق..." : <>دخول <span className="font-medium opacity-70" dir="ltr">Sign in</span> <ChevronLeft className="h-4 w-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
