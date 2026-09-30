import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Accessibility, AlertTriangle, ArrowLeftRight, Ban, BellRing, Building2, Check, CheckCircle2, ChevronDown, Clock3, Footprints, Hospital, Link2, MapPin, Ribbon, RotateCcw, ShieldCheck, Smartphone, Stethoscope, Timer, Truck, Users, XCircle } from "lucide-react";
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
  requestWindow,
  sameDayAppointments,
  personsText,
  requestPersons,
  statusText,
  tripPersons,
  type ClinicAppointment,
  type UnrequestedMatch,
  type Vehicle,
  type VehicleRequest,
} from "@shared/transport";
import { LATE_MINUTES, minutesSince, tripEndpoints, tripPhase, type TripPhase } from "@shared/trips";
import { distanceKm } from "@shared/hospitals";
import { checkLabel, checkStateText, countdownText, driverCheck, pendingCheck, type CheckKind } from "@shared/driverChecks";
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
import { useHospitals, useLiveVehicles, useNow } from "@/lib/useShared";

/** حالات الطلب قبل استلام المريض (السيارة لم تصل أو لم تُرسل بعد). */
const BEFORE_PICKUP: VehicleRequest["status"][] = ["بانتظار التوزيع", "تم إرسال السيارة", "وصلت السيارة"];
const OUTBOUND_STEPS = ["طُلبت السيارة", "أُرسلت", "وصلت السيارة", "استُلم الضيف", "الوجهة"];
const RETURN_STEPS = ["طُلبت العودة", "أُرسلت", "وصلت السيارة", "استُلم الضيف"];
const NURSE_STEPS = ["طُلبت عودة الـ Nurse", "أُرسلت", "وصلت السيارة", "استُلمت الـ Nurse"];
/** ضيوف ذهبوا في أيام سابقة ولم تُسجَّل عودتهم: يُنبَّه عنهم هذا العدد من الأيام */
export const UNRETURNED_DAYS = 7;


type Row = { appointment: ClinicAppointment; request?: VehicleRequest };
type Stage = "request" | "expired" | "progress" | "atAppointment";
type RequestHandlers = {
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
    direction: "ذهاب",
    status: "بانتظار التوزيع",
    notificationMethod: "whatsapp",
    createdAt: timeLabel(new Date()),
  };
}

export function SupervisorHome({ uid, lead = false, appointments, requests, vehicles, onRequest, onUpdateRequest, onCancel, onReturn, onTransfer, onCancelAppointment, onCheckReply, onNurseReturn, onSelfReturn }: {
  /** رقم حساب المشرف: يرى متابعة طلباته هو فقط */
  uid: string;
  /** مسؤول مشرفي المباني: يتابع كل الطلبات (يؤكد وصول السيارة واستلام الضيف ويرد على السائق في أي طلب) */
  lead?: boolean;
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  /** السيارات: رقم هاتف سائق السيارة المرسلة للاتصال به */
  vehicles: Vehicle[];
} & RequestHandlers) {
  const [buildings, setBuildings] = useState<string[]>(loadBuildings);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const now = useNow();
  const hospitals = useHospitals();
  const liveGps = useLiveVehicles(now);
  const today = localDateString(now);

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
  const fromOf = (request?: VehicleRequest) => (request?.fromAppointmentId ? appointments.find((item) => item.id === request.fromAppointmentId) ?? null : null);
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

  // فلتر المباني: اختيار مبنى أو أكثر، ويُحفظ على هذا الجهاز
  const buildingCounts = new Map<string, number>();
  for (const appointment of [...visible.map((row) => row.appointment), ...pastAtAppointment]) {
    buildingCounts.set(appointment.buildingNumber, (buildingCounts.get(appointment.buildingNumber) ?? 0) + 1);
  }
  const buildingNumbers = Array.from(new Set([...Array.from(buildingCounts.keys()), ...buildings]))
    .sort((first, second) => first.localeCompare(second, "ar", { numeric: true }));
  const inFilter = (appointment: ClinicAppointment) => !buildings.length || buildings.includes(appointment.buildingNumber);
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
  const openUnrequested = todays.filter((appointment) => appointment.status === "بانتظار طلب السيارة" && !latest.has(appointment.id) && requestWindow(appointment, now).open);
  const partnerOf = (appointment: ClinicAppointment) => openUnrequested.find((other) => {
    if (other.id === appointment.id) return false;
    const details = calculateTripGroupingScore(appointment, other, hospitals);
    return details.timeGapMinutes <= 30 && (details.sameDestination || details.nearbyDestination);
  });
  const dayOf = (appointment: ClinicAppointment) => (appointment.appointmentDate === today ? undefined : formatDay(appointment.appointmentDate, now));
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
  useCheckAlerts(progressRows);
  useUnreturnedAlert(unreturned.length);

  return (
    <>
      <PageHeader
        title={lead ? "كل طلبات السيارات" : "طلبات السيارات"}
        subtitle={`${longDate(today)} · مواعيد اليوم${lead ? " · طلبات كل مشرفي المباني" : ""}`}
        actions={<BuildingFilter all={visible.length + pastAtAppointment.length} counts={buildingCounts} buildings={buildingNumbers} selected={buildings} onChange={chooseBuildings} />}
      />

      {/* شريط الحالة: عدادات حية ملونة، والضغط ينقل إلى القسم */}
      <div className="mb-6">
        <StatusBar
          label="حالة طلبات اليوم"
          items={[
            { key: "request", label: "تحتاج طلب سيارة", value: toRequest.length, tone: "amber", hint: matchCount ? `${matchCount} لنفس وجهة رحلة قائمة` : `حتى ${REQUEST_GRACE_MINUTES} د بعد الموعد`, onClick: () => jump("sup-request") },
            { key: "progress", label: "طلبات جارية", value: progressRows.length, tone: "blue", hint: "حتى وصول السيارة إلى الوجهة", onClick: () => jump("sup-progress") },
            { key: "at", label: "ضيوف في الموعد", value: atAppointment.length, tone: "cyan", hint: `${completed} مكتملة اليوم`, onClick: () => jump("sup-at") },
            { key: "attention", label: "تحتاج انتباهك", value: attentionRows.length + unreturned.length, tone: "red", hint: `${attentionRows.length} تأخر أو تأكيد · ${unreturned.length} لم تُسجَّل عودتهم`, onClick: () => jump(unreturned.length ? "sup-unreturned" : "sup-progress") },
          ]}
        />
      </div>

      <div className="space-y-6">
        {unreturned.length > 0 && (
          <Panel id="sup-unreturned" tone="red" icon={AlertTriangle} title="لم تُسجَّل عودتهم" count={unreturned.length} description="ذهبوا إلى مواعيد في أيام سابقة ولم تُطلب لهم سيارة عودة ولم يُسجَّل أنهم عادوا بأنفسهم. تأكد من حالة كل ضيف: هل عاد بنفسه؟">
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

        <Panel id="sup-request" tone="amber" icon={BellRing} title="مواعيد تحتاج طلب سيارة" count={toRequest.length} description={`يمكن الطلب حتى ${REQUEST_GRACE_MINUTES} دقيقة بعد وقت الموعد`}>
          {toRequest.length ? (
            <div className="divide-y divide-slate-100">
              {toRequest.map(({ appointment }) => (
                <RequestRow
                  key={appointment.id}
                  appointment={appointment}
                  day={dayOf(appointment)}
                  match={matches.get(appointment.id)}
                  partner={partnerOf(appointment)}
                  earlier={sameDayAppointments(appointment, appointments).find((other) => other.appointmentAt < appointment.appointmentAt && other.status !== "مكتملة")}
                  now={now}
                  onRequest={onRequest}
                  onCancelAppointment={() => setCancelling({ appointment })}
                />
              ))}
            </div>
          ) : <EmptyState icon={CheckCircle2} title="لا توجد مواعيد بانتظار طلب سيارة" hint="تظهر هنا مواعيد العيادات لليوم حتى يُطلب لها سيارة" />}
        </Panel>

        <Panel id="sup-progress" tone="blue" icon={Truck} title="طلبات جارية" count={progressRows.length} description={lead ? "طلبات كل مشرفي المباني حتى وصول السيارة إلى الوجهة" : "طلباتك حتى وصول السيارة إلى الوجهة"}>
          {progressRows.length ? (
            <div className="divide-y divide-slate-100">
              {progressRows.map(({ appointment, request }) => (
                <ProgressRow
                  key={request.id}
                  appointment={appointment}
                  request={request}
                  byOther={lead && Boolean(request.requestedBy) && request.requestedBy !== uid}
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
          ) : <EmptyState icon={Truck} title="لا توجد طلبات جارية" />}
        </Panel>

        {atAppointment.length > 0 && (
          <Panel id="sup-at" tone="cyan" icon={Hospital} title="ضيوف في الموعد" count={atAppointment.length} description="وصلوا إلى الوجهة · عند انتهاء الموعد يطلب أي مشرف سيارة العودة أو النقل إلى موعد الضيف التالي، أو يسجّل أنه عاد بنفسه">
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
          <Panel tone="red" icon={XCircle} title="انتهت مهلة الطلب" count={expired.length} description={`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد، ويجب أن تعدّل العيادة الموعد أولًا`}>
            <div className="divide-y divide-slate-100">
              {expired.map(({ appointment }) => (
                <Expandable
                  key={appointment.id}
                  label={`تفاصيل موعد ${appointment.patientName}`}
                  summary={<GuestSummary appointment={appointment} day={dayOf(appointment)} timeTone="red" status={<Badge tone="red" icon={Clock3}>بانتظار تعديل العيادة</Badge>} />}
                >
                  <GuestDetails appointment={appointment} />
                  {canCancelAppointment(appointment) && <div className={moreActions}><CancelAppointmentButton onClick={() => setCancelling({ appointment })} /></div>}
                </Expandable>
              ))}
            </div>
          </Panel>
        )}

        {cancelled.length > 0 && (
          <Panel icon={Ban} title="مواعيد ملغاة" count={cancelled.length} description="أُلغيت اليوم مع سبب الإلغاء">
            <div className="divide-y divide-slate-100">
              {cancelled.map((appointment) => (
                <Expandable
                  key={appointment.id}
                  label={`تفاصيل موعد ${appointment.patientName} الملغي`}
                  summary={(
                    <GuestSummary
                      appointment={appointment}
                      day={dayOf(appointment)}
                      status={<span className="inline-flex min-w-0 items-center gap-1 text-xs text-red-700"><Ban className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{appointment.cancelReason || "ملغي"}</span></span>}
                    />
                  )}
                >
                  <GuestDetails appointment={appointment} />
                  <Note tone="red" icon={Ban}>
                    <span className="font-semibold">سبب الإلغاء:</span> {appointment.cancelReason || "—"}
                    {appointment.cancelledBy && <span className="text-red-700/80"> · {appointment.cancelledBy}{appointment.cancelledAt && !Number.isNaN(Date.parse(appointment.cancelledAt)) ? ` ${timeLabel(new Date(appointment.cancelledAt))}` : ""}</span>}
                  </Note>
                </Expandable>
              ))}
            </div>
          </Panel>
        )}
      </div>

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
    </>
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
  return <button type="button" onClick={onClick} className={cx(btn("ghost", "sm"), "text-red-600 hover:bg-red-50 hover:text-red-700")}><Ban className="h-4 w-4" /> إلغاء الموعد</button>;
}

/** إلغاء الموعد: سبب إلزامي (من الأسباب الجاهزة أو مكتوب). */
function CancelDialog({ appointment, request, onClose, onConfirm }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
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
      title={`إلغاء موعد ${appointment.patientName}`}
      description={`${appointment.appointmentAt} · ${appointmentPickupLabel(appointment)} ← ${appointment.clinic}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>رجوع</button>
          <button type="button" disabled={!valid} onClick={() => onConfirm(reason.slice(0, 300))} className={cx(btn("primary"), "bg-red-600 hover:bg-red-700")}><Ban className="h-4 w-4" /> إلغاء الموعد</button>
        </>
      )}
    >
      {request && (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900 ring-1 ring-inset ring-amber-200">
          {carOnWay
            ? <>سيُلغى أيضًا طلب السيارة <span dir="ltr" className="font-semibold">{request.vehiclePlate}</span> وتصل رسالة لمشرف السيارات ليبلغ السائق.</>
            : "سيُلغى أيضًا طلب السيارة المرسل إلى مشرف السيارات."}
        </p>
      )}
      <fieldset>
        <legend className={labelClass}>سبب الإلغاء <span className="text-red-600">*</span></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {[...CANCEL_REASONS, "other"].map((item) => (
            <button key={item} type="button" aria-pressed={preset === item} onClick={() => setPreset(item)} className={cx(choiceClass(preset === item), "min-h-10 text-start")}>
              {item === "other" ? "سبب آخر" : item}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className={labelClass}>{other ? "اكتب السبب" : "تفاصيل (اختياري)"}{other && <span className="text-red-600"> *</span>}</span>
        <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={200} rows={2} placeholder={other ? "مثال: الضيف في المستشفى منذ أمس" : "أي ملاحظة لمشرف السيارات والعيادة"} className={cx(inputClass, "h-auto py-2.5")} />
      </label>
      {!valid && preset && <p className="mt-2 text-xs text-red-600">اكتب السبب (3 أحرف على الأقل)</p>}
    </Modal>
  );
}

/**
 * تنبيه في الصفحة (مع صوت قصير) عندما يسجّل السائق من تطبيقه وصوله أو استلام الضيف في طلب يتابعه المشرف،
 * حتى يؤكده أو ينفيه خلال المهلة. ما كان ينتظر الرد عند فتح الصفحة لا يُنبَّه له.
 */
function useCheckAlerts(rows: Required<Row>[]) {
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
      toast.warning(`السائق سجّل ${check.kind === "arrival" ? "وصول السيارة" : request.nurseOnly ? "استلام الـ Nurse" : "استلام الضيف"}: ${request.nurseOnly ? `الـ Nurse · ${appointment.patientName}` : appointment.patientName}`, {
        description: `السيارة ${request.vehiclePlate ?? ""} · أكّد أو انفِ خلال 5 دقائق، وإلا يُقبل تلقائيًا`,
        duration: 20000,
      });
    }
    beep();
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** تنبيه عند فتح الصفحة (وعند زيادة العدد) بضيوف لم تُسجَّل عودتهم من أيام سابقة. */
function useUnreturnedAlert(count: number) {
  const shown = useRef(0);
  useEffect(() => {
    if (count > shown.current) {
      toast.error(`${count === 1 ? "ضيف لم تُسجَّل عودته" : `${count} ضيوف لم تُسجَّل عودتهم`} من أيام سابقة`, {
        description: "تأكد من حالتهم في «لم تُسجَّل عودتهم» أعلى الصفحة: هل عادوا بأنفسهم؟",
        duration: 15000,
      });
    }
    shown.current = count;
  }, [count]);
}

const distanceText = (meters: number) => (meters < 1000 ? `${meters} م` : `${(meters / 1000).toFixed(1)} كم`);

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
  const now = useNow(1000);
  const hospitals = useHospitals();
  const check = pendingCheck(request, now);
  // عودة الـ Nurse فقط: الراكب هو الـ Nurse. (قبل سطر النتيجة الذي يستعمله بعد الرد أو انتهاء المهلة)
  const rider = (text: string) => (request.nurseOnly ? text.replace("الضيف", "الـ Nurse") : text);
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
            {rider(checkStateText(item))}
          </li>
        ))}
      </ul>
    );
  }
  const point = check.kind === "arrival" ? request.arrivalGps : request.pickupGps;
  const pickup = tripEndpoints(appointment, request.direction, hospitals, from).from;
  const meters = point && pickup ? Math.round(distanceKm(point, pickup) * 1000) : null;
  const far = meters !== null && meters > 800;
  const what = rider(checkLabel(check.kind));
  return (
    <div role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-300">
      <p className="flex items-start gap-1.5 text-sm font-semibold text-amber-950">
        <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
        <span>السائق سجّل {what} من تطبيقه الساعة <span dir="ltr" className="tabular">{timeLabel(check.at)}</span></span>
      </p>
      {meters !== null && (
        <p className={cx("mt-1 flex items-center gap-1.5 text-xs", far ? "font-semibold text-red-700" : "text-amber-900")}>
          <MapPin className="h-3.5 w-3.5 shrink-0" /> موقع هاتفه لحظتها على بعد {distanceText(meters)} من نقطة الاستلام{far ? " · بعيد عن المكان" : ""}
        </p>
      )}
      <p className="mt-1 text-xs text-amber-900">
        أكّد أو انفِ خلال <span dir="ltr" className="font-semibold tabular">{countdownText(check.secondsLeft)}</span>، وإلا يُقبل تلقائيًا. يستطيع السائق المتابعة قبل تأكيدك.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => onReply(check.kind, "confirmed")} className={btn("success", "sm")}>
          <CheckCircle2 className="h-4 w-4" /> تأكيد {check.kind === "arrival" ? "الوصول" : "الاستلام"}
        </button>
        <button
          type="button"
          onClick={() => window.confirm(check.kind === "arrival"
            ? "السيارة لم تصل فعلًا؟ ستعود الرحلة إلى «تم إرسال السيارة» ويصل تنبيه لمشرف السيارات والسائق."
            : rider("الضيف لم يُستلم فعلًا؟ ستعود الرحلة إلى «وصلت السيارة» ويصل تنبيه لمشرف السيارات والسائق.")) && onReply(check.kind, "denied")}
          className={btn("danger", "sm")}
        >
          <XCircle className="h-4 w-4" /> {check.kind === "arrival" ? "لم تصل السيارة" : request.nurseOnly ? "لم تُستلم الـ Nurse" : "لم يُستلم الضيف"}
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
  const pickup = from ? from.clinic : appointmentPickupLabel(appointment);
  const returning = request?.direction === "عودة";
  return (
    <>
      <TimeBlock time={appointment.appointmentAt} day={day} tone={timeTone} />
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-ink">
            {request?.nurseOnly ? <>الـ Nurse <span className="font-normal text-slate-500">· مرافقة {appointment.patientName}</span></> : appointment.patientName}
          </span>
          {request && (from
            ? <Badge tone="cyan" icon={ArrowLeftRight}>نقل بين موعدين</Badge>
            : request.nurseOnly ? <Badge tone="amber" icon={Stethoscope}>عودة الـ Nurse فقط</Badge> : <Badge tone={returning ? "amber" : "neutral"}>{request.direction}</Badge>)}
          {isNonMedical(appointment) && <Badge tone="violet">غير طبية</Badge>}
          {appointment.kind === "احتياجات خاصة" && <Badge icon={Accessibility}>احتياجات خاصة</Badge>}
          {appointment.cancer && <Badge tone="red" icon={Ribbon}>أولوية · حالة سرطان</Badge>}
        </span>
        <span className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">{returning ? appointment.clinic : pickup} ← <span className="font-medium text-slate-800">{returning ? pickup : appointment.clinic}</span></span>
        </span>
        {status && <span className="mt-2 flex flex-wrap items-center gap-1.5">{status}</span>}
      </span>
    </>
  );
}

/** تفاصيل البطاقة المفتوحة: الاتصال بالضيف وواتساب، واحتياجاته وعدد الأشخاص والسيارة. */
function GuestDetails({ appointment, request, driver, persons }: {
  appointment: ClinicAppointment;
  request?: VehicleRequest;
  driver?: string;
  /** عدد الأشخاص في الرحلة (الضيف ومرافقه والـ Nurse، أو الـ Nurse وحدها) */
  persons?: number;
}) {
  const assistance = appointment.assistance.join("، ");
  const count = persons ?? tripPersons(appointment, request);
  return (
    <div className="space-y-2.5">
      {appointment.mobile && appointment.mobile !== "-" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-700">
          <span className="text-xs font-medium text-slate-500">هاتف الضيف</span>
          <GuestContact mobile={appointment.mobile} size="md" />
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {appointment.gender && <span>{appointment.gender}</span>}
        {assistance && !request?.nurseOnly && <span className="inline-flex items-center gap-1"><Accessibility className="h-3.5 w-3.5" />{assistance}</span>}
        <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{personsText(count)}</span>
        {request?.vehiclePlate && (
          <span className="inline-flex items-center gap-1 text-slate-600">
            <Truck className="h-3.5 w-3.5" /><span dir="ltr" className="font-semibold text-ink">{request.vehiclePlate}</span>{driver ? ` · ${driver}` : ""}
            {request.groupId && <Badge tone="violet" className="ms-1">رحلة مجمّعة</Badge>}
          </span>
        )}
      </p>
    </div>
  );
}

function RequestRow({ appointment, day, match, partner, earlier, now, onRequest, onCancelAppointment }: {
  appointment: ClinicAppointment;
  day?: string;
  match?: UnrequestedMatch;
  partner?: ClinicAppointment;
  /** موعد سابق للضيف نفسه اليوم: يمكن نقله منه مباشرة إلى هذا الموعد */
  earlier?: ClinicAppointment;
  now: Date;
  onRequest: RequestHandlers["onRequest"];
  onCancelAppointment: () => void;
}) {
  const deadline = requestWindow(appointment, now);

  function requestCar() {
    if (!requestWindow(appointment).open) {
      toast.error(`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد. يجب أن تعدّل العيادة الموعد أولًا.`);
      return;
    }
    if (!canRequestVehicle(appointment)) {
      toast.error("لا يوجد موعد قابل للطلب");
      return;
    }
    onRequest(newRequest(appointment), appointment.id);
  }

  return (
    <Expandable
      label={`تفاصيل موعد ${appointment.patientName}`}
      summary={(
        <GuestSummary
          appointment={appointment}
          day={day}
          status={<>
            <span className={cx("inline-flex items-center gap-1 text-xs", deadline.minutesLeft <= 15 ? "font-semibold text-red-600" : "text-slate-500")}>
              <Clock3 className="h-3.5 w-3.5" /> آخر موعد للطلب <span dir="ltr" className="tabular">{timeLabel(deadline.deadline)}</span>
            </span>
            {match
              ? <Badge tone="amber" icon={BellRing}>{match.sameDestination ? "نفس وجهة رحلة قائمة" : "وجهة مجاورة لرحلة قائمة"}</Badge>
              : partner && <Badge tone="violet" icon={Link2}>رحلة مشتركة ممكنة</Badge>}
            {earlier && <Badge tone="cyan" icon={ArrowLeftRight}>بعد موعد سابق اليوم</Badge>}
          </>}
        />
      )}
      action={<button onClick={requestCar} className={btn("primary")}><BellRing className="h-4 w-4" /> طلب السيارة</button>}
    >
      <GuestDetails appointment={appointment} />
      {earlier && (
        <Note tone="cyan" icon={ArrowLeftRight}>
          للضيف موعد سابق اليوم الساعة <span dir="ltr" className="font-semibold tabular">{earlier.appointmentAt}</span> في {earlier.clinic}. عند انتهائه يمكن نقله مباشرة إلى هذا الموعد من «ضيوف في الموعد»، بدل طلب سيارة من المجمع.
        </Note>
      )}
      {match ? (
        <Note tone="amber" icon={BellRing}>
          <span className="font-semibold">{match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} رحلة {match.matchedAppointment.patientName}</span> (مبنى {match.matchedAppointment.buildingNumber}، {match.matchedAppointment.appointmentAt} · {match.matchedRequest.status}). اطلب الآن لتُجمع معها.
        </Note>
      ) : partner && (
        <Note tone="violet" icon={Link2}>رحلة مشتركة ممكنة مع {partner.patientName} (مبنى {partner.buildingNumber}، {partner.appointmentAt})</Note>
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
  const returning = request.direction === "عودة";
  // الذهاب: بعد الاستلام تبقى الرحلة هنا «في الطريق إلى الوجهة» حتى تصل
  const step = request.status === "بانتظار التوزيع" ? 0 : request.status === "تم إرسال السيارة" ? 1 : request.status === "وصلت السيارة" ? 2 : returning ? 3 : 4;
  const next = request.status === "تم إرسال السيارة"
    ? { label: "وصلت السيارة", status: "وصلت السيارة" as const }
    : request.status === "وصلت السيارة"
      ? { label: request.nurseOnly ? "تم استلام الـ Nurse" : "تم استلام الضيف", status: "تم استلام المريض" as const }
      : null;
  const canCancel = request.status === "بانتظار التوزيع" || request.status === "تم إرسال السيارة";
  // عودة الـ Nurse فقط: الراكب هو الـ Nurse
  const rider = (text: string) => (request.nurseOnly ? text.replace("الضيف", "الـ Nurse") : text);
  const check = pendingCheck(request, now);
  const late = lateMinutes(request, now);
  const status = check
    ? <Badge tone="amber" icon={Smartphone}>السائق سجّل {rider(checkLabel(check.kind))} · بانتظار ردك</Badge>
    : phase.kind === "toDestination"
      ? <Badge tone="blue" icon={Timer}>في الطريق · الوصول المتوقع <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span>{phase.late ? " (متأخرة)" : ""}</Badge>
      : late !== null
        ? <Badge tone="red" icon={AlertTriangle}>تأخرت السيارة · {late} د</Badge>
        : <Badge tone={step === 0 ? "amber" : "blue"}>{step === 0 ? "بانتظار إرسال سيارة" : rider(statusText(request.status))}</Badge>;
  return (
    <Expandable
      label={`تفاصيل طلب ${request.nurseOnly ? `الـ Nurse مرافقة ${appointment.patientName}` : appointment.patientName}`}
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
            {byOther && <Badge tone="violet" icon={Building2}>طلب مشرف مبنى آخر</Badge>}
          </>}
        />
      )}
      action={next && <button onClick={() => onUpdateRequest(request.id, next.status)} className={btn("dark")}><CheckCircle2 className="h-4 w-4" /> {next.label}</button>}
    >
      <GuestDetails appointment={appointment} request={request} driver={driver} persons={persons} />
      {byOther && request.createdAt && <p className="mt-2 flex items-center gap-1 text-xs text-violet-700"><Building2 className="h-3.5 w-3.5" /> طلبه مشرف مبنى آخر الساعة {request.createdAt}</p>}
      <div className="mt-3"><Steps steps={request.nurseOnly ? NURSE_STEPS : returning ? RETURN_STEPS : OUTBOUND_STEPS} current={step} /></div>
      {(request.arrivalCheck || request.pickupCheck) && (
        <DriverCheckBox request={request} appointment={appointment} from={from} onReply={(kind, reply) => onCheckReply(request, kind, reply)} />
      )}
      {request.status === "بانتظار التوزيع" && <p className="mt-2 text-xs text-slate-500">بانتظار أن يرسل مشرف السيارات سيارة{from ? ` إلى ${from.clinic}` : ""}</p>}
      {driverPhone && (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") && (
        <DriverCall request={request} driver={driver} phone={driverPhone} now={now} />
      )}
      {phase.kind === "toDestination" && <p className="mt-2 text-xs text-slate-500">يُتاح طلب العودة بعد وصول السيارة إلى الوجهة</p>}
      {(canCancel || onCancelAppointment) && (
        <div className={moreActions}>
          {canCancel && <button onClick={() => window.confirm(request.nurseOnly ? "إلغاء طلب عودة الـ Nurse؟ يبقى الضيف في موعده." : "إلغاء طلب السيارة فقط؟ يبقى الموعد ويمكن طلب سيارة له من جديد.") && onCancel(appointment, request)} className={btn("danger", "sm")}><XCircle className="h-4 w-4" /> إلغاء طلب السيارة</button>}
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
  return (
    <div className={cx("mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2.5 text-xs", late ? "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-300" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200/80")}>
      <span className={cx("inline-flex items-center gap-1", late && "font-semibold")}>
        {late ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <Truck className="h-3.5 w-3.5 shrink-0" />}
        {late ? `تأخرت السيارة: مضت ${minutes} دقيقة على إرسالها ولم تصل` : `السائق${driver ? ` ${driver}` : ""}${minutes !== null ? ` · أُرسلت منذ ${minutes} د` : ""}`}
      </span>
      <GuestContact mobile={phone} size="md" labels={{ call: "اتصال بالسائق", whatsapp: "واتساب" }} />
    </div>
  );
}

/** حالة عودة الـ Nurse وحدها: بانتظار السيارة، أو في الطريق، أو عادت. */
function nurseTripText(request: VehicleRequest) {
  if (request.status === "بانتظار التوزيع") return "عودة الـ Nurse: بانتظار سيارة";
  if (request.status === "تم إرسال السيارة" || request.status === "وصلت السيارة") return `عودة الـ Nurse: ${statusText(request.status)}${request.vehiclePlate ? ` (${request.vehiclePlate})` : ""}`;
  return "عادت الـ Nurse إلى المجمع";
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
  // الـ Nurse بانتظار سيارتها: طلب عودة الضيف يضمه إلى نفس الطلب
  const nurseWaiting = Boolean(nurseTrip && BEFORE_PICKUP.includes(nurseTrip.status));
  const returnButton = (
    <button key="return" onClick={() => onReturn(appointment, request)} className={btn(overdue || next ? "secondary" : "soft")}>
      <RotateCcw className="h-4 w-4" /> {nurseWaiting ? "عودة الضيف مع الـ Nurse" : next ? "العودة إلى المجمع" : "طلب العودة"}
    </button>
  );
  const selfButton = (
    <button
      key="self"
      onClick={() => window.confirm(`تأكيد أن ${appointment.patientName} عاد إلى المجمع بنفسه؟ ينتهي موعده بلا سيارة عودة.`) && onSelfReturn(appointment)}
      className={cx(btn(overdue ? "success" : "ghost"), !overdue && "text-emerald-700 hover:bg-emerald-50")}
    >
      <Footprints className="h-4 w-4" /> عاد بنفسه
    </button>
  );
  // الإجراء الرئيسي ظاهر في البطاقة المطوية: النقل إلى الموعد التالي، أو «عاد بنفسه» لمن لم تُسجَّل عودته، أو طلب العودة
  const primary = next
    ? (
      <button onClick={() => onTransfer(appointment, request, next)} className={btn("primary")}>
        <ArrowLeftRight className="h-4 w-4" /> إلى الموعد التالي <span dir="ltr" className="tabular">{next.appointmentAt}</span>
      </button>
    )
    : overdue ? selfButton : returnButton;
  return (
    <Expandable
      label={`تفاصيل ${appointment.patientName} في الموعد`}
      summary={(
        <GuestSummary
          appointment={appointment}
          request={request}
          day={day}
          timeTone={overdue ? "red" : undefined}
          status={<>
            {phase.kind === "toDestination"
              ? <Badge tone="blue" icon={Timer}>في الطريق · الوصول المتوقع <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span></Badge>
              : phase.kind === "arrived" && phase.at
                ? <Badge tone={overdue ? "red" : "green"} icon={overdue ? AlertTriangle : CheckCircle2}>وصل إلى الوجهة{overdue ? ` ${formatDay(localDateString(phase.at), new Date())}` : ""} <span dir="ltr" className="tabular">{timeLabel(phase.at)}</span></Badge>
                : <Badge tone="cyan" icon={CheckCircle2}>تم استلام الضيف</Badge>}
            {nurseTrip && <Badge tone={nurseWaiting ? "amber" : "green"} icon={Stethoscope}>{nurseTripText(nurseTrip)}</Badge>}
            {next && <Badge tone="cyan" icon={ArrowLeftRight}>موعد آخر <span dir="ltr" className="tabular">{next.appointmentAt}</span></Badge>}
          </>}
        />
      )}
      action={primary}
    >
      <GuestDetails appointment={appointment} request={request} driver={driver} persons={persons} />
      {overdue && <Note tone="red" icon={AlertTriangle}>لم تُطلب له سيارة عودة ولم يُسجَّل أنه عاد بنفسه. تأكد من حالته.</Note>}
      {next && (
        <Note tone="cyan" icon={ArrowLeftRight}>
          للضيف موعد آخر اليوم الساعة <span dir="ltr" className="font-semibold tabular">{next.appointmentAt}</span> في {next.clinic}
        </Note>
      )}
      <div className={moreActions}>
        {(next || overdue) && returnButton}
        {hasNurse(appointment) && !nurseTrip && (
          <button
            onClick={() => window.confirm(`طلب سيارة لعودة الـ Nurse وحدها إلى المجمع؟ يبقى ${appointment.patientName} في موعده، وتُطلب عودته لاحقًا.`) && onNurseReturn(appointment, request)}
            className={btn("secondary")}
          >
            <Stethoscope className="h-4 w-4" /> عودة الـ Nurse فقط
          </button>
        )}
        {!overdue && selfButton}
      </div>
    </Expandable>
  );
}
