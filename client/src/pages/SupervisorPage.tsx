import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { goTo, reveal } from "@/lib/notify";
import { Accessibility, AlertTriangle, ArrowLeftRight, Ban, BellRing, BriefcaseMedical, Building2, Check, CheckCircle2, ChevronDown, Clock3, Footprints, Hospital, House, Link2, MapPin, MessageSquareWarning, Pencil, Flag, RotateCcw, ShieldCheck, Smartphone, Stethoscope, Timer, Truck, UserMinus, Users, XCircle } from "lucide-react";
import { NURSE_BUILDING } from "@shared/guests";
import { toWesternDigits } from "@shared/text";
import {
  CANCEL_REASONS,
  appointmentPickupLabel,
  calculateTripGroupingScore,
  canCancelAppointment,
  canRequestVehicle,
  findUnrequestedMatches,
  followsRequest,
  hasNurse,
  isNonMedical,
  localDateString,
  nextAppointmentOf,
  REQUEST_GRACE_MINUTES,
  RETURN_ONLY_LABEL,
  isReturnOnly,
  requestWindow,
  sameDayAppointments,
  personsText,
  requestPersons,
  appointmentTypeText,
  hospitalTransferSource,
  tripPersons,
  type ClinicAppointment,
  type UnrequestedMatch,
  type Vehicle,
  type VehicleRequest,
  transferSource,
  transferLabels,
  isHospitalTransfer,
} from "@shared/transport";
import { LATE_MINUTES, minutesSince, tripEndpoints, tripPhase, type TripPhase } from "@shared/trips";
import { distanceKm } from "@shared/hospitals";
import { checkLabel, countdownText, driverCheck, pendingCheck, type CheckKind, type DriverCheck } from "@shared/driverChecks";
import GuestContact from "@/components/GuestContact";
import { beep } from "@/lib/beep";
import {
  Badge,
  EmptyState,
  Expandable,
  Modal,
  Panel,
  PageHeader,
  StatusBar,
  Steps,
  TimeBlock,
  btn,
  byAppointmentTime,
  choiceClass,
  cx,
  formatDay,
  inputClass,
  labelClass,
  longDate,
  timeLabel,
} from "@/components/ui-kit";
import { useComplaints, useGuests, useHospitals, useLiveVehicles, useNow } from "@/lib/useShared";
import { CLINIC_TEXT, type Lang } from "@/lib/i18n";
import { cancelReasonText } from "@/lib/translate";
import { useAppointmentNames } from "./ClinicPages";
import { ComplaintForm, ComplaintList, ComplaintView, type ComplaintGuest } from "@/components/Complaints";
import { addComplaint, replyToReferral } from "@/lib/complaints";
import type { Complaint, ComplaintDraft } from "@shared/complaints";

/** فتح استمارة الشكوى من بطاقة الموعد (الضيف ورحلته معبأة) */
const ComplaintContext = createContext<((appointment: ClinicAppointment, request?: VehicleRequest, driver?: string) => void) | null>(null);

/** حالات الطلب قبل استلام المريض (السيارة لم تصل أو لم تُرسل بعد). */
const BEFORE_PICKUP: VehicleRequest["status"][] = ["بانتظار التوزيع", "تم إرسال السيارة", "وصلت السيارة"];
const OUTBOUND_STEPS = { ar: ["طُلبت السيارة", "أُرسلت", "وصلت السيارة", "استُلم الضيف", "الوجهة"], en: ["Car requested", "Sent", "Car arrived", "Picked up", "Destination"] };
const RETURN_STEPS = { ar: ["طُلبت العودة", "أُرسلت", "وصلت السيارة", "استُلم الضيف"], en: ["Return requested", "Sent", "Car arrived", "Picked up"] };
const NURSE_STEPS = { ar: ["طُلبت عودة الـ Nurse", "أُرسلت", "وصلت السيارة", "استُلمت الـ Nurse"], en: ["Nurse return requested", "Sent", "Car arrived", "Nurse picked up"] };
/** ضيوف ذهبوا في أيام سابقة ولم تُسجَّل عودتهم: يُنبَّه عنهم هذا العدد من الأيام */
export const UNRETURNED_DAYS = 7;


/**
 * لغة الصفحة: العربية دائمًا لمشرف المبنى، والإنجليزية لمسؤول العيادة في «سيارات الممرضات» إن اختارها في واجهة العيادة.
 * t(عربي، إنجليزي)، واسم الضيف والمستشفى بالإنجليزية من قائمة الضيوف والدليل.
 */
type PageText = {
  en: boolean;
  t: <T>(ar: T, en: T) => T;
  guest: (appointment: ClinicAppointment) => string;
  place: (appointment: ClinicAppointment) => string;
};
const ARABIC: PageText = { en: false, t: (ar) => ar, guest: (appointment) => appointment.patientName, place: (appointment) => appointment.clinic };
const TextContext = createContext<PageText>(ARABIC);
const useText = () => useContext(TextContext);

const requestStatusText = (status: string, en: boolean) => CLINIC_TEXT[en ? "en" : "ar"].requestStatus(status);
const personsLabel = (count: number, en: boolean) => (en ? `${count} ${count === 1 ? "person" : "people"}` : personsText(count));
const pickupLabel = (appointment: ClinicAppointment, en: boolean) => (en ? `Building ${appointment.buildingNumber}, Apt ${appointment.apartmentNumber}` : appointmentPickupLabel(appointment));
const directionLabel = (direction: VehicleRequest["direction"], en: boolean) => (en ? (direction === "عودة" ? "Return" : "Outbound") : direction);
const dayLabel = (date: string, now: Date, en: boolean) => formatDay(date, now, en ? { today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday" } : undefined);
const checkWhat = (kind: CheckKind, en: boolean) => (en ? (kind === "arrival" ? "car arrival" : "guest pickup") : checkLabel(kind));
/** ما سجّله السائق وحالته الآن (بانتظار التأكيد، أُكّد، قُبل تلقائيًا، نُفي) */
function checkLine(check: DriverCheck, en: boolean) {
  const what = checkWhat(check.kind, en);
  const by = check.by ? ` (${check.by})` : "";
  if (!en) {
    const label = checkLabel(check.kind);
    switch (check.state) {
      case "pending": return `${label}: بانتظار تأكيد مشرف المبنى`;
      case "confirmed": return `${label}: أكّده مشرف المبنى${by}`;
      case "auto": return `${label}: قُبل تلقائيًا`;
      case "denied": return `${label}: نفاه مشرف المبنى${by}`;
    }
  }
  const head = what.charAt(0).toUpperCase() + what.slice(1);
  switch (check.state) {
    case "pending": return `${head}: awaiting confirmation`;
    case "confirmed": return `${head}: confirmed${by}`;
    case "auto": return `${head}: accepted automatically`;
    case "denied": return `${head}: denied${by}`;
  }
}
/** عودة الـ Nurse فقط: الراكب هو الـ Nurse */
const riderText = (request: VehicleRequest | undefined, text: string) => (request?.nurseOnly ? text.replace("الضيف", "الـ Nurse").replace(/guest/g, "nurse") : text);

type Row = { appointment: ClinicAppointment; request?: VehicleRequest };
type Stage = "request" | "expired" | "progress" | "atAppointment";
export type RequestHandlers = {
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  /** بدل العودة إلى المجمع: نقل الضيف من هذا الموعد إلى موعده التالي في نفس اليوم */
  onTransfer: (appointment: ClinicAppointment, request: VehicleRequest, next: ClinicAppointment) => void;
  /** إلغاء الموعد نفسه (مع طلب السيارة القائم إن وُجد) بسبب مكتوب */
  onCancelAppointment: (appointment: ClinicAppointment, reason: string, request?: VehicleRequest) => void;
  /** الرد على ما سجّله السائق من تطبيقه (وصوله أو استلام الضيف): تأكيد أو نفي */
  onCheckReply: (request: VehicleRequest, kind: CheckKind, reply: "confirmed" | "denied") => void;
  /** عودة الـ Nurse وحدها إلى المجمع ويبقى الضيف في موعده */
  onNurseReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  /** الضيف عاد إلى المجمع بنفسه بلا سيارة عودة */
  onSelfReturn: (appointment: ClinicAppointment) => void;
  /** تصحيح رقم هاتف الضيف قبل طلب السيارة (إن كان خطأ) */
  onEditMobile: (appointment: ClinicAppointment, mobile: string) => void;
};

/** المباني التي يتابعها المشرف على هذا الجهاز (فارغة = كل المباني). */
const BUILDINGS_KEY = "fox_building_filter";

function loadBuildings(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(BUILDINGS_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function newRequest(appointment: ClinicAppointment): VehicleRequest {
  return {
    id: `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    appointmentId: appointment.id,
    // طلب العودة فقط من المستشفى: سيارة عودة إلى المجمع
    direction: isReturnOnly(appointment) ? "عودة" : "ذهاب",
    status: "بانتظار التوزيع",
    notificationMethod: "whatsapp",
    createdAt: timeLabel(new Date()),
  };
}

export function SupervisorHome({ uid, userName = "", lead = false, nurses = false, lang = "ar", appointments, requests, vehicles, onRequest, onUpdateRequest, onCancel, onReturn, onTransfer, onCancelAppointment, onCheckReply, onNurseReturn, onSelfReturn, onEditMobile }: {
  /** رقم حساب المشرف: يرى متابعة طلباته هو فقط */
  uid: string;
  /** اسم المشرف: في استمارة الشكوى */
  userName?: string;
  /** مسؤول مشرفي المباني: يتابع كل الطلبات (يؤكد وصول السيارة واستلام الضيف ويرد على السائق في أي طلب) */
  lead?: boolean;
  /** مسؤول العيادة: سيارات الممرضات (مبنى 03) فقط، ويتابع كل طلباتها */
  nurses?: boolean;
  /** لغة واجهة العيادة (لسيارات الممرضات فقط؛ صفحة مشرف المبنى بالعربية) */
  lang?: Lang;
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  /** السيارات: رقم هاتف سائق السيارة المرسلة للاتصال به */
  vehicles: Vehicle[];
} & RequestHandlers) {
  const [buildings, setBuildings] = useState<string[]>(loadBuildings);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  // الشكاوى: الاستمارة المفتوحة (معبأة من بطاقة الموعد أو فارغة)، والشكوى المعروضة
  const [complaintDraft, setComplaintDraft] = useState<Partial<ComplaintDraft> | null>(null);
  const [complaintId, setComplaintId] = useState<string | null>(null);
  const [showComplaints, setShowComplaints] = useState(false);
  // مشرف المبنى: الشكاوى التي سجّلها (وما حُوّل إليه من غيرها في «شكاوى محوّلة إليك»)، والمسؤول: كل الشكاوى
  const allComplaints = useComplaints();
  const complaints = lead ? allComplaints : allComplaints.filter((complaint) => complaint.createdBy === uid);
  const now = useNow();
  const hospitals = useHospitals();
  const liveGps = useLiveVehicles(now);
  const today = localDateString(now);
  const en = nurses && lang === "en";
  const guests = useGuests();
  const names = useAppointmentNames(en ? "en" : "ar", guests, hospitals);
  const text: PageText = en ? { en, t: (_ar, english) => english, guest: names.guest, place: names.place } : ARABIC;
  const { t } = text;

  // آخر طلب للضيف في كل موعد (الذهاب، ثم العودة إن طُلبت)؛ عودة الـ Nurse فقط تُتابَع وحدها
  const latest = new Map<string, VehicleRequest>();
  const nurseTrip = new Map<string, VehicleRequest>();
  for (const request of requests) (request.nurseOnly ? nurseTrip : latest).set(request.appointmentId, request);
  const phaseOf = (request: VehicleRequest) => tripPhase(request, now, Boolean(request.vehiclePlate && liveGps.has(request.vehiclePlate)));

  // مواعيد اليوم فقط، مع أي رحلة من يوم سابق لم يُستلم مريضها بعد (مثل عودة بعد منتصف الليل)
  const activeIds = new Set(requests.filter((request) => !request.nurseOnly && BEFORE_PICKUP.includes(request.status)).map((request) => request.appointmentId));
  const todays = appointments.filter((appointment) => appointment.appointmentDate === today
    || (appointment.appointmentDate < today && activeIds.has(appointment.id)));

  /**
   * أين يظهر الموعد الآن، أو null إن لم يكن لهذا المشرف:
   * - متابعة طلب الذهاب حتى وصول السيارة إلى الوجهة لمن طلبها فقط.
   * - بعد وصول الوجهة (مرضى في الموعد): لكل مشرفي المباني، وأي مشرف يطلب العودة.
   * - متابعة طلب العودة (وصول السيارة واستلام المريض) لمن طلبها فقط.
   * مسؤول مشرفي المباني يتابع كل الطلبات.
   */
  const follows = (request: VehicleRequest) => lead || followsRequest(request, uid);
  // الموعد الذي طُلب نقل ضيفه إلى موعده التالي يُتابَع من الموعد التالي
  const transferredFrom = new Set(requests.flatMap((request) => (request.fromAppointmentId ? [request.fromAppointmentId] : [])));
  const fromOf = (request?: VehicleRequest) => (request ? transferSource(request, appointments) : null);
  const stageOf = (appointment: ClinicAppointment): Stage | null => {
    if (transferredFrom.has(appointment.id)) return null;
    const request = latest.get(appointment.id);
    if (!request) return requestWindow(appointment, now).open ? "request" : "expired";
    if (request.direction === "عودة") return follows(request) ? "progress" : null;
    if (BEFORE_PICKUP.includes(request.status)) return follows(request) ? "progress" : null;
    if (phaseOf(request).kind === "arrived") return "atAppointment";
    return follows(request) ? "progress" : null;
  };
  // رحلة عودة استلم السائق ضيفها تبقى ظاهرة حتى يرد المشرف على ما سجّله (أو تنتهي المهلة)
  const awaitingReply = (appointment: ClinicAppointment) => {
    const request = latest.get(appointment.id);
    return Boolean(request && pendingCheck(request, now));
  };
  const visible = todays
    .filter((appointment) => (appointment.status !== "مكتملة" || awaitingReply(appointment)) && appointment.status !== "ملغي")
    .flatMap((appointment) => {
      const stage = stageOf(appointment);
      return stage ? [{ appointment, request: latest.get(appointment.id), stage }] : [];
    });

  // ضيوف ذهبوا إلى مواعيد في الأيام السابقة ولم تُطلب لهم عودة ولم يُسجَّل أنهم عادوا بأنفسهم
  const since = new Date(now);
  since.setDate(since.getDate() - UNRETURNED_DAYS);
  const sinceDate = localDateString(since);
  const pastAtAppointment = appointments
    .filter((appointment) => appointment.appointmentDate < today && appointment.appointmentDate >= sinceDate
      && appointment.status !== "مكتملة" && appointment.status !== "ملغي" && stageOf(appointment) === "atAppointment")
    .sort(byAppointmentTime);

  // ضيوف مواعيد اليوم (ثم الأيام السابقة) للاختيار في استمارة الشكوى
  const complaintGuests: ComplaintGuest[] = [];
  const seenGuests = new Set<string>();
  for (const appointment of [...todays, ...appointments.filter((item) => item.appointmentDate < today && item.appointmentDate >= sinceDate).reverse()]) {
    const key = `${appointment.patientName}|${appointment.buildingNumber}|${appointment.apartmentNumber}`;
    if (seenGuests.has(key) || !appointment.patientName) continue;
    seenGuests.add(key);
    const mobile = appointment.mobile && appointment.mobile !== "-" ? appointment.mobile : undefined;
    // آخر سيارة أُرسلت للضيف في هذا الموعد (الشكاوى على النقل والسيارات)
    const request = requests.filter((item) => item.appointmentId === appointment.id && item.vehiclePlate).at(-1);
    complaintGuests.push({
      name: appointment.patientName, buildingNumber: appointment.buildingNumber, apartmentNumber: appointment.apartmentNumber, ...(mobile ? { mobile } : {}),
      appointmentId: appointment.id, ...(request?.vehiclePlate ? { vehiclePlate: request.vehiclePlate, driver: liveGps.get(request.vehiclePlate)?.driver || request.driver || undefined } : {}),
    });
  }
  const complaintFrom = (appointment: ClinicAppointment, request?: VehicleRequest, driver?: string) => {
    const mobile = appointment.mobile && appointment.mobile !== "-" ? appointment.mobile : undefined;
    setComplaintDraft({
      guestName: appointment.patientName,
      buildingNumber: appointment.buildingNumber,
      apartmentNumber: appointment.apartmentNumber,
      ...(mobile ? { mobile } : {}),
      appointmentId: appointment.id,
      ...(request?.vehiclePlate ? { vehiclePlate: request.vehiclePlate } : {}),
      ...(request?.vehiclePlate && (driver || request.driver) ? { driver: driver || request.driver } : {}),
    });
  };
  const shownComplaint = complaintId ? complaints.find((complaint) => complaint.id === complaintId) : undefined;
  function saveComplaint(complaint: Complaint) {
    addComplaint(complaint);
    setComplaintDraft(null);
    setComplaintId(complaint.id);
    toast.success(`سُجّلت شكوى ${complaint.guestName}`, { description: "يمكنك طباعة الاستمارة الآن أو لاحقًا من زر «الشكاوى» أعلى الصفحة" });
  }

  // فلتر المباني: اختيار مبنى أو أكثر، ويُحفظ على هذا الجهاز
  const buildingCounts = new Map<string, number>();
  for (const appointment of [...visible.map((row) => row.appointment), ...pastAtAppointment]) {
    buildingCounts.set(appointment.buildingNumber, (buildingCounts.get(appointment.buildingNumber) ?? 0) + 1);
  }
  const buildingNumbers = Array.from(new Set([...Array.from(buildingCounts.keys()), ...buildings]))
    .sort((first, second) => first.localeCompare(second, "ar", { numeric: true }));
  const inFilter = (appointment: ClinicAppointment) => nurses || !buildings.length || buildings.includes(appointment.buildingNumber);
  function chooseBuildings(next: string[]) {
    setBuildings(next);
    try { localStorage.setItem(BUILDINGS_KEY, JSON.stringify(next)); } catch { /* التخزين غير متاح */ }
  }

  const rows = visible.filter((row) => inFilter(row.appointment)).sort((a, b) => byAppointmentTime(a.appointment, b.appointment));
  const inStage = (stage: Stage) => rows.filter((row) => row.stage === stage);

  // المواعيد حسب ما تحتاجه الآن من مشرف المبنى
  const toRequest = inStage("request");
  const expired = inStage("expired");
  const inProgress = inStage("progress") as Required<Row>[];
  const atAppointment = inStage("atAppointment") as Required<Row>[];
  const completed = todays.filter((appointment) => appointment.status === "مكتملة" && inFilter(appointment)).length;
  const cancelled = todays.filter((appointment) => appointment.status === "ملغي" && inFilter(appointment)).sort(byAppointmentTime);

  // مواعيد بلا طلب ولها رحلة قائمة لنفس الوجهة في نفس التوقيت
  const matches = new Map(findUnrequestedMatches(todays, requests, hospitals, now).map((match) => [match.appointment.id, match]));
  const matchCount = toRequest.filter((row) => matches.has(row.appointment.id)).length;
  // مواعيد بلا طلب يمكن طلبها معًا (نفس الوجهة أو وجهة مجاورة خلال 30 دقيقة)، ولو في مبنى آخر
  const openUnrequested = todays.filter((appointment) => appointment.status === "بانتظار طلب السيارة" && !isReturnOnly(appointment) && !latest.has(appointment.id) && requestWindow(appointment, now).open);
  const partnerOf = (appointment: ClinicAppointment) => openUnrequested.find((other) => {
    if (other.id === appointment.id || isReturnOnly(appointment)) return false;
    const details = calculateTripGroupingScore(appointment, other, hospitals);
    return details.timeGapMinutes <= 30 && (details.sameDestination || details.nearbyDestination);
  });
  const dayOf = (appointment: ClinicAppointment) => (appointment.appointmentDate === today ? undefined : dayLabel(appointment.appointmentDate, now, en));
  const driverOf = (request: VehicleRequest) => (request.vehiclePlate && liveGps.get(request.vehiclePlate)?.driver) || request.driver || "";

  // أشخاص عودة الضيف: بدون الـ Nurse إن استُلمت في عودتها وحدها (وإن كانت تنتظر سيارتها تعود معه)
  const guestPersons = (appointment: ClinicAppointment) => {
    const nurse = nurseTrip.get(appointment.id);
    return tripPersons(appointment, undefined, Boolean(nurse && !BEFORE_PICKUP.includes(nurse.status)));
  };

  // عودة الـ Nurse فقط: تُتابَع في «طلبات جارية» حتى استلامها (وحتى الرد على ما سجّله السائق)
  const nurseProgress = Array.from(nurseTrip.values())
    .filter((request) => follows(request) && (BEFORE_PICKUP.includes(request.status) || Boolean(pendingCheck(request, now))))
    .flatMap((request) => {
      const appointment = appointments.find((item) => item.id === request.appointmentId);
      return appointment && inFilter(appointment) ? [{ appointment, request }] : [];
    });
  const progressRows = [...inProgress, ...nurseProgress].sort((a, b) => byAppointmentTime(a.appointment, b.appointment));

  const unreturned = pastAtAppointment.filter(inFilter).map((appointment) => ({ appointment, request: latest.get(appointment.id)! }));
  // تحتاج انتباه المشرف: ما سجّله السائق ينتظر رده، أو تأخرت السيارة عن الوصول إلى الاستلام
  const attentionRows = progressRows.filter(({ request }) => Boolean(pendingCheck(request, now)) || lateMinutes(request, now) !== null);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  useCheckAlerts(progressRows, text);
  useUnreturnedAlert(unreturned.length, text);

  return (
    <TextContext.Provider value={text}>
      <PageHeader
        title={nurses ? t("سيارات الممرضات", "Nurses' cars") : lead ? "كل طلبات السيارات" : "طلبات السيارات"}
        subtitle={`${longDate(today, en ? "en" : "ar")} · ${nurses ? t(`مواعيد الممرضات اليوم (مبنى ${NURSE_BUILDING}) · طلب السيارة ومتابعتها كما في صفحة مشرف المبنى`, `Nurses' appointments today (building ${NURSE_BUILDING}) · request a car and follow it to the destination`) : `مواعيد اليوم${lead ? " · طلبات كل مشرفي المباني" : ""}`}`}
        actions={!nurses && (
          <>
            <button type="button" onClick={() => setComplaintDraft({})} className={btn("secondary")}><MessageSquareWarning className="h-4 w-4" /> تسجيل شكوى</button>
            {/* الشكاوى المسجلة في نافذة عند الطلب (لا قسم في الصفحة، حتى لا تطول مع كثرة الشكاوى) */}
            <button type="button" onClick={() => setShowComplaints(true)} className={btn("secondary")}>
              الشكاوى{complaints.length > 0 && <span className="rounded-full bg-slate-200 px-1.5 text-[11px] leading-5 text-slate-700 tabular">{complaints.length}</span>}
            </button>
            <BuildingFilter all={visible.length + pastAtAppointment.length} counts={buildingCounts} buildings={buildingNumbers} selected={buildings} onChange={chooseBuildings} />
          </>
        )}
      />

      {/* شريط الحالة: عدادات حية ملونة، والضغط ينقل إلى القسم */}
      <div className="mb-6">
        <StatusBar
          label={t("حالة طلبات اليوم", "Today's requests")}
          items={[
            { key: "request", label: t("تحتاج طلب سيارة", "Need a car request"), value: toRequest.length, tone: "amber", hint: matchCount ? t(`${matchCount} لنفس وجهة رحلة قائمة`, `${matchCount} to the destination of a trip`) : t(`حتى ${REQUEST_GRACE_MINUTES} د بعد الموعد`, `Up to ${REQUEST_GRACE_MINUTES} min after the appointment`), onClick: () => jump("sup-request") },
            { key: "progress", label: t("طلبات جارية", "Requests in progress"), value: progressRows.length, tone: "blue", hint: t("حتى وصول السيارة إلى الوجهة", "Until the car reaches the destination"), onClick: () => jump("sup-progress") },
            { key: "at", label: t("ضيوف في الموعد", "At the appointment"), value: atAppointment.length, tone: "cyan", hint: t(`${completed} مكتملة اليوم`, `${completed} completed today`), onClick: () => jump("sup-at") },
            { key: "attention", label: t("تحتاج انتباهك", "Need your attention"), value: attentionRows.length + unreturned.length, tone: "red", hint: t(`${attentionRows.length} تأخر أو تأكيد · ${unreturned.length} لم تُسجَّل عودتهم`, `${attentionRows.length} late or to confirm · ${unreturned.length} return not recorded`), onClick: () => jump(unreturned.length ? "sup-unreturned" : "sup-progress") },
          ]}
        />
      </div>

      <ComplaintContext.Provider value={nurses ? null : complaintFrom}>
      <div className="space-y-6">
        {unreturned.length > 0 && (
          <Panel id="sup-unreturned" tone="red" icon={AlertTriangle} title={t("لم تُسجَّل عودتهم", "Return not recorded")} count={unreturned.length} description={t("ذهبوا إلى مواعيد في أيام سابقة ولم تُطلب لهم سيارة عودة ولم يُسجَّل أنهم عادوا بأنفسهم. تأكد من حالة كل ضيف: هل عاد بنفسه؟", "Went to appointments on previous days with no return car requested and no self return recorded. Check each one: did they return by themselves?")}>
            <div className="divide-y divide-slate-100">
              {unreturned.map(({ appointment, request }) => (
                <AtAppointmentRow
                  key={appointment.id}
                  overdue
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={phaseOf(request)}
                  nurseTrip={nurseTrip.get(appointment.id)}
                  persons={guestPersons(appointment)}
                  onReturn={onReturn}
                  onTransfer={onTransfer}
                  onNurseReturn={onNurseReturn}
                  onSelfReturn={onSelfReturn}
                />
              ))}
            </div>
          </Panel>
        )}

        <Panel id="sup-request" tone="amber" icon={BellRing} title={t("مواعيد تحتاج طلب سيارة", "Appointments that need a car")} count={toRequest.length} description={t(`يمكن الطلب حتى ${REQUEST_GRACE_MINUTES} دقيقة بعد وقت الموعد · طلب العودة من المستشفى طوال يومه`, `A car can be requested up to ${REQUEST_GRACE_MINUTES} minutes after the appointment time · a return from hospital all day`)}>
          {toRequest.length ? (
            <div className="divide-y divide-slate-100">
              {toRequest.map(({ appointment }) => (
                <RequestRow
                  key={appointment.id}
                  appointment={appointment}
                  day={dayOf(appointment)}
                  match={matches.get(appointment.id)}
                  partner={partnerOf(appointment)}
                  earlier={isReturnOnly(appointment) ? undefined : sameDayAppointments(appointment, appointments).find((other) => other.appointmentAt < appointment.appointmentAt && other.status !== "مكتملة")}
                  now={now}
                  onRequest={onRequest}
                  onSelfReturn={onSelfReturn}
                  onEditMobile={onEditMobile}
                  onCancelAppointment={() => setCancelling({ appointment })}
                />
              ))}
            </div>
          ) : <EmptyState icon={CheckCircle2} title={t("لا توجد مواعيد بانتظار طلب سيارة", "No appointments waiting for a car request")} hint={nurses ? t("تظهر هنا مواعيد الممرضات لليوم بعد موافقتك حتى يُطلب لها سيارة", "Today's nurse appointments appear here after your approval until a car is requested") : "تظهر هنا مواعيد العيادات لليوم حتى يُطلب لها سيارة"} />}
        </Panel>

        <Panel id="sup-progress" tone="blue" icon={Truck} title={t("طلبات جارية", "Requests in progress")} count={progressRows.length} description={nurses ? t("طلبات سيارات الممرضات حتى وصول السيارة إلى الوجهة", "Nurses' car requests until the car reaches the destination") : lead ? "طلبات كل مشرفي المباني حتى وصول السيارة إلى الوجهة" : "طلباتك حتى وصول السيارة إلى الوجهة"}>
          {progressRows.length ? (
            <div className="divide-y divide-slate-100">
              {progressRows.map(({ appointment, request }) => (
                <ProgressRow
                  key={request.id}
                  appointment={appointment}
                  request={request}
                  byOther={lead && !nurses && Boolean(request.requestedBy) && request.requestedBy !== uid}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={phaseOf(request)}
                  from={fromOf(request)}
                  onUpdateRequest={onUpdateRequest}
                  onCheckReply={onCheckReply}
                  onCancel={onCancel}
                  persons={requestPersons(request, appointment, requests)}
                  driverPhone={vehicles.find((vehicle) => vehicle.plate === request.vehiclePlate)?.phone}
                  now={now}
                  onCancelAppointment={!request.nurseOnly && canCancelAppointment(appointment, request) ? () => setCancelling({ appointment, request }) : undefined}
                />
              ))}
            </div>
          ) : <EmptyState icon={Truck} title={t("لا توجد طلبات جارية", "No requests in progress")} />}
        </Panel>

        {atAppointment.length > 0 && (
          <Panel id="sup-at" tone="cyan" icon={Hospital} title={t("ضيوف في الموعد", "At the appointment")} count={atAppointment.length} description={t("وصلوا إلى الوجهة · عند انتهاء الموعد يطلب أي مشرف سيارة العودة أو النقل إلى موعد الضيف التالي، أو يسجّل أنه عاد بنفسه", "Arrived at the destination · when the appointment ends, request the return car or the transfer to the next appointment, or record a self return")}>
            <div className="divide-y divide-slate-100">
              {atAppointment.map(({ appointment, request }) => (
                <AtAppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={phaseOf(request)}
                  next={request.direction === "ذهاب" ? nextAppointmentOf(appointment, appointments, now) : null}
                  nurseTrip={nurseTrip.get(appointment.id)}
                  persons={guestPersons(appointment)}
                  onReturn={onReturn}
                  onTransfer={onTransfer}
                  onNurseReturn={onNurseReturn}
                  onSelfReturn={onSelfReturn}
                />
              ))}
            </div>
          </Panel>
        )}

        {expired.length > 0 && (
          <Panel tone="red" icon={XCircle} title={t("انتهت مهلة الطلب", "Request time passed")} count={expired.length} description={t(`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد، ويجب أن تعدّل العيادة الموعد أولًا`, `More than ${REQUEST_GRACE_MINUTES} minutes after the appointment; the clinic must edit the appointment first`)}>
            <div className="divide-y divide-slate-100">
              {expired.map(({ appointment }) => (
                <Expandable
                  key={appointment.id}
                  label={t(`تفاصيل موعد ${appointment.patientName}`, `Appointment details: ${text.guest(appointment)}`)}
                  summary={<GuestSummary appointment={appointment} day={dayOf(appointment)} timeTone="red" status={<Badge tone="red" icon={Clock3}>{t("بانتظار تعديل العيادة", "Waiting for the clinic to edit")}</Badge>} />}
                >
                  <GuestDetails appointment={appointment} />
                  {canCancelAppointment(appointment) && <div className={moreActions}><CancelAppointmentButton onClick={() => setCancelling({ appointment })} /></div>}
                </Expandable>
              ))}
            </div>
          </Panel>
        )}

        {cancelled.length > 0 && (
          <Panel icon={Ban} title={t("مواعيد ملغاة", "Cancelled appointments")} count={cancelled.length} description={t("أُلغيت اليوم مع سبب الإلغاء", "Cancelled today, with the reason")}>
            <div className="divide-y divide-slate-100">
              {cancelled.map((appointment) => (
                <Expandable
                  key={appointment.id}
                  label={t(`تفاصيل موعد ${appointment.patientName} الملغي`, `Cancelled appointment details: ${text.guest(appointment)}`)}
                  summary={(
                    <GuestSummary
                      appointment={appointment}
                      day={dayOf(appointment)}
                      status={<span className="inline-flex min-w-0 items-center gap-1 text-xs text-red-700"><Ban className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{cancelReasonText(appointment.cancelReason, en ? "en" : "ar") || t("ملغي", "Cancelled")}</span></span>}
                    />
                  )}
                >
                  <GuestDetails appointment={appointment} />
                  <Note tone="red" icon={Ban}>
                    <span className="font-semibold">{t("سبب الإلغاء:", "Reason:")}</span> {cancelReasonText(appointment.cancelReason, en ? "en" : "ar") || "—"}
                    {appointment.cancelledBy && <span className="text-red-700/80"> · {appointment.cancelledBy}{appointment.cancelledAt && !Number.isNaN(Date.parse(appointment.cancelledAt)) ? ` ${timeLabel(new Date(appointment.cancelledAt))}` : ""}</span>}
                  </Note>
                </Expandable>
              ))}
            </div>
          </Panel>
        )}

      </div>
      </ComplaintContext.Provider>

      {showComplaints && (
        <Modal
          icon={MessageSquareWarning}
          title="الشكاوى"
          description={lead ? "شكاوى كل مشرفي المباني · لا تُعدّل ولا تُحذف بعد تسجيلها (الحذف لمدير النظام فقط)" : "الشكاوى التي سجّلتها · لا تُعدّل ولا تُحذف بعد تسجيلها (الحذف لمدير النظام فقط)"}
          onClose={() => setShowComplaints(false)}
          footer={(
            <>
              <button type="button" onClick={() => setShowComplaints(false)} className={btn("secondary")}>إغلاق</button>
              <button type="button" onClick={() => { setShowComplaints(false); setComplaintDraft({}); }} className={btn("primary")}><MessageSquareWarning className="h-4 w-4" /> تسجيل شكوى</button>
            </>
          )}
        >
          <ComplaintList complaints={complaints} showAuthor={lead} onOpen={(complaint) => { setShowComplaints(false); setComplaintId(complaint.id); }} empty="لم تُسجَّل شكاوى بعد" />
        </Modal>
      )}
      {complaintDraft && (
        <ComplaintForm initial={complaintDraft} guests={complaintGuests} supervisorName={userName} onSave={saveComplaint} onClose={() => setComplaintDraft(null)} />
      )}
      {shownComplaint && (
        <ComplaintView
          complaint={shownComplaint}
          uid={uid}
          onReply={(index, reply) => { replyToReferral(shownComplaint.id, index, reply); toast.success(`أُرسل ردك على الشكوى #${shownComplaint.number}`); }}
          onClose={() => setComplaintId(null)}
        />
      )}

      {cancelling && (
        <CancelDialog
          appointment={cancelling.appointment}
          request={cancelling.request}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => {
            onCancelAppointment(cancelling.appointment, reason, cancelling.request);
            setCancelling(null);
          }}
        />
      )}
    </TextContext.Provider>
  );
}

/** فلتر المباني: قائمة منسدلة مخفية حتى يُضغط زرها، تختار «كل المباني» أو مبنى واحدًا أو أكثر. */
function BuildingFilter({ all, counts, buildings, selected, onChange }: {
  all: number;
  counts: Map<string, number>;
  buildings: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  if (!buildings.length) return null;
  const label = selected.length ? `مبنى ${selected.join("، ")}` : "كل المباني";
  const row = (active: boolean) => cx(
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-sm transition",
    active ? "bg-brand-50 font-medium text-brand-700" : "text-slate-700 hover:bg-slate-50",
  );
  const check = (active: boolean) => (
    <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded ring-1 ring-inset", active ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-300")}>
      {active && <Check className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(btn("secondary"), "max-w-[16rem]", selected.length > 0 && "ring-brand-600 text-brand-700")}
      >
        <Building2 className="h-4 w-4 shrink-0" />
        <span className="truncate">{label}</span>
        <ChevronDown className={cx("h-4 w-4 shrink-0 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div role="group" aria-label="فلتر المباني" className="absolute start-0 z-30 mt-2 w-60 sm:start-auto sm:end-0 rounded-xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200">
          <button type="button" aria-pressed={!selected.length} onClick={() => { onChange([]); setOpen(false); }} className={row(!selected.length)}>
            {check(!selected.length)}
            <span className="flex-1">كل المباني</span>
            <span className="text-xs text-slate-400 tabular">{all}</span>
          </button>
          <div className="my-1 border-t border-slate-100" />
          <div className="max-h-72 overflow-y-auto">
            {buildings.map((building) => {
              const active = selected.includes(building);
              return (
                <button
                  key={building}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onChange(active ? selected.filter((item) => item !== building) : [...selected, building])}
                  className={row(active)}
                >
                  {check(active)}
                  <span className="flex-1">مبنى {building}</span>
                  <span className="text-xs text-slate-400 tabular">{counts.get(building) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CancelAppointmentButton({ onClick }: { onClick: () => void }) {
  const { t } = useText();
  return <button type="button" onClick={onClick} className={cx(btn("ghost", "sm"), "text-red-600 hover:bg-red-50 hover:text-red-700")}><Ban className="h-4 w-4" /> {t("إلغاء الموعد", "Cancel appointment")}</button>;
}

/** إلغاء الموعد: سبب إلزامي (من الأسباب الجاهزة أو مكتوب). */
function CancelDialog({ appointment, request, onClose, onConfirm }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t, en, guest, place } = useText();
  const [preset, setPreset] = useState("");
  const [details, setDetails] = useState("");
  const other = preset === "other";
  const reason = (other ? details : [preset, details.trim()].filter(Boolean).join(" — ")).trim();
  const valid = Boolean(preset) && reason.length >= 3;
  const carOnWay = request && request.status !== "بانتظار التوزيع";
  return (
    <Modal
      tone="red"
      icon={Ban}
      title={t(`إلغاء موعد ${appointment.patientName}`, `Cancel the appointment of ${guest(appointment)}`)}
      description={`${appointment.appointmentAt} · ${pickupLabel(appointment, en)} ${t("←", "→")} ${place(appointment)}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>{t("رجوع", "Back")}</button>
          <button type="button" disabled={!valid} onClick={() => onConfirm(reason.slice(0, 300))} className={cx(btn("primary"), "bg-red-600 hover:bg-red-700")}><Ban className="h-4 w-4" /> {t("إلغاء الموعد", "Cancel appointment")}</button>
        </>
      )}
    >
      {request && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900 ring-1 ring-inset ring-amber-200">
          {carOnWay
            ? t(<>سيُلغى أيضًا طلب السيارة <span dir="ltr" className="font-semibold">{request.vehiclePlate}</span> وتصل رسالة لمشرف السيارات ليبلغ السائق.</>,
              <>The car request <span className="font-semibold">{request.vehiclePlate}</span> is cancelled too, and the fleet supervisor is told to inform the driver.</>)
            : t("سيُلغى أيضًا طلب السيارة المرسل إلى مشرف السيارات.", "The car request sent to the fleet supervisor is cancelled too.")}
        </p>
      )}
      <fieldset>
        <legend className={labelClass}>{t("سبب الإلغاء", "Cancellation reason")} <span className="text-red-600">*</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[...CANCEL_REASONS, "other"].map((item) => (
            <button key={item} type="button" aria-pressed={preset === item} onClick={() => setPreset(item)} className={cx(choiceClass(preset === item), "min-h-10 text-start")}>
              {item === "other" ? t("سبب آخر", "Other reason") : cancelReasonText(item, en ? "en" : "ar")}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className={labelClass}>{other ? t("اكتب السبب", "Write the reason") : t("تفاصيل (اختياري)", "Details (optional)")}{other && <span className="text-red-600"> *</span>}</span>
        <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={200} rows={2} placeholder={other ? t("مثال: الضيف في المستشفى منذ أمس", "e.g. the guest has been in hospital since yesterday") : t("أي ملاحظة لمشرف السيارات والعيادة", "Any note for the fleet supervisor and the clinic")} className={cx(inputClass, "h-auto py-2.5")} />
      </label>
      {!valid && preset && <p className="mt-2 text-xs text-red-600">{t("اكتب السبب (3 أحرف على الأقل)", "Write the reason (at least 3 characters)")}</p>}
    </Modal>
  );
}

/**
 * تنبيه في الصفحة (مع صوت قصير) عندما يسجّل السائق من تطبيقه وصوله أو استلام الضيف في طلب يتابعه المشرف،
 * حتى يؤكده أو ينفيه خلال المهلة. ما كان ينتظر الرد عند فتح الصفحة لا يُنبَّه له.
 */
function useCheckAlerts(rows: Required<Row>[], { t, en, guest }: PageText) {
  const seen = useRef<Set<string> | null>(null);
  const pending = rows.flatMap(({ appointment, request }) => {
    const check = pendingCheck(request);
    return check ? [{ key: `${request.id}:${check.kind}:${check.at.getTime()}`, appointment, request, check }] : [];
  });
  const signature = pending.map((item) => item.key).join("|");
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(pending.map((item) => item.key));
      return;
    }
    const fresh = pending.filter((item) => !seen.current!.has(item.key));
    if (!fresh.length) return;
    fresh.forEach((item) => seen.current!.add(item.key));
    for (const { appointment, request, check } of fresh) {
      // الضغط على الإشعار يفتح بطاقة الطلب وفيها التأكيد والنفي
      const name = en ? guest(appointment) : appointment.patientName;
      toast.warning(t(`السائق سجّل ${check.kind === "arrival" ? "وصول السيارة" : request.nurseOnly ? "استلام الـ Nurse" : "استلام الضيف"}: ${request.nurseOnly ? `الـ Nurse · ${name}` : name}`,
        `The driver recorded ${riderText(request, checkWhat(check.kind, true))}: ${request.nurseOnly ? `nurse · ${name}` : name}`), {
        description: t(`السيارة ${request.vehiclePlate ?? ""} · أكّد أو انفِ خلال 5 دقائق، وإلا يُقبل تلقائيًا`, `Car ${request.vehiclePlate ?? ""} · confirm or deny within 5 minutes, or it is accepted automatically`),
        duration: 20000,
        ...goTo(() => reveal(`request:${request.id}`)),
      });
    }
    beep();
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** تنبيه عند فتح الصفحة (وعند زيادة العدد) بضيوف لم تُسجَّل عودتهم من أيام سابقة. */
function useUnreturnedAlert(count: number, { t }: PageText) {
  const shown = useRef(0);
  useEffect(() => {
    if (count > shown.current) {
      toast.error(t(`${count === 1 ? "ضيف لم تُسجَّل عودته" : `${count} ضيوف لم تُسجَّل عودتهم`} من أيام سابقة`, `${count === 1 ? "1 guest" : `${count} guests`} with no recorded return from previous days`), {
        description: t("تأكد من حالتهم في «لم تُسجَّل عودتهم» أعلى الصفحة: هل عادوا بأنفسهم؟", "Check them in “Return not recorded” at the top: did they return by themselves?"),
        duration: 15000,
        ...goTo(() => reveal("sup-unreturned")),
      });
    }
    shown.current = count;
  }, [count]);
}

const distanceText = (meters: number, en = false) => (meters < 1000 ? `${meters} ${en ? "m" : "م"}` : `${(meters / 1000).toFixed(1)} ${en ? "km" : "كم"}`);

/**
 * ما سجّله السائق من تطبيقه: ينتظر رد مشرف المبنى (تأكيد أو نفي) خلال 5 دقائق مع موقع هاتف السائق
 * لحظتها وبعده عن نقطة الاستلام، وإلا يُقبل تلقائيًا. بعد الرد (أو انتهاء المهلة) سطر قصير بالنتيجة.
 */
function DriverCheckBox({ request, appointment, from, onReply }: {
  request: VehicleRequest;
  appointment: ClinicAppointment;
  from?: ClinicAppointment | null;
  onReply: (kind: CheckKind, reply: "confirmed" | "denied") => void;
}) {
  const { t, en } = useText();
  const now = useNow(1000);
  const hospitals = useHospitals();
  const check = pendingCheck(request, now);
  // عودة الـ Nurse فقط: الراكب هو الـ Nurse. (قبل سطر النتيجة الذي يستعمله بعد الرد أو انتهاء المهلة)
  const rider = (text: string) => riderText(request, text);
  if (!check) {
    const done = (["arrival", "pickup"] as CheckKind[]).flatMap((kind) => {
      const item = driverCheck(request, kind, now);
      return item ? [item] : [];
    });
    if (!done.length) return null;
    return (
      <ul className="mt-2 space-y-0.5 text-xs">
        {done.map((item) => (
          <li key={item.kind} className={cx("flex items-center gap-1.5", item.state === "denied" ? "font-medium text-red-700" : "text-slate-500")}>
            {item.state === "denied" ? <XCircle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {rider(checkLine(item, en))}
          </li>
        ))}
      </ul>
    );
  }
  const point = check.kind === "arrival" ? request.arrivalGps : request.pickupGps;
  const pickup = tripEndpoints(appointment, request.direction, hospitals, from).from;
  const meters = point && pickup ? Math.round(distanceKm(point, pickup) * 1000) : null;
  const far = meters !== null && meters > 800;
  const what = rider(checkWhat(check.kind, en));
  return (
    <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-300">
      <p className="flex items-start gap-1.5 text-sm font-semibold text-amber-950">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{t("السائق سجّل", "The driver recorded")} {what} {t("من تطبيقه الساعة", "from the app at")} <span dir="ltr" className="tabular">{timeLabel(check.at)}</span></span>
      </p>
      {meters !== null && (
        <p className={cx("mt-1 flex items-center gap-1.5 text-xs", far ? "font-semibold text-red-700" : "text-amber-900")}>
          <MapPin className="h-3.5 w-3.5 shrink-0" /> {t(`موقع هاتفه لحظتها على بعد ${distanceText(meters)} من نقطة الاستلام${far ? " · بعيد عن المكان" : ""}`, `His phone was ${distanceText(meters, true)} from the pickup point${far ? " · far from the place" : ""}`)}
        </p>
      )}
      <p className="mt-1 text-xs text-amber-900">
        {t("أكّد أو انفِ خلال", "Confirm or deny within")} <span dir="ltr" className="font-semibold tabular">{countdownText(check.secondsLeft)}</span>{t("، وإلا يُقبل تلقائيًا. يستطيع السائق المتابعة قبل تأكيدك.", ", or it is accepted automatically. The driver can carry on before you confirm.")}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onReply(check.kind, "confirmed")} className={btn("success", "sm")}>
          <CheckCircle2 className="h-4 w-4" /> {check.kind === "arrival" ? t("تأكيد الوصول", "Confirm arrival") : t("تأكيد الاستلام", "Confirm pickup")}
        </button>
        <button
          type="button"
          onClick={() => window.confirm(check.kind === "arrival"
            ? t("السيارة لم تصل فعلًا؟ ستعود الرحلة إلى «تم إرسال السيارة» ويصل تنبيه لمشرف السيارات والسائق.", "The car did not really arrive? The trip goes back to “Car sent”, and the fleet supervisor and the driver are alerted.")
            : rider(t("الضيف لم يُستلم فعلًا؟ ستعود الرحلة إلى «وصلت السيارة» ويصل تنبيه لمشرف السيارات والسائق.", "The guest was not really picked up? The trip goes back to “Car arrived”, and the fleet supervisor and the driver are alerted."))) && onReply(check.kind, "denied")}
          className={btn("danger", "sm")}
        >
          <XCircle className="h-4 w-4" /> {check.kind === "arrival" ? t("لم تصل السيارة", "Car did not arrive") : request.nurseOnly ? t("لم تُستلم الـ Nurse", "Nurse not picked up") : t("لم يُستلم الضيف", "Guest not picked up")}
        </button>
      </div>
    </div>
  );
}

/** سطر الإجراءات الثانوية أسفل البطاقة المفتوحة. */
const moreActions = "mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-3";

/** دقائق تأخر السيارة عن الوصول إلى نقطة الاستلام (LATE_MINUTES أو أكثر منذ إرسالها)، أو null. */
function lateMinutes(request: VehicleRequest, now: Date) {
  const minutes = request.status === "تم إرسال السيارة" ? minutesSince(request.notificationSentAt, now) : null;
  return minutes !== null && minutes >= LATE_MINUTES ? minutes : null;
}

/** ملاحظة ملونة داخل البطاقة المفتوحة (موعد سابق، رحلة يمكن الجمع معها، سبب الإلغاء). */
function Note({ tone, icon: IconComponent, children }: { tone: "cyan" | "amber" | "violet" | "red"; icon: typeof MapPin; children: ReactNode }) {
  const styles = {
    cyan: "bg-cyan-50 text-cyan-900 ring-cyan-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
    red: "bg-red-50 text-red-800 ring-red-200",
  };
  return (
    <p className={cx("mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2 text-xs leading-5 ring-1 ring-inset", styles[tone])}>
      <IconComponent className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{children}</span>
    </p>
  );
}

/**
 * ملخص البطاقة المطوية: الوقت والضيف والوجهة وأهم العلامات، ثم سطر الحالة.
 * عناصر span فقط لأنه داخل زر فتح البطاقة (لا روابط ولا أزرار).
 */
function GuestSummary({ appointment, request, from, day, timeTone, status }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  /** الموعد الأول في النقل بين موعدين */
  from?: ClinicAppointment | null;
  day?: string;
  timeTone?: "red";
  /** شارات الحالة تحت الوجهة */
  status?: ReactNode;
}) {
  const { t, en, guest, place } = useText();
  // طلب العودة فقط: من المستشفى إلى المجمع، قبل طلب سيارته وبعده
  const returnOnly = isReturnOnly(appointment);
  const returning = request ? request.direction === "عودة" : returnOnly;
  // النقل من مستشفى إلى مستشفى: الذهاب من مستشفى الاستلام (قبل طلب سيارته أيضًا)
  const hospitalTransfer = isHospitalTransfer(appointment) && !returning;
  const pickup = from ? place(from) : hospitalTransfer ? place(hospitalTransferSource(appointment)) : pickupLabel(appointment, en);
  const transferText = en ? transferLabels(appointment).en : transferLabels(appointment).ar;
  return (
    <>
      <TimeBlock time={appointment.appointmentAt} day={day} tone={timeTone} />
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">
            {request?.nurseOnly ? <>{t("الـ Nurse", "Nurse")} <span className="font-normal text-slate-500">· {t("مرافقة", "with")} {guest(appointment)}</span></> : guest(appointment)}
          </span>
          {returnOnly
            ? <Badge tone="cyan" icon={House}>{t(RETURN_ONLY_LABEL, "Return only from hospital")}</Badge>
            : (from || (hospitalTransfer && !request))
              ? <Badge tone="cyan" icon={ArrowLeftRight}>{transferText}</Badge>
              : request && (request.nurseOnly
                ? <Badge tone="amber" icon={Stethoscope}>{t("عودة الـ Nurse فقط", "Nurse return only")}</Badge>
                : <Badge tone={returning ? "amber" : "neutral"}>{directionLabel(request.direction, en)}</Badge>)}
          {isNonMedical(appointment) && <Badge tone="violet">{t("غير طبية", "Non-medical")}</Badge>}
          {appointment.nurse && <Badge tone="violet" icon={BriefcaseMedical}>{t("ممرضة", "Nurse")}</Badge>}
          {appointment.kind === "احتياجات خاصة" && <Badge icon={Accessibility}>{t("احتياجات خاصة", "Special needs")}</Badge>}
          {/* «أولوية» فقط بلا سببها (حالة سرطان لا تظهر لمشرف المبنى) */}
          {appointment.cancer && <Badge tone="red" icon={Flag}>{t("أولوية", "Priority")}</Badge>}
        </span>
        <span className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">{returning ? place(appointment) : pickup} {t("←", "→")} <span className="font-medium text-slate-800">{returning ? pickup : place(appointment)}</span></span>
        </span>
        {status && <span className="mt-2 flex flex-wrap items-center gap-1.5">{status}</span>}
      </span>
    </>
  );
}

/** تفاصيل البطاقة المفتوحة: الاتصال بالضيف وواتساب، واحتياجاته وعدد الأشخاص والسيارة. */
function GuestDetails({ appointment, request, driver, persons, onEditMobile }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  driver?: string;
  /** عدد الأشخاص في الرحلة (الضيف ومرافقه والـ Nurse، أو الـ Nurse وحدها) */
  persons?: number;
  /** قبل طلب السيارة: زر القلم بجانب الرقم لتصحيحه إن كان خطأ */
  onEditMobile?: (mobile: string) => void;
}) {
  const { t, en } = useText();
  const assistance = appointment.assistance.map((need) => (en ? CLINIC_TEXT.en.need(need) : need)).join(t("، ", ", "));
  const count = persons ?? tripPersons(appointment, request);
  const contactLabels = en ? { call: "Call", whatsapp: "WhatsApp" } : undefined;
  const hasMobile = Boolean(appointment.mobile && appointment.mobile !== "-");
  const complain = useContext(ComplaintContext);
  const guestName = useText().guest(appointment);
  return (
    <div className="space-y-2.5">
      {onEditMobile
        ? <GuestMobile mobile={hasMobile ? appointment.mobile : ""} name={guestName} onSave={onEditMobile} />
        : hasMobile && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-700">
            <span className="text-xs font-medium text-slate-500">{t("هاتف الضيف", "Guest phone")}</span>
            <GuestContact mobile={appointment.mobile} size="md" labels={contactLabels} />
          </div>
        )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {appointment.appointmentType && <span>{t("نوع الموعد:", "Appointment type:")} <span className="font-medium text-slate-700">{appointmentTypeText(appointment.appointmentType, en ? "en" : "ar")}</span></span>}
        {appointment.gender && <span>{en ? (appointment.gender === "أنثى" ? "Female" : "Male") : appointment.gender}</span>}
        {assistance && !request?.nurseOnly && <span className="inline-flex items-center gap-1"><Accessibility className="h-3.5 w-3.5" />{assistance}</span>}
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{personsLabel(count, en)}</span>
        {request?.vehiclePlate && (
          <span className="inline-flex items-center gap-1 text-slate-600">
            <Truck className="h-3.5 w-3.5" /><span dir="ltr" className="font-semibold text-ink">{request.vehiclePlate}</span>{driver ? ` · ${driver}` : ""}
            {request.groupId && <Badge tone="violet" className="ms-1">{t("رحلة مجمّعة", "Shared trip")}</Badge>}
          </span>
        )}
        {/* غيّر مشرف السيارات السيارة بعد إرسالها (عطل أو حادث أو تأخر) */}
        {request?.removedFrom && request.status === "بانتظار التوزيع" && (
          <span className="w-full font-medium text-red-700">{t("أُزيل من رحلة السيارة", "Removed from the trip of car")} <span dir="ltr">{request.removedFrom}</span>{request.removeReason ? ` · ${request.removeReason}` : ""} · {t("ينتظر سيارة أخرى", "waiting for another car")}</span>
        )}
        {request?.previousPlate && request.vehiclePlate && request.status !== "وصلت الوجهة" && (
          <span className="w-full font-medium text-amber-800">{t("تغيّرت السيارة: بدل", "Car changed: instead of")} <span dir="ltr">{request.previousPlate}</span>{request.changeReason ? ` · ${request.changeReason}` : ""}</span>
        )}
      </p>
      {complain && (
        <button type="button" onClick={() => complain(appointment, request, driver)} className={cx(btn("ghost", "sm"), "-ms-2 text-slate-500")}>
          <MessageSquareWarning className="h-3.5 w-3.5" /> تسجيل شكوى للضيف
        </button>
      )}
    </div>
  );
}

/**
 * هاتف الضيف قبل طلب السيارة: الرقم مع الاتصال وواتساب، وبجانبه زر القلم لتصحيحه إن كان خطأ
 * (يُحفظ في الموعد ويُسجَّل في سجل العمليات).
 */
function GuestMobile({ mobile, name, onSave }: { mobile: string; name: string; onSave: (mobile: string) => void }) {
  const { t, en } = useText();
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (draft !== null) inputRef.current?.focus();
  }, [draft !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  function save(event: React.FormEvent) {
    event.preventDefault();
    const next = toWesternDigits(draft ?? "").replace(/[\s-]/g, "");
    if (!/^\+?\d{8,15}$/.test(next)) {
      toast.error(t("أدخل رقم هاتف صحيحًا من 8 إلى 15 رقمًا", "Enter a valid phone number of 8 to 15 digits"));
      return;
    }
    if (next !== mobile) onSave(next);
    setDraft(null);
  }

  if (draft !== null) {
    return (
      <form onSubmit={save} className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="shrink-0 whitespace-nowrap text-xs font-medium text-slate-500">{t("هاتف الضيف", "Guest phone")}</span>
          <input
            ref={inputRef}
            dir="ltr"
            type="tel"
            inputMode="tel"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && setDraft(null)}
            aria-label={t(`رقم هاتف ${name}`, `Phone number of ${name}`)}
            className={cx(inputClass, "h-10 w-44 tabular")}
          />
        </label>
        <button type="submit" className={btn("primary", "sm")}><Check className="h-4 w-4" /> {t("حفظ الرقم", "Save number")}</button>
        <button type="button" onClick={() => setDraft(null)} className={btn("ghost", "sm")}>{t("إلغاء", "Cancel")}</button>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-700">
      <span className="text-xs font-medium text-slate-500">{t("هاتف الضيف", "Guest phone")}</span>
      {mobile ? <GuestContact mobile={mobile} size="md" labels={en ? { call: "Call", whatsapp: "WhatsApp" } : undefined} /> : <span className="text-amber-700">{t("بلا رقم", "No number")}</span>}
      <button
        type="button"
        onClick={() => setDraft(mobile)}
        title={t("تعديل رقم الضيف", "Edit the guest's number")}
        aria-label={t(`تعديل رقم هاتف ${name}`, `Edit the phone number of ${name}`)}
        className={cx(btn("ghost", "sm"), "h-10 w-10 px-0 text-slate-500 hover:text-ink")}
      >
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}

function RequestRow({ appointment, day, match, partner, earlier, now, onRequest, onSelfReturn, onEditMobile, onCancelAppointment }: {
  appointment: ClinicAppointment;
  day?: string;
  match?: UnrequestedMatch;
  partner?: ClinicAppointment;
  /** موعد سابق للضيف نفسه اليوم: يمكن نقله منه مباشرة إلى هذا الموعد */
  earlier?: ClinicAppointment;
  now: Date;
  onRequest: RequestHandlers["onRequest"];
  /** طلب العودة فقط: الضيف عاد من المستشفى بنفسه قبل طلب سيارته */
  onSelfReturn: RequestHandlers["onSelfReturn"];
  onEditMobile: RequestHandlers["onEditMobile"];
  onCancelAppointment: () => void;
}) {
  const { t, guest, place } = useText();
  const name = guest(appointment);
  const editMobile = (mobile: string) => onEditMobile(appointment, mobile);
  const deadline = requestWindow(appointment, now);
  // طلب عودة فقط: الضيف في المستشفى، وتُطلب سيارة العودة عند جاهزيته (طوال يومه)
  const returnOnly = isReturnOnly(appointment);

  if (returnOnly) {
    return (
      <Expandable
        label={t(`تفاصيل طلب عودة ${appointment.patientName}`, `Return request details: ${name}`)}
        summary={(
          <GuestSummary
            appointment={appointment}
            day={day}
            status={(
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" /> {t("الضيف في المستشفى · وقت العودة", "In hospital · return time")} <span dir="ltr" className="tabular">{appointment.appointmentAt}</span>
              </span>
            )}
          />
        )}
        action={<button onClick={() => onRequest(newRequest(appointment), appointment.id)} className={btn("primary")}><RotateCcw className="h-4 w-4" /> {t("طلب سيارة العودة", "Request return car")}</button>}
      >
        <GuestDetails appointment={appointment} onEditMobile={editMobile} />
        <Note tone="cyan" icon={House}>
          {t(`طلب عودة فقط من ${appointment.clinic} إلى المجمع (لم يذهب الضيف بسيارة من المجمع). اطلب السيارة عندما يكون الضيف جاهزًا، أو سجّل أنه عاد بنفسه.`,
            `Return only from ${place(appointment)} to the complex (the guest did not go by a complex car). Request the car when the guest is ready, or record a self return.`)}
        </Note>
        <div className={moreActions}>
          <button
            onClick={() => window.confirm(t(`تأكيد أن ${appointment.patientName} عاد إلى المجمع بنفسه؟ ينتهي طلب العودة بلا سيارة.`, `Confirm that ${name} returned to the complex by themselves? The return request ends without a car.`)) && onSelfReturn(appointment)}
            className={cx(btn("ghost"), "text-emerald-700 hover:bg-emerald-50")}
          >
            <Footprints className="h-4 w-4" /> {t("عاد بنفسه", "Returned by themselves")}
          </button>
          {canCancelAppointment(appointment) && <CancelAppointmentButton onClick={onCancelAppointment} />}
        </div>
      </Expandable>
    );
  }

  function requestCar() {
    if (!requestWindow(appointment).open) {
      toast.error(t(`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد. يجب أن تعدّل العيادة الموعد أولًا.`, `More than ${REQUEST_GRACE_MINUTES} minutes after the appointment. The clinic must edit the appointment first.`));
      return;
    }
    if (!canRequestVehicle(appointment)) {
      toast.error(t("لا يوجد موعد قابل للطلب", "This appointment cannot be requested"));
      return;
    }
    onRequest(newRequest(appointment), appointment.id);
  }

  return (
    <Expandable
      label={t(`تفاصيل موعد ${appointment.patientName}`, `Appointment details: ${name}`)}
      summary={(
        <GuestSummary
          appointment={appointment}
          day={day}
          status={<>
            <span className={cx("inline-flex items-center gap-1 text-xs", deadline.minutesLeft <= 15 ? "font-semibold text-red-600" : "text-slate-500")}>
              <Clock3 className="h-3.5 w-3.5" /> {t("آخر موعد للطلب", "Request by")} <span dir="ltr" className="tabular">{timeLabel(deadline.deadline)}</span>
            </span>
            {match
              ? <Badge tone="amber" icon={BellRing}>{match.sameDestination ? t("نفس وجهة رحلة قائمة", "Same destination as a trip") : t("وجهة مجاورة لرحلة قائمة", "Near the destination of a trip")}</Badge>
              : partner && <Badge tone="violet" icon={Link2}>{t("رحلة مشتركة ممكنة", "Shared trip possible")}</Badge>}
            {earlier && <Badge tone="cyan" icon={ArrowLeftRight}>{t("بعد موعد سابق اليوم", "After an earlier appointment today")}</Badge>}
          </>}
        />
      )}
      action={<button onClick={requestCar} className={btn("primary")}><BellRing className="h-4 w-4" /> {t("طلب السيارة", "Request car")}</button>}
    >
      <GuestDetails appointment={appointment} onEditMobile={editMobile} />
      {earlier && (
        <Note tone="cyan" icon={ArrowLeftRight}>
          {t("للضيف موعد سابق اليوم الساعة", "The guest has an earlier appointment today at")} <span dir="ltr" className="font-semibold tabular">{earlier.appointmentAt}</span> {t("في", "in")} {place(earlier)}{t(". عند انتهائه يمكن نقله مباشرة إلى هذا الموعد من «ضيوف في الموعد»، بدل طلب سيارة من المجمع.", ". When it ends, transfer them directly to this appointment from “At the appointment” instead of a car from the complex.")}
        </Note>
      )}
      {match ? (
        <Note tone="amber" icon={BellRing}>
          {t(<><span className="font-semibold">{match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} رحلة {match.matchedAppointment.patientName}</span> (مبنى {match.matchedAppointment.buildingNumber}، {match.matchedAppointment.appointmentAt} · {requestStatusText(match.matchedRequest.status, false)}). اطلب الآن لتُجمع معها.</>,
            <><span className="font-semibold">{match.sameDestination ? "Same destination as" : "Near the destination of"} the trip of {guest(match.matchedAppointment)}</span> (building {match.matchedAppointment.buildingNumber}, {match.matchedAppointment.appointmentAt} · {requestStatusText(match.matchedRequest.status, true)}). Request now to share it.</>)}
        </Note>
      ) : partner && (
        <Note tone="violet" icon={Link2}>{t(`رحلة مشتركة ممكنة مع ${partner.patientName} (مبنى ${partner.buildingNumber}، ${partner.appointmentAt})`, `Shared trip possible with ${guest(partner)} (building ${partner.buildingNumber}, ${partner.appointmentAt})`)}</Note>
      )}
      {canCancelAppointment(appointment) && <div className={moreActions}><CancelAppointmentButton onClick={onCancelAppointment} /></div>}
    </Expandable>
  );
}

function ProgressRow({ appointment, request, byOther = false, day, driver, phase, from, persons, driverPhone, now, onUpdateRequest, onCheckReply, onCancel, onCancelAppointment }: {
  appointment: ClinicAppointment;
  request: VehicleRequest;
  /** عدد الأشخاص في الرحلة (الضيف ومرافقه والـ Nurse، أو الـ Nurse وحدها) */
  persons?: number;
  /** هاتف سائق السيارة المرسلة (من قائمة السيارات) */
  driverPhone?: string;
  now: Date;
  /** لمسؤول مشرفي المباني: الطلب طلبه مشرف مبنى آخر */
  byOther?: boolean;
  day?: string;
  driver: string;
  phase: TripPhase;
  /** الموعد الأول في النقل بين موعدين */
  from?: ClinicAppointment | null;
  onUpdateRequest: RequestHandlers["onUpdateRequest"];
  onCheckReply: RequestHandlers["onCheckReply"];
  onCancel: RequestHandlers["onCancel"];
  onCancelAppointment?: () => void;
}) {
  const { t, en, guest, place } = useText();
  const name = guest(appointment);
  const returning = request.direction === "عودة";
  // الذهاب: بعد الاستلام تبقى الرحلة هنا «في الطريق إلى الوجهة» حتى تصل
  const step = request.status === "بانتظار التوزيع" ? 0 : request.status === "تم إرسال السيارة" ? 1 : request.status === "وصلت السيارة" ? 2 : returning ? 3 : 4;
  const next = request.status === "تم إرسال السيارة"
    ? { label: t("وصلت السيارة", "Car arrived"), status: "وصلت السيارة" as const }
    : request.status === "وصلت السيارة"
      ? { label: request.nurseOnly ? t("تم استلام الـ Nurse", "Nurse picked up") : t("تم استلام الضيف", "Guest picked up"), status: "تم استلام المريض" as const }
      : null;
  const canCancel = request.status === "بانتظار التوزيع" || request.status === "تم إرسال السيارة";
  // عودة الـ Nurse فقط: الراكب هو الـ Nurse
  const rider = (text: string) => riderText(request, text);
  const check = pendingCheck(request, now);
  const late = lateMinutes(request, now);
  const status = check
    ? <Badge tone="amber" icon={Smartphone}>{t("السائق سجّل", "Driver recorded")} {rider(checkWhat(check.kind, en))} · {t("بانتظار ردك", "awaiting your reply")}</Badge>
    : phase.kind === "toDestination"
      ? <Badge tone="blue" icon={Timer}>{t("في الطريق · الوصول المتوقع", "On the way · expected")} <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span>{phase.late ? t(" (متأخرة)", " (late)") : ""}</Badge>
      : late !== null
        ? <Badge tone="red" icon={AlertTriangle}>{t(`تأخرت السيارة · ${late} د`, `Car late · ${late} min`)}</Badge>
        : <Badge tone={step === 0 ? "amber" : "blue"}>{step === 0 ? t("بانتظار إرسال سيارة", "Waiting for a car") : rider(requestStatusText(request.status, en))}</Badge>;
  return (
    <Expandable
      target={`request:${request.id}`}
      label={t(`تفاصيل طلب ${request.nurseOnly ? `الـ Nurse مرافقة ${appointment.patientName}` : appointment.patientName}`, `Request details: ${request.nurseOnly ? `nurse with ${name}` : name}`)}
      attention={Boolean(check) || late !== null}
      summary={(
        <GuestSummary
          appointment={appointment}
          request={request}
          from={from}
          day={day}
          status={<>
            {status}
            {request.vehiclePlate && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Truck className="h-3.5 w-3.5" /><span dir="ltr" className="font-semibold text-slate-700">{request.vehiclePlate}</span></span>}
            {/* غيّر مشرف السيارات السيارة بعد إرسالها: السبب في التفاصيل */}
            {request.previousPlate && request.vehiclePlate && <Badge tone="amber" icon={ArrowLeftRight}>{t("تغيّرت السيارة", "Car changed")}</Badge>}
            {/* أزاله مشرف السيارات من رحلة (لم يركب): ينتظر سيارة أخرى */}
            {request.removedFrom && request.status === "بانتظار التوزيع" && <Badge tone="red" icon={UserMinus}>{t("أُزيل من رحلة السيارة", "Removed from car")} <span dir="ltr">{request.removedFrom}</span></Badge>}
            {byOther && <Badge tone="violet" icon={Building2}>{request.requestedByName ? `طلب ${request.requestedByName}` : "طلب مشرف مبنى آخر"}</Badge>}
          </>}
        />
      )}
      action={next && <button onClick={() => onUpdateRequest(request.id, next.status)} className={btn("dark")}><CheckCircle2 className="h-4 w-4" /> {next.label}</button>}
    >
      <GuestDetails appointment={appointment} request={request} driver={driver} persons={persons} />
      {byOther && request.createdAt && <p className="mt-2 flex items-center gap-1 text-xs text-violet-700"><Building2 className="h-3.5 w-3.5" /> طلبه {request.requestedByName || "مشرف مبنى آخر"} الساعة {request.createdAt}</p>}
      <div className="mt-3"><Steps steps={(request.nurseOnly ? NURSE_STEPS : returning ? RETURN_STEPS : OUTBOUND_STEPS)[en ? "en" : "ar"]} current={step} /></div>
      {(request.arrivalCheck || request.pickupCheck) && (
        <DriverCheckBox request={request} appointment={appointment} from={from} onReply={(kind, reply) => onCheckReply(request, kind, reply)} />
      )}
      {request.status === "بانتظار التوزيع" && <p className="mt-2 text-xs text-slate-500">{t(`بانتظار أن يرسل مشرف السيارات سيارة${from ? ` إلى ${from.clinic}` : ""}`, `Waiting for the fleet supervisor to send a car${from ? ` to ${place(from)}` : ""}`)}</p>}
      {driverPhone && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") && (
        <DriverCall request={request} driver={driver} phone={driverPhone} now={now} />
      )}
      {phase.kind === "toDestination" && <p className="mt-2 text-xs text-slate-500">{t("يُتاح طلب العودة بعد وصول السيارة إلى الوجهة", "The return can be requested after the car reaches the destination")}</p>}
      {(canCancel || onCancelAppointment) && (
        <div className={moreActions}>
          {canCancel && <button onClick={() => window.confirm(request.nurseOnly ? t("إلغاء طلب عودة الـ Nurse؟ يبقى الضيف في موعده.", "Cancel the nurse return request? The guest stays at the appointment.") : t("إلغاء طلب السيارة فقط؟ يبقى الموعد ويمكن طلب سيارة له من جديد.", "Cancel the car request only? The appointment stays and a car can be requested again.")) && onCancel(appointment, request)} className={btn("danger", "sm")}><XCircle className="h-4 w-4" /> {t("إلغاء طلب السيارة", "Cancel car request")}</button>}
          {onCancelAppointment && <CancelAppointmentButton onClick={onCancelAppointment} />}
        </div>
      )}
    </Expandable>
  );
}

/**
 * الاتصال بسائق السيارة المرسلة (وواتساب)، مع تنبيه إن تأخرت السيارة عن الوصول إلى الاستلام
 * LATE_MINUTES أو أكثر منذ إرسالها.
 */
function DriverCall({ request, driver, phone, now }: { request: VehicleRequest; driver: string; phone: string; now: Date }) {
  const minutes = request.status === "تم إرسال السيارة" ? minutesSince(request.notificationSentAt, now) : null;
  const late = minutes !== null && minutes >= LATE_MINUTES;
  const { t } = useText();
  return (
    <div className={cx("mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 text-xs", late ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200/80")}>
      <span className={cx("inline-flex items-center gap-1", late && "font-semibold")}>
        {late ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Truck className="h-3.5 w-3.5 shrink-0" />}
        {late
          ? t(`تأخرت السيارة: مضت ${minutes} دقيقة على إرسالها ولم تصل`, `Car late: sent ${minutes} minutes ago and not arrived`)
          : t(`السائق${driver ? ` ${driver}` : ""}${minutes !== null ? ` · أُرسلت منذ ${minutes} د` : ""}`, `Driver${driver ? ` ${driver}` : ""}${minutes !== null ? ` · sent ${minutes} min ago` : ""}`)}
      </span>
      <GuestContact mobile={phone} size="md" labels={t({ call: "اتصال بالسائق", whatsapp: "واتساب" }, { call: "Call the driver", whatsapp: "WhatsApp" })} />
    </div>
  );
}

/** حالة عودة الـ Nurse وحدها: بانتظار السيارة، أو في الطريق، أو عادت. */
function nurseTripText(request: VehicleRequest, en: boolean) {
  if (request.status === "بانتظار التوزيع") return en ? "Nurse return: waiting for a car" : "عودة الـ Nurse: بانتظار سيارة";
  if (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") return `${en ? "Nurse return" : "عودة الـ Nurse"}: ${requestStatusText(request.status, en)}${request.vehiclePlate ? ` (${request.vehiclePlate})` : ""}`;
  return en ? "The nurse returned to the complex" : "عادت الـ Nurse إلى المجمع";
}

function AtAppointmentRow({ appointment, request, day, driver, phase, next, nurseTrip, persons, overdue = false, onReturn, onTransfer, onNurseReturn, onSelfReturn }: {
  appointment: ClinicAppointment;
  request: VehicleRequest;
  day?: string;
  driver: string;
  phase: TripPhase;
  /** موعد الضيف التالي اليوم: يمكن نقله إليه مباشرة بدل العودة إلى المجمع */
  next?: ClinicAppointment | null;
  /** طلب عودة الـ Nurse وحدها لهذا الموعد، إن وُجد */
  nurseTrip?: VehicleRequest;
  /** عدد الأشخاص في عودة الضيف (بدون الـ Nurse إن عادت قبله) */
  persons: number;
  /** من يوم سابق ولم تُسجَّل عودته */
  overdue?: boolean;
  onReturn: RequestHandlers["onReturn"];
  onTransfer: RequestHandlers["onTransfer"];
  onNurseReturn: RequestHandlers["onNurseReturn"];
  onSelfReturn: RequestHandlers["onSelfReturn"];
}) {
  const { t, en, guest, place } = useText();
  const name = guest(appointment);
  // الـ Nurse بانتظار سيارتها: طلب عودة الضيف يضمه إلى نفس الطلب
  const nurseWaiting = Boolean(nurseTrip && BEFORE_PICKUP.includes(nurseTrip.status));
  const returnButton = (
    <button key="return" onClick={() => onReturn(appointment, request)} className={btn(overdue || next ? "secondary" : "soft")}>
      <RotateCcw className="h-4 w-4" /> {nurseWaiting ? t("عودة الضيف مع الـ Nurse", "Guest returns with the nurse") : next ? t("العودة إلى المجمع", "Return to the complex") : t("طلب العودة", "Request return")}
    </button>
  );
  const selfButton = (
    <button
      key="self"
      onClick={() => window.confirm(t(`تأكيد أن ${appointment.patientName} عاد إلى المجمع بنفسه؟ ينتهي موعده بلا سيارة عودة.`, `Confirm that ${name} returned to the complex by themselves? The appointment ends without a return car.`)) && onSelfReturn(appointment)}
      className={cx(btn(overdue ? "success" : "ghost"), !overdue && "text-emerald-700 hover:bg-emerald-50")}
    >
      <Footprints className="h-4 w-4" /> {t("عاد بنفسه", "Returned by themselves")}
    </button>
  );
  // الإجراء الرئيسي ظاهر في البطاقة المطوية: النقل إلى الموعد التالي، أو «عاد بنفسه» لمن لم تُسجَّل عودته، أو طلب العودة
  const primary = next
    ? (
      <button onClick={() => onTransfer(appointment, request, next)} className={btn("primary")}>
        <ArrowLeftRight className="h-4 w-4" /> {t("إلى الموعد التالي", "To the next appointment")} <span dir="ltr" className="tabular">{next.appointmentAt}</span>
      </button>
    )
    : overdue ? selfButton : returnButton;
  return (
    <Expandable
      label={t(`تفاصيل ${appointment.patientName} في الموعد`, `Details: ${name} at the appointment`)}
      summary={(
        <GuestSummary
          appointment={appointment}
          request={request}
          day={day}
          timeTone={overdue ? "red" : undefined}
          status={<>
            {phase.kind === "toDestination"
              ? <Badge tone="blue" icon={Timer}>{t("في الطريق · الوصول المتوقع", "On the way · expected")} <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span></Badge>
              : phase.kind === "arrived" && phase.at
                ? <Badge tone={overdue ? "red" : "green"} icon={overdue ? AlertTriangle : CheckCircle2}>{t("وصل إلى الوجهة", "Arrived")}{overdue ? ` ${dayLabel(localDateString(phase.at), new Date(), en)}` : ""} <span dir="ltr" className="tabular">{timeLabel(phase.at)}</span></Badge>
                : <Badge tone="cyan" icon={CheckCircle2}>{t("تم استلام الضيف", "Guest picked up")}</Badge>}
            {nurseTrip && <Badge tone={nurseWaiting ? "amber" : "green"} icon={Stethoscope}>{nurseTripText(nurseTrip, en)}</Badge>}
            {next && <Badge tone="cyan" icon={ArrowLeftRight}>{t("موعد آخر", "Next appointment")} <span dir="ltr" className="tabular">{next.appointmentAt}</span></Badge>}
            {/* رحلة غير طبية بعودة تلقائية: تُطلب سيارتها وحدها قبل وقتها بنصف ساعة */}
            {appointment.returnAt && !overdue && <Badge tone="blue" icon={RotateCcw}>{t("عودة تلقائية", "Automatic return")} <span dir="ltr" className="tabular">{appointment.returnAt}</span></Badge>}
          </>}
        />
      )}
      action={primary}
    >
      <GuestDetails appointment={appointment} request={request} driver={driver} persons={persons} />
      {overdue && <Note tone="red" icon={AlertTriangle}>{t("لم تُطلب له سيارة عودة ولم يُسجَّل أنه عاد بنفسه. تأكد من حالته.", "No return car was requested and no self return was recorded. Check on them.")}</Note>}
      {next && (
        <Note tone="cyan" icon={ArrowLeftRight}>
          {t("للضيف موعد آخر اليوم الساعة", "The guest has another appointment today at")} <span dir="ltr" className="font-semibold tabular">{next.appointmentAt}</span> {t("في", "in")} {place(next)}
        </Note>
      )}
      <div className={moreActions}>
        {(next || overdue) && returnButton}
        {hasNurse(appointment) && !nurseTrip && (
          <button
            onClick={() => window.confirm(t(`طلب سيارة لعودة الـ Nurse وحدها إلى المجمع؟ يبقى ${appointment.patientName} في موعده، وتُطلب عودته لاحقًا.`, `Request a car for the nurse alone back to the complex? ${name} stays at the appointment, and their return is requested later.`)) && onNurseReturn(appointment, request)}
            className={btn("secondary")}
          >
            <Stethoscope className="h-4 w-4" /> {t("عودة الـ Nurse فقط", "Nurse return only")}
          </button>
        )}
        {!overdue && selfButton}
      </div>
    </Expandable>
  );
}
