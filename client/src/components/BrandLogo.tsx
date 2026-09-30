import { cx } from "@/components/ui-kit";

/** مسار شعار مجمع الثمامة (خلفية شفافة) في client/public. */
export const LOGO_SRC = "/logo.png";
const LOGO_ALT = "شعار مجمع الثمامة";

/** الشعار وحده بحجم يحدده الصنف (للرأس وغيره). */
export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return <img src={LOGO_SRC} alt={LOGO_ALT} className={cx("object-contain", className)} draggable={false} />;
}

/**
 * شعار مجمع الثمامة على بطاقة بيضاء: صغير بجانب اسم النظام (compact)، أو كبير في لوحة شاشة الدخول.
 */
export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx(
      "flex shrink-0 items-center justify-center bg-white shadow-sm ring-1 ring-slate-900/5",
      compact ? "h-12 w-12 rounded-xl p-0.5" : "h-24 w-24 rounded-2xl p-1.5",
    )}>
      <LogoMark className="h-full w-full" />
    </span>
  );
}
