import { useState } from "react";
import { ChevronLeft, Eye, EyeOff, LockKeyhole } from "lucide-react";
import BrandLogo, { Crescent } from "@/components/BrandLogo";
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
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#10233f] p-10 text-white lg:flex">
          <Crescent className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 opacity-[0.07]" />
          <BrandLogo tone="dark" />
          <div>
            <h1 className="text-4xl font-bold leading-[1.25]">سيارات مجمع الثمامة</h1>
            <p className="mt-3 text-lg font-semibold text-slate-300" dir="ltr">Al Thumama Complex Transport</p>
          </div>
          <p className="flex items-center gap-2 text-xs text-slate-400"><LockKeyhole className="h-4 w-4 text-[#e43846]" /> <span>دخول الموظفين</span><span className="text-slate-600">·</span><span dir="ltr">Staff only</span></p>
        </div>
        <div className="p-6 sm:p-10">
          <div className="mb-6 lg:hidden"><BrandLogo /></div>
          <h2 className="text-2xl font-bold text-slate-900">تسجيل الدخول <span className="text-base font-semibold text-slate-400" dir="ltr">Sign in</span></h2>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <label className="block">
              <span className="mb-1.5 flex justify-between text-xs font-bold text-slate-600"><span>اسم المستخدم</span><span dir="ltr" className="text-slate-400">Username</span></span>
              <input dir="ltr" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]" />
            </label>
            <label className="block">
              <span className="mb-1.5 flex justify-between text-xs font-bold text-slate-600"><span>كلمة المرور</span><span dir="ltr" className="text-slate-400">Password</span></span>
              <div className="relative">
                <input dir="ltr" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 pr-11 text-sm outline-none focus:border-[#e6a1aa]" />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-center text-xs font-bold text-red-700">{error}</p>}
            <button disabled={busy || !username || !password} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white shadow-lg shadow-[#a61d2d]/20 hover:bg-[#8b1725] disabled:opacity-60">
              {busy ? "جارٍ التحقق..." : <>دخول <span className="font-semibold opacity-70" dir="ltr">Sign in</span> <ChevronLeft className="h-4 w-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
