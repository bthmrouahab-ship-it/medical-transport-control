import { useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { localDateString, statusText, type ClinicAppointment } from "@shared/transport";

/**
 * مكونات الواجهة الموحدة: كل الصفحات تستخدمها حتى يبقى الشكل متسقًا.
 * الألوان لها معنى ثابت في كل مكان:
 * كهرماني = ينتظر إجراء، أزرق = قيد التنفيذ، أخضر = تم / متاح، بنفسجي = اقتراح، أحمر = تنبيه أو خطأ، رمادي = معلومات.
 */

type Icon = ComponentType<{ className?: string }>;

export type Tone = "neutral" | "brand" | "amber" | "blue" | "green" | "violet" | "red" | "cyan";

/** soft: شارة، icon: مربع أيقونة، bar: شريط أعلى القسم، dot: نقطة الحالة، halo: هالتها، text: رقم ملون (الوضع الداكن لصفحة السائق) */
const TONES: Record<Tone, { soft: string; icon: string; bar: string; dot: string; halo: string; text: string }> = {
  neutral: { soft: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700", icon: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300", bar: "", dot: "bg-slate-400", halo: "ring-slate-400/20", text: "text-slate-700" },
  brand: { soft: "bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-600/15 dark:text-brand-200 dark:ring-brand-600/30", icon: "bg-brand-50 text-brand-600", bar: "bg-brand-600", dot: "bg-brand-600", halo: "ring-brand-600/20", text: "text-brand-700" },
  amber: { soft: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30", icon: "bg-amber-100 text-amber-700", bar: "bg-amber-400", dot: "bg-amber-500", halo: "ring-amber-500/20", text: "text-amber-700" },
  blue: { soft: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30", icon: "bg-blue-100 text-blue-700", bar: "bg-blue-500", dot: "bg-blue-500", halo: "ring-blue-500/20", text: "text-blue-700" },
  green: { soft: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30", icon: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-500", halo: "ring-emerald-500/20", text: "text-emerald-700" },
  violet: { soft: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30", icon: "bg-violet-100 text-violet-700", bar: "bg-violet-500", dot: "bg-violet-500", halo: "ring-violet-500/20", text: "text-violet-700" },
  red: { soft: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30", icon: "bg-red-100 text-red-700", bar: "bg-red-500", dot: "bg-red-500", halo: "ring-red-500/20", text: "text-red-700" },
  cyan: { soft: "bg-cyan-50 text-cyan-800 ring-cyan-200 dark:bg-cyan-500/15 dark:text-cyan-200 dark:ring-cyan-500/30", icon: "bg-cyan-100 text-cyan-700", bar: "bg-cyan-500", dot: "bg-cyan-500", halo: "ring-cyan-500/20", text: "text-cyan-700" },
};

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export const byAppointmentTime = (a: ClinicAppointment, b: ClinicAppointment) =>
  `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`);

// ————— الأزرار والحقول —————

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "dark" | "soft";

/** صنف الزر: primary للإجراء الرئيسي في القسم (واحد فقط غالبًا)، وsecondary لما سواه. */
export function btn(variant: ButtonVariant = "secondary", size: "sm" | "md" | "lg" = "md") {
  const sizes = { sm: "h-9 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-12 px-5 text-base" };
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-brand-600 text-white shadow-brand hover:bg-brand-700 active:bg-brand-800",
    secondary: "bg-white text-slate-700 shadow-[0_1px_2px_rgba(11,37,69,.06)] ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:text-ink dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-700",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
    danger: "bg-white text-red-600 ring-1 ring-inset ring-red-200 hover:bg-red-50 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30",
    success: "bg-emerald-600 text-white shadow-[0_1px_2px_rgba(5,150,105,.25),0_6px_16px_-6px_rgba(5,150,105,.45)] hover:bg-emerald-700",
    dark: "bg-navy-900 text-white shadow-[0_1px_2px_rgba(11,37,69,.3),0_6px_16px_-6px_rgba(11,37,69,.45)] hover:bg-navy-800",
    soft: "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100 dark:bg-brand-600/15 dark:text-brand-200 dark:ring-brand-600/30",
  };
  return cx("inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none", sizes[size], variants[variant]);
}

/** زر داخل الشريط العلوي الداكن. */
export const headerButton = "inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-200 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white";

/** خيار في نموذج (نوع الرحلة، الاحتياجات، الوجهة): المختار بإطار أحمر الهلال. */
export const choiceClass = (selected: boolean) => cx(
  "flex min-h-11 items-center gap-2.5 rounded-xl px-4 text-sm font-medium ring-inset transition",
  selected ? "bg-brand-50 text-brand-700 ring-2 ring-brand-600" : "bg-slate-50 text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100",
);

/** حقل مملوء بلا إطار ظاهر: خلفية رمادية فاتحة، ويصبح أبيض بإطار أحمر خفيف عند الكتابة. */
export const inputClass = "h-11 w-full rounded-xl border border-transparent bg-slate-100 px-3.5 text-sm text-ink outline-none transition placeholder:text-slate-400 hover:bg-slate-200/60 focus:border-brand-600/50 focus:bg-white focus:ring-4 focus:ring-brand-600/10 disabled:bg-slate-50 disabled:text-slate-400 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900";
export const labelClass = "mb-1.5 block text-[13px] font-medium text-slate-700";

export function Field({ label, value, onChange, placeholder = "", type = "text", wide, dir, list }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
  dir?: "rtl" | "ltr";
  list?: string;
}) {
  return (
    <label className={cx("block", wide && "sm:col-span-2")}>
      <span className={labelClass}>{label}</span>
      <input dir={dir} list={list} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={inputClass} />
    </label>
  );
}

// ————— تخطيط الصفحة —————

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * قسم في الصفحة. لون الشريط العلوي والأيقونة يدلّان على نوعه:
 * amber ينتظر إجراء، blue قيد التنفيذ، green تم، violet اقتراحات، red تنبيه، neutral معلومات.
 */
export function Panel({ id, title, description, icon: IconComponent, tone = "neutral", count, actions, children, className, bodyClassName }: {
  /** للانتقال إلى القسم (شريط الحالة) */
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  icon?: Icon;
  tone?: Tone;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const style = TONES[tone];
  return (
    <section id={id} className={cx("scroll-mt-24 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-900/[0.03]", className)}>
      {style.bar && <div className={cx("h-[3px]", style.bar)} />}
      {/* الأزرار تنزل تحت العنوان حين يضيق المكان (الهاتف) بدل أن تضغط الوصف */}
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5 border-b border-slate-100 px-5 py-3.5">
        <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
          {IconComponent && <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", style.icon)}><IconComponent className="h-[18px] w-[18px]" /></span>}
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <span className="truncate">{title}</span>
              {count !== undefined && <span className={cx("rounded-full px-2 py-px text-xs font-semibold ring-1 ring-inset tabular", style.soft)}>{count}</span>}
            </h2>
            {description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/** بطاقة رقم (مؤشر): العنوان، ثم الرقم، وأيقونة بلون معناه. */
export function Stat({ label, value, icon: IconComponent, tone = "neutral", hint }: { label: string; value: ReactNode; icon: Icon; tone?: Tone; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-card ring-1 ring-slate-900/[0.03] sm:gap-4 sm:p-4">
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", TONES[tone].icon)}><IconComponent className="h-[18px] w-[18px] sm:h-5 sm:w-5" /></span>
      <div className="min-w-0">
        <p className="text-xs font-medium leading-snug text-slate-500 sm:text-[13px]">{label}</p>
        <p className="text-2xl font-semibold leading-tight text-ink">{value}</p>
        {hint && <p className="hidden truncate text-xs text-slate-400 sm:block">{hint}</p>}
      </div>
    </div>
  );
}

export function Badge({ tone = "neutral", icon: IconComponent, children, className, title }: { tone?: Tone; icon?: Icon; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", TONES[tone].soft, className)}>
      {IconComponent && <IconComponent className="h-3.5 w-3.5" />}{children}
    </span>
  );
}

/** نقطة ملونة صغيرة بهالة خفيفة بجانب نص (للحالة)، واللون لا يحمل المعنى وحده بل النص بجانبه. pulse: موجة للحالة الحية (GPS). */
export function Dot({ tone = "neutral", pulse = false }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", TONES[tone].dot)} />}
      <span className={cx("relative inline-block h-2.5 w-2.5 rounded-full ring-[3px]", TONES[tone].dot, TONES[tone].halo)} />
    </span>
  );
}

/** لون ثابت لكل حالة موعد أو طلب في كل الصفحات. */
export const STATUS_TONE: Record<string, Tone> = {
  "بانتظار طلب السيارة": "neutral",
  "تم طلب السيارة": "amber",
  "بانتظار التوزيع": "amber",
  "تم إرسال السيارة": "blue",
  "وصلت السيارة": "violet",
  "تم استلام المريض": "cyan",
  "وصلت الوجهة": "green",
  "طلب عودة": "amber",
  "مكتملة": "green",
  "ملغي": "red",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? statusText(status)}</Badge>;
}

export function EmptyState({ icon: IconComponent, title, hint }: { icon: Icon; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><IconComponent className="h-6 w-6" /></span>
      <p className="mt-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

/** مجموعة أزرار يُختار منها واحد (تبويبات أو خيارات قليلة). */
export function Segmented<T extends string>({ options, value, onChange, label, size = "md", full = false }: {
  options: { value: T; label: ReactNode; icon?: Icon }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  /** يملأ العرض المتاح بأزرار متساوية (داخل الأقسام الضيقة) */
  full?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cx("max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800", full ? "flex w-full" : "inline-flex")}>
      {options.map((option) => {
        const active = option.value === value;
        const IconComponent = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition",
              full ? "min-w-0 flex-1 justify-center" : "shrink-0",
              size === "sm" ? cx("h-8 text-xs", full ? "px-1.5" : "px-3") : "h-9 px-3.5 text-sm",
              active ? "bg-white text-ink shadow-[0_1px_3px_rgba(11,37,69,.12)] dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:text-ink dark:text-slate-300 dark:hover:text-white",
            )}
          >
            {IconComponent && <IconComponent className="h-4 w-4" />}{option.label}
          </button>
        );
      })}
    </div>
  );
}

/** الوقت واليوم في عمود ثابت العرض بجانب كل موعد. */
export function TimeBlock({ time, day, tone = "neutral" }: { time: string; day?: string; tone?: Tone }) {
  return (
    <span className={cx("flex w-[68px] shrink-0 flex-col items-center justify-center rounded-xl px-2 py-2 text-center", tone === "red" ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200" : "bg-slate-100/80 text-ink dark:bg-slate-800 dark:text-white")}>
      <span dir="ltr" className="text-base font-semibold leading-none tabular">{time}</span>
      {day && <span className="mt-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{day}</span>}
    </span>
  );
}

/** مراحل الرحلة في خط واحد: المراحل المنتهية بلون، والحالية بإطار. */
export function Steps({ steps, current, tone = "blue" }: { steps: string[]; current: number; tone?: Tone }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[11px]" aria-label="مراحل الرحلة">
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={step} className="flex items-center gap-1">
            <span className={cx(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              done && "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              active && cx(TONES[tone].soft, "ring-1 ring-inset font-semibold"),
              !done && !active && "text-slate-400 dark:text-slate-500",
            )}>
              <span className={cx("h-1.5 w-1.5 rounded-full", done ? "bg-slate-400" : active ? TONES[tone].dot : "bg-slate-300")} />
              {step}
            </span>
            {index < steps.length - 1 && <span className="h-px w-3 bg-slate-300 dark:bg-slate-700" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** نافذة حوار فوق الصفحة: تُغلق بزر الإغلاق أو Esc أو النقر خارجها، ويعود التركيز بعدها إلى ما كان عليه. */
export function Modal({ title, description, icon: IconComponent, tone = "neutral", onClose, children, footer }: {
  title: ReactNode;
  description?: ReactNode;
  icon?: Icon;
  tone?: Tone;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200">
        {TONES[tone].bar && <div className={cx("h-[3px] shrink-0", TONES[tone].bar)} />}
        <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          {IconComponent && <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONES[tone].icon)}><IconComponent className="h-[18px] w-[18px]" /></span>}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-5 text-slate-500">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق" className={cx(btn("ghost", "sm"), "w-9 px-0")}><X className="h-4 w-4" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ————— التاريخ والوقت —————

/** "اليوم" / "غدًا" / "أمس" أو التاريخ */
export function formatDay(date: string, now: Date, labels = { today: "اليوم", tomorrow: "غدًا", yesterday: "أمس" }) {
  const offset = (days: number) => localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  if (date === offset(0)) return labels.today;
  if (date === offset(1)) return labels.tomorrow;
  if (date === offset(-1)) return labels.yesterday;
  return date;
}

/** تاريخ ووقت بالتقويم الميلادي وأرقام لاتينية (مثل 24/09/2026 14:05). */
export function stamp(date = new Date()) {
  const day = `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  return `${day} ${timeLabel(date)}`;
}

export const timeLabel = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return localDateString(new Date(year, month - 1, day + days));
}

/** التاريخ بالعربية مع اسم اليوم، مثل «الأحد 27 سبتمبر». */
export function longDate(date: string, lang: "ar" | "en" = "ar") {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(lang === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** اختيار التاريخ: اليوم، غدًا، أو تاريخ آخر من التقويم. */
export function DateChooser({ value, onChange, labels = { today: "اليوم", tomorrow: "غدًا", other: "تاريخ آخر" }, label }: {
  value: string;
  onChange: (date: string) => void;
  labels?: { today: string; tomorrow: string; other: string };
  label?: string;
}) {
  const today = localDateString();
  const tomorrow = addDays(today, 1);
  const [picking, setPicking] = useState(value !== today && value !== tomorrow);
  const mode = picking ? "other" : value === today ? "today" : value === tomorrow ? "tomorrow" : "other";
  return (
    <div>
      {label && <span className={labelClass}>{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={label ?? "التاريخ"}
          value={mode}
          onChange={(next) => {
            if (next === "other") setPicking(true);
            else {
              setPicking(false);
              onChange(next === "today" ? today : tomorrow);
            }
          }}
          options={[{ value: "today", label: labels.today }, { value: "tomorrow", label: labels.tomorrow }, { value: "other", label: labels.other }]}
        />
        {mode === "other" && <input type="date" aria-label={labels.other} value={value} onChange={(event) => event.target.value && onChange(event.target.value)} className={cx(inputClass, "h-11 w-auto bg-white shadow-card")} />}
      </div>
    </div>
  );
}

/** مفتاح تشغيل/إيقاف بحركة ناعمة (الدائرة تنزلق، وتنضغط قليلًا عند اللمس). lg لصفحة السائق. */
export function Switch({ checked, onChange, label, disabled, size = "md" }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean; size?: "md" | "lg" }) {
  const big = size === "lg";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "group inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        big ? "h-8 w-14" : "h-6 w-11",
        checked ? "bg-emerald-500 shadow-[inset_0_1px_2px_rgba(4,120,87,.35)]" : "bg-slate-300 shadow-[inset_0_1px_2px_rgba(11,37,69,.15)] dark:bg-slate-600",
      )}
    >
      <span className={cx(
        "rounded-full bg-white shadow-[0_1px_3px_rgba(11,37,69,.3)] transition-transform duration-300 ease-spring group-active:scale-90",
        big ? "h-7 w-7" : "h-5 w-5",
        checked && (big ? "translate-x-6 rtl:-translate-x-6" : "translate-x-5 rtl:-translate-x-5"),
      )} />
    </button>
  );
}

export type StatusItem = { key: string; label: string; value: number; tone: Tone; hint?: ReactNode; onClick?: () => void };

/**
 * شريط الحالة المقسّم بعدادات حية ملونة (بدل بطاقات الأرقام): أخضر متاح، أزرق جارٍ، كهرماني ينتظر، أحمر متأخر.
 * الضغط على جزء ينقل إلى القسم المعني. الأحمر يبرز فقط حين يكون العدد أكبر من صفر.
 */
export function StatusBar({ items, label }: { items: StatusItem[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1.5 shadow-card ring-1 ring-slate-900/[0.03] lg:grid-cols-4">
      {items.map((item) => {
        const alert = item.tone === "red" && item.value > 0;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={cx("flex min-w-0 items-center gap-3 rounded-xl px-3.5 py-3 text-start transition", alert ? "bg-red-50 hover:bg-red-100/70" : "hover:bg-slate-50")}
          >
            <Dot tone={item.value > 0 ? item.tone : "neutral"} pulse={alert} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className={cx("block text-[13px] font-semibold leading-snug", alert ? "text-red-800" : "text-slate-700")}>{item.label}</span>
              {item.hint && <span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.hint}</span>}
            </span>
            <span className={cx("text-2xl font-semibold leading-none tabular", item.value > 0 ? TONES[item.tone].text : "text-slate-300")}>{item.value}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * بطاقة قابلة للتوسيع: الملخص (المعلومات الأساسية) ظاهر دائمًا ويفتح البطاقة عند اللمس، والإجراء الرئيسي بجانبه،
 * والتفاصيل وباقي الإجراءات تنزل بحركة ناعمة. attention: تُفتح وحدها بخط كهرماني حين تحتاج انتباهًا
 * (تأكيد خلال مهلة، سيارة متأخرة)، ويستطيع المستخدم طيّها حتى يأتي تنبيه جديد.
 */
export function Expandable({ summary, action, children, attention = false, label, target }: {
  /** بلا روابط أو أزرار داخله (عناصر span فقط): كله زر واحد يفتح البطاقة */
  summary: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  attention?: boolean;
  /** اسم الزر لقارئ الشاشة (مثل «تفاصيل ضيف …») */
  label: string;
  /** علامة البطاقة للإشعار الذي ينقل إليها (reveal في lib/notify.ts يفتحها) */
  target?: string;
}) {
  // null: تتبع attention، وبعد لمس المستخدم تتبع اختياره حتى يبدأ تنبيه جديد
  const [open, setOpen] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    const show = () => setOpen(true);
    element?.addEventListener("reveal", show);
    return () => element?.removeEventListener("reveal", show);
  }, []);
  const [wasAttention, setWasAttention] = useState(attention);
  if (attention !== wasAttention) {
    setWasAttention(attention);
    if (attention) setOpen(null);
  }
  const expanded = open ?? attention;
  const bodyId = useId();
  return (
    <div ref={root} data-target={target} className={cx(
      "relative transition-colors duration-300",
      attention ? "bg-amber-50/40" : expanded ? "bg-slate-50/70" : "hover:bg-slate-50/50",
    )}>
      {attention && <span className="absolute inset-y-0 start-0 w-[3px] bg-amber-400" aria-hidden="true" />}
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <button type="button" aria-expanded={expanded} aria-controls={bodyId} aria-label={label} onClick={() => setOpen(!expanded)} className="flex min-w-0 flex-1 items-center gap-4 rounded-xl text-start">
          {summary}
          <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition duration-300", expanded ? "rotate-180 bg-white text-slate-600 shadow-sm" : "bg-slate-100/80")}>
            <ChevronDown className="h-4 w-4" />
          </span>
        </button>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:flex-1 sm:[&>*]:flex-none sm:justify-end">{action}</div>}
      </div>
      <div id={bodyId} className={cx("grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className={cx("overflow-hidden transition-[visibility] duration-300", !expanded && "invisible")}>
          <div className="px-4 pb-4 sm:px-5 sm:pb-5 sm:ps-[104px]">{children}</div>
        </div>
      </div>
    </div>
  );
}
