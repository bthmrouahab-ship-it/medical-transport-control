import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  Download,
  Pencil,
  Phone,
  Trash2,
  Truck,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  localDateString,
  parseImportedAppointments,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
} from "@shared/transport";
import { matchHospital } from "@shared/hospitals";
import { DateChooser, Field, formatDay, InfoCard, PageHeading } from "@/components/ui-kit";
import type { ClinicText, Lang } from "@/lib/i18n";
import { useHospitals, useNow } from "@/lib/useShared";

const WAITING = "بانتظار طلب السيارة";

export function ClinicHome({ t, appointments, date, onDateChange, onNew, onEdit, onDelete, onImport }: {
  t: ClinicText;
  appointments: ClinicAppointment[];
  date: string;
  onDateChange: (date: string) => void;
  onNew: () => void;
  onEdit: (appointment: ClinicAppointment) => void;
  onDelete: (appointment: ClinicAppointment) => void;
  onImport: (appointments: ClinicAppointment[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const hospitals = useHospitals();
  const now = useNow();

  async function importExcel(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error("empty workbook");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" });
      const result = parseImportedAppointments(rows, appointments, Date.now(), localDateString(), hospitals);
      if (!result.appointments.length) {
        toast.error(t.dir === "rtl" && result.errors[0] ? result.errors[0] : t.importNone);
        return;
      }
      if (!window.confirm(t.importFound(result.appointments.length))) return;
      onImport(result.appointments);
      toast.success(t.imported(result.appointments.length));
      if (result.errors.length) toast.warning(t.skipped(result.errors.length));
    } catch {
      toast.error(t.importError);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadTemplate() {
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet([{
        "اسم المريض أو الرقم": "مريض 001",
        "اسم العيادة أو المستشفى": "مستشفى حمد العام",
        "رقم المبنى": "12",
        "رقم الشقة": "4",
        "رقم الموبايل": "55123456",
        "تاريخ الموعد": localDateString(),
        "وقت الموعد": "09:30",
        "نوع الرحلة": "عادي",
        "احتياجات المريض": "يحتاج مرافق، كرسي متحرك",
      }]);
      worksheet["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 30 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المواعيد");
      XLSX.writeFile(workbook, "appointments-template.xlsx");
      toast.success(t.templateDone);
    } catch {
      toast.error(t.templateError);
    }
  }

  const today = localDateString(now);
  const dayAppointments = appointments.filter((appointment) => appointment.appointmentDate === date);
  return (
    <>
      <PageHeading
        title={t.title}
        action={(
          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => importExcel(event.target.files?.[0])} />
            <button onClick={downloadTemplate} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 hover:bg-slate-50"><Download className="h-4 w-4 text-[#a61d2d]" /> {t.template}</button>
            <button disabled={importing} onClick={() => fileInputRef.current?.click()} className="flex min-h-11 items-center gap-2 rounded-xl border border-[#e6b7b7] bg-[#fff7f7] px-4 text-sm font-bold text-[#a61d2d] hover:bg-[#fff1f2] disabled:opacity-60"><Upload className="h-4 w-4" /> {importing ? t.importing : t.import}</button>
            <button onClick={onNew} className="flex min-h-11 items-center gap-2 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white hover:bg-[#8b1725]"><ClipboardPlus className="h-4 w-4" /> {t.add}</button>
          </div>
        )}
      />

      <div className="mb-5"><DateChooser value={date} onChange={onDateChange} labels={t.dateChoice} /></div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <InfoCard icon={CalendarDays} label={date === today ? t.statToday : t.statDate} value={String(dayAppointments.length)} tone="teal" />
        <InfoCard icon={Clock3} label={t.statWaiting} value={String(dayAppointments.filter((appointment) => appointment.status === WAITING).length)} tone="amber" />
        <InfoCard icon={CheckCircle2} label={t.statLinked} value={String(dayAppointments.filter((appointment) => appointment.status !== WAITING).length)} tone="blue" />
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-5 py-4 font-bold">{t.list} <span className="mx-1 text-slate-300">|</span><span className="font-semibold text-slate-400" dir="ltr">{date}</span></h3>
        <div className="divide-y divide-slate-100">
          {dayAppointments.length
            ? dayAppointments.map((appointment) => <AppointmentCard key={appointment.id} t={t} appointment={appointment} now={now} onEdit={onEdit} onDelete={onDelete} />)
            : <div className="p-12 text-center"><UsersRound className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-500">{t.empty}</p></div>}
        </div>
      </section>
    </>
  );
}

function AppointmentCard({ t, appointment, now, onEdit, onDelete }: {
  t: ClinicText;
  appointment: ClinicAppointment;
  now: Date;
  onEdit: (appointment: ClinicAppointment) => void;
  onDelete: (appointment: ClinicAppointment) => void;
}) {
  const editable = appointment.status === WAITING;
  const expired = editable && !requestWindow(appointment, now).open;
  return (
    <div className={`flex flex-col gap-4 p-5 lg:flex-row lg:items-center ${expired ? "bg-red-50/40" : ""}`}>
      <div className="min-w-[95px] text-sm font-bold">
        <p className="flex items-center gap-2" dir="ltr"><Clock3 className="h-4 w-4 text-slate-300" />{appointment.appointmentAt}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-400">{formatDay(appointment.appointmentDate, now, t.days)}</p>
      </div>
      <div className="flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{appointment.id}</span></div>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500"><Building2 className="h-3.5 w-3.5" />{t.pickup(appointment.buildingNumber, appointment.apartmentNumber)}<span>·</span>{appointment.clinic}<span>·</span>{t.kind(appointment.kind)}</p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span>{appointment.assistance.length > 0 && <><span>·</span><Accessibility className="h-3.5 w-3.5" /><span>{appointment.assistance.map(t.need).join(t.dir === "rtl" ? "، " : ", ")}</span></>}</p>
      </div>
      {expired
        ? <span className="w-fit rounded-full bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700">{t.expired}</span>
        : <span className={`w-fit rounded-full px-3 py-1.5 text-xs font-bold ${editable ? "bg-amber-50 text-amber-700" : "bg-violet-50 text-violet-700"}`}>{t.status(appointment.status)}</span>}
      <div className="flex items-center gap-2">
        <button disabled={!editable} title={editable ? t.edit : t.lockedHint} onClick={() => onEdit(appointment)} className="flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"><Pencil className="h-3.5 w-3.5" /> {t.edit}</button>
        <button disabled={!editable} title={editable ? t.delete : t.lockedHint} onClick={() => onDelete(appointment)} className="flex min-h-10 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /> {t.delete}</button>
      </div>
    </div>
  );
}

export function ClinicForm({ t, lang, initial, defaultDate, onBack, onSave }: {
  t: ClinicText;
  lang: Lang;
  defaultDate: string;
  initial: ClinicAppointment | null;
  onBack: () => void;
  onSave: (appointment: ClinicAppointment) => void;
}) {
  const hospitals = useHospitals();
  const [form, setForm] = useState(() => ({
    patientName: initial?.patientName ?? "",
    clinic: initial?.clinic ?? "",
    buildingNumber: initial?.buildingNumber ?? "",
    apartmentNumber: initial?.apartmentNumber ?? "",
    mobile: initial?.mobile === "-" ? "" : initial?.mobile ?? "",
    appointmentDate: initial?.appointmentDate ?? defaultDate,
    appointmentAt: initial?.appointmentAt ?? "09:00",
    kind: initial?.kind ?? "عادي" as AppointmentKind,
    assistance: initial?.assistance ?? [] as AssistanceNeed[],
  }));

  function toggleAssistance(need: AssistanceNeed) {
    setForm((current) => ({
      ...current,
      assistance: current.assistance.includes(need) ? current.assistance.filter((item) => item !== need) : [...current.assistance, need],
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.patientName.trim() || !form.clinic.trim() || !form.buildingNumber.trim() || !form.apartmentNumber.trim() || !form.mobile || !form.appointmentDate || !form.appointmentAt) {
      toast.error(t.errIncomplete);
      return;
    }
    const mobile = form.mobile.replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(mobile)) {
      toast.error(t.errMobile);
      return;
    }
    if (!requestWindow(form).open) {
      toast.error(t.errPast(REQUEST_GRACE_MINUTES));
      return;
    }
    const clinic = form.clinic.trim();
    onSave({
      ...form,
      patientName: form.patientName.trim(),
      buildingNumber: form.buildingNumber.trim(),
      apartmentNumber: form.apartmentNumber.trim(),
      clinic,
      hospitalId: matchHospital(clinic, hospitals)?.id,
      mobile,
      id: initial?.id ?? `APT-${Date.now().toString().slice(-6)}`,
      status: initial?.status ?? WAITING,
    });
  }

  const BackIcon = t.dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-bold text-[#a61d2d]"><BackIcon className="h-4 w-4" /> {t.back}</button>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_8px_30px_rgba(25,45,85,.04)] sm:p-8">
        <h2 className="text-2xl font-bold">{initial ? t.editTitle : t.newTitle}</h2>
        <form onSubmit={submit} className="mt-7 grid gap-4 sm:grid-cols-2">
          <Field label={t.patient} value={form.patientName} onChange={(value) => setForm({ ...form, patientName: value })} wide />
          <Field label={t.hospital} value={form.clinic} onChange={(value) => setForm({ ...form, clinic: value })} placeholder={t.hospitalHint} list="hospital-options" wide />
          <datalist id="hospital-options">{hospitals.map((hospital) => <option key={hospital.id} value={lang === "en" ? hospital.nameEn || hospital.name : hospital.name} />)}</datalist>
          <Field label={t.building} value={form.buildingNumber} onChange={(value) => setForm({ ...form, buildingNumber: value })} dir="ltr" />
          <Field label={t.apartment} value={form.apartmentNumber} onChange={(value) => setForm({ ...form, apartmentNumber: value })} dir="ltr" />
          <Field label={t.mobile} value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
          <div className="sm:col-span-2"><DateChooser label={t.date} value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} labels={t.dateChoice} /></div>
          <Field label={t.time} value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 block text-xs font-bold text-slate-600">{t.tripType}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["عادي", "احتياجات خاصة"] as AppointmentKind[]).map((kind) => (
                <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind })} className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-bold transition ${form.kind === kind ? "border-[#d88994] bg-[#fff1f2] text-[#861b2a]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                  {kind === "احتياجات خاصة" ? <Accessibility className="h-5 w-5" /> : <Truck className="h-5 w-5" />}{t.kind(kind)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className="mb-2 block text-xs font-bold text-slate-600">{t.needs}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["يحتاج مرافق", "كرسي متحرك"] as AssistanceNeed[]).map((need) => {
                const selected = form.assistance.includes(need);
                return (
                  <label key={need} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-bold transition ${selected ? "border-[#a8d9cf] bg-[#effbf8] text-[#176d5f]" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleAssistance(need)} className="h-4 w-4 accent-[#a61d2d]" />
                    {t.need(need)}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-3 sm:col-span-2">
            <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> {initial ? t.saveChanges : t.save}</button>
            <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-600">{t.cancel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
