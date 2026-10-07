import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Accessibility, CheckCircle2, MapPin, Repeat, Truck, X } from "lucide-react";
import {
  NON_MEDICAL_DESTINATIONS,
  RECURRING_DEFAULT_DAYS,
  RECURRING_MAX_DAYS,
  REQUEST_GRACE_MINUTES,
  WEEKDAY_NAMES,
  addDays,
  localDateString,
  recurringDates,
  requestWindow,
  type AppointmentKind,
  type AssistanceNeed,
  GENDERS,
  type ClinicAppointment,
  type Gender,
  type VehicleRequest,
} from "@shared/transport";
import { PRIVATE_CAR_MESSAGE, guestIndex, hasPrivateCar, hasSpecialNeeds, isNurse, type Guest } from "@shared/guests";
import { CLINIC_TEXT } from "@/lib/i18n";
import { useGuests } from "@/lib/useShared";
import { DateChooser, Field, Panel, btn, choiceClass, cx, inputClass, labelClass, timeLabel } from "@/components/ui-kit";
import { GuestPicker, NeedsField, SpecialNeedsNote } from "./ClinicPages";

const OTHER = "أخرى";

/** «الأحد 04-10» */
const dayText = (date: string) => `${WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]} ${date.slice(8, 10)}-${date.slice(5, 7)}`;

/**
 * رحلة غير طبية يضيفها مشرف السيارات: تُنشأ مباشرة كطلب بانتظار التوزيع. الضيف من قائمة ضيوف المجمع
 * (بنفس طريقة موعد العيادة): المبنى والشقة والجنس من القائمة، والهاتف منها ويمكن تغييره.
 * «رحلة متكررة»: نفس الرحلة في أيام محددة (الأحد إلى الخميس افتراضيًا) حتى تاريخ، بنفس رقم السلسلة (seriesId)،
 * بلا طلب سيارة: كل رحلة «بانتظار طلب السيارة» تظهر لمشرف المبنى في يومها، ولا تصل إلى مشرف السيارات حتى يطلبها.
 * الرحلة الواحدة مع طلب سيارتها مباشرة، وطلبها ليوم قادم فيه يوم الحجز (requestedOn).
 * editing: تعديل رحلة لم تُرسل سيارتها (nonMedicalOpen): نفس النموذج بلا التكرار، ويُحفظ بنفس رقمها وحالتها (onUpdate).
 */
export default function NonMedicalTripForm({ defaultDate, editing, onSave, onUpdate, onCancel }: {
  defaultDate: string;
  editing?: ClinicAppointment;
  onSave?: (trips: { appointment: ClinicAppointment; request?: VehicleRequest }[]) => void;
  onUpdate?: (appointment: ClinicAppointment) => void;
  onCancel: () => void;
}) {
  const guests = useGuests();
  const index = useMemo(() => guestIndex(guests), [guests]);
  const known = editing && NON_MEDICAL_DESTINATIONS.some((item) => item.ar === editing.clinic);
  const [form, setForm] = useState({
    guestId: editing?.guestId ?? "",
    gender: editing?.gender as Gender | undefined,
    destination: editing ? (known ? editing.clinic : OTHER) : NON_MEDICAL_DESTINATIONS[0].ar,
    otherDestination: editing && !known ? editing.clinic : "",
    mobile: editing?.mobile ?? "",
    appointmentDate: editing?.appointmentDate ?? defaultDate,
    appointmentAt: editing?.appointmentAt ?? timeLabel(new Date(Date.now() + 30 * 60000)),
    kind: editing?.kind ?? "عادي" as AppointmentKind,
    assistance: editing ? [...editing.assistance] : [] as AssistanceNeed[],
  });

  const guest = form.guestId ? index.byId.get(form.guestId) : undefined;
  // رحلة متكررة: الأيام وتاريخ النهاية (4 أسابيع افتراضيًا)
  const [repeat, setRepeat] = useState({ enabled: false, days: RECURRING_DEFAULT_DAYS, until: addDays(defaultDate, 27) });
  // العودة التلقائية بوقت ثابت (تُختار مع الرحلة المتكررة)، وإلا يطلبها مشرف المبنى
  const [autoReturn, setAutoReturn] = useState({ enabled: Boolean(editing?.returnAt), at: editing?.returnAt ?? "" });
  // أيام الرحلة المتكررة (بلا يوم اليوم إن مضى وقته)، أو null لمدة غير صالحة
  const seriesDates = useMemo(() => {
    if (!repeat.enabled) return null;
    const dates = recurringDates(form.appointmentDate, repeat.until, repeat.days);
    return dates && dates.filter((appointmentDate) => requestWindow({ appointmentDate, appointmentAt: form.appointmentAt }).open);
  }, [repeat, form.appointmentDate, form.appointmentAt]);
  const toggleDay = (day: number) => setRepeat((current) => ({
    ...current,
    days: current.days.includes(day) ? current.days.filter((item) => item !== day) : [...current.days, day].sort(),
  }));

  function selectGuest(next: Guest | undefined) {
    setForm((current) => {
      const previous = current.guestId ? index.byId.get(current.guestId) : undefined;
      // هاتف الضيف من القائمة، إلا إذا كتب المشرف رقمًا آخر
      const mobile = !current.mobile || current.mobile === previous?.mobile ? next?.mobile ?? "" : current.mobile;
      // المرافق اختياري هنا حتى للضيف أقل من 18 سنة (إلزامي في الموعد الطبي فقط)
      const assistance = current.assistance;
      // من ذوي الاحتياجات الخاصة: «احتياجات خاصة» و«كرسي متحرك»، ويمكن تغييرهما
      const special = hasSpecialNeeds(next);
      return {
        ...current,
        guestId: next?.id ?? "",
        mobile,
        gender: next?.gender ?? (next ? current.gender : undefined),
        kind: special ? "احتياجات خاصة" as AppointmentKind : current.kind,
        assistance: special && !assistance.includes("كرسي متحرك") ? [...assistance, "كرسي متحرك" as AssistanceNeed] : assistance,
      };
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!guest) {
      toast.error("اختر الضيف من قائمة ضيوف المجمع");
      return;
    }
    // صاحب سيارة خاصة أو من يسكن معه في نفس الشقة
    if (hasPrivateCar(guest)) {
      toast.error(PRIVATE_CAR_MESSAGE);
      return;
    }
    const destination = form.destination === OTHER ? form.otherDestination.trim() : form.destination;
    if (!destination || !form.mobile || !form.appointmentAt) {
      toast.error(form.destination === OTHER && !destination ? "اكتب الوجهة" : "أكمل الوجهة والموبايل والوقت");
      return;
    }
    if (!form.gender) {
      toast.error("اختر جنس الضيف");
      return;
    }
    const mobile = form.mobile.replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(mobile)) {
      toast.error("أدخل رقم موبايل صحيحًا من 8 إلى 15 رقمًا");
      return;
    }
    if (repeat.enabled) {
      if (!seriesDates) {
        toast.error(`تاريخ النهاية بعد تاريخ البداية وخلال ${RECURRING_MAX_DAYS} يومًا (3 أشهر)`);
        return;
      }
      if (!seriesDates.length) {
        toast.error("لا توجد رحلات في هذه الأيام والمدة", { description: "اختر أيام التكرار أو مدّ تاريخ النهاية" });
        return;
      }
    } else if ((!editing || form.appointmentDate !== editing.appointmentDate || form.appointmentAt !== editing.appointmentAt) && !requestWindow(form).open) {
      // التعديل يُفحص وقته فقط إن تغيّر التاريخ أو الوقت
      toast.error(`الوقت مضى عليه أكثر من ${REQUEST_GRACE_MINUTES} دقيقة`);
      return;
    }
    if (autoReturn.enabled && !(autoReturn.at > form.appointmentAt)) {
      toast.error("وقت العودة بعد وقت الذهاب في نفس اليوم");
      return;
    }
    if (editing) {
      // نفس الرحلة (رقمها وحالتها وسلسلتها) ببياناتها الجديدة
      const { nurse: _nurse, returnAt: _returnAt, ...rest } = editing;
      onUpdate?.({
        ...rest,
        guestId: guest.id,
        patientName: guest.name,
        clinic: destination,
        buildingNumber: guest.buildingNumber,
        apartmentNumber: guest.apartmentNumber,
        mobile,
        gender: form.gender,
        ...(isNurse(guest) ? { nurse: true } : {}),
        appointmentDate: form.appointmentDate,
        appointmentAt: form.appointmentAt,
        kind: form.kind,
        assistance: form.assistance,
        ...(autoReturn.enabled ? { returnAt: autoReturn.at } : {}),
      });
      return;
    }
    const stamp = Date.now();
    const base = stamp.toString(36);
    const today = localDateString();
    const createdAt = timeLabel(new Date());
    const dates = repeat.enabled && seriesDates ? seriesDates : [form.appointmentDate];
    const series = repeat.enabled ? { seriesId: `SER-${base}` } : {};
    onSave?.(dates.map((appointmentDate, index) => {
      const appointment: ClinicAppointment = {
        id: repeat.enabled ? `TRP-${base}-${index + 1}` : `TRP-${String(stamp).slice(-6)}`,
        guestId: guest.id,
        patientName: guest.name,
        clinic: destination,
        buildingNumber: guest.buildingNumber,
        apartmentNumber: guest.apartmentNumber,
        mobile,
        gender: form.gender,
        // ممرضة من قائمة الممرضات
        ...(isNurse(guest) ? { nurse: true } : {}),
        appointmentDate,
        appointmentAt: form.appointmentAt,
        category: "غير طبية",
        kind: form.kind,
        assistance: form.assistance,
        // المتكررة: ينتظر طلب مشرف المبنى في يومها
        status: repeat.enabled ? "بانتظار طلب السيارة" : "تم طلب السيارة",
        ...series,
        ...(autoReturn.enabled ? { returnAt: autoReturn.at } : {}),
      };
      const request: VehicleRequest = {
        id: `REQ-${stamp}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
        appointmentId: appointment.id,
        direction: "ذهاب",
        status: "بانتظار التوزيع",
        notificationMethod: "whatsapp",
        createdAt,
        // حجز ليوم قادم: السيارة مطلوبة من وقت الانطلاق في يومه
        ...(appointmentDate !== today ? { requestedOn: today } : {}),
      };
      return repeat.enabled ? { appointment } : { appointment, request };
    }));
  }

  return (
    <Panel
      tone="violet"
      icon={MapPin}
      title={editing ? "تعديل الرحلة غير الطبية" : "رحلة غير طبية"}
      description={editing
        ? `${editing.patientName} · ${editing.clinic} · ${editing.appointmentDate} ${editing.appointmentAt}${editing.seriesId ? " · هذه الرحلة فقط من الرحلات المتكررة" : ""}`
        : "تُضاف مباشرة إلى الطلبات بانتظار التوزيع"}
      className="mb-6"
      actions={<button type="button" onClick={onCancel} aria-label="إغلاق" className={btn("ghost", "sm")}><X className="h-4 w-4" /></button>}
    >
      <form onSubmit={submit} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <GuestPicker t={CLINIC_TEXT.ar} guests={guests} guest={guest} onSelect={selectGuest} />
        {hasSpecialNeeds(guest) && <SpecialNeedsNote t={CLINIC_TEXT.ar} chosen />}

        <fieldset className="sm:col-span-2">
          <legend className={labelClass}>الوجهة</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[...NON_MEDICAL_DESTINATIONS.map((item) => item.ar), OTHER].map((destination) => (
              <button key={destination} type="button" aria-pressed={form.destination === destination} onClick={() => setForm({ ...form, destination })} className={cx(choiceClass(form.destination === destination), "justify-center text-center")}>{destination}</button>
            ))}
          </div>
          {form.destination === OTHER && (
            <input autoFocus value={form.otherDestination} onChange={(event) => setForm({ ...form, otherDestination: event.target.value })} placeholder="اكتب الوجهة" aria-label="الوجهة الأخرى" className={cx(inputClass, "mt-3")} />
          )}
        </fieldset>

        <Field label="رقم الموبايل" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
        {guest && !guest.gender && (
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>الجنس</legend>
            <div className="grid grid-cols-2 gap-3">
              {GENDERS.map((gender) => (
                <button key={gender} type="button" aria-pressed={form.gender === gender} onClick={() => setForm({ ...form, gender })} className={choiceClass(form.gender === gender)}>{gender}</button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="sm:col-span-2"><DateChooser label={repeat.enabled ? "من تاريخ" : "التاريخ"} value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} /></div>
        <Field label="الوقت" value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

        {!editing && <label className={cx(choiceClass(repeat.enabled), "cursor-pointer sm:col-span-2")}>
          <input type="checkbox" checked={repeat.enabled} onChange={(event) => {
            const enabled = event.target.checked;
            setRepeat((current) => ({ ...current, enabled }));
            // الرحلة المتكررة: العودة تلقائية افتراضيًا
            if (enabled) setAutoReturn((current) => ({ ...current, enabled: true }));
          }} className="h-4 w-4 accent-brand-600" />
          <Repeat className="h-4 w-4" /> رحلة متكررة
          <span className="text-xs font-normal text-slate-500">· نفس الرحلة في أيام محددة حتى تاريخ</span>
        </label>}
        {repeat.enabled && (
          <div className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200 sm:col-span-2">
            <fieldset>
              <legend className={labelClass}>أيام التكرار</legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_NAMES.map((name, day) => (
                  <button key={name} type="button" aria-pressed={repeat.days.includes(day)} onClick={() => toggleDay(day)} className={cx(choiceClass(repeat.days.includes(day)), "min-h-9 px-3")}>{name}</button>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className={labelClass}>حتى تاريخ</span>
              <input type="date" value={repeat.until} min={form.appointmentDate} max={addDays(form.appointmentDate, RECURRING_MAX_DAYS)}
                onChange={(event) => setRepeat((current) => ({ ...current, until: event.target.value }))} className={cx(inputClass, "sm:max-w-xs")} />
            </label>
            {/* معاينة: كم رحلة ستُضاف وأيامها */}
            <p role="status" className={cx("text-sm leading-6", seriesDates?.length ? "text-slate-700" : "text-red-700")}>
              {!seriesDates
                ? `تاريخ النهاية بعد تاريخ البداية وخلال ${RECURRING_MAX_DAYS} يومًا (حتى ${addDays(form.appointmentDate, RECURRING_MAX_DAYS)})`
                : !seriesDates.length
                  ? "لا توجد رحلات في هذه الأيام والمدة"
                  : <><span className="font-semibold">{seriesDates.length.toLocaleString("en")} رحلة</span> · {seriesDates.slice(0, 5).map(dayText).join("، ")}{seriesDates.length > 5 ? ` … آخرها ${dayText(seriesDates[seriesDates.length - 1])}` : ""}</>}
            </p>
            <p className="text-xs leading-5 text-slate-500">كل رحلة تظهر لمشرف المبنى في يومها في «تحتاج طلب سيارة»، ولا تصل إلى مشرف السيارات حتى يطلبها. ويمكن إيقاف الرحلات القادمة من «كل المواعيد».</p>
          </div>
        )}

        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
          <label className={cx(choiceClass(autoReturn.enabled), "cursor-pointer")}>
            <input type="checkbox" checked={autoReturn.enabled} onChange={(event) => setAutoReturn((current) => ({ ...current, enabled: event.target.checked }))} className="h-4 w-4 accent-brand-600" />
            عودة تلقائية في وقت محدد
          </label>
          {autoReturn.enabled && (
            <label className="block">
              <span className="sr-only">وقت العودة</span>
              <input type="time" aria-label="وقت العودة" value={autoReturn.at} onChange={(event) => setAutoReturn((current) => ({ ...current, at: event.target.value }))} className={inputClass} />
            </label>
          )}
        </div>
        <p className="-mt-3 text-xs leading-5 text-slate-500 sm:col-span-2">
          {autoReturn.enabled
            ? "يُطلب له سيارة العودة تلقائيًا قبل وقتها بنصف ساعة، بعد تسجيل استلامه في الذهاب، ويتابعها مشرفو المباني."
            : "العودة يطلبها مشرف المبنى عند انتهاء الضيف."}
        </p>

        <fieldset className="sm:col-span-2">
          <legend className={labelClass}>نوع الرحلة</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["عادي", "احتياجات خاصة"] as AppointmentKind[]).map((kind) => (
              <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind })} className={choiceClass(form.kind === kind)}>
                {kind === "احتياجات خاصة" ? <Accessibility className="h-5 w-5" /> : <Truck className="h-5 w-5" />}{kind}
              </button>
            ))}
          </div>
        </fieldset>

        <NeedsField t={CLINIC_TEXT.ar} value={form.assistance} minor={false} onChange={(assistance) => setForm((current) => ({ ...current, assistance }))} />

        <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
          <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> {editing ? "حفظ التعديل" : repeat.enabled && seriesDates?.length ? `إضافة ${seriesDates.length.toLocaleString("en")} رحلة` : "إضافة الرحلة"}</button>
          <button type="button" onClick={onCancel} className={btn("secondary", "lg")}>إلغاء</button>
        </div>
      </form>
    </Panel>
  );
}
