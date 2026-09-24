import { useId, useState } from "react";

/** شعار الهلال الأحمر: الملف الرسمي إن وُضع في client/public/qrcs-logo.png، وإلا هلال مرسوم. */
export function Crescent({ className = "h-9 w-9" }: { className?: string }) {
  const maskId = `crescent-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <mask id={maskId}>
          <rect width="64" height="64" fill="#fff" />
          <circle cx="39" cy="28" r="21" fill="#000" />
        </mask>
      </defs>
      <circle cx="30" cy="32" r="26" fill="#e30613" mask={`url(#${maskId})`} />
    </svg>
  );
}

export default function BrandLogo({ tone = "light", compact = false }: { tone?: "light" | "dark"; compact?: boolean }) {
  const [official, setOfficial] = useState(true);
  const text = tone === "dark" ? "text-white" : "text-slate-900";
  const sub = tone === "dark" ? "text-slate-300" : "text-slate-500";

  if (official) {
    return (
      <img
        src="/qrcs-logo.png"
        alt="الهلال الأحمر القطري · Qatar Red Crescent"
        onError={() => setOfficial(false)}
        className={`${compact ? "h-10" : "h-14"} w-auto rounded-lg bg-white object-contain p-1`}
      />
    );
  }
  return (
    <div className="flex items-center gap-2.5" aria-label="الهلال الأحمر القطري · Qatar Red Crescent">
      <div className={`flex shrink-0 items-center justify-center rounded-xl bg-white ${compact ? "h-10 w-10" : "h-12 w-12"} shadow-sm ring-1 ring-slate-200`}>
        <Crescent className={compact ? "h-7 w-7" : "h-9 w-9"} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className={`text-sm font-bold ${text}`}>الهلال الأحمر القطري</p>
          <p className={`text-[11px] font-semibold tracking-wide ${sub}`} dir="ltr">Qatar Red Crescent</p>
        </div>
      )}
    </div>
  );
}
