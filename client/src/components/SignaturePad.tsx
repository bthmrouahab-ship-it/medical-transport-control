import { useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { COMPLAINT_SIGNATURE_MAX, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, signaturePath } from "@shared/complaints";
import { btn, cx } from "./ui-kit";

/** صورة التوقيع المحفوظ (خطوط SVG) */
export function SignatureImage({ path, className }: { path?: string; className?: string }) {
  if (!path) return <span className={cx("flex items-center justify-center text-xs text-slate-400", className)}>بلا توقيع</span>;
  return (
    <svg viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`} role="img" aria-label="توقيع" className={className}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * التوقيع بالإصبع أو الفأرة على الشاشة: يُحفظ خطوطًا مختصرة (signaturePath) لا صورة، فيبقى صغيرًا ويُطبع واضحًا.
 * «مسح» يبدأ من جديد. الصفحة لا تتحرك أثناء التوقيع (touch-action: none).
 */
export default function SignaturePad({ label, value, onChange }: { label: string; value?: string; onChange: (path: string | undefined) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  // التوقيع المحفوظ قبل فتح اللوحة يبقى، والخطوط الجديدة تُضاف إليه
  const base = useRef(value ?? "");
  const strokes = useRef<[number, number][][]>([]);
  const drawing = useRef<number | null>(null);
  const [live, setLive] = useState(value ?? "");
  const [tooLong, setTooLong] = useState(false);

  const pointOf = (event: React.PointerEvent): [number, number] => {
    const rect = svgRef.current!.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * SIGNATURE_WIDTH, ((event.clientY - rect.top) / rect.height) * SIGNATURE_HEIGHT];
  };
  const current = () => base.current + signaturePath(strokes.current);

  function start(event: React.PointerEvent<SVGSVGElement>) {
    if (event.button > 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = event.pointerId;
    strokes.current.push([pointOf(event)]);
    setLive(current());
  }
  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (drawing.current !== event.pointerId) return;
    strokes.current[strokes.current.length - 1].push(pointOf(event));
    setLive(current());
  }
  function end(event: React.PointerEvent<SVGSVGElement>) {
    if (drawing.current !== event.pointerId) return;
    drawing.current = null;
    let next = current();
    // توقيع أطول من المسموح: يُلغى الخط الأخير
    if (next.length > COMPLAINT_SIGNATURE_MAX) {
      strokes.current.pop();
      next = current();
      setTooLong(true);
    } else setTooLong(false);
    setLive(next);
    onChange(next || undefined);
  }
  function clear() {
    base.current = "";
    strokes.current = [];
    setLive("");
    setTooLong(false);
    onChange(undefined);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-700">{label}</span>
        {live && <button type="button" onClick={clear} className={cx(btn("ghost", "sm"), "h-7 px-2")}><Eraser className="h-3.5 w-3.5" /> مسح</button>}
      </div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}`}
          role="img"
          aria-label={label}
          data-testid="signature-pad"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          style={{ touchAction: "none" }}
          className="block aspect-[300/110] w-full cursor-crosshair select-none rounded-xl bg-white text-ink ring-1 ring-inset ring-slate-300"
        >
          <line x1={16} x2={SIGNATURE_WIDTH - 16} y1={SIGNATURE_HEIGHT - 22} y2={SIGNATURE_HEIGHT - 22} stroke="#cbd5e1" strokeDasharray="4 4" />
          {live && <path d={live} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
        </svg>
        {!live && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <PenLine className="h-3.5 w-3.5" /> وقّع هنا بإصبعك
          </span>
        )}
      </div>
      {tooLong && <p className="mt-1 text-xs text-amber-800">التوقيع طويل جدًا، فلم يُحفظ آخر خط. امسحه ووقّع باختصار.</p>}
    </div>
  );
}
