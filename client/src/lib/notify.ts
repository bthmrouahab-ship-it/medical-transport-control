import { toast } from "sonner";

/**
 * الإشعار ينقل إلى مكانه: الضغط على الإشعار كله (أو زر «عرض» فيه) ينقل إلى العنصر الذي يخصه في الصفحة
 * (بطاقة رحلة، طلب، سيارة، قسم)، ويفتح بطاقته المطوية ويبرزه لحظات. تنبيه الجهاز مثله: يعيد الصفحة إلى
 * الواجهة ثم ينقل إلى المكان. المكان عنصر في الصفحة بـ data-target (كلمات مثل «trip:R1 trip:R2») أو بـ id.
 */

const links = new Map<string, () => void>();
let counter = 0;

/**
 * خيارات إشعار sonner ينقل الضغط عليه إلى go: رقمه وعلامته في الصفحة، وزر «عرض» بنص action (أو بلا زر إن كان
 * للإشعار زر آخر: action = false).
 */
export function goTo(go: () => void, action: string | false = "عرض") {
  const id = `go-${++counter}`;
  links.set(id, go);
  if (links.size > 100) links.delete(links.keys().next().value!);
  return { id, testId: id, className: "toast-link", ...(action ? { action: { label: action, onClick: go } } : {}) };
}

/** الضغط على إشعار له مكان (خارج أزراره) ينقل إليه ويغلقه. يُركَّب مرة واحدة عند بدء التطبيق. */
export function installToastLinks() {
  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element || element.closest("button, a, input, select")) return;
    const id = element.closest<HTMLElement>("[data-sonner-toast][data-testid]")?.dataset.testid;
    const go = id ? links.get(id) : undefined;
    if (!id || !go) return;
    go();
    toast.dismiss(id);
  });
}

/**
 * ينقل إلى المكان ويبرزه: عنصر بهذا الرقم أو بالعلامة target في data-target. يفتح البطاقة المطوية (حدث «reveal»)،
 * وينتظر العنصر قليلًا إن كانت الصفحة تتبدل (قسم أو صفحة أخرى). يعيد false إن لم يظهر.
 */
export function reveal(target: string, tries = 30): void {
  const element = document.getElementById(target) ?? document.querySelector<HTMLElement>(`[data-target~="${target.replace(/["\\]/g, "")}"]`);
  if (!element) {
    if (tries > 0) window.setTimeout(() => reveal(target, tries - 1), 100);
    return;
  }
  element.dispatchEvent(new CustomEvent("reveal"));
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // بعد أن تنفتح البطاقة المطوية
  window.setTimeout(() => element.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" }), 60);
  element.classList.remove("reveal-flash");
  void element.offsetWidth;
  element.classList.add("reveal-flash");
  window.setTimeout(() => element.classList.remove("reveal-flash"), 2800);
}

/** تنبيه على الجهاز (والصفحة في الخلفية): الضغط عليه يعيد الصفحة إلى الواجهة ثم ينقل إلى مكانه. */
export function deviceNotify(title: string, body: string, tag: string, go?: () => void) {
  try {
    const notification = new Notification(title, { body, icon: "/icon-192.png", tag });
    notification.onclick = () => {
      window.focus();
      go?.();
      notification.close();
    };
  } catch {
    /* المتصفح لا يدعم التنبيه هنا */
  }
}
