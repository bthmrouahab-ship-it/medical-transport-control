import { useId, useState, type ReactNode } from "react";
import { CalendarClock, CarFront, ChevronLeft, Eye, EyeOff, LoaderCircle, LockKeyhole, MapPinned, UserRound } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import { btn, cx } from "@/components/ui-kit";
import { authErrorMessage, login } from "@/lib/auth";
import { SERVER_DOWN_MESSAGE, serverUnavailable } from "@/lib/api";

/**
 * حقل بعنوان عائم: العنوان داخل الحقل، ويصعد صغيرًا إلى أعلاه عند الكتابة أو التركيز.
 * على الهاتف مملوء بلا إطار، وعلى الشاشة الواسعة بإطار رفيع وأيقونة في طرفه (`icons`).
 * placeholder فارغ (" ") ليعرف CSS هل في الحقل نص (:placeholder-shown).
 */
function FloatingField({ label, icons, trailing, className, ...input }: {
  label: ReactNode;
  /** أيقونات في طرف الحقل على الشاشة الواسعة */
  icons?: ReactNode;
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
          "lg:h-[52px] lg:rounded-xl lg:border-slate-300 lg:bg-white lg:hover:border-slate-400 lg:hover:bg-white lg:focus:border-brand-600",
          className,
        )}
      />
      <label
        htmlFor={id}
        className={cx(
          "pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-sm text-slate-500 transition-all duration-200",
          "peer-focus:top-3.5 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:text-brand-700",
          "peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-medium",
          "lg:peer-focus:top-3 lg:peer-[:not(:placeholder-shown)]:top-3",
        )}
      >
        {label}
      </label>
      {icons && <span className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 items-center gap-2 text-slate-400 lg:flex">{icons}</span>}
      {trailing}
    </div>
  );
}

/** عنوان بالعربية ثم الإنجليزية بخط أخف، والفاصل خارج النص الإنجليزي حتى لا ينقلب مكانه. */
const bilingual = (ar: string, en: string) => (
  <>{ar}<span aria-hidden="true" className="mx-1.5 opacity-40">·</span><span dir="ltr" className="font-normal opacity-70">{en}</span></>
);

const FEATURES = [
  { icon: CarFront, ar: "طلب السيارة من المبنى ومتابعتها حتى الوجهة", en: "Request a car and follow it to the destination" },
  { icon: CalendarClock, ar: "توزيع السيارات وجمع الرحلات في الوقت المناسب", en: "Dispatch and group trips on time" },
  { icon: MapPinned, ar: "موقع السيارات مباشرة من تطبيق السائق", en: "Live vehicle location from the driver app" },
];

/**
 * شاشة الدخول: بطاقة في وسط الصفحة لا تغطيها كلها. على الهاتف بطاقة النموذج وحدها، وعلى الشاشة الواسعة (lg)
 * بطاقة بنصفين: لوحة كحلية بالشعار واسم النظام ومزاياه، والنموذج على مساحة بيضاء.
 */
export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await login(username, password);
    } catch (loginError) {
      // انقطاع الخادم ليس خطأ في كلمة المرور: رسالة واضحة، وتبقى كلمة المرور مكتوبة لإعادة المحاولة
      if (serverUnavailable(loginError)) {
        setError(SERVER_DOWN_MESSAGE);
      } else {
        setError(authErrorMessage(loginError, "تعذر تسجيل الدخول. حاول مرة أخرى."));
        setPassword("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-page p-4 sm:p-8" dir="rtl">
      {/* خلفية هادئة: هالتان خفيفتان بلوني الهلال والكحلي */}
      <div className="pointer-events-none absolute -top-40 end-[-10rem] h-[28rem] w-[28rem] rounded-full bg-brand-600/[0.07] blur-3xl lg:h-[36rem] lg:w-[36rem]" />
      <div className="pointer-events-none absolute -bottom-48 start-[-8rem] h-[32rem] w-[32rem] rounded-full bg-navy-700/[0.08] blur-3xl lg:h-[40rem] lg:w-[40rem]" />

      <div className="animate-rise relative w-full max-w-[440px] overflow-hidden rounded-[28px] bg-white shadow-raised ring-1 ring-slate-900/[0.04] lg:grid lg:min-h-[560px] lg:max-w-[980px] lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]">
        <div className="absolute inset-x-0 top-0 z-10 h-1 bg-gradient-to-l from-brand-600 via-brand-500 to-brand-700" />

        {/* الشاشة الواسعة: لوحة كحلية على اليمين بالشعار واسم النظام ومزاياه */}
        <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:flex lg:flex-col lg:px-11 lg:pb-10 lg:pt-11">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(38,75,120,0.55),transparent_60%),radial-gradient(ellipse_at_bottom_left,rgba(218,41,28,0.16),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(rgba(255,255,255,.7)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.7)_1px,transparent_1px)] [background-size:40px_40px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />

          <div className="relative"><BrandLogo /></div>

          <div className="relative mt-auto pt-10">
            <p className="text-end text-[13px] font-medium tracking-wide text-slate-300" dir="ltr">Al Thumama Complex Transport</p>
            <h2 className="mt-1.5 text-[34px] font-bold leading-tight tracking-tight">سيارات مجمع الثمامة</h2>
            <p className="mt-3 max-w-sm text-sm leading-6 text-slate-300">نقل الضيوف من المجمع إلى مواعيدهم الطبية والعودة، من طلب السيارة حتى الوصول.</p>
            <ul className="mt-8 space-y-3.5">
              {FEATURES.map(({ icon: IconComponent, ar, en }) => (
                <li key={en} className="flex items-center gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] ring-1 ring-inset ring-white/10">
                    <IconComponent className="h-[18px] w-[18px] text-brand-200" />
                  </span>
                  <span className="leading-snug">
                    <span className="block text-sm font-medium">{ar}</span>
                    <span className="block text-end text-[11px] text-slate-400" dir="ltr">{en}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* النموذج: بطاقة الهاتف كما هي، وعلى الشاشة الواسعة النصف الأبيض على اليسار */}
        <main className="px-7 pb-8 pt-10 sm:px-10 sm:pb-10 sm:pt-12 lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-12">
          <div className="lg:mx-auto lg:w-full lg:max-w-[360px]">
            <div className="flex items-center gap-3 lg:hidden">
              <BrandLogo compact />
              <div className="min-w-0 leading-tight">
                <p className="truncate font-semibold text-ink">سيارات مجمع الثمامة</p>
                <p className="truncate text-xs text-slate-500" dir="ltr">Al Thumama Complex Transport</p>
              </div>
            </div>

            <h1 className="mt-9 text-[26px] font-bold tracking-tight text-ink lg:mt-0 lg:text-[28px]">تسجيل الدخول</h1>
            <p className="hidden text-end text-xl font-light text-slate-500 lg:block" dir="ltr">Sign In</p>
            <p className="mt-1.5 text-sm leading-6 text-slate-500 lg:hidden">ادخل بالحساب الذي أنشأه لك مدير النظام</p>
            <p className="text-end text-xs text-slate-400 lg:hidden" dir="ltr">Sign in with your staff account</p>

            <form onSubmit={submit} className="mt-8 space-y-4 lg:mt-9 lg:space-y-3.5" noValidate>
              <FloatingField
                label={bilingual("اسم المستخدم", "Username")}
                dir="ltr"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                className="lg:pl-12"
                icons={<UserRound className="h-[18px] w-[18px]" />}
              />
              <FloatingField
                label={bilingual("كلمة المرور", "Password")}
                dir="ltr"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                className="pl-12 lg:pl-[88px]"
                icons={<span className="ml-9 flex"><LockKeyhole className="h-[18px] w-[18px]" /></span>}
                trailing={(
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    className="absolute left-2.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200/70 hover:text-slate-600 lg:left-2"
                  >
                    {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                  </button>
                )}
              />
              {error && <p role="alert" className="animate-rise rounded-2xl bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700 lg:rounded-xl">{error}</p>}
              <button type="submit" disabled={busy} className={cx(btn("primary", "lg"), "!mt-7 h-14 w-full rounded-2xl text-base lg:h-12 lg:rounded-xl")}>
                {busy
                  ? <><LoaderCircle className="h-5 w-5 animate-spin" /> جارٍ التحقق...</>
                  : <>تسجيل الدخول <span className="font-medium opacity-75" dir="ltr">Sign in</span> <ChevronLeft className="h-5 w-5" /></>}
              </button>
            </form>

            <p className="mt-8 flex items-center justify-center gap-2 text-xs text-slate-400 lg:mt-6">
              <LockKeyhole className="h-3.5 w-3.5" /> <span>دخول الموظفين فقط</span><span aria-hidden="true">·</span><span dir="ltr">Staff only</span>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
