import { useId, useState, type ReactNode } from "react";
import { ChevronLeft, Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";
import BrandLogo, { Crescent } from "@/components/BrandLogo";
import { btn, cx } from "@/components/ui-kit";
import { authErrorMessage, login } from "@/lib/auth";

/**
 * حقل مملوء بلا إطار بعنوان عائم: العنوان داخل الحقل، ويصعد صغيرًا إلى أعلاه عند الكتابة أو التركيز.
 * placeholder فارغ (" ") ليعرف CSS هل في الحقل نص (:placeholder-shown).
 */
function FloatingField({ label, trailing, className, ...input }: {
  label: ReactNode;
  trailing?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="relative">
      <input
        id={id}
        placeholder=" "
        {...input}
        className={cx(
          "peer h-14 w-full rounded-2xl border border-transparent bg-slate-100 px-4 pb-1.5 pt-5 text-[15px] text-ink outline-none transition",
          "hover:bg-slate-200/60 focus:border-brand-600/40 focus:bg-white focus:ring-4 focus:ring-brand-600/10",
          className,
        )}
      />
      <label
        htmlFor={id}
        className={cx(
          "pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-sm text-slate-500 transition-all duration-200",
          "peer-focus:top-3.5 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-brand-700",
          "peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-medium",
        )}
      >
        {label}
      </label>
      {trailing}
    </div>
  );
}

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

  const bilingual = (ar: string, en: string) => <>{ar} <span dir="ltr" className="font-normal opacity-70">· {en}</span></>;
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page p-4 sm:p-8" dir="rtl">
      {/* خلفية هادئة: هالتان خفيفتان بلوني الهلال والكحلي، والهلال علامة مائية */}
      <div className="pointer-events-none absolute -top-40 end-[-10rem] h-[28rem] w-[28rem] rounded-full bg-brand-600/[0.07] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 start-[-8rem] h-[32rem] w-[32rem] rounded-full bg-navy-700/[0.08] blur-3xl" />
      <Crescent className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 opacity-[0.04]" />

      <main className="animate-rise relative w-full max-w-[440px] overflow-hidden rounded-[28px] bg-white shadow-raised ring-1 ring-slate-900/[0.04]">
        <div className="h-1 bg-gradient-to-l from-brand-600 via-brand-500 to-brand-700" />
        <div className="px-7 pb-8 pt-9 sm:px-10 sm:pb-10 sm:pt-11">
          <div className="flex items-center gap-3">
            <BrandLogo compact />
            <div className="min-w-0 leading-tight">
              <p className="truncate font-semibold text-ink">سيارات مجمع الثمامة</p>
              <p className="truncate text-xs text-slate-500" dir="ltr">Al Thumama Complex Transport</p>
            </div>
          </div>

          <h1 className="mt-9 text-[26px] font-bold tracking-tight text-ink">تسجيل الدخول</h1>
          <p className="mt-1.5 text-sm leading-6 text-slate-500">ادخل بالحساب الذي أنشأه لك مدير النظام <span dir="ltr" className="text-slate-400">· Sign in with your staff account</span></p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <FloatingField
              label={bilingual("اسم المستخدم", "Username")}
              dir="ltr"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <FloatingField
              label={bilingual("كلمة المرور", "Password")}
              dir="ltr"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="pl-12"
              trailing={(
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  className="absolute left-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200/70 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              )}
            />
            {error && <p role="alert" className="animate-rise rounded-2xl bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">{error}</p>}
            <button disabled={busy || !username || !password} className={cx(btn("primary", "lg"), "!mt-7 h-14 w-full rounded-2xl text-base")}>
              {busy
                ? <><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ التحقق...</>
                : <>دخول <span className="font-medium opacity-75" dir="ltr">Sign in</span> <ChevronLeft className="h-5 w-5" /></>}
            </button>
          </form>

          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400">
            <LockKeyhole className="h-3.5 w-3.5" /> <span>دخول الموظفين فقط</span><span aria-hidden="true">·</span><span dir="ltr">Staff only</span>
          </p>
        </div>
      </main>
    </div>
  );
}
