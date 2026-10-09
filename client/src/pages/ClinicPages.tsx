import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Accessibility,
  AlertTriangle,
  ArrowLeft,
  Ban,
  ArrowRight,
  Baby,
  Building2,
  CalendarDays,
  CarFront,
  CalendarPlus,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPlus,
  Clock3,
  Download,
  EyeOff,
  FileSpreadsheet,
  Filter,
  House,
  Languages,
  Lock,
  Ribbon,
  Pencil,
  X,
  Trash2,
  Truck,
  Upload,
  Undo2,
  UserRoundSearch,
  UsersRound,
  Search,
  BriefcaseMedical,
  ArrowLeftRight,
} from "lucide-react";
import {
  APPOINTMENT_TYPES,
  ASSISTANCE_NEEDS,
  ESCORT_NEED,
  GENDERS,
  appointmentTypeText,
  approvalOf,
  destinationLabels,
  guestAlerts,
  isReturnOnly,
  isDirectRequest,
  isHospitalTransfer,
  hospitalTransferSource,
  directStatus,
  localDateString,
  parseImportedAppointments,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  sameDayAppointments,
  escortLocked,
  normalizeAppointmentType,
  statusText,
  withMinorEscort,
  type AppointmentKind,
  type Approval,
  type AssistanceNeed,
  type ClinicAppointment,
  type Gender,
  type VehicleRequest,
} from "@shared/transport";
import { matchHospital, normalizePlaceName, type Hospital } from "@shared/hospitals";
import { guestIndex, guestOfAppointment, hasPrivateCar, hasSpecialNeeds, isMinor, isNurse, searchGuests, type Guest } from "@shared/guests";
import { Badge, DateChooser, EmptyState, Field, Panel, PageHeader, Segmented, Stat, StatusBadge, StatusBar, btn, choiceClass, cx, formatDay, inputClass, labelClass, longDate } from "@/components/ui-kit";
import { FILTER_LABELS_AR, FILTER_LABELS_EN, FilterTable, useColumnFilters, type FilterColumn } from "@/components/ExcelFilter";
import { cancelReasonText, enableTranslation, hasArabic, useCancelReason } from "@/lib/translate";
import type { ClinicText, Lang } from "@/lib/i18n";
import { useGuests, useHospitals, useNow } from "@/lib/useShared";

const WAITING = "بانتظار طلب السيارة";

/**
 * اسم الضيف والوجهة بلغة الواجهة: بالإنجليزية اسم الضيف الإنجليزي من قائمة ضيوف المجمع واسم المستشفى الإنجليزي
 * من الدليل (وإلا الاسم كما حُفظ في الموعد)، وبالعربية كما في الموعد.
 */
export function useAppointmentNames(lang: Lang, guests: Guest[], hospitals: Hospital[]) {
  const index = useMemo(() => guestIndex(guests), [guests]);
  return useMemo(() => ({
    guest: (appointment: ClinicAppointment) => (lang === "en" ? guestOfAppointment(index, appointment)?.nameEn || appointment.patientName : appointment.patientName),
    place: (appointment: ClinicAppointment) => (lang === "en" ? destinationLabels(appointment, hospitals).en : appointment.clinic),
  }), [lang, index, hospitals]);
}

export function ClinicHome({ t, lang, appointments, date, onDateChange, onNew, onEdit, onDelete, onImport, lead = false, onApproval, canChange, requestOf }: {
  t: ClinicText;
  lang: Lang;
  appointments: ClinicAppointment[];
  date: string;
  onDateChange: (date: string) => void;
  /** return: طلب عودة فقط من المستشفى، وtransfer: نقل من مستشفى إلى مستشفى، بنفس نموذج الموعد */
  onNew: (kind?: "return" | "transfer") => void;
  onEdit: (appointment: ClinicAppointment) => void;
  onDelete: (appointment: ClinicAppointment) => void;
  onImport: (appointments: ClinicAppointment[]) => void;
  /** مسؤول العيادة: يوافق على المواعيد أو يستبعدها أو يرجعها (واحدًا واحدًا أو المحدد معًا)، ويرى التنبيهات */
  lead?: boolean;
  /** الحالة الجديدة لكل موعد (رقم الموعد ← الحالة)، في حفظ واحد */
  onApproval?: (changes: Record<string, Approval>) => void;
  /** يمكن تعديله أو حذفه: لم يُطلب له سيارة، أو طلب عودة لم تُرسل سيارته بعد */
  canChange?: (appointment: ClinicAppointment) => boolean;
  /** طلب سيارة الموعد (لطلب العودة: حالة سيارته) */
  requestOf?: (appointment: ClinicAppointment) => VehicleRequest | undefined;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const hospitals = useHospitals();
  const guests = useGuests();
  const now = useNow();
  // بالإنجليزية: اسم الضيف من قائمة ضيوف المجمع واسم المستشفى من الدليل (وإلا كما كُتب)
  const names = useAppointmentNames(lang, guests, hospitals);
  // ضيف يسكن في شقة لها سيارة خاصة (لموعد أُضيف قبل رفع قائمة السيارات الخاصة)
  const guestsIndex = useMemo(() => guestIndex(guests), [guests]);
  const privateCarOf = (appointment: ClinicAppointment) => hasPrivateCar(guestOfAppointment(guestsIndex, appointment));

  async function importExcel(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) throw new Error("empty workbook");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" });
      // الموعد لضيف من قائمة ضيوف المجمع ولمستشفى من الدليل فقط
      const result = parseImportedAppointments(rows, appointments, Date.now(), localDateString(), hospitals, guests);
      // أسباب رفض الصفوف (مكتوبة بالعربية في المنطق المشترك)، وبالإنجليزية شرح القاعدة
      const reasons = <span className="whitespace-pre-line">{t.dir === "rtl" ? result.errors.slice(0, 4).join("\n") : t.importGuestsHint}</span>;
      if (!result.appointments.length) {
        toast.error(t.importNone, { description: reasons, duration: 12000 });
        return;
      }
      if (!window.confirm(t.importFound(result.appointments.length))) return;
      onImport(result.appointments);
      toast.success(t.imported(result.appointments.length));
      if (result.errors.length) toast.warning(t.skipped(result.errors.length), { description: reasons, duration: 12000 });
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
        // اختياري: من القائمة أو أي نوع آخر
        "نوع الموعد": "مراجعة",
        "رقم المبنى": "12",
        "رقم الشقة": "4",
        "رقم الموبايل": "55123456",
        "تاريخ الموعد": localDateString(),
        "وقت الموعد": "09:30",
        "نوع الرحلة": "عادي",
        "احتياجات الضيف": "يحتاج مرافق، يحتاج Nurse، كرسي متحرك",
        "الجنس": "ذكر",
        "حالة سرطان": "لا",
        // نعم: طلب عودة فقط من المستشفى («وقت الموعد» وقت العودة)
        "عودة فقط": "لا",
        // نقل من مستشفى إلى مستشفى: اسم مستشفى الاستلام من الدليل (وإلا يبقى فارغًا)
        "من مستشفى": "",
      }]);
      worksheet["!cols"] = [{ wch: 22 }, { wch: 28 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 28 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "المواعيد");
      XLSX.writeFile(workbook, "appointments-template.xlsx");
      toast.success(t.templateDone);
    } catch {
      toast.error(t.templateError);
    }
  }

  const today = localDateString(now);
  const dayAppointments = useMemo(() => appointments.filter((appointment) => appointment.appointmentDate === date), [appointments, date]);

  // الجدول: اليوم المختار أو كل الأيام، وفلترة كل عمود مثل Excel
  const [scope, setScope] = useState<"day" | "all">("day");
  const byDateTime = (a: ClinicAppointment, b: ClinicAppointment) => `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`);
  const rows = useMemo(() => (scope === "all" ? [...appointments] : dayAppointments).sort(byDateTime), [appointments, dayAppointments, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const separator = t.dir === "rtl" ? "، " : ", ";
  const expiredOf = (appointment: ClinicAppointment) => appointment.status === WAITING && !requestWindow(appointment, now).open;

  // الموافقة والتنبيهات: موعدان للضيف نفسه في نفس الوقت، أو في نفس المستشفى في وقتين مختلفين
  const alertsOf = useMemo(() => new Map(rows.map((appointment) => [appointment.id, guestAlerts(appointment, appointments)])), [rows, appointments]);
  const alertValue = (appointment: ClinicAppointment) => Array.from(new Set((alertsOf.get(appointment.id) ?? [])
    .map((alert) => (alert.kind === "sameTime" ? t.alertSameTimeValue : t.alertSameHospitalValue)))).join(separator);
  const approvalTone = { pending: "amber", approved: "green", excluded: "neutral" } as const;
  const pendingOf = (appointment: ClinicAppointment) => approvalOf(appointment) === "pending" && appointment.status === WAITING;

  /** موافقة أو استبعاد أو إرجاع لموعد أو أكثر في حفظ واحد، مع «تراجع» يعيد كل موعد إلى حالته السابقة */
  function changeApproval(list: ClinicAppointment[], approval: Approval) {
    if (!list.length) return;
    const previous = Object.fromEntries(list.map((appointment) => [appointment.id, approvalOf(appointment)]));
    onApproval?.(Object.fromEntries(list.map((appointment) => [appointment.id, approval])));
    const message = approval === "approved" ? t.approvedToast(list.length) : approval === "excluded" ? t.excludedToast(list.length) : t.restoredToast(list.length);
    toast.success(message, {
      action: { label: t.undo, onClick: () => { onApproval?.(previous); toast.success(t.undone); } },
      duration: 8000,
    });
  }
  const setApproval = (appointment: ClinicAppointment, approval: Approval) => changeApproval([appointment], approval);

  const approvalColumn: FilterColumn<ClinicAppointment> = {
    key: "approval",
    label: t.cols.approval,
    value: (a) => (isDirectRequest(a) ? t.noApproval : t.approvalStates[approvalOf(a)]),
    cell: (a) => {
      // طلب العودة من المستشفى والنقل من مستشفى لا يمران بالموافقة
      if (isDirectRequest(a)) return <Badge tone="cyan" icon={Truck}>{t.noApproval}</Badge>;
      const state = approvalOf(a);
      const by = state === "approved" ? a.approvedBy && t.approvedByText(a.approvedBy) : state === "excluded" ? a.excludedBy && t.excludedByText(a.excludedBy) : "";
      return (
        <div className={cx("flex flex-col gap-1.5", lead && "min-w-[176px]")}>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={approvalTone[state]} icon={state === "approved" ? CheckCircle2 : state === "excluded" ? EyeOff : Clock3}>{t.approvalStates[state]}</Badge>
          </span>
          {by && <span className="text-[11px] text-slate-400">{by}</span>}
          {lead && a.status === WAITING && !isDirectRequest(a) && (
            <span className="flex flex-wrap gap-1.5">
              {state === "pending" && <button type="button" onClick={() => setApproval(a, "approved")} className={btn("success", "sm")}><Check className="h-3.5 w-3.5" /> {t.approve}</button>}
              {state !== "excluded" && <button type="button" onClick={() => setApproval(a, "excluded")} className={cx(btn("ghost", "sm"), "text-slate-600")}><EyeOff className="h-3.5 w-3.5" /> {t.exclude}</button>}
              {state === "excluded" && <button type="button" onClick={() => setApproval(a, "pending")} className={btn("secondary", "sm")}><Undo2 className="h-3.5 w-3.5" /> {t.restore}</button>}
            </span>
          )}
        </div>
      );
    },
  };
  const alertsColumn: FilterColumn<ClinicAppointment> = {
    key: "alerts",
    label: t.cols.alerts,
    value: alertValue,
    cell: (a) => {
      const alerts = alertsOf.get(a.id) ?? [];
      if (!alerts.length) return <span className="text-slate-300">—</span>;
      return (
        <ul className="min-w-[190px] max-w-[260px] space-y-1 whitespace-normal">
          {alerts.map((alert) => (
            <li key={alert.other.id} className={cx("flex items-start gap-1 rounded-lg px-2 py-1 text-[11px] leading-4 ring-1 ring-inset",
              alert.kind === "sameTime" ? "bg-red-50 text-red-800 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200")}>
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>{alert.kind === "sameTime" ? t.alertSameTime(alert.other.appointmentAt, names.place(alert.other), alert.gap) : t.alertSameHospital(alert.other.appointmentAt)}</span>
            </li>
          ))}
        </ul>
      );
    },
  };

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
      value: (a) => names.guest(a),
      cell: (a) => (
        <div className="min-w-[160px] max-w-[260px] whitespace-normal">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
            <bdi>{names.guest(a)}</bdi>
            {a.nurse && <Badge tone="violet" icon={BriefcaseMedical}>{t.nurse}</Badge>}
            {a.cancer && <Badge tone="red" icon={Ribbon}>{t.priority}</Badge>}
            {privateCarOf(a) && <Badge tone="red" icon={CarFront} title={t.privateCarHint}>{t.privateCarBadge}</Badge>}
          </p>
          {sameDayAppointments(a, appointments)
            // لمسؤول العيادة: الموعد الذي عليه تنبيه يظهر في عمود التنبيهات فقط
            .filter((other) => !lead || !(alertsOf.get(a.id) ?? []).some((alert) => alert.other.id === other.id))
            .map((other) => (
            <p key={other.id} className="mt-1 flex items-start gap-1 text-[11px] leading-4 text-cyan-800"><CalendarPlus className="mt-px h-3 w-3 shrink-0" /> {t.otherSameDay(other.appointmentAt, names.place(other))}</p>
          ))}
          {a.returnedSelf && <p className="mt-1 text-[11px] leading-4 text-emerald-700">{t.returnedSelf(a.returnedSelfBy)}</p>}
        </div>
      ),
    },
    {
      // موعد (ذهاب وعودة)، أو طلب عودة فقط من المستشفى
      key: "type",
      label: t.cols.type,
      value: (a) => t.requestType(isReturnOnly(a), isHospitalTransfer(a)),
      cell: (a) => (isReturnOnly(a)
        ? <span className="flex flex-col gap-1"><Badge tone="cyan" icon={House}>{t.returnOnly}</Badge><span className="max-w-[200px] whitespace-normal text-[11px] leading-4 text-slate-500">{t.returnTo(names.place(a))}</span></span>
        : isHospitalTransfer(a)
          ? <span className="flex flex-col gap-1"><Badge tone="cyan" icon={ArrowLeftRight}>{t.transferBadge}</Badge><span className="max-w-[200px] whitespace-normal text-[11px] leading-4 text-slate-500">{t.transferFromText(names.place(hospitalTransferSource(a)))}</span></span>
          : <span className="text-slate-500">{t.requestType(false)}</span>),
    },
    approvalColumn,
    ...(lead ? [alertsColumn] : []),
    { key: "gender", label: t.cols.gender, value: (a) => (a.gender ? t.genderLabel(a.gender) : "") },
    { key: "building", label: t.cols.building, value: (a) => a.buildingNumber, cell: (a) => <span className="tabular">{a.buildingNumber}</span> },
    { key: "apartment", label: t.cols.apartment, value: (a) => a.apartmentNumber, cell: (a) => <span className="tabular">{a.apartmentNumber}</span> },
    { key: "mobile", label: t.cols.mobile, value: (a) => (a.mobile === "-" ? "" : a.mobile), cell: (a) => (a.mobile && a.mobile !== "-" ? <span dir="ltr" className="tabular">{a.mobile}</span> : <span className="text-slate-300">—</span>) },
    { key: "destination", label: t.cols.destination, value: (a) => names.place(a), cell: (a) => <span className="block max-w-[220px] whitespace-normal">{names.place(a)}</span> },
    {
      key: "appointmentType",
      label: t.cols.appointmentType,
      value: (a) => appointmentTypeText(a.appointmentType, lang),
      cell: (a) => (a.appointmentType ? <span className="block max-w-[160px] whitespace-normal">{appointmentTypeText(a.appointmentType, lang)}</span> : <span className="text-slate-300">—</span>),
    },
    { key: "kind", label: t.cols.kind, value: (a) => t.kind(a.kind) },
    { key: "needs", label: t.cols.needs, value: (a) => a.assistance.map(t.need).join(separator), cell: (a) => (a.assistance.length ? <span className="block max-w-[180px] whitespace-normal text-xs">{a.assistance.map(t.need).join(separator)}</span> : <span className="text-slate-300">—</span>) },
    {
      key: "status",
      label: t.cols.status,
      value: (a) => (expiredOf(a) ? t.expiredShort : t.status(a.status)),
      cell: (a) => {
        if (expiredOf(a)) return <Badge tone="red">{t.expiredShort}</Badge>;
        // طلب العودة: حالة سيارته (بانتظار سيارة، أُرسلت، استُلم الضيف...)
        const request = isDirectRequest(a) && a.status === directStatus(a) ? requestOf?.(a) : undefined;
        if (request) return <span className="flex flex-col gap-1"><StatusBadge status={request.status} label={t.requestStatus(request.status)} />{request.vehiclePlate && <span dir="ltr" className="text-[11px] text-slate-500 tabular">{request.vehiclePlate}</span>}</span>;
        return <StatusBadge status={a.status} label={t.status(a.status)} />;
      },
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
        const editable = canChange ? canChange(a) : a.status === WAITING;
        return (
          <div className="flex gap-1.5">
            <button disabled={!editable} title={editable ? t.edit : t.lockedHint} aria-label={`${t.edit} ${names.guest(a)}`} onClick={() => onEdit(a)} className={cx(btn(expiredOf(a) ? "primary" : "secondary", "sm"), "w-9 px-0")}><Pencil className="h-3.5 w-3.5" /></button>
            <button disabled={!editable} title={editable ? t.delete : t.lockedHint} aria-label={`${t.delete} ${names.guest(a)}`} onClick={() => onDelete(a)} className={cx(btn("danger", "sm"), "w-9 px-0")}><Trash2 className="h-3.5 w-3.5" /></button>
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
        "نوع الموعد": appointment.appointmentType ?? "",
        "رقم المبنى": appointment.buildingNumber,
        "رقم الشقة": appointment.apartmentNumber,
        "رقم الموبايل": appointment.mobile,
        "تاريخ الموعد": appointment.appointmentDate,
        "وقت الموعد": appointment.appointmentAt,
        "نوع الرحلة": appointment.kind,
        ...Object.fromEntries(ASSISTANCE_NEEDS.map((need) => [need, yesNo(appointment.assistance.includes(need))])),
        "حالة سرطان": yesNo(Boolean(appointment.cancer)),
        "عودة فقط": yesNo(isReturnOnly(appointment)),
        "من مستشفى": appointment.fromClinic ?? "",
        "الحالة": statusText(appointment.status),
        "الموافقة": ({ pending: "بانتظار الموافقة", approved: "موافق عليه", excluded: "مستبعد" } as const)[approvalOf(appointment)],
        "سبب الإلغاء": appointment.cancelReason ?? "",
        "ألغاه": appointment.cancelledBy ?? "",
      }));
      const worksheet = XLSX.utils.json_to_sheet(rows);
      worksheet["!cols"] = [14, 24, 8, 30, 16, 10, 10, 14, 13, 10, 14, 12, 12, 12, 12, 10, 28, 20, 28, 18].map((wch) => ({ wch }));
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
  // مسؤول العيادة: عدادات الموافقة لليوم المختار، والضغط يفلتر الجدول
  const active = dayAppointments.filter((appointment) => appointment.status !== "ملغي" && !isDirectRequest(appointment));
  const countOf = (approval: Approval) => active.filter((appointment) => approvalOf(appointment) === approval).length;
  const dayAlerts = active.filter((appointment) => guestAlerts(appointment, appointments).length > 0).length;
  const showOnly = (key: string, values: string[]) => {
    table.clear();
    setScope("day");
    table.setFilter(key, values);
  };

  // التحديد (لمسؤول العيادة): مواعيد لم يُطلب لها سيارة بعد، ومن المعروض فقط؛ ما تخفيه الفلاتر أو تغيّرت حالته يخرج من التحديد
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const canSelect = (appointment: ClinicAppointment) => appointment.status === WAITING && !isDirectRequest(appointment);
  useEffect(() => {
    setSelected((current) => {
      if (!current.size) return current;
      const visible = new Set(shown.filter(canSelect).map((appointment) => appointment.id));
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [shown]);
  const chosen = lead ? shown.filter((appointment) => canSelect(appointment) && selected.has(appointment.id)) : [];
  // كل زر على ما يناسبه من المحدد: الموافقة لما ينتظرها (لا تعيد المستبعد)، والاستبعاد لغير المستبعد، والإرجاع للمستبعد
  const toApprove = chosen.filter(pendingOf);
  const toExclude = chosen.filter((appointment) => approvalOf(appointment) !== "excluded");
  const toRestore = chosen.filter((appointment) => approvalOf(appointment) === "excluded");
  function applyToSelected(list: ClinicAppointment[], approval: Approval) {
    if (approval === "approved") {
      const withAlerts = list.filter((appointment) => (alertsOf.get(appointment.id) ?? []).length > 0).length;
      if (withAlerts && !window.confirm(t.confirmApprove(list.length, withAlerts))) return;
    }
    changeApproval(list, approval);
    setSelected(new Set());
  }
  return (
    <>
      <PageHeader
        title={t.title}
        subtitle={<>{longDate(date, lang)}{date === today ? ` · ${t.days.today}` : ""}{lead ? ` · ${t.leadHint}` : ""}</>}
        actions={(
          <>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(event) => importExcel(event.target.files?.[0])} />
            <button onClick={downloadTemplate} className={btn("ghost")}><Download className="h-4 w-4" /> {t.template}</button>
            <button disabled={importing} onClick={() => fileInputRef.current?.click()} className={btn("secondary")}><Upload className="h-4 w-4" /> {importing ? t.importing : t.import}</button>
            <button onClick={exportAppointments} className={btn("secondary")}><FileSpreadsheet className="h-4 w-4" /> {t.exportExcel}</button>
            <button onClick={() => onNew("transfer")} className={btn("secondary")}><ArrowLeftRight className="h-4 w-4" /> {t.addTransfer}</button>
            <button onClick={() => onNew("return")} className={btn("secondary")}><House className="h-4 w-4" /> {t.addReturn}</button>
            <button onClick={() => onNew()} className={btn("primary")}><ClipboardPlus className="h-4 w-4" /> {t.add}</button>
          </>
        )}
      />

      <div className="mb-6"><DateChooser value={date} onChange={onDateChange} labels={t.dateChoice} /></div>

      {lead ? (
        <div className="mb-6">
          <StatusBar
            label={t.statusBarLabel}
            items={[
              { key: "pending", label: t.statPending, value: countOf("pending"), tone: "amber", hint: t.statPendingHint, onClick: () => showOnly("approval", [t.approvalStates.pending]) },
              { key: "approved", label: t.statApproved, value: countOf("approved"), tone: "green", hint: t.statApprovedHint, onClick: () => showOnly("approval", [t.approvalStates.approved]) },
              { key: "excluded", label: t.statExcluded, value: countOf("excluded"), tone: "neutral", hint: t.statExcludedHint, onClick: () => showOnly("approval", [t.approvalStates.excluded]) },
              { key: "alerts", label: t.statAlerts, value: dayAlerts, tone: "red", hint: t.statAlertsHint, onClick: () => showOnly("alerts", table.optionsFor("alerts").map((option) => option.value).filter(Boolean)) },
            ]}
          />
        </div>
      ) : (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <Stat icon={CalendarDays} tone="neutral" label={date === today ? t.statToday : t.statDate} value={dayAppointments.length} />
          <Stat icon={Clock3} tone="amber" label={t.statWaiting} value={waiting} />
          <Stat icon={Truck} tone="blue" label={t.statLinked} value={dayAppointments.length - waiting - cancelled} />
          <Stat icon={Ban} tone="red" label={t.statCancelled} value={cancelled} />
        </div>
      )}

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
          rowClassName={(a) => (a.status === "ملغي" ? "bg-red-50/40" : approvalOf(a) === "excluded" ? "bg-slate-50 opacity-70" : undefined)}
          labels={lang === "en" ? FILTER_LABELS_EN : FILTER_LABELS_AR}
          dir={t.dir}
          empty={<EmptyState icon={filtering ? Filter : UsersRound} title={filtering || rows.length ? t.noResults : t.empty} />}
          selection={lead ? {
            selected,
            onChange: setSelected,
            canSelect,
            allLabel: t.selectAll,
            rowLabel: (a) => t.selectRow(names.guest(a)),
            lockedHint: t.selectLocked,
          } : undefined}
        />
      </Panel>

      {/* شريط المحدد: ثابت أسفل الشاشة ما دام هناك مواعيد محددة */}
      {chosen.length > 0 && (
        <>
          <div aria-hidden="true" className="h-24" />
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[55] flex justify-center px-4">
            <div role="region" aria-label={t.selectionLabel} className="animate-rise pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl bg-navy-900 p-2 ps-4 text-white shadow-raised ring-1 ring-white/10">
              <span className="me-1 flex items-center gap-2 text-sm font-semibold">
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/15 px-1.5 text-xs tabular">{chosen.length}</span>
                {t.selectedCount(chosen.length)}
              </span>
              <button type="button" disabled={!toApprove.length} title={t.approveSelectedHint} onClick={() => applyToSelected(toApprove, "approved")} className={btn("success", "sm")}>
                <Check className="h-3.5 w-3.5" /> {t.approveSelected(toApprove.length)}
              </button>
              <button type="button" disabled={!toExclude.length} title={t.excludeSelectedHint} onClick={() => applyToSelected(toExclude, "excluded")} className={btn("secondary", "sm")}>
                <EyeOff className="h-3.5 w-3.5" /> {t.excludeSelected(toExclude.length)}
              </button>
              {toRestore.length > 0 && (
                <button type="button" title={t.restoreSelectedHint} onClick={() => applyToSelected(toRestore, "pending")} className={btn("secondary", "sm")}>
                  <Undo2 className="h-3.5 w-3.5" /> {t.restoreSelected(toRestore.length)}
                </button>
              )}
              <button type="button" onClick={() => setSelected(new Set())} aria-label={t.clearSelection} title={t.clearSelection} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
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

export function ClinicForm({ t, lang, initial, defaultDate, returnOnly = false, transfer = false, onBack, onSave }: {
  t: ClinicText;
  lang: Lang;
  defaultDate: string;
  initial: ClinicAppointment | null;
  /** طلب عودة فقط من المستشفى: نفس النموذج، والمستشفى مكان الاستلام والوقت وقت العودة، بلا موعد ثانٍ */
  returnOnly?: boolean;
  /** نقل من مستشفى إلى مستشفى: مستشفى الاستلام ومستشفى الموعد، بلا موعد ثانٍ */
  transfer?: boolean;
  onBack: () => void;
  /** موعد واحد، أو موعدان لنفس الضيف في نفس اليوم يُضافان معًا */
  onSave: (appointments: ClinicAppointment[]) => void;
}) {
  const hospitals = useHospitals();
  // الموعد لضيف من قائمة ضيوف المجمع ولمستشفى من الدليل فقط
  const guests = useGuests();
  const index = useMemo(() => guestIndex(guests), [guests]);
  /** «غدًا» أو التاريخ بلغة الواجهة */
  const dayName = (date: string) => {
    const label = formatDay(date, new Date(), t.days);
    return label === date ? longDate(date, lang) : label;
  };
  const [form, setForm] = useState(() => {
    const guest = initial ? guestOfAppointment(index, initial) : undefined;
    const hospital = initial ? hospitals.find((item) => item.id === initial.hospitalId) ?? matchHospital(initial.clinic, hospitals) : null;
    return {
      guestId: guest?.id ?? "",
      hospitalId: hospital?.id ?? "",
      fromHospitalId: initial?.fromClinic ? hospitals.find((item) => item.id === initial.fromHospitalId)?.id ?? matchHospital(initial.fromClinic, hospitals)?.id ?? "" : "",
      mobile: initial?.mobile === "-" ? "" : initial?.mobile ?? "",
      // طلب العودة والنقل من مستشفى لضيف في المستشفى الآن: اليوم افتراضيًا (لا اليوم المختار في القائمة، مثل الغد لمسؤول العيادة)
      appointmentDate: initial?.appointmentDate ?? (returnOnly || transfer ? localDateString() : defaultDate),
      appointmentAt: initial?.appointmentAt ?? "09:00",
      kind: initial?.kind ?? "عادي" as AppointmentKind,
      // الضيف أقل من 18 سنة: المرافق إلزامي إلا مع Nurse
      assistance: withMinorEscort(initial?.assistance ?? [], isMinor(guest)),
      gender: initial?.gender ?? guest?.gender,
      cancer: initial?.cancer ?? false,
      appointmentType: initial?.appointmentType ?? "",
    };
  });
  const guest = form.guestId ? index.byId.get(form.guestId) : undefined;
  const minor = isMinor(guest);
  // موعد ثانٍ لنفس الضيف في نفس اليوم (عند الإضافة فقط)
  const [second, setSecond] = useState({ enabled: false, hospitalId: "", appointmentAt: "", appointmentType: "" });

  function selectGuest(next: Guest | undefined) {
    setForm((current) => {
      const previous = current.guestId ? index.byId.get(current.guestId) : undefined;
      // هاتف الضيف من القائمة، إلا إذا كتبت العيادة رقمًا آخر
      const mobile = !current.mobile || current.mobile === previous?.mobile ? next?.mobile ?? "" : current.mobile;
      // من ذوي الاحتياجات الخاصة (موعد جديد): نوع الرحلة «احتياجات خاصة» و«كرسي متحرك»، ويمكن تغييرهما
      const special = !initial && hasSpecialNeeds(next);
      const assistance = withMinorEscort(current.assistance, isMinor(next));
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
      toast.error(t.errGuest);
      return;
    }
    if (hasPrivateCar(guest)) {
      toast.error(t.privateCar);
      return;
    }
    const fromHospital = transfer ? hospitals.find((item) => item.id === form.fromHospitalId) : undefined;
    if (transfer && !fromHospital) {
      toast.error(t.errTransferFrom);
      return;
    }
    const hospital = hospitals.find((item) => item.id === form.hospitalId);
    if (!hospital) {
      toast.error(t.errHospital);
      return;
    }
    if (fromHospital && fromHospital.id === hospital.id) {
      toast.error(t.errTransferSame);
      return;
    }
    if (!form.mobile || !form.appointmentDate || !form.appointmentAt) {
      toast.error(t.errIncomplete);
      return;
    }
    const mobile = form.mobile.replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(mobile)) {
      toast.error(t.errMobile);
      return;
    }
    // طلب العودة يمكن تسجيله طوال يومه (ولو مضى وقت العودة)، والموعد حتى 30 دقيقة بعد وقته
    if (!requestWindow({ ...form, returnOnly }).open) {
      toast.error(returnOnly ? t.errPastDay : t.errPast(REQUEST_GRACE_MINUTES));
      return;
    }
    if (!form.gender) {
      toast.error(t.errGender);
      return;
    }
    // طلب العودة أو النقل ليوم غير اليوم: يُسأل أولًا (الطلب يصل إلى مشرف السيارات لذلك اليوم، لا سيارة اليوم)
    if ((returnOnly || transfer) && form.appointmentDate !== localDateString() && !window.confirm(t.directNotTodayConfirm(dayName(form.appointmentDate)))) return;
    const secondHospital = hospitals.find((item) => item.id === second.hospitalId);
    if (second.enabled && !initial && !returnOnly && !transfer) {
      if (!secondHospital || !second.appointmentAt) {
        toast.error(secondHospital ? t.errSecondIncomplete : t.errSecondHospital);
        return;
      }
      if (second.appointmentAt <= form.appointmentAt) {
        toast.error(t.errSecondOrder);
        return;
      }
    }
    const stamp = Date.now().toString().slice(-6);
    const appointmentType = normalizeAppointmentType(form.appointmentType);
    const first: ClinicAppointment = {
      id: initial?.id ?? `APT-${stamp}`,
      guestId: guest.id,
      patientName: guest.name,
      clinic: hospital.name,
      hospitalId: hospital.id,
      buildingNumber: guest.buildingNumber,
      apartmentNumber: guest.apartmentNumber,
      mobile,
      appointmentDate: form.appointmentDate,
      appointmentAt: form.appointmentAt,
      kind: form.kind,
      assistance: withMinorEscort(form.assistance, minor),
      gender: form.gender,
      ...(form.cancer ? { cancer: true } : {}),
      ...(appointmentType ? { appointmentType } : {}),
      ...(returnOnly ? { returnOnly: true } : {}),
      ...(fromHospital ? { fromClinic: fromHospital.name, fromHospitalId: fromHospital.id } : {}),
      // ممرضة من قائمة الممرضات: تُعرف بها عند المشرفين والسائق
      ...(isNurse(guest) ? { nurse: true } : {}),
      status: initial?.status ?? WAITING,
    };
    if (!second.enabled || initial || returnOnly || transfer || !secondHospital) {
      onSave([first]);
      return;
    }
    // الموعد الثاني: نفس الضيف والتاريخ والاحتياجات، بمستشفى ووقت ونوع آخر
    const { appointmentType: _firstType, ...shared } = first;
    const secondType = normalizeAppointmentType(second.appointmentType);
    onSave([first, {
      ...shared,
      id: `APT-${stamp}-2`,
      clinic: secondHospital.name,
      hospitalId: secondHospital.id,
      appointmentAt: second.appointmentAt,
      ...(secondType ? { appointmentType: secondType } : {}),
    }]);
  }

  const BackIcon = t.dir === "rtl" ? ArrowRight : ArrowLeft;
  const notListed = initial && !form.guestId && !guest ? initial.patientName : "";
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className={cx(btn("ghost", "sm"), "mb-4 -ms-2")}><BackIcon className="h-4 w-4" /> {t.back}</button>
      <Panel
        tone={returnOnly || transfer ? "cyan" : "brand"}
        icon={returnOnly ? House : transfer ? ArrowLeftRight : ClipboardPlus}
        title={returnOnly ? (initial ? t.editReturnTitle : t.newReturnTitle) : transfer ? (initial ? t.editTransferTitle : t.newTransferTitle) : initial ? t.editTitle : t.newTitle}
        description={initial ? initial.id : undefined}
      >
        <form onSubmit={submit} className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
          {returnOnly && (
            <p className="flex items-start gap-2.5 rounded-xl bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-900 ring-1 ring-inset ring-cyan-200 sm:col-span-2">
              <House className="mt-1 h-4 w-4 shrink-0" /> {t.returnHint}
            </p>
          )}
          {transfer && (
            <p className="flex items-start gap-2.5 rounded-xl bg-cyan-50 px-4 py-3 text-sm leading-6 text-cyan-900 ring-1 ring-inset ring-cyan-200 sm:col-span-2">
              <ArrowLeftRight className="mt-1 h-4 w-4 shrink-0" /> {t.transferHint}
            </p>
          )}
          <GuestPicker t={t} guests={guests} guest={guest} onSelect={selectGuest} notListed={notListed} />
          {hasSpecialNeeds(guest) && <SpecialNeedsNote t={t} chosen={!initial} />}
          {transfer && <HospitalSelect id="hospital-from" label={t.transferFrom} value={form.fromHospitalId} onChange={(fromHospitalId) => setForm({ ...form, fromHospitalId })} hospitals={hospitals} lang={lang} placeholder={t.hospitalChoose} noMatch={t.hospitalNoMatch} wide />}
          <HospitalSelect id="hospital-first" label={returnOnly ? t.returnHospital : transfer ? t.transferTo : t.hospital} value={form.hospitalId} onChange={(hospitalId) => setForm({ ...form, hospitalId })} hospitals={hospitals} lang={lang} placeholder={t.hospitalChoose} noMatch={t.hospitalNoMatch} wide />
          <Field label={t.mobile} value={form.mobile} onChange={(value) => setForm({ ...form, mobile: value })} type="tel" dir="ltr" wide />
          {!guest?.gender && <fieldset className="sm:col-span-2">
            <legend className={labelClass}>{t.gender}</legend>
            <div className="grid grid-cols-2 gap-3">
              {GENDERS.map((gender: Gender) => (
                <button key={gender} type="button" aria-pressed={form.gender === gender} onClick={() => setForm({ ...form, gender })} className={choiceClass(form.gender === gender)}>{t.genderLabel(gender)}</button>
              ))}
            </div>
          </fieldset>}
          <div className="sm:col-span-2">
            <DateChooser label={returnOnly ? t.returnDate : t.date} value={form.appointmentDate} onChange={(value) => setForm({ ...form, appointmentDate: value })} labels={t.dateChoice} />
            {/* طلب العودة والنقل يصلان مباشرة إلى مشرف السيارات: «اليوم»، وتنبيه إن اختير يوم آخر */}
            {(returnOnly || transfer) && (form.appointmentDate === localDateString()
              ? <p className="mt-2 text-xs leading-5 text-slate-500">{t.directTodayHint}</p>
              : (
                <p role="alert" className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium leading-6 text-amber-900 ring-1 ring-inset ring-amber-300">
                  <AlertTriangle className="mt-1 h-4 w-4 shrink-0" /> {t.directNotToday(dayName(form.appointmentDate))}
                </p>
              ))}
          </div>
          <Field label={returnOnly ? t.returnTime : t.time} value={form.appointmentAt} onChange={(value) => setForm({ ...form, appointmentAt: value })} type="time" />
          <AppointmentTypeField id="appointment-type" t={t} lang={lang} value={form.appointmentType} onChange={(appointmentType) => setForm((current) => ({ ...current, appointmentType }))} />

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

          <NeedsField t={t} value={form.assistance} minor={minor} onChange={(assistance) => setForm((current) => ({ ...current, assistance }))} />

          <label className={cx(choiceClass(form.cancer), "cursor-pointer sm:col-span-2")}>
            <input type="checkbox" checked={form.cancer} onChange={(event) => setForm({ ...form, cancer: event.target.checked })} className="h-4 w-4 accent-brand-600" />
            <Ribbon className="h-4 w-4" /> {t.cancer}
            <span className="text-xs font-normal text-slate-500">· {t.cancerHint}</span>
          </label>

          {!initial && !returnOnly && !transfer && (
            <fieldset className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink">
                <input type="checkbox" checked={second.enabled} onChange={(event) => setSecond({ ...second, enabled: event.target.checked })} className="h-4 w-4 accent-brand-600" />
                <CalendarPlus className="h-4 w-4 text-slate-500" /> {t.secondToggle}
              </label>
              {second.enabled && (
                <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                  <HospitalSelect id="hospital-second" label={`${t.secondTitle} · ${t.hospital}`} value={second.hospitalId} onChange={(hospitalId) => setSecond({ ...second, hospitalId })} hospitals={hospitals} lang={lang} placeholder={t.hospitalChoose} noMatch={t.hospitalNoMatch} />
                  <Field label={`${t.secondTitle} · ${t.time}`} value={second.appointmentAt} onChange={(value) => setSecond({ ...second, appointmentAt: value })} type="time" />
                  <AppointmentTypeField id="appointment-type-second" t={t} lang={lang} label={`${t.secondTitle} · ${t.appointmentType}`} value={second.appointmentType} onChange={(appointmentType) => setSecond((current) => ({ ...current, appointmentType }))} className="sm:col-span-2" />
                  <p className="text-xs leading-5 text-slate-500 sm:col-span-2">{t.secondHint}</p>
                </div>
              )}
            </fieldset>
          )}

          <div className="flex gap-3 border-t border-slate-100 pt-5 sm:col-span-2">
            <button className={cx(btn("primary", "lg"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> {initial ? t.saveChanges : returnOnly ? t.saveReturn : transfer ? t.saveTransfer : t.save}</button>
            <button type="button" onClick={onBack} className={btn("secondary", "lg")}>{t.cancel}</button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

/** ملاحظة «احتياجات خاصة» عند تسجيل موعد لضيف من قائمة ذوي الاحتياجات الخاصة */
export function SpecialNeedsNote({ t, chosen }: { t: ClinicText; chosen: boolean }) {
  return (
    <p role="note" className="flex items-start gap-2.5 rounded-xl bg-violet-50 px-4 py-3 text-sm leading-6 text-violet-900 ring-1 ring-inset ring-violet-200 sm:col-span-2">
      <Accessibility className="mt-1 h-4 w-4 shrink-0" />
      <span><span className="font-semibold">{t.specialNeedsNote}</span>{chosen ? ` ${t.specialNeedsChosen}` : ""}</span>
    </p>
  );
}

const TYPE_OTHER = "__other";

/**
 * نوع الموعد (اختياري): من القائمة الجاهزة، أو «أخرى» ويُكتب. القيمة نوع القائمة بالعربية أو النص المكتوب،
 * وفارغة بلا تحديد.
 */
function AppointmentTypeField({ id, t, lang, label, value, onChange, className }: {
  id: string;
  t: ClinicText;
  lang: Lang;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const preset = APPOINTMENT_TYPES.some((type) => type.ar === value);
  const [other, setOther] = useState(() => Boolean(value) && !preset);
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label ?? t.appointmentType} <span className="text-xs font-normal text-slate-400">({t.optional})</span>
      </label>
      <select
        id={id}
        value={other ? TYPE_OTHER : preset ? value : ""}
        onChange={(event) => {
          const next = event.target.value;
          setOther(next === TYPE_OTHER);
          onChange(next === TYPE_OTHER ? "" : next);
        }}
        className={inputClass}
      >
        <option value="">{t.appointmentTypeNone}</option>
        {APPOINTMENT_TYPES.map((type) => <option key={type.ar} value={type.ar}>{lang === "en" ? type.en : type.ar}</option>)}
        <option value={TYPE_OTHER}>{t.appointmentTypeOther}</option>
      </select>
      {other && (
        <input
          autoFocus
          aria-label={t.appointmentTypeOtherLabel}
          value={value}
          maxLength={60}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t.appointmentTypeOtherPlaceholder}
          className={cx(inputClass, "mt-2")}
        />
      )}
    </div>
  );
}

/**
 * احتياجات الضيف. الضيف أقل من 18 سنة (minor): يُضاف المرافق تلقائيًا ولا يُزال إلا إذا اختير «يحتاج Nurse»،
 * وإزالة الـ Nurse تعيد المرافق.
 */
export function NeedsField({ t, value, onChange, minor, columns = "sm:grid-cols-3" }: {
  t: ClinicText;
  value: AssistanceNeed[];
  onChange: (assistance: AssistanceNeed[]) => void;
  minor: boolean;
  columns?: string;
}) {
  const locked = escortLocked(value, minor);
  function toggle(need: AssistanceNeed) {
    const next = value.includes(need) ? value.filter((item) => item !== need) : [...value, need];
    onChange(withMinorEscort(next, minor));
  }
  return (
    <fieldset className="sm:col-span-2">
      <legend className={labelClass}>{t.needs}</legend>
      <div className={cx("grid gap-3", columns)}>
        {ASSISTANCE_NEEDS.map((need) => {
          const selected = value.includes(need);
          const fixed = need === ESCORT_NEED && locked;
          return (
            <label key={need} title={fixed ? t.minorEscortLocked : undefined} className={cx(choiceClass(selected), fixed ? "cursor-not-allowed" : "cursor-pointer")}>
              <input type="checkbox" checked={selected} disabled={fixed} onChange={() => toggle(need)} className="h-4 w-4 accent-brand-600" />
              {t.need(need)}
              {fixed && <Lock aria-hidden="true" className="ms-auto h-3.5 w-3.5 text-slate-400" />}
            </label>
          );
        })}
      </div>
      {minor && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">
          <Baby className="mt-0.5 h-4 w-4 shrink-0" /> {t.minorEscortHint}
        </p>
      )}
    </fieldset>
  );
}

/** ترتيب أرقام المباني والشقق: الأرقام بترتيبها ثم R1 وR2 */
const byUnit = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * اختيار الضيف من قائمة ضيوف المجمع: بحث بالاسم (العربي أو الإنجليزي أو الهاتف)، أو بالمبنى والشقة
 * لمن كُتب اسمه بطريقة مختلفة. القائمة تظهر تحت الحقول وتضيق مع كل اختيار.
 */
export function GuestPicker({ t, guests, guest, onSelect, notListed }: {
  t: ClinicText;
  guests: Guest[];
  guest?: Guest;
  onSelect: (guest: Guest | undefined) => void;
  /** اسم ضيف موعد قديم غير موجود في القائمة الحالية */
  notListed?: string;
}) {
  const [query, setQuery] = useState("");
  const [building, setBuilding] = useState("");
  const [apartment, setApartment] = useState("");
  const [active, setActive] = useState(0);
  // آخر ضيف اختير وهو صاحب سيارة خاصة أو من عائلته: لا يُختار، وتظهر رسالة المنع
  const [blocked, setBlocked] = useState<Guest | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buildings = useMemo(() => Array.from(new Set(guests.map((item) => item.buildingNumber))).sort(byUnit), [guests]);
  const apartments = useMemo(() => (building
    ? Array.from(new Set(guests.filter((item) => item.buildingNumber === building).map((item) => item.apartmentNumber))).sort(byUnit)
    : []), [guests, building]);
  const searching = query.trim().length >= 2;
  const filtering = searching || Boolean(building);
  const results = useMemo(() => {
    if (!filtering) return [];
    const inUnit = guests.filter((item) => (!building || item.buildingNumber === building) && (!apartment || item.apartmentNumber === apartment));
    return searching
      ? searchGuests(inUnit, query, inUnit.length)
      : [...inUnit].sort((a, b) => byUnit(a.apartmentNumber, b.apartmentNumber) || a.name.localeCompare(b.name, "ar"));
  }, [guests, building, apartment, query, searching, filtering]);
  const shown = results.slice(0, 30);
  const listId = "guest-options";
  // بالإنجليزية: الاسم الإنجليزي أولًا والعربي تحته
  const english = t.dir === "ltr";
  const mainName = (item: Guest) => (english ? item.nameEn || item.name : item.name);
  const otherName = (item: Guest) => (english ? (item.nameEn ? item.name : "") : item.nameEn);
  /** صاحب السيارة الخاصة ومن يسكن معه في نفس الشقة لا يُضاف لهم موعد */
  function choose(item: Guest) {
    if (hasPrivateCar(item)) {
      setBlocked(item);
      toast.error(t.privateCar, { description: mainName(item), duration: 8000 });
      return;
    }
    setBlocked(null);
    onSelect(item);
  }
  const privateCarAlert = (item: Guest) => (
    <p role="alert" className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-800 ring-1 ring-inset ring-red-200">
      <CarFront className="mt-0.5 h-4 w-4 shrink-0" /> <span><bdi>{mainName(item)}</bdi>: {t.privateCar}</span>
    </p>
  );

  if (guest) {
    return (
      <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-slate-500">{t.guest}</p>
            <p className="mt-0.5 font-semibold text-ink"><bdi>{mainName(guest)}</bdi></p>
            {otherName(guest) && <p className="text-xs text-slate-500"><bdi>{otherName(guest)}</bdi></p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {isNurse(guest) && <Badge tone="violet" icon={BriefcaseMedical}>{t.nurse}{guest.organization ? ` · ${guest.organization}` : ""}</Badge>}
              <Badge tone="neutral" icon={Building2}>{t.guestUnit(guest.buildingNumber, guest.apartmentNumber)}</Badge>
              {guest.gender && <Badge tone="neutral">{t.genderLabel(guest.gender)}</Badge>}
              {isMinor(guest) && <Badge tone="amber" icon={Baby}>{t.minor}</Badge>}
              {hasPrivateCar(guest) && <Badge tone="red" icon={CarFront}>{t.privateCarBadge}</Badge>}
              {hasSpecialNeeds(guest) && <Badge tone="violet" icon={Accessibility}>{t.specialNeedsBadge}</Badge>}
            </div>
            {/* موعد سابق لضيف أُضيفت شقته إلى السيارات الخاصة */}
            {hasPrivateCar(guest) && privateCarAlert(guest)}
            <p className="mt-2 text-[11px] leading-4 text-slate-400">{t.guestFromList}</p>
          </div>
          <button type="button" onClick={() => { onSelect(undefined); requestAnimationFrame(() => inputRef.current?.focus()); }} className={btn("secondary", "sm")}>
            <UserRoundSearch className="h-4 w-4" /> {t.guestChange}
          </button>
        </div>
      </div>
    );
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && shown.length) {
      event.preventDefault();
      setActive((current) => (current + (event.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    } else if (event.key === "Enter") {
      // Enter يختار الضيف ولا يرسل النموذج
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    }
  }

  const small = "mb-1 block text-[11px] font-medium text-slate-500";
  const selectClass = (on: boolean) => cx(inputClass, on && "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200");
  return (
    <fieldset className="sm:col-span-2">
      <legend className={labelClass}>{t.guest}</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_140px_140px]">
        <label className="col-span-2 block sm:col-span-1">
          <span className={small}>{t.guestByName}</span>
          <span className="relative block">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              id="guest-search"
              role="combobox"
              aria-label={t.guest}
              aria-expanded={filtering && shown.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtering && shown[active] ? `guest-${shown[active].id}` : undefined}
              autoComplete="off"
              disabled={!guests.length}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0); setBlocked(null); }}
              onKeyDown={onKeyDown}
              placeholder={t.guestSearch}
              className={cx(inputClass, "ps-10")}
            />
          </span>
        </label>
        <label className="block">
          <span className={small}>{t.building}</span>
          <select value={building} disabled={!guests.length} onChange={(event) => { setBuilding(event.target.value); setApartment(""); setActive(0); }} className={selectClass(Boolean(building))}>
            <option value="">{t.allBuildings}</option>
            {buildings.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={small}>{t.apartment}</span>
          <select value={apartment} disabled={!building} onChange={(event) => { setApartment(event.target.value); setActive(0); }} className={selectClass(Boolean(apartment))}>
            <option value="">{t.allApartments}</option>
            {apartments.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      {filtering && (
        <div className="mt-2 overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-1.5 text-[11px] text-slate-500">
            <span>{t.guestsFound(results.length)}</span>
            <button type="button" onClick={() => { setQuery(""); setBuilding(""); setApartment(""); inputRef.current?.focus(); }} className="rounded-md px-1.5 py-0.5 font-semibold text-slate-600 hover:bg-slate-200/70">{t.guestClear}</button>
          </div>
          <ul id={listId} role="listbox" aria-label={t.guest} className="max-h-72 overflow-y-auto p-1.5">
            {shown.length ? shown.map((item, position) => (
              <li
                key={item.id}
                id={`guest-${item.id}`}
                role="option"
                aria-selected={position === active}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(position)}
                className={cx("flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2", position === active ? "bg-brand-50" : "hover:bg-slate-50")}
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
                    <span className="truncate"><bdi>{mainName(item)}</bdi></span>
                    {isNurse(item) && <Badge tone="violet" icon={BriefcaseMedical} className="shrink-0">{t.nurse}</Badge>}
                    {hasPrivateCar(item) && <Badge tone="red" icon={CarFront} className="shrink-0" title={t.privateCarHint}>{t.privateCarBadge}</Badge>}
                    {hasSpecialNeeds(item) && <Badge tone="violet" icon={Accessibility} className="shrink-0">{t.specialNeedsBadge}</Badge>}
                  </span>
                  {otherName(item) && <span className="block truncate text-xs text-slate-500"><bdi>{otherName(item)}</bdi></span>}
                </span>
                <span className="shrink-0 text-xs text-slate-500 tabular">{t.guestUnit(item.buildingNumber, item.apartmentNumber)}</span>
              </li>
            )) : <li className="px-3 py-3 text-center text-sm text-slate-500">{t.guestNoMatch}</li>}
            {results.length > shown.length && <li className="px-3 py-2 text-center text-[11px] text-slate-400">{t.guestMore(results.length - shown.length)}</li>}
          </ul>
        </div>
      )}
      {blocked && privateCarAlert(blocked)}
      {!guests.length
        ? <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">{t.guestListEmpty}</p>
        : notListed
          ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">{t.guestNotListed(notListed)}</p>
          : !filtering && <p className="mt-1.5 text-[11px] text-slate-400">{t.guestSearchHint}</p>}
    </fieldset>
  );
}

/**
 * المستشفى من دليل المستشفيات فقط: الكتابة تفلتر القائمة (بالاسم العربي أو الإنجليزي أو الأسماء البديلة)،
 * والأسهم وEnter للاختيار. بالإنجليزية في الواجهة الإنجليزية.
 */
function HospitalSelect({ id, label, value, onChange, hospitals, lang, placeholder, noMatch, wide }: {
  id: string;
  label: string;
  value: string;
  onChange: (hospitalId: string) => void;
  hospitals: Hospital[];
  lang: Lang;
  placeholder: string;
  noMatch: string;
  wide?: boolean;
}) {
  // null: لا يكتب المستخدم الآن، فيظهر اسم المستشفى المختار
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const nameOf = (hospital: Hospital) => (lang === "en" ? hospital.nameEn || hospital.name : hospital.name);
  const otherName = (hospital: Hospital) => (lang === "en" ? hospital.name : hospital.nameEn);
  const sorted = useMemo(() => [...hospitals].sort((a, b) => nameOf(a).localeCompare(nameOf(b), lang)), [hospitals, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const selected = hospitals.find((hospital) => hospital.id === value);
  const open = query !== null;
  const matches = useMemo(() => {
    const key = normalizePlaceName(query ?? "");
    if (!key) return sorted;
    // المطابقة في الاسم نفسه أولًا، ثم في الأسماء البديلة
    const rank = (hospital: Hospital) => ([hospital.name, hospital.nameEn].some((name) => normalizePlaceName(name).includes(key)) ? 0
      : hospital.aliases.some((name) => normalizePlaceName(name).includes(key)) ? 1 : 2);
    return sorted.map((hospital) => ({ hospital, rank: rank(hospital) })).filter((item) => item.rank < 2)
      .sort((a, b) => a.rank - b.rank).map((item) => item.hospital);
  }, [query, sorted]);

  // الخيار النشط ظاهر عند التنقل بالأسهم
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(hospital: Hospital) {
    onChange(hospital.id);
    setQuery(null);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setQuery("");
        setActive(0);
      } else if (matches.length) {
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && matches[active]) choose(matches[active]);
    } else if (event.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <div className={cx("relative", wide && "sm:col-span-2")}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${id}-${matches[active].id}` : undefined}
          autoComplete="off"
          value={open ? query : selected ? nameOf(selected) : ""}
          // عند الكتابة يبقى اسم المختار ظاهرًا كتلميح
          placeholder={selected ? nameOf(selected) : placeholder}
          onFocus={() => { setQuery(""); setActive(Math.max(0, sorted.findIndex((hospital) => hospital.id === value))); }}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onBlur={() => setQuery(null)}
          onKeyDown={onKeyDown}
          className={cx(inputClass, "ps-10 pe-9", selected && !open && "font-medium")}
        />
        <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <ul ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl bg-white p-1.5 shadow-raised ring-1 ring-slate-900/10">
          {matches.length ? matches.map((hospital, position) => (
            <li
              key={hospital.id}
              id={`${id}-${hospital.id}`}
              data-index={position}
              role="option"
              aria-selected={hospital.id === value}
              // قبل أن يفقد الحقل التركيز فتُغلق القائمة
              onMouseDown={(event) => { event.preventDefault(); choose(hospital); }}
              onMouseEnter={() => setActive(position)}
              className={cx("flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2", position === active ? "bg-brand-50" : "hover:bg-slate-50")}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{nameOf(hospital)}</span>
                {otherName(hospital) && <span className="block truncate text-xs text-slate-500"><bdi>{otherName(hospital)}</bdi></span>}
              </span>
              {hospital.id === value && <Check className="h-4 w-4 shrink-0 text-brand-600" />}
            </li>
          )) : <li className="px-3 py-3 text-center text-sm text-slate-500">{noMatch}</li>}
        </ul>
      )}
    </div>
  );
}
