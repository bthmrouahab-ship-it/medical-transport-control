import { useState } from "react";
import { toast } from "sonner";
import { Accessibility, CheckCircle2, MapPin, Truck } from "lucide-react";
import {
  localDateString,
  NON_MEDICAL_DESTINATIONS,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import { Field, timeLabel } from "@/components/ui-kit";

const OTHER = "أخرى";

/** رحلة غير طبية يضيفها مشرف السيارات: تُنشأ مباشرة كطلب بانتظار التوزيع. */
export default function NonMedicalTripForm({ onSave, onCancel }: {
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
    appointmentDate: localDateString(),
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

  const chip = (active: boolean) => `flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-bold transition ${active ? "border-[#d88994] bg-[#fff1f2] text-[#861b2a]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`;

  return (
    <form onSubmit={submit} className="mb-6 grid gap-4 rounded-2xl border border-[#f0c4ca] bg-white p-5 sm:grid-cols-2">
      <h3 className="flex items-center gap-2 text-lg font-bold sm:col-span-2"><MapPin className="h-5 w-5 text-[#a61d2d]" /> رحلة غير طبية</h3>
      <Field label="الاسم أو الرقم" value={form.patientName} onChange={(value) => setForm({ ...form, patientName: value })} wide />

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 block text-xs font-bold text-slate-600">الوجهة</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[...NON_MEDICAL_DESTINATIONS.map((item) => item.ar), OTHER].map((destination) => (
            <button key={destination} type="button" aria-pressed={form.destination === destination} onClick={() => setForm({ ...form, destination })} className={chip(form.destination === destination)}>{destination}</button>
          ))}
        </div>
        {form.destination === OTHER && (
          <input autoFocus value={form.otherDestination} onChange={(event) => setForm({ ...form, otherDestination: event.target.value })} placeholder="اكتب الوجهة" aria-label="الوجهة الأخرى" className="mt-3 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]" />
        )}
      </fieldset>

      <Field label="رقم المبنى" value={form.buildingNumber} onChange={(value) => setForm({ ...form, buildingNumber: value })} dir="ltr" />
      <Field label="رقم الشقة" value={form.apartmentNumber} onChange={(value) => setForm({ ...form, apartmentNumber: value })} dir="ltr" />
      <Field label="رقم الموبايل" value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
      <Field label="التاريخ" value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} type="date" />
      <Field label="الوقت" value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 block text-xs font-bold text-slate-600">نوع الرحلة</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["عادي", "احتياجات خاصة"] as AppointmentKind[]).map((kind) => (
            <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind })} className={chip(form.kind === kind)}>
              {kind === "احتياجات خاصة" ? <Accessibility className="h-5 w-5" /> : <Truck className="h-5 w-5" />}{kind}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="sm:col-span-2">
        <legend className="mb-2 block text-xs font-bold text-slate-600">الاحتياجات</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["يحتاج مرافق", "كرسي متحرك"] as AssistanceNeed[]).map((need) => {
            const selected = form.assistance.includes(need);
            return (
              <label key={need} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-bold ${selected ? "border-[#a8d9cf] bg-[#effbf8] text-[#176d5f]" : "border-slate-200 bg-white text-slate-500"}`}>
                <input type="checkbox" checked={selected} onChange={() => setForm({ ...form, assistance: selected ? form.assistance.filter((item) => item !== need) : [...form.assistance, need] })} className="h-4 w-4 accent-[#a61d2d]" />
                {need}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex gap-3 sm:col-span-2">
        <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> إضافة الرحلة</button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">إلغاء</button>
      </div>
    </form>
  );
}
