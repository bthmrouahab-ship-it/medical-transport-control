import { loadState, saveState } from "./appStore";
import { stamp } from "@/components/ui-kit";

const MAX_ENTRIES = 50;

/** يضيف عملية إلى السجل المشترك مع اسم من نفّذها، ويعيد السجل الجديد. */
export function appendAudit(message: string, actor: string) {
  const entry = `${stamp()} — ${message} (${actor})`;
  const next = [entry, ...loadState<string[]>("fox_audit", [])].slice(0, MAX_ENTRIES);
  saveState("fox_audit", next);
  return next;
}
