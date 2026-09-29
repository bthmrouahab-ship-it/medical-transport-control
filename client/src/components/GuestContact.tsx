import { MessageCircle, Phone } from "lucide-react";
import { whatsappNumber } from "@shared/transport";
import { cx } from "./ui-kit";

/** رقم الضيف مع زرّين: الاتصال به، أو فتح محادثة واتساب معه. */
export default function GuestContact({ mobile, size = "sm", labels = { call: "اتصال", whatsapp: "واتساب" } }: {
  mobile: string;
  size?: "sm" | "md";
  labels?: { call: string; whatsapp: string };
}) {
  const number = whatsappNumber(mobile);
  const pill = cx("inline-flex items-center gap-1 rounded-lg font-semibold ring-1 ring-inset transition", size === "md" ? "h-10 px-3.5 text-sm" : "h-8 px-2.5");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span dir="ltr" className="tabular">{mobile}</span>
      <a href={`tel:+${number}`} className={cx(pill, "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50 hover:text-ink dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700")} aria-label={`${labels.call} ${mobile}`}>
        <Phone className="h-3.5 w-3.5" /> {labels.call}
      </a>
      <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" className={cx(pill, "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30")} aria-label={`${labels.whatsapp} ${mobile}`}>
        <MessageCircle className="h-3.5 w-3.5" /> {labels.whatsapp}
      </a>
    </span>
  );
}
