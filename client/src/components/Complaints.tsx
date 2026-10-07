import { useMemo, useState } from "react";
import { CheckCircle2, CircleCheck, CircleDot, Link2, MessageSquareWarning, Plus, Printer, RotateCcw, Search, Trash2, UserRound, X } from "lucide-react";
import {
  COMPLAINT_CATEGORIES,
  COMPLAINT_MAX_WITNESSES,
  COMPLAINT_RESOLUTION_MAX,
  COMPLAINT_TEXT_MAX,
  buildComplaint,
  complaintError,
  complaintMatches,
  complaintNumber,
  isResolved,
  type Complaint,
  type ComplaintDraft,
} from "@shared/complaints";
import { localDateString } from "@shared/transport";
import { toWesternDigits } from "@shared/text";
import { dayText, printComplaint, stampText } from "@/lib/complaints";
import SignaturePad, { SignatureImage } from "./SignaturePad";
import { Badge, EmptyState, Modal, btn, choiceClass, cx, inputClass, labelClass, timeLabel } from "./ui-kit";

/** ضيف مقترح في الاستمارة (من مواعيد اليوم عند مشرف المبنى) */
export type ComplaintGuest = { name: string; buildingNumber: string; apartmentNumber: string; mobile?: string };

const newId = () => `CMP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function ComplaintStatus({ complaint }: { complaint: Complaint }) {
  if (!complaint.number) return <Badge tone="neutral">يُحفظ…</Badge>;
  return isResolved(complaint)
    ? <Badge tone="green" icon={CircleCheck}>تمت المعالجة</Badge>
    : <Badge tone="amber" icon={CircleDot}>جديدة</Badge>;
}

/**
 * تسجيل شكوى بالاستمارة المعتمدة: الضيف (من مواعيد اليوم أو يُكتب)، والمبنى والشقة، والموضوع والنص، وتاريخها ووقتها،
 * والتوقيعات على الشاشة (الضيف والمشرف وشاهدان اختياريًا). لا تُعدّل بعد تسجيلها ولا يحذفها إلا مدير النظام.
 */
export function ComplaintForm({ initial, guests, supervisorName, onSave, onClose }: {
  /** من بطاقة الموعد: الضيف ومبناه وشقته وهاتفه والرحلة */
  initial?: Partial<ComplaintDraft>;
  guests: ComplaintGuest[];
  supervisorName: string;
  onSave: (complaint: Complaint) => void;
  onClose: () => void;
}) {
  const now = new Date();
  const [draft, setDraft] = useState<ComplaintDraft>(() => ({
    date: localDateString(now),
    time: timeLabel(now),
    guestName: "",
    buildingNumber: "",
    apartmentNumber: "",
    text: "",
    ...initial,
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (patch: Partial<ComplaintDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const error = complaintError({ ...draft, mobile: toWesternDigits(draft.mobile ?? "").replace(/[\s-]/g, "") || undefined });
  const witnesses = draft.witnesses ?? [];
  const setWitness = (index: number, patch: Partial<{ name: string; signature?: string }>) =>
    set({ witnesses: witnesses.map((witness, at) => (at === index ? { ...witness, ...patch } : witness)) });

  // الضيوف المقترحون: من مواعيد اليوم، بالاسم أو المبنى
  const query = draft.guestName.trim();
  const matches = useMemo(() => {
    if (!query) return [];
    const words = query.toLowerCase().split(/\s+/);
    return guests.filter((guest) => words.every((word) => `${guest.name} ${guest.buildingNumber}`.toLowerCase().includes(word))).slice(0, 6);
  }, [guests, query]);
  const chosen = guests.some((guest) => guest.name === draft.guestName && guest.buildingNumber === draft.buildingNumber && guest.apartmentNumber === draft.apartmentNumber);
  const dirty = Boolean(draft.text.trim() || draft.guestSignature || draft.supervisorSignature || witnesses.length || (!initial?.guestName && draft.guestName.trim()));

  function close() {
    if (dirty && !window.confirm("الشكوى لم تُسجَّل بعد. إغلاق الاستمارة وتجاهل ما كُتب؟")) return;
    onClose();
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (error) return;
    const mobile = toWesternDigits(draft.mobile ?? "").replace(/[\s-]/g, "");
    onSave(buildComplaint({ ...draft, mobile: mobile || undefined }, newId()));
  }

  const trip = [draft.vehiclePlate && `السيارة ${draft.vehiclePlate}`, draft.driver && `السائق ${draft.driver}`].filter(Boolean).join(" · ");
  return (
    <Modal
      tone="amber"
      icon={MessageSquareWarning}
      title="تسجيل شكوى"
      description="استمارة الشكاوى المعتمدة في مجمع الثمامة · بعد التسجيل لا تُعدّل الشكوى ولا تُحذف (الحذف لمدير النظام فقط)"
      onClose={close}
      footer={(
        <>
          {showErrors && error && <p role="alert" className="me-auto self-center text-xs font-medium text-red-700">{error}</p>}
          <button type="button" onClick={close} className={btn("secondary")}>إلغاء</button>
          <button type="submit" form="complaint-form" className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> تسجيل الشكوى</button>
        </>
      )}
    >
      <form id="complaint-form" onSubmit={submit} className="space-y-5" noValidate>
        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-ink">الضيف</legend>
          <div className="relative">
            <label className={labelClass} htmlFor="complaint-guest">اسم الضيف</label>
            <input
              id="complaint-guest"
              value={draft.guestName}
              autoComplete="off"
              placeholder={guests.length ? "اكتب الاسم أو اختر من ضيوف مواعيد اليوم" : "اسم الضيف"}
              onChange={(event) => { set({ guestName: event.target.value }); setSuggesting(true); }}
              onFocus={() => setSuggesting(true)}
              onBlur={() => window.setTimeout(() => setSuggesting(false), 150)}
              className={cx(inputClass, showErrors && !draft.guestName.trim() && "ring-2 ring-red-300")}
            />
            {suggesting && !chosen && matches.length > 0 && (
              <ul role="listbox" aria-label="ضيوف مواعيد اليوم" className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl bg-white p-1 shadow-raised ring-1 ring-slate-200">
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
        </fieldset>

        <fieldset>
          <legend className={labelClass}>موضوع الشكوى (اختياري)</legend>
          <div className="flex flex-wrap gap-1.5">
            {COMPLAINT_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                aria-pressed={draft.category === category}
                onClick={() => set({ category: draft.category === category ? undefined : category })}
                className={cx(choiceClass(draft.category === category), "min-h-9 px-3 text-xs")}
              >
                {category}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 flex items-center justify-between text-[13px] font-medium text-slate-700">
            الشكوى
            <span className={cx("text-xs font-normal tabular", draft.text.length > COMPLAINT_TEXT_MAX ? "text-red-700" : "text-slate-400")}>{draft.text.length}/{COMPLAINT_TEXT_MAX}</span>
          </span>
          <textarea
            value={draft.text}
            rows={5}
            placeholder="اكتب الشكوى كما ذكرها الضيف"
            onChange={(event) => set({ text: event.target.value })}
            className={cx(inputClass, "h-auto min-h-32 py-2.5 leading-6", showErrors && draft.text.trim().length < 3 && "ring-2 ring-red-300")}
          />
        </label>

        {(draft.appointmentId || trip) && (
          <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
            <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1">مرتبطة بموعد الضيف اليوم{trip ? ` · ${trip}` : ""}</span>
            <button type="button" onClick={() => set({ appointmentId: undefined, vehiclePlate: undefined, driver: undefined })} className="shrink-0 font-medium text-slate-500 hover:text-red-700">إلغاء الربط</button>
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelClass}>التاريخ</span>
            <input type="date" value={draft.date} max={localDateString(now)} onChange={(event) => set({ date: event.target.value })} className={cx(inputClass, "tabular")} />
          </label>
          <label className="block">
            <span className={labelClass}>الوقت</span>
            <input type="time" value={draft.time} onChange={(event) => set({ time: event.target.value })} className={cx(inputClass, "tabular")} />
          </label>
        </div>

        <fieldset className="space-y-4 rounded-2xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <legend className="sr-only">التوقيعات</legend>
          <p className="text-sm font-semibold text-ink">التوقيعات <span className="text-xs font-normal text-slate-500">· اختيارية، ويمكن التوقيع على الاستمارة المطبوعة</span></p>
          <SignaturePad label={`توقيع الضيف${draft.guestName.trim() ? `: ${draft.guestName.trim()}` : ""}`} value={draft.guestSignature} onChange={(guestSignature) => set({ guestSignature })} />
          <SignaturePad label={`توقيع المشرف: ${supervisorName}`} value={draft.supervisorSignature} onChange={(supervisorSignature) => set({ supervisorSignature })} />
          {witnesses.map((witness, index) => (
            <div key={index} className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-inset ring-slate-200">
              <div className="flex items-end gap-2">
                <label className="block min-w-0 flex-1">
                  <span className={labelClass}>اسم الشاهد ({index + 1})</span>
                  <input value={witness.name} onChange={(event) => setWitness(index, { name: event.target.value })} className={cx(inputClass, showErrors && !witness.name.trim() && "ring-2 ring-red-300")} />
                </label>
                <button type="button" aria-label={`حذف الشاهد ${index + 1}`} onClick={() => set({ witnesses: witnesses.filter((_, at) => at !== index) })} className={cx(btn("ghost"), "w-10 px-0 text-slate-500 hover:text-red-700")}><X className="h-4 w-4" /></button>
              </div>
              <SignaturePad label={`توقيع الشاهد (${index + 1})`} value={witness.signature} onChange={(signature) => setWitness(index, { signature })} />
            </div>
          ))}
          {witnesses.length < COMPLAINT_MAX_WITNESSES && (
            <button type="button" onClick={() => set({ witnesses: [...witnesses, { name: "" }] })} className={btn("secondary", "sm")}>
              <Plus className="h-3.5 w-3.5" /> إضافة شاهد
            </button>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

/**
 * الشكوى المسجلة: كل بياناتها وتوقيعاتها وطباعة الاستمارة. للمدير وحده المتابعة (تمت المعالجة مع ملاحظة، أو إعادة فتحها) والحذف.
 */
export function ComplaintView({ complaint, admin = false, onResolve, onReopen, onDelete, onClose }: {
  complaint: Complaint;
  admin?: boolean;
  onResolve?: (resolution: string) => void;
  onReopen?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState(complaint.resolution ?? "");
  const trip = [complaint.vehiclePlate && `السيارة ${complaint.vehiclePlate}`, complaint.driver && `السائق ${complaint.driver}`].filter(Boolean).join(" · ");
  const row = (label: string, value?: string) => value ? <div className="flex gap-2 text-sm"><dt className="w-24 shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 font-medium text-ink">{value}</dd></div> : null;
  const signature = (label: string, path?: string) => (
    <div>
      <p className="mb-1 text-xs text-slate-500">{label}</p>
      <SignatureImage path={path} className="aspect-[300/110] w-full rounded-lg bg-white text-ink ring-1 ring-inset ring-slate-200" />
    </div>
  );
  return (
    <Modal
      tone={isResolved(complaint) ? "green" : "amber"}
      icon={MessageSquareWarning}
      title={<>الشكوى {complaintNumber(complaint)}</>}
      description={complaint.createdByName ? `سجّلها ${complaint.createdByName}${complaint.createdAt ? ` · ${stampText(complaint.createdAt)}` : ""}` : "تُحفظ الآن…"}
      onClose={onClose}
      footer={(
        <>
          {admin && onDelete && (
            <button
              type="button"
              onClick={() => window.confirm(`حذف الشكوى ${complaintNumber(complaint)} من الضيف ${complaint.guestName} نهائيًا؟\nيبقى في سجل العمليات أنها سُجّلت وحُذفت.`) && onDelete()}
              className={cx(btn("danger"), "me-auto")}
            >
              <Trash2 className="h-4 w-4" /> حذف
            </button>
          )}
          {admin && isResolved(complaint) && onReopen && <button type="button" onClick={onReopen} className={btn("secondary")}><RotateCcw className="h-4 w-4" /> إعادة فتح</button>}
          {admin && !resolving && onResolve && (
            <button type="button" onClick={() => setResolving(true)} className={btn("success")} disabled={!complaint.number}>
              <CircleCheck className="h-4 w-4" /> {isResolved(complaint) ? "تعديل المعالجة" : "تمت المعالجة"}
            </button>
          )}
          <button type="button" onClick={() => printComplaint(complaint)} disabled={!complaint.number} className={btn(admin ? "secondary" : "primary")}><Printer className="h-4 w-4" /> طباعة الاستمارة</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ComplaintStatus complaint={complaint} />
          {complaint.category && <Badge tone="violet">{complaint.category}</Badge>}
          <span className="text-xs text-slate-500 tabular">{dayText(complaint.date)} · {complaint.time}</span>
        </div>
        <dl className="space-y-1.5">
          {row("اسم الضيف", complaint.guestName)}
          {row("المبنى والشقة", `مبنى ${complaint.buildingNumber} · شقة ${complaint.apartmentNumber}`)}
          {row("الهاتف", complaint.mobile)}
          {row("الرحلة", trip)}
        </dl>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">الشكوى</p>
          <p className="whitespace-pre-wrap rounded-xl bg-slate-50 px-3.5 py-3 text-sm leading-7 text-ink ring-1 ring-inset ring-slate-200">{complaint.text}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {signature(`توقيع الضيف`, complaint.guestSignature)}
          {signature(`توقيع المشرف${complaint.createdByName ? `: ${complaint.createdByName}` : ""}`, complaint.supervisorSignature)}
          {(complaint.witnesses ?? []).map((witness, index) => <div key={index}>{signature(`شاهد (${index + 1}): ${witness.name}`, witness.signature)}</div>)}
        </div>
        {isResolved(complaint) && !resolving && (
          <div className="rounded-xl bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900 ring-1 ring-inset ring-emerald-200">
            <p className="font-semibold">المعالجة</p>
            <p className="mt-1 whitespace-pre-wrap leading-6">{complaint.resolution}</p>
            <p className="mt-1 text-xs text-emerald-800/80">{[complaint.resolvedBy, stampText(complaint.resolvedAt)].filter(Boolean).join(" · ")}</p>
          </div>
        )}
        {resolving && onResolve && (
          <form
            onSubmit={(event) => { event.preventDefault(); if (resolution.trim()) { onResolve(resolution.trim()); setResolving(false); } }}
            className="space-y-2 rounded-xl bg-emerald-50/60 p-3 ring-1 ring-inset ring-emerald-200"
          >
            <label className="block">
              <span className={labelClass}>ماذا تم بشأن الشكوى؟</span>
              <textarea autoFocus value={resolution} maxLength={COMPLAINT_RESOLUTION_MAX} rows={3} onChange={(event) => setResolution(event.target.value)} className={cx(inputClass, "h-auto py-2.5 leading-6")} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setResolving(false)} className={btn("ghost", "sm")}>إلغاء</button>
              <button type="submit" disabled={!resolution.trim()} className={btn("success", "sm")}><CheckCircle2 className="h-3.5 w-3.5" /> حفظ المعالجة</button>
            </div>
          </form>
        )}
        {!admin && <p className="text-xs text-slate-500">لا يمكن تعديل الشكوى أو حذفها بعد تسجيلها؛ الحذف لمدير النظام فقط.</p>}
      </div>
    </Modal>
  );
}

/** صف شكوى في القائمة: الرقم والضيف والمبنى والموضوع والحالة، والضغط يفتحها */
export function ComplaintRow({ complaint, showAuthor = false, onOpen }: { complaint: Complaint; showAuthor?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-target={`complaint:${complaint.id}`} className="flex w-full items-start gap-3 px-5 py-3 text-start transition hover:bg-slate-50">
      <span className="mt-0.5 w-12 shrink-0 text-sm font-semibold text-ink tabular">{complaintNumber(complaint)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">{complaint.guestName}</span>
          <span className="text-xs text-slate-500">مبنى {complaint.buildingNumber} · شقة {complaint.apartmentNumber}</span>
          {complaint.category && <Badge tone="violet">{complaint.category}</Badge>}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm text-slate-600">{complaint.text}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500 tabular">
          <span>{dayText(complaint.date)} · {complaint.time}</span>
          {showAuthor && complaint.createdByName && <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{complaint.createdByName}</span>}
        </span>
      </span>
      <span className="shrink-0"><ComplaintStatus complaint={complaint} /></span>
    </button>
  );
}

/** قائمة الشكاوى مع البحث، وأحدثها أولًا (أول limit ثم «عرض الكل») */
export function ComplaintList({ complaints, showAuthor = false, limit = 8, onOpen, empty }: {
  complaints: Complaint[];
  showAuthor?: boolean;
  limit?: number;
  onOpen: (complaint: Complaint) => void;
  empty: string;
}) {
  const [query, setQuery] = useState("");
  const [all, setAll] = useState(false);
  const shown = complaints.filter((complaint) => complaintMatches(complaint, toWesternDigits(query)));
  const visible = all || query ? shown : shown.slice(0, limit);
  if (!complaints.length) return <EmptyState icon={MessageSquareWarning} title={empty} />;
  return (
    <>
      {complaints.length > limit && (
        <div className="border-b border-slate-100 px-5 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالرقم أو الضيف أو المبنى أو النص" aria-label="بحث في الشكاوى" className={cx(inputClass, "ps-9")} />
          </label>
        </div>
      )}
      <div className="divide-y divide-slate-100">
        {visible.map((complaint) => <ComplaintRow key={complaint.id} complaint={complaint} showAuthor={showAuthor} onOpen={() => onOpen(complaint)} />)}
        {!visible.length && <p className="px-5 py-6 text-center text-sm text-slate-500">لا توجد شكوى تطابق البحث</p>}
      </div>
      {!all && !query && shown.length > limit && (
        <div className="border-t border-slate-100 px-5 py-2.5 text-center">
          <button type="button" onClick={() => setAll(true)} className={btn("ghost", "sm")}>عرض كل الشكاوى ({shown.length})</button>
        </div>
      )}
    </>
  );
}
