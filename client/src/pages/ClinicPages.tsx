import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  ArrowLeft,
  Ban,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ClipboardPlus,
  Clock3,
  Download,
  FileSpreadsheet,
  Filter,
  Languages,
  Ribbon,
  Pencil,
  X,
  Trash2,
  Truck,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  ASSISTANCE_NEEDS,
  GENDERS,
  localDateString,
  parseImportedAppointments,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  sameDayAppointments,
  statusText,
  type AppointmentKind,
  type AssistanceNeed,
  type ClinicAppointment,
  type Gender,
} from "@shared/transport";
import { matchHospital } from "@shared/hospitals";
import { Badge, DateChooser, EmptyState, Field, Panel, PageHeader, Segmented, Stat, StatusBadge, btn, choiceClass, cx, formatDay, labelClass, longDate } from "@/components/ui-kit";
import { FILTER_LABELS_AR, FILTER_LABELS_EN, FilterTable, useColumnFilters, type FilterColumn } from "@/components/ExcelFilter";
import { cancelReasonText, enableTranslation, hasArabic, useCancelReason } from "@/lib/translate";
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
        "احتياجات الضيف": "يحتاج مرافق، يحتاج Nurse، كرسي متحرك",
        "الجنس": "ذكر",
        "حالة سرطان": "لا",
      }]);
      worksheet["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 12 }];
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

  // الجدول: اليوم المختار أو كل الأيام، وفلترة كل عمود مثل Excel
  const [scope, setScope] = useState<"day" | "all">("day");
  const byDateTime = (a: ClinicAppointment, b: ClinicAppointment) => `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`);
  const rows = useMemo(() => (scope === "all" ? [...appointments] : dayAppointments).sort(byDateTime), [appointments, dayAppointments, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const separator = t.dir === "rtl" ? "، " : ", ";
  const expiredOf = (appointment: ClinicAppointment) => appointment.status === WAITING && !requestWindow(appointment, now).open;
  const columns: FilterColumn<ClinicAppointment>[] = [
    ...(scope === "all" ? [{
      key: "date",
      label: t.cols.date,
      value: (a: ClinicAppointment) => a.appointmentDate,
      cell: (a: ClinicAppointment) => <span className="whitespace-nowrap text-xs"><span dir="ltr" className="tabular">{a.appointmentDate}</span><span className="block text-slate-400">{formatDay(a.appointmentDate, now, t.days)}</span></span>,
    }] : []),
    {
      key: "time",
      label: t.cols.time,
      value: (a) => a.appointmentAt,
      cell: (a) => <span dir="ltr" className={cx("font-semibold tabular", expiredOf(a) ? "text-red-600" : "text-ink")}>{a.appointmentAt}</span>,
    },
    {
      key: "guest",
      label: t.cols.guest,
      value: (a) => a.patientName,
      cell: (a) => (
        <div className="min-w-[160px] max-w-[260px] whitespace-normal">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
            {a.patientName}
            {a.cancer && <Badge tone="red" icon={Ribbon}>{t.priority}</Badge>}
          </p>
          {sameDayAppointments(a, appointments).map((other) => (
            <p key={other.id} className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-cyan-800"><CalendarPlus className="mt-px h-3 w-3 shrink-0" /> {t.otherSameDay(other.appointmentAt, other.clinic)}</p>
          ))}
          {a.returnedSelf && <p className="mt-1 text-[11px] leading-4 text-emerald-700">{t.returnedSelf(a.returnedSelfBy)}</p>}
        </div>
      ),
    },
    { key: "gender", label: t.cols.gender, value: (a) => (a.gender ? t.genderLabel(a.gender) : "") },
    { key: "building", label: t.cols.building, value: (a) => a.buildingNumber, cell: (a) => <span className="tabular">{a.buildingNumber}</span> },
    { key: "apartment", label: t.cols.apartment, value: (a) => a.apartmentNumber, cell: (a) => <span className="tabular">{a.apartmentNumber}</span> },
    { key: "mobile", label: t.cols.mobile, value: (a) => (a.mobile === "-" ? "" : a.mobile), cell: (a) => (a.mobile && a.mobile !== "-" ? <span dir="ltr" className="tabular">{a.mobile}</span> : <span className="text-slate-300">—</span>) },
    { key: "destination", label: t.cols.destination, value: (a) => a.clinic, cell: (a) => <span className="block max-w-[220px] whitespace-normal">{a.clinic}</span> },
    { key: "kind", label: t.cols.kind, value: (a) => t.kind(a.kind) },
    { key: "needs", label: t.cols.needs, value: (a) => a.assistance.map(t.need).join(separator), cell: (a) => (a.assistance.length ? <span className="block max-w-[180px] whitespace-normal text-xs">{a.assistance.map(t.need).join(separator)}</span> : <span className="text-slate-300">—</span>) },
    {
      key: "status",
      label: t.cols.status,
      value: (a) => (expiredOf(a) ? t.expiredShort : t.status(a.status)),
      cell: (a) => (expiredOf(a) ? <Badge tone="red">{t.expiredShort}</Badge> : <StatusBadge status={a.status} label={t.status(a.status)} />),
    },
    {
      key: "reason",
      label: t.cols.reason,
      value: (a) => (a.status === "ملغي" ? cancelReasonText(a.cancelReason, lang) : ""),
      cell: (a) => <CancelReason t={t} lang={lang} appointment={a} />,
    },
    { key: "id", label: t.cols.id, value: (a) => a.id, cell: (a) => <span dir="ltr" className="text-xs text-slate-400">{a.id}</span> },
    {
      key: "actions",
      label: t.cols.actions,
      filterable: false,
      cell: (a) => {
        const editable = a.status === WAITING;
        return (
          <div className="flex gap-1.5">
            <button disabled={!editable} title={editable ? t.edit : t.lockedHint} aria-label={`${t.edit} ${a.patientName}`} onClick={() => onEdit(a)} className={cx(btn(expiredOf(a) ? "primary" : "secondary", "sm"), "w-9 px-0")}><Pencil className="h-3.5 w-3.5" /></button>
            <button disabled={!editable} title={editable ? t.delete : t.lockedHint} aria-label={`${t.delete} ${a.patientName}`} onClick={() => onDelete(a)} className={cx(btn("danger", "sm"), "w-9 px-0")}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        );
      },
      value: () => "",
    },
  ];
  const table = useColumnFilters(rows, columns);
  const shown = table.shown;
  const filtering = table.active > 0;

  /** تصدير المواعيد المعروضة (بعد البحث والفلترة) إلى Excel: كل خيار في عمود، وبعناوين القالب حتى يمكن استيراده. */
  async function exportAppointments() {
    if (!shown.length) {
      toast.error(t.exportNone);
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const yesNo = (value: boolean) => (value ? "نعم" : "لا");
      const rows = shown.map((appointment) => ({
        "رقم الموعد": appointment.id,
        "اسم الضيف أو الرقم": appointment.patientName,
        "الجنس": appointment.gender ?? "",
        "اسم العيادة أو المستشفى": appointment.clinic,
        "رقم المبنى": appointment.buildingNumber,
        "رقم الشقة": appointment.apartmentNumber,
        "رقم الموبايل": appointment.mobile,
        "تاريخ الموعد": appointment.appointmentDate,
        "وقت الموعد": appointment.appointmentAt,
        "نوع الرحلة": appointment.kind,
        ...Object.fromEntries(ASSISTANCE_NEEDS.map((need) => [need, yesNo(appointment.assistance.includes(need))])),
        "حالة سرطان": yesNo(Boolean(appointment.cancer)),
        "الحالة": statusText(appointment.status),
        "سبب الإلغاء": appointment.cancelReason ?? "",
        "ألغاه": appointment.cancelledBy ?? "",
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [14, 24, 8, 30, 10, 10, 14, 13, 10, 14, 12, 12, 12, 12, 20, 28, 18].map((wch) => ({ wch }));
      const workbook = XLSX.utils.book_new();
      workbook.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(workbook, worksheet, "المواعيد");
      const stamp = scope === "all" ? "all" : date;
      XLSX.writeFile(workbook, `appointments-${stamp}.xlsx`);
      toast.success(t.exported(shown.length));
    } catch {
      toast.error(t.templateError);
    }
  }
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
            <button onClick={exportAppointments} className={btn("secondary")}><FileSpreadsheet className="h-4 w-4" /> {t.exportExcel}</button>
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

      <Panel
        icon={UsersRound}
        title={t.list}
        count={shown.length}
        description={<>{scope === "all" ? t.scopeAll : longDate(date, lang)} · {filtering ? `${t.results(shown.length)} · ${t.filtersOn(table.active)}` : t.filterHint}</>}
        actions={(
          <>
            {(filtering || table.sort) && <button type="button" onClick={table.clear} className={btn("ghost", "sm")}><X className="h-4 w-4" /> {t.clearFilters}</button>}
            <Segmented size="sm" label={t.cols.date} value={scope} onChange={setScope} options={[{ value: "day", label: t.scopeDay }, { value: "all", label: t.scopeAll }]} />
          </>
        )}
      >
        <FilterTable
          rows={shown}
          columns={columns}
          state={table}
          rowKey={(a) => a.id}
          rowClassName={(a) => (a.status === "ملغي" ? "bg-red-50/40" : undefined)}
          labels={lang === "en" ? FILTER_LABELS_EN : FILTER_LABELS_AR}
          dir={t.dir}
          empty={<EmptyState icon={filtering ? Filter : UsersRound} title={filtering || rows.length ? t.noResults : t.empty} />}
        />
      </Panel>
    </>
  );
}

/** سبب الإلغاء بلغة الواجهة: الأسباب الجاهزة مترجمة، والمكتوب بالعربية بمترجم المتصفح على الجهاز إن توفر. */
function CancelReason({ t, lang, appointment }: { t: ClinicText; lang: Lang; appointment: ClinicAppointment }) {
  const reason = useCancelReason(appointment.cancelReason, lang);
  if (appointment.status !== "ملغي") return <span className="text-slate-300">—</span>;
  return (
    <div className="min-w-[160px] max-w-[260px] whitespace-normal text-xs leading-5 text-red-800">
      <span dir="auto" title={reason.original ?? undefined}>{reason.text || "—"}</span>
      {reason.machine && <span className="ms-1 text-[11px] text-slate-400">({t.machineTranslated})</span>}
      {lang === "en" && !reason.machine && hasArabic(reason.text) && (reason.canEnable
        ? (
          <button type="button" onClick={enableTranslation} className="ms-1.5 inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
            <Languages className="h-3 w-3" /> {t.translate}
          </button>
        )
        : <span className="ms-1 text-[11px] text-slate-400">({t.writtenInArabic})</span>)}
      {appointment.cancelledBy && <span className="block text-[11px] text-red-700/70">{t.cancelledBy(appointment.cancelledBy)}</span>}
    </div>
  );
}

export function ClinicForm({ t, lang, initial, defaultDate, onBack, onSave }: {
  t: ClinicText;
  lang: Lang;
  defaultDate: string;
  initial: ClinicAppointment | null;
  onBack: () => void;
  /** موعد واحد، أو موعدان لنفس الضيف في نفس اليوم يُضافان معًا */
  onSave: (appointments: ClinicAppointment[]) => void;
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
    gender: initial?.gender,
    cancer: initial?.cancer ?? false,
  }));
  // موعد ثانٍ لنفس الضيف في نفس اليوم (عند الإضافة فقط)
  const [second, setSecond] = useState({ enabled: false, clinic: "", appointmentAt: "" });

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
    if (!form.gender) {
      toast.error(t.errGender);
      return;
    }
    if (second.enabled && !initial) {
      if (!second.clinic.trim() || !second.appointmentAt) {
        toast.error(t.errSecondIncomplete);
        return;
      }
      if (second.appointmentAt <= form.appointmentAt) {
        toast.error(t.errSecondOrder);
        return;
      }
    }
    const clinic = form.clinic.trim();
    const stamp = Date.now().toString().slice(-6);
    const { cancer, gender, ...rest } = form;
    const first: ClinicAppointment = {
      ...rest,
      gender,
      ...(cancer ? { cancer: true } : {}),
      patientName: form.patientName.trim(),
      buildingNumber: form.buildingNumber.trim(),
      apartmentNumber: form.apartmentNumber.trim(),
      clinic,
      hospitalId: matchHospital(clinic, hospitals)?.id,
      mobile,
      id: initial?.id ?? `APT-${stamp}`,
      status: initial?.status ?? WAITING,
    };
    if (!second.enabled || initial) {
      onSave([first]);
      return;
    }
    // الموعد الثاني: نفس الضيف والتاريخ والاحتياجات، بمستشفى ووقت آخرين
    const secondClinic = second.clinic.trim();
    onSave([first, { ...first, id: `APT-${stamp}-2`, clinic: secondClinic, hospitalId: matchHospital(secondClinic, hospitals)?.id, appointmentAt: second.appointmentAt }]);
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
          <fieldset className="sm:col-span-2">
            <legend className={labelClass}>{t.gender}</legend>
            <div className="grid grid-cols-2 gap-3">
              {GENDERS.map((gender: Gender) => (
                <button key={gender} type="button" aria-pressed={form.gender === gender} onClick={() => setForm({ ...form, gender })} className={choiceClass(form.gender === gender)}>{t.genderLabel(gender)}</button>
              ))}
            </div>
          </fieldset>
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
            <div className="grid gap-3 sm:grid-cols-3">
              {ASSISTANCE_NEEDS.map((need) => {
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

          <label className={cx(choiceClass(form.cancer), "cursor-pointer sm:col-span-2")}>
            <input type="checkbox" checked={form.cancer} onChange={(event) => setForm({ ...form, cancer: event.target.checked })} className="h-4 w-4 accent-brand-600" />
            <Ribbon className="h-4 w-4" /> {t.cancer}
            <span className="text-xs font-normal text-slate-500">· {t.cancerHint}</span>
          </label>

          {!initial && (
            <fieldset className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
                <input type="checkbox" checked={second.enabled} onChange={(event) => setSecond({ ...second, enabled: event.target.checked })} className="h-4 w-4 accent-brand-600" />
                <CalendarPlus className="h-4 w-4 text-slate-500" /> {t.secondToggle}
              </label>
              {second.enabled && (
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <Field label={`${t.secondTitle} · ${t.hospital}`} value={second.clinic} onChange={(value) => setSecond({ ...second, clinic: value })} placeholder={t.hospitalHint} list="hospital-options" />
                  <Field label={`${t.secondTitle} · ${t.time}`} value={second.appointmentAt} onChange={(value) => setSecond({ ...second, appointmentAt: value })} type="time" />
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{t.secondHint}</p>
                </div>
              )}
            </fieldset>
          )}

          <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
            <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> {initial ? t.saveChanges : t.save}</button>
            <button type="button" onClick={onBack} className={btn("secondary", "lg")}>{t.cancel}</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
