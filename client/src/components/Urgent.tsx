import { useMemo, useState } from "react";
import { Ambulance, CheckCircle2, Hospital as HospitalIcon, House, Moon, Siren } from "lucide-react";
import { COMPLEX_CLINIC, type Hospital } from "@shared/hospitals";
import { GENDERS, type AssistanceNeed, type ClinicAppointment, type Gender, type UrgentOutcome } from "@shared/transport";
import { NIGHT_SHIFT_TEXT, URGENT_LABEL, URGENT_OUTCOMES, isNightShift, urgentDraftError, type UrgentDraft } from "@shared/urgent";
import { HospitalSelect } from "@/pages/ClinicPages";
import type { ComplaintGuest } from "./Complaints";
import { Badge, Modal, btn, choiceClass, cx, inputClass, labelClass } from "./ui-kit";

/** شارة الحالة المستعجلة (شفت الليل) */
export function UrgentBadge() {
  return <Badge tone="red" icon={Siren}>{URGENT_LABEL}</Badge>;
}

/**
 * زر طلب سيارة لحالة مستعجلة من المبنى إلى عيادة المجمع: يعمل في شفت الليل فقط (من 10 مساءً إلى 6 صباحًا)، وفي غيره ظاهر
 * ومعطّل مع السبب. الخادم يرفض الطلب خارج هذه الساعات أيضًا.
 */
export function UrgentButton({ now, onClick, size }: { now: Date; onClick: () => void; size?: "sm" }) {
  const night = isNightShift(now);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!night}
      title={night ? `طلب سيارة لحالة مستعجلة من المبنى إلى ${COMPLEX_CLINIC.name}` : `يعمل في شفت الليل فقط (${NIGHT_SHIFT_TEXT})`}
      className={cx(btn(night ? "danger" : "secondary", size), !night && "cursor-not-allowed opacity-60")}
    >
      {night ? <Siren className={size ? "h-3.5 w-3.5" : "h-4 w-4"} /> : <Moon className={size ? "h-3.5 w-3.5" : "h-4 w-4"} />}
      حالة مستعجلة
      {!night && <span className="text-xs font-normal">· من 10 مساءً</span>}
    </button>
  );
}

const NEEDS: { need: AssistanceNeed; label: string }[] = [
  { need: "كرسي متحرك", label: "كرسي متحرك" },
  { need: "يحتاج مرافق", label: "يحتاج مرافق" },
  { need: "يحتاج Nurse", label: "يحتاج Nurse" },
];

/**
 * نموذج الحالة المستعجلة: الضيف (يُكتب أو يُختار من ضيوف مواعيد اليوم والأيام السابقة فيملأ المبنى والشقة والهاتف)،
 * وجنسه واحتياجاته. الحفظ يطلب السيارة فورًا من المبنى إلى عيادة المجمع ويصل إلى مشرف السيارات.
 */
export function UrgentCaseForm({ guests, onSave, onClose }: {
  guests: ComplaintGuest[];
  onSave: (draft: UrgentDraft) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<UrgentDraft>({ patientName: "", buildingNumber: "", apartmentNumber: "", kind: "عادي", assistance: [] });
  const [showErrors, setShowErrors] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const set = (patch: Partial<UrgentDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const error = urgentDraftError(draft);

  const query = draft.patientName.trim();
  const matches = useMemo(() => {
    if (!query) return [];
    const words = query.toLowerCase().split(/\s+/);
    return guests.filter((guest) => words.every((word) => `${guest.name} ${guest.buildingNumber}`.toLowerCase().includes(word))).slice(0, 6);
  }, [guests, query]);
  const chosen = guests.some((guest) => guest.name === draft.patientName && guest.buildingNumber === draft.buildingNumber && guest.apartmentNumber === draft.apartmentNumber);

  function toggle(need: AssistanceNeed) {
    const assistance = draft.assistance.includes(need) ? draft.assistance.filter((item) => item !== need) : [...draft.assistance, need];
    // الكرسي المتحرك يحتاج سيارة احتياجات خاصة
    set({ assistance, kind: assistance.includes("كرسي متحرك") ? "احتياجات خاصة" : "عادي" });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setShowErrors(true);
    if (!error) onSave(draft);
  }

  return (
    <Modal
      tone="red"
      icon={Siren}
      title="طلب سيارة لحالة مستعجلة"
      description={`من المبنى إلى ${COMPLEX_CLINIC.name} · يصل الطلب فورًا إلى مشرف السيارات ليرسل السائق، وتتابعه من «طلبات جارية»`}
      onClose={onClose}
      footer={(
        <>
          {showErrors && error && <p role="alert" className="me-auto self-center text-xs font-medium text-red-700">{error}</p>}
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="submit" form="urgent-form" className={btn("danger")}><Siren className="h-4 w-4" /> طلب السيارة الآن</button>
        </>
      )}
    >
      <form id="urgent-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="relative">
          <label className={labelClass} htmlFor="urgent-guest">اسم الضيف</label>
          <input
            id="urgent-guest"
            value={draft.patientName}
            autoComplete="off"
            autoFocus
            placeholder={guests.length ? "اكتب الاسم أو اختر من ضيوف المواعيد" : "اسم الضيف"}
            onChange={(event) => { set({ patientName: event.target.value }); setSuggesting(true); }}
            onFocus={() => setSuggesting(true)}
            onBlur={() => window.setTimeout(() => setSuggesting(false), 150)}
            className={cx(inputClass, showErrors && query.length < 2 && "ring-2 ring-red-300")}
          />
          {suggesting && !chosen && matches.length > 0 && (
            <ul role="listbox" aria-label="ضيوف المواعيد" className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-xl bg-white p-1 shadow-raised ring-1 ring-slate-200">
              {matches.map((guest) => (
                <li key={`${guest.name}|${guest.buildingNumber}|${guest.apartmentNumber}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      set({ patientName: guest.name, buildingNumber: guest.buildingNumber, apartmentNumber: guest.apartmentNumber, mobile: guest.mobile });
                      setSuggesting(false);
                    }}
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
        <fieldset>
          <legend className={labelClass}>الجنس (اختياري)</legend>
          <div className="grid grid-cols-2 gap-2">
            {GENDERS.map((gender) => (
              <label key={gender} className={cx(choiceClass(draft.gender === gender), "cursor-pointer")}>
                <input type="radio" name="urgent-gender" checked={draft.gender === gender} onChange={() => set({ gender: gender as Gender })} className="h-4 w-4 accent-brand-600" />
                {gender}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={labelClass}>احتياجات الضيف <span className="font-normal text-slate-500">· الكرسي المتحرك تُرسل له سيارة احتياجات خاصة</span></legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {NEEDS.map(({ need, label }) => (
              <label key={need} className={cx(choiceClass(draft.assistance.includes(need)), "cursor-pointer")}>
                <input type="checkbox" checked={draft.assistance.includes(need)} onChange={() => toggle(need)} className="h-4 w-4 accent-brand-600" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

/**
 * نتيجة الحالة في عيادة المجمع بعد وصول الضيف إليها: عاد إلى المبنى (عولج في العيادة فقط) أو ذهب بسيارة الإسعاف ينهيان
 * التتبع، و«إلى المستشفى بسيارة المجمع» يفتح اختيار المستشفى فيُطلب السائق بنفس نظام النهار.
 */
export function UrgentOutcomeActions({ appointment, hospitals, onOutcome }: {
  appointment: ClinicAppointment;
  hospitals: Hospital[];
  onOutcome: (appointment: ClinicAppointment, outcome: UrgentOutcome, hospital?: Hospital) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const icons: Record<UrgentOutcome, typeof House> = { returned: House, ambulance: Ambulance, hospital: HospitalIcon };
  const tones: Record<UrgentOutcome, "success" | "danger" | "primary"> = { returned: "success", ambulance: "danger", hospital: "primary" };
  function choose(outcome: UrgentOutcome) {
    if (outcome === "hospital") {
      setChoosing(true);
      return;
    }
    const item = URGENT_OUTCOMES.find((entry) => entry.value === outcome)!;
    if (window.confirm(`${appointment.patientName}: ${item.done}؟\nينتهي تتبع الحالة.`)) onOutcome(appointment, outcome);
  }
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {URGENT_OUTCOMES.map((item) => {
          const Icon = icons[item.value];
          return (
            <button key={item.value} type="button" onClick={() => choose(item.value)} title={item.hint} className={btn(tones[item.value], "sm")}>
              <Icon className="h-3.5 w-3.5" /> {item.label}
            </button>
          );
        })}
      </div>
      {choosing && (
        <HospitalTransferDialog
          appointment={appointment}
          hospitals={hospitals}
          onClose={() => setChoosing(false)}
          onConfirm={(hospital) => {
            setChoosing(false);
            onOutcome(appointment, "hospital", hospital);
          }}
        />
      )}
    </>
  );
}

/** المستشفى من الدليل: يُطلب له سائق من العيادة بنفس نظام النهار */
function HospitalTransferDialog({ appointment, hospitals, onClose, onConfirm }: {
  appointment: ClinicAppointment;
  hospitals: Hospital[];
  onClose: () => void;
  onConfirm: (hospital: Hospital) => void;
}) {
  const [hospitalId, setHospitalId] = useState("");
  const [showError, setShowError] = useState(false);
  const hospital = hospitals.find((item) => item.id === hospitalId);
  return (
    <Modal
      tone="blue"
      icon={HospitalIcon}
      title="إلى المستشفى بسيارة المجمع"
      description={`${appointment.patientName} · من ${COMPLEX_CLINIC.name} إلى المستشفى · يُرسل السائق بنفس نظام النهار، ثم تُطلب العودة من «ضيوف في الموعد»`}
      onClose={onClose}
      footer={(
        <>
          {showError && !hospital && <p role="alert" className="me-auto self-center text-xs font-medium text-red-700">اختر المستشفى</p>}
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" onClick={() => (hospital ? onConfirm(hospital) : setShowError(true))} className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> طلب السيارة إلى المستشفى</button>
        </>
      )}
    >
      <HospitalSelect id="urgent-hospital" label="المستشفى" value={hospitalId} onChange={setHospitalId} hospitals={hospitals} lang="ar" placeholder="ابحث باسم المستشفى" noMatch="لا يوجد مستشفى بهذا الاسم في الدليل" wide />
    </Modal>
  );
}
