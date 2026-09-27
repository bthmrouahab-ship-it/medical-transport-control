import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  ArrowLeft,
  Ban,
  ArrowRight,
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
import { Badge, DateChooser, EmptyState, Field, Panel, PageHeader, Stat, StatusBadge, TimeBlock, btn, choiceClass, cx, formatDay, labelClass, longDate } from "@/components/ui-kit";
import type { ClinicText, Lang } from "@/lib/i18n";
import { useHospitals, useNow } from "@/lib/useShared";

const WAITING = "بانتظار طلب السيارة";

export function ClinicHome({ t, lang, appointments, date, onDateChange, onNew, onEdit, onDelete, onImport }: {
  t: ClinicText;
  lang: Lang;
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
        "اسم الضيف أو الرقم": "ضيف 001",
        "اسم العيادة أو المستشفى": "مستشفى حمد العام",
        "رقم المبنى": "12",
        "رقم الشقة": "4",
        "رقم الموبايل": "55123456",
        "تاريخ الموعد": localDateString(),
        "وقت الموعد": "09:30",
        "نوع الرحلة": "عادي",
        "احتياجات الضيف": "يحتاج مرافق، كرسي متحرك",
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
  const waiting = dayAppointments.filter((appointment) => appointment.status === WAITING).length;
  const cancelled = dayAppointments.filter((appointment) => appointment.status === "ملغي").length;
  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={<>{longDate(date, lang)}{date === today ? ` · ${t.days.today}` : ""}</>}
        actions={(
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => importExcel(event.target.files?.[0])} />
            <button onClick={downloadTemplate} className={btn("ghost")}><Download className="h-4 w-4" /> {t.template}</button>
            <button disabled={importing} onClick={() => fileInputRef.current?.click()} className={btn("secondary")}><Upload className="h-4 w-4" /> {importing ? t.importing : t.import}</button>
            <button onClick={onNew} className={btn("primary")}><ClipboardPlus className="h-4 w-4" /> {t.add}</button>
          </>
        )}
      />

      <div className="mb-6"><DateChooser value={date} onChange={onDateChange} labels={t.dateChoice} /></div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat icon={CalendarDays} tone="neutral" label={date === today ? t.statToday : t.statDate} value={dayAppointments.length} />
        <Stat icon={Clock3} tone="amber" label={t.statWaiting} value={waiting} />
        <Stat icon={Truck} tone="blue" label={t.statLinked} value={dayAppointments.length - waiting - cancelled} />
        <Stat icon={Ban} tone="red" label={t.statCancelled} value={cancelled} />
      </div>

      <Panel icon={UsersRound} title={t.list} count={dayAppointments.length} description={longDate(date, lang)}>
        {dayAppointments.length ? (
          <div className="divide-y divide-slate-100">
            {dayAppointments.map((appointment) => <AppointmentCard key={appointment.id} t={t} appointment={appointment} now={now} onEdit={onEdit} onDelete={onDelete} />)}
          </div>
        ) : <EmptyState icon={UsersRound} title={t.empty} />}
      </Panel>
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
  const separator = t.dir === "rtl" ? "، " : ", ";
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <TimeBlock time={appointment.appointmentAt} day={formatDay(appointment.appointmentDate, now, t.days)} tone={expired ? "red" : "neutral"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{appointment.patientName}</p>
            <span dir="ltr" className="text-xs text-slate-400">{appointment.id}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{t.pickup(appointment.buildingNumber, appointment.apartmentNumber)} · {appointment.clinic}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>{t.kind(appointment.kind)}</span>
            {appointment.mobile && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span></span>}
            {appointment.assistance.length > 0 && <span className="inline-flex items-center gap-1"><Accessibility className="h-3.5 w-3.5" />{appointment.assistance.map(t.need).join(separator)}</span>}
          </p>
          {appointment.status === "ملغي" && (
            <p className="mt-2 w-fit rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              <span className="font-semibold">{t.cancelReason}:</span> {appointment.cancelReason || "—"}
              {appointment.cancelledBy && <span className="text-red-700/80"> · {t.cancelledBy(appointment.cancelledBy)}</span>}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {expired ? <Badge tone="red">{t.expired}</Badge> : <StatusBadge status={appointment.status} label={t.status(appointment.status)} />}
        <button disabled={!editable} title={editable ? t.edit : t.lockedHint} onClick={() => onEdit(appointment)} className={btn(expired ? "primary" : "secondary", "sm")}><Pencil className="h-3.5 w-3.5" /> {t.edit}</button>
        <button disabled={!editable} title={editable ? t.delete : t.lockedHint} onClick={() => onDelete(appointment)} className={btn("danger", "sm")}><Trash2 className="h-3.5 w-3.5" /> {t.delete}</button>
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
      <button onClick={onBack} className={cx(btn("ghost", "sm"), "mb-4 -ms-2")}><BackIcon className="h-4 w-4" /> {t.back}</button>
      <Panel tone="brand" icon={ClipboardPlus} title={initial ? t.editTitle : t.newTitle} description={initial ? initial.id : undefined}>
        <form onSubmit={submit} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          <Field label={t.patient} value={form.patientName} onChange={(value) => setForm({ ...form, patientName: value })} wide />
          <Field label={t.hospital} value={form.clinic} onChange={(value) => setForm({ ...form, clinic: value })} placeholder={t.hospitalHint} list="hospital-options" wide />
          <datalist id="hospital-options">{hospitals.map((hospital) => <option key={hospital.id} value={lang === "en" ? hospital.nameEn || hospital.name : hospital.name} />)}</datalist>
          <Field label={t.building} value={form.buildingNumber} onChange={(value) => setForm({ ...form, buildingNumber: value })} dir="ltr" />
          <Field label={t.apartment} value={form.apartmentNumber} onChange={(value) => setForm({ ...form, apartmentNumber: value })} dir="ltr" />
          <Field label={t.mobile} value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
          <div className="sm:col-span-2"><DateChooser label={t.date} value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} labels={t.dateChoice} /></div>
          <Field label={t.time} value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>{t.tripType}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["عادي", "احتياجات خاصة"] as AppointmentKind[]).map((kind) => (
                <button key={kind} type="button" aria-pressed={form.kind === kind} onClick={() => setForm({ ...form, kind })} className={choiceClass(form.kind === kind)}>
                  {kind === "احتياجات خاصة" ? <Accessibility className="h-5 w-5" /> : <Truck className="h-5 w-5" />}{t.kind(kind)}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>{t.needs}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(["يحتاج مرافق", "كرسي متحرك"] as AssistanceNeed[]).map((need) => {
                const selected = form.assistance.includes(need);
                return (
                  <label key={need} className={cx(choiceClass(selected), "cursor-pointer")}>
                    <input type="checkbox" checked={selected} onChange={() => toggleAssistance(need)} className="h-4 w-4 accent-brand-600" />
                    {t.need(need)}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
            <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> {initial ? t.saveChanges : t.save}</button>
            <button type="button" onClick={onBack} className={btn("secondary", "lg")}>{t.cancel}</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
