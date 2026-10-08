import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileText, ImageUp, Loader2, ScrollText, X } from "lucide-react";
import { COMPLAINT_TEXT_MAX, PAPER_COMPLAINT_TEXT, buildComplaint, complaintError, type Complaint, type ComplaintDraft } from "@shared/complaints";
import { localDateString } from "@shared/transport";
import { toWesternDigits } from "@shared/text";
import { prepareScan, type PreparedScan } from "@/lib/complaints";
import type { ComplaintGuest } from "./Complaints";
import { Modal, btn, cx, inputClass, labelClass, timeLabel } from "./ui-kit";

const newId = () => `CMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ميجابايت` : `${Math.max(1, Math.round(bytes / 1024))} كيلوبايت`);

/** اختيار صورة الاستمارة (الكاميرا أو ملف) أو PDF، وتجهيزها للرفع */
export function ScanPicker({ scan, onChange, invalid = false }: { scan: PreparedScan | null; onChange: (scan: PreparedScan | null) => void; invalid?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onChange(await prepareScan(file));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "تعذر قراءة الملف");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <div>
      <input ref={input} type="file" accept="image/*,application/pdf" className="sr-only" aria-label="صورة الاستمارة الورقية أو PDF" onChange={(event) => choose(event.target.files?.[0])} />
      {scan ? (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-inset ring-emerald-200">
          {scan.type === "application/pdf"
            ? <FileText className="h-8 w-8 shrink-0 text-emerald-700" />
            : <img src={`data:${scan.type};base64,${scan.data}`} alt="" className="h-14 w-11 shrink-0 rounded object-cover ring-1 ring-emerald-200" />}
          <span className="min-w-0 flex-1 text-sm">
            <span className="block truncate font-medium text-ink">{scan.name}</span>
            <span className="text-xs text-slate-600">{scan.type === "application/pdf" ? "PDF" : "صورة"} · {sizeText(scan.size)}</span>
          </span>
          <button type="button" onClick={() => input.current?.click()} className={btn("ghost", "sm")}>تغيير</button>
          <button type="button" aria-label="إزالة الملف" onClick={() => onChange(null)} className={cx(btn("ghost", "sm"), "w-9 px-0 text-slate-500 hover:text-red-700")}><X className="h-4 w-4" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={cx("flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition hover:bg-slate-50",
            invalid ? "border-red-300 bg-red-50/40" : "border-slate-300")}
        >
          {busy ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : <ImageUp className="h-6 w-6 text-slate-500" />}
          <span className="text-sm font-semibold text-ink">{busy ? "جارٍ تجهيز الملف…" : "صورة الاستمارة الورقية أو ملف PDF"}</span>
          <span className="text-xs text-slate-500">التقط صورة بالكاميرا أو اختر ملفًا · حتى 5 ميجابايت</span>
        </button>
      )}
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

/**
 * إضافة شكوى ورقية (مدير النظام فقط): بيانات الاستمارة المكتوبة باليد، واسم المشرف كما فيها، وصورتها أو ملف PDF. ملخص الشكوى
 * اختياري (وإلا «الشكوى في الاستمارة الورقية المرفقة»). تُحفظ الشكوى ثم تُرفع الاستمارة.
 */
export function PaperComplaintForm({ guests, onSave, onClose }: {
  guests: ComplaintGuest[];
  onSave: (complaint: Complaint, scan: PreparedScan) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [draft, setDraft] = useState<ComplaintDraft>({ date: localDateString(now), time: timeLabel(now), guestName: "", buildingNumber: "", apartmentNumber: "", text: "", paper: true, paperSupervisor: "" });
  const [scan, setScan] = useState<PreparedScan | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (patch: Partial<ComplaintDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const mobile = toWesternDigits(draft.mobile ?? "").replace(/[\s-]/g, "");
  const final = { ...draft, text: draft.text.trim() || PAPER_COMPLAINT_TEXT, mobile: mobile || undefined };
  const error = complaintError(final) ?? (scan ? null : "أرفق صورة الاستمارة الورقية أو ملف PDF");

  const query = draft.guestName.trim();
  const matches = useMemo(() => {
    if (!query) return [];
    const words = query.toLowerCase().split(/\s+/);
    return guests.filter((guest) => words.every((word) => `${guest.name} ${guest.buildingNumber}`.toLowerCase().includes(word))).slice(0, 6);
  }, [guests, query]);
  const chosen = guests.some((guest) => guest.name === draft.guestName && guest.buildingNumber === draft.buildingNumber && guest.apartmentNumber === draft.apartmentNumber);

  function close() {
    if ((scan || draft.guestName.trim() || draft.text.trim()) && !window.confirm("الشكوى لم تُضف بعد. إغلاق النافذة وتجاهل ما كُتب؟")) return;
    onClose();
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (error || !scan) return;
    onSave(buildComplaint(final, newId()), scan);
  }

  return (
    <Modal
      tone="amber"
      icon={ScrollText}
      title="إضافة شكوى ورقية"
      description="استمارة شكوى مكتوبة باليد: اكتب بياناتها كما في الورقة وأرفق صورتها · لا تُعدّل بعد إضافتها"
      onClose={close}
      footer={(
        <>
          {showErrors && error && <p role="alert" className="me-auto self-center text-xs font-medium text-red-700">{error}</p>}
          <button type="button" onClick={close} className={btn("secondary")}>إلغاء</button>
          <button type="submit" form="paper-complaint-form" className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> إضافة الشكوى</button>
        </>
      )}
    >
      <form id="paper-complaint-form" onSubmit={submit} className="space-y-4" noValidate>
        <ScanPicker scan={scan} onChange={setScan} invalid={showErrors && !scan} />
        <div className="relative">
          <label className={labelClass} htmlFor="paper-guest">اسم الضيف</label>
          <input
            id="paper-guest"
            value={draft.guestName}
            autoComplete="off"
            placeholder="كما في الاستمارة، أو اختر من قائمة الضيوف"
            onChange={(event) => { set({ guestName: event.target.value }); setSuggesting(true); }}
            onFocus={() => setSuggesting(true)}
            onBlur={() => window.setTimeout(() => setSuggesting(false), 150)}
            className={cx(inputClass, showErrors && !draft.guestName.trim() && "ring-2 ring-red-300")}
          />
          {suggesting && !chosen && matches.length > 0 && (
            <ul role="listbox" aria-label="ضيوف المجمع" className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl bg-white p-1 shadow-raised ring-1 ring-slate-200">
              {matches.map((guest) => (
                <li key={`${guest.name}|${guest.buildingNumber}|${guest.apartmentNumber}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { set({ guestName: guest.name, buildingNumber: guest.buildingNumber, apartmentNumber: guest.apartmentNumber, ...(guest.mobile ? { mobile: guest.mobile } : {}) }); setSuggesting(false); }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-ink">{guest.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">مبنى {guest.buildingNumber} · شقة {guest.apartmentNumber}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className={labelClass}>رقم المبنى</span>
            <input value={draft.buildingNumber} inputMode="numeric" onChange={(event) => set({ buildingNumber: event.target.value })} className={cx(inputClass, "tabular", showErrors && !draft.buildingNumber.trim() && "ring-2 ring-red-300")} />
          </label>
          <label className="block">
            <span className={labelClass}>رقم الشقة</span>
            <input value={draft.apartmentNumber} inputMode="numeric" onChange={(event) => set({ apartmentNumber: event.target.value })} className={cx(inputClass, "tabular", showErrors && !draft.apartmentNumber.trim() && "ring-2 ring-red-300")} />
          </label>
          <label className="block">
            <span className={labelClass}>الهاتف (اختياري)</span>
            <input value={draft.mobile ?? ""} dir="ltr" inputMode="tel" onChange={(event) => set({ mobile: event.target.value || undefined })} className={cx(inputClass, "tabular")} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelClass}>تاريخ الشكوى</span>
            <input type="date" value={draft.date} max={localDateString(now)} onChange={(event) => set({ date: event.target.value })} className={cx(inputClass, "tabular")} />
          </label>
          <label className="block">
            <span className={labelClass}>الوقت</span>
            <input type="time" value={draft.time} onChange={(event) => set({ time: event.target.value })} className={cx(inputClass, "tabular")} />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>اسم المشرف في الاستمارة (اختياري)</span>
          <input value={draft.paperSupervisor ?? ""} maxLength={80} onChange={(event) => set({ paperSupervisor: event.target.value })} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-slate-700">
            الشكوى (اختياري)
            <span className={cx("text-xs font-normal tabular", draft.text.length > COMPLAINT_TEXT_MAX ? "text-red-700" : "text-slate-400")}>{draft.text.length}/{COMPLAINT_TEXT_MAX}</span>
          </span>
          <textarea
            value={draft.text}
            rows={4}
            placeholder={`انسخ نص الشكوى من الاستمارة لتظهر في البحث، أو اتركه فارغًا: «${PAPER_COMPLAINT_TEXT}»`}
            onChange={(event) => set({ text: event.target.value })}
            className={cx(inputClass, "h-auto min-h-24 py-2.5 leading-6")}
          />
        </label>
      </form>
    </Modal>
  );
}
