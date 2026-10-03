import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Accessibility, CheckCircle2, MapPin, Truck, X } from "lucide-react";
import {
  NON_MEDICAL_DESTINATIONS,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type AppointmentKind,
  type AssistanceNeed,
  GENDERS,
  type ClinicAppointment,
  type Gender,
  type VehicleRequest,
  withMinorEscort,
} from "@shared/transport";
import { PRIVATE_CAR_MESSAGE, guestIndex, hasPrivateCar, hasSpecialNeeds, isMinor, isNurse, type Guest } from "@shared/guests";
import { CLINIC_TEXT } from "@/lib/i18n";
import { useGuests } from "@/lib/useShared";
import { DateChooser, Field, Panel, btn, choiceClass, cx, inputClass, labelClass, timeLabel } from "@/components/ui-kit";
import { GuestPicker, NeedsField, SpecialNeedsNote } from "./ClinicPages";

const OTHER = "أخرى";

/**
 * رحلة غير طبية يضيفها مشرف السيارات: تُنشأ مباشرة كطلب بانتظار التوزيع. الضيف من قائمة ضيوف المجمع
 * (بنفس طريقة موعد العيادة): المبنى والشقة والجنس من القائمة، والهاتف منها ويمكن تغييره.
 */
export default function NonMedicalTripForm({ defaultDate, onSave, onCancel }: {
  defaultDate: string;
  onSave: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onCancel: () => void;
}) {
  const guests = useGuests();
  const index = useMemo(() => guestIndex(guests), [guests]);
  const [form, setForm] = useState({
    guestId: "",
    gender: undefined as Gender | undefined,
    destination: NON_MEDICAL_DESTINATIONS[0].ar,
    otherDestination: "",
    mobile: "",
    appointmentDate: defaultDate,
    appointmentAt: timeLabel(new Date(Date.now() + 30 * 60000)),
    kind: "عادي" as AppointmentKind,
    assistance: [] as AssistanceNeed[],
  });

  const guest = form.guestId ? index.byId.get(form.guestId) : undefined;

  function selectGuest(next: Guest | undefined) {
    setForm((current) => {
      const previous = current.guestId ? index.byId.get(current.guestId) : undefined;
      // هاتف الضيف من القائمة، إلا إذا كتب المشرف رقمًا آخر
      const mobile = !current.mobile || current.mobile === previous?.mobile ? next?.mobile ?? "" : current.mobile;
      // الضيف أقل من 18 سنة: المرافق إلزامي إلا مع Nurse
      const assistance = withMinorEscort(current.assistance, isMinor(next));
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
    if (!requestWindow(form).open) {
      toast.error(`الوقت مضى عليه أكثر من ${REQUEST_GRACE_MINUTES} دقيقة`);
      return;
    }
    const stamp = Date.now();
    const appointment: ClinicAppointment = {
      id: `TRP-${String(stamp).slice(-6)}`,
      guestId: guest.id,
      patientName: guest.name,
      clinic: destination,
      buildingNumber: guest.buildingNumber,
      apartmentNumber: guest.apartmentNumber,
      mobile,
      gender: form.gender,
      // ممرضة من قائمة الممرضات
      ...(isNurse(guest) ? { nurse: true } : {}),
      appointmentDate: form.appointmentDate,
      appointmentAt: form.appointmentAt,
      category: "غير طبية",
      kind: form.kind,
      assistance: withMinorEscort(form.assistance, isMinor(guest)),
      status: "تم طلب السيارة",
    };
    onSave(appointment, {
      id: `REQ-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      appointmentId: appointment.id,
      direction: "ذهاب",
      status: "بانتظار التوزيع",
      notificationMethod: "whatsapp",
      createdAt: timeLabel(new Date()),
    });
  }

  return (
    <Panel
      tone="violet"
      icon={MapPin}
      title="رحلة غير طبية"
      description="تُضاف مباشرة إلى الطلبات بانتظار التوزيع"
      className="mb-6"
      actions={<button type="button" onClick={onCancel} aria-label="إغلاق" className={btn("ghost", "sm")}><X className="h-4 w-4" /></button>}
    >
      <form onSubmit={submit} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
        <GuestPicker t={CLINIC_TEXT.ar} guests={guests} guest={guest} onSelect={selectGuest} />
        {hasSpecialNeeds(guest) && <SpecialNeedsNote t={CLINIC_TEXT.ar} chosen />}

        <fieldset className="sm:col-span-2">
          <legend className={labelClass}>الوجهة</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <div className="sm:col-span-2"><DateChooser label="التاريخ" value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} /></div>
        <Field label="الوقت" value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

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

        <NeedsField t={CLINIC_TEXT.ar} value={form.assistance} minor={isMinor(guest)} onChange={(assistance) => setForm((current) => ({ ...current, assistance }))} />

        <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
          <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> إضافة الرحلة</button>
          <button type="button" onClick={onCancel} className={btn("secondary", "lg")}>إلغاء</button>
        </div>
      </form>
    </Panel>
  );
}
