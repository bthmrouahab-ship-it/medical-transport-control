import { useState } from "react";
import { toast } from "sonner";
import { Accessibility, CheckCircle2, MapPin, Truck, X } from "lucide-react";
import {
  NON_MEDICAL_DESTINATIONS,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import { DateChooser, Field, Panel, btn, choiceClass, cx, inputClass, labelClass, timeLabel } from "@/components/ui-kit";

const OTHER = "أخرى";

/** رحلة غير طبية يضيفها مشرف السيارات: تُنشأ مباشرة كطلب بانتظار التوزيع. */
export default function NonMedicalTripForm({ defaultDate, onSave, onCancel }: {
  defaultDate: string;
  onSave: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    patientName: "",
    destination: NON_MEDICAL_DESTINATIONS[0].ar,
    otherDestination: "",
    buildingNumber: "",
    apartmentNumber: "",
    mobile: "",
    appointmentDate: defaultDate,
    appointmentAt: timeLabel(new Date(Date.now() + 30 * 60000)),
    kind: "عادي" as AppointmentKind,
    assistance: [] as AssistanceNeed[],
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const destination = form.destination === OTHER ? form.otherDestination.trim() : form.destination;
    if (!form.patientName.trim() || !destination || !form.buildingNumber.trim() || !form.apartmentNumber.trim() || !form.mobile || !form.appointmentAt) {
      toast.error(form.destination === OTHER && !destination ? "اكتب الوجهة" : "أكمل الاسم والوجهة والمبنى والشقة والموبايل والوقت");
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
      patientName: form.patientName.trim(),
      clinic: destination,
      buildingNumber: form.buildingNumber.trim(),
      apartmentNumber: form.apartmentNumber.trim(),
      mobile,
      appointmentDate: form.appointmentDate,
      appointmentAt: form.appointmentAt,
      category: "غير طبية",
      kind: form.kind,
      assistance: form.assistance,
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
        <Field label="الاسم أو الرقم" value={form.patientName} onChange={(value) => setForm({ ...form, patientName: value })} wide />

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

        <Field label="رقم المبنى" value={form.buildingNumber} onChange={(value) => setForm({ ...form, buildingNumber: value })} dir="ltr" />
        <Field label="رقم الشقة" value={form.apartmentNumber} onChange={(value) => setForm({ ...form, apartmentNumber: value })} dir="ltr" />
        <Field label="رقم الموبايل" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
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

        <fieldset className="sm:col-span-2">
          <legend className={labelClass}>الاحتياجات</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["يحتاج مرافق", "كرسي متحرك"] as AssistanceNeed[]).map((need) => {
              const selected = form.assistance.includes(need);
              return (
                <label key={need} className={cx(choiceClass(selected), "cursor-pointer")}>
                  <input type="checkbox" checked={selected} onChange={() => setForm({ ...form, assistance: selected ? form.assistance.filter((item) => item !== need) : [...form.assistance, need] })} className="h-4 w-4 accent-brand-600" />
                  {need}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
          <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> إضافة الرحلة</button>
          <button type="button" onClick={onCancel} className={btn("secondary", "lg")}>إلغاء</button>
        </div>
      </form>
    </Panel>
  );
}
