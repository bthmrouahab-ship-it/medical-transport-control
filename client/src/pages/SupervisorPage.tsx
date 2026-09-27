import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Accessibility, Ban, BellRing, Building2, Check, CheckCircle2, ChevronDown, Hospital, Link2, MessageCircle, Phone, RotateCcw, Timer, Truck, XCircle } from "lucide-react";
import {
  CANCEL_REASONS,
  appointmentPickupLabel,
  calculateTripGroupingScore,
  canCancelAppointment,
  canRequestVehicle,
  findUnrequestedMatches,
  followsRequest,
  isNonMedical,
  localDateString,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type ClinicAppointment,
  type UnrequestedMatch,
  type VehicleRequest,
} from "@shared/transport";
import { tripPhase, type TripPhase } from "@shared/trips";
import {
  Badge,
  EmptyState,
  Modal,
  Panel,
  PageHeader,
  Segmented,
  Stat,
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
const OUTBOUND_STEPS = ["طُلبت السيارة", "أُرسلت", "وصلت السيارة", "استُلم المريض", "الوجهة"];
const RETURN_STEPS = ["طُلبت العودة", "أُرسلت", "وصلت السيارة", "استُلم المريض"];

type Row = { appointment: ClinicAppointment; request?: VehicleRequest };
type Stage = "request" | "expired" | "progress" | "atAppointment";
type RequestHandlers = {
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  /** إلغاء الموعد نفسه (مع طلب السيارة القائم إن وُجد) بسبب مكتوب */
  onCancelAppointment: (appointment: ClinicAppointment, reason: string, request?: VehicleRequest) => void;
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

function newRequest(appointment: ClinicAppointment, method: VehicleRequest["notificationMethod"]): VehicleRequest {
  return {
    id: `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    appointmentId: appointment.id,
    direction: "ذهاب",
    status: "بانتظار التوزيع",
    notificationMethod: method,
    createdAt: timeLabel(new Date()),
  };
}

export function SupervisorHome({ uid, appointments, requests, onRequest, onUpdateRequest, onCancel, onReturn, onCancelAppointment }: {
  /** رقم حساب المشرف: يرى متابعة طلباته هو فقط */
  uid: string;
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
} & RequestHandlers) {
  const [buildings, setBuildings] = useState<string[]>(loadBuildings);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const now = useNow();
  const hospitals = useHospitals();
  const liveGps = useLiveVehicles(now);
  const today = localDateString(now);

  // آخر طلب لكل موعد (الذهاب، ثم العودة إن طُلبت)
  const latest = new Map<string, VehicleRequest>();
  for (const request of requests) latest.set(request.appointmentId, request);
  const phaseOf = (request: VehicleRequest) => tripPhase(request, now, Boolean(request.vehiclePlate && liveGps.has(request.vehiclePlate)));

  // مواعيد اليوم فقط، مع أي رحلة من يوم سابق لم يُستلم مريضها بعد (مثل عودة بعد منتصف الليل)
  const activeIds = new Set(requests.filter((request) => BEFORE_PICKUP.includes(request.status)).map((request) => request.appointmentId));
  const todays = appointments.filter((appointment) => appointment.appointmentDate === today
    || (appointment.appointmentDate < today && activeIds.has(appointment.id)));

  /**
   * أين يظهر الموعد الآن، أو null إن لم يكن لهذا المشرف:
   * - متابعة طلب الذهاب حتى وصول السيارة إلى الوجهة لمن طلبها فقط.
   * - بعد وصول الوجهة (مرضى في الموعد): لكل مشرفي المباني، وأي مشرف يطلب العودة.
   * - متابعة طلب العودة (وصول السيارة واستلام المريض) لمن طلبها فقط.
   */
  const stageOf = (appointment: ClinicAppointment): Stage | null => {
    const request = latest.get(appointment.id);
    if (!request) return requestWindow(appointment, now).open ? "request" : "expired";
    if (request.direction === "عودة") return followsRequest(request, uid) ? "progress" : null;
    if (BEFORE_PICKUP.includes(request.status)) return followsRequest(request, uid) ? "progress" : null;
    if (phaseOf(request).kind === "arrived") return "atAppointment";
    return followsRequest(request, uid) ? "progress" : null;
  };
  const visible = todays
    .filter((appointment) => appointment.status !== "مكتملة" && appointment.status !== "ملغي")
    .flatMap((appointment) => {
      const stage = stageOf(appointment);
      return stage ? [{ appointment, request: latest.get(appointment.id), stage }] : [];
    });

  // فلتر المباني: اختيار مبنى أو أكثر، ويُحفظ على هذا الجهاز
  const buildingCounts = new Map<string, number>();
  for (const { appointment } of visible) buildingCounts.set(appointment.buildingNumber, (buildingCounts.get(appointment.buildingNumber) ?? 0) + 1);
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

  return (
    <>
      <PageHeader
        title="طلبات السيارات"
        subtitle={`${longDate(today)} · مواعيد اليوم`}
        actions={<BuildingFilter all={visible.length} counts={buildingCounts} buildings={buildingNumbers} selected={buildings} onChange={chooseBuildings} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat icon={BellRing} tone="amber" label="تحتاج طلب سيارة" value={toRequest.length} hint={matchCount ? `${matchCount} لنفس وجهة رحلة قائمة` : `حتى ${REQUEST_GRACE_MINUTES} د بعد الموعد`} />
        <Stat icon={Truck} tone="blue" label="طلبات جارية" value={inProgress.length} hint="حتى استلام المريض" />
        <Stat icon={Hospital} tone="cyan" label="في الموعد" value={atAppointment.length} hint="يمكن طلب العودة" />
        <Stat icon={CheckCircle2} tone="green" label="مكتملة اليوم" value={completed} />
      </div>

      <div className="space-y-6">
        <Panel tone="amber" icon={BellRing} title="مواعيد تحتاج طلب سيارة" count={toRequest.length} description={`يمكن الطلب حتى ${REQUEST_GRACE_MINUTES} دقيقة بعد وقت الموعد`}>
          {toRequest.length ? (
            <div className="divide-y divide-slate-100">
              {toRequest.map(({ appointment }) => (
                <RequestRow key={appointment.id} appointment={appointment} day={dayOf(appointment)} match={matches.get(appointment.id)} partner={partnerOf(appointment)} now={now} onRequest={onRequest} onCancelAppointment={() => setCancelling({ appointment })} />
              ))}
            </div>
          ) : <EmptyState icon={CheckCircle2} title="لا توجد مواعيد بانتظار طلب سيارة" hint="تظهر هنا مواعيد العيادات لليوم حتى يُطلب لها سيارة" />}
        </Panel>

        <Panel tone="blue" icon={Truck} title="طلبات جارية" count={inProgress.length} description="طلباتك حتى وصول السيارة إلى الوجهة">
          {inProgress.length ? (
            <div className="divide-y divide-slate-100">
              {inProgress.map(({ appointment, request }) => (
                <ProgressRow
                  key={appointment.id}
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={phaseOf(request)}
                  onUpdateRequest={onUpdateRequest}
                  onCancel={onCancel}
                  onCancelAppointment={canCancelAppointment(appointment, request) ? () => setCancelling({ appointment, request }) : undefined}
                />
              ))}
            </div>
          ) : <EmptyState icon={Truck} title="لا توجد طلبات جارية" />}
        </Panel>

        {atAppointment.length > 0 && (
          <Panel tone="cyan" icon={Hospital} title="مرضى في الموعد" count={atAppointment.length} description="وصلوا إلى الوجهة · عند انتهاء الموعد يطلب أي مشرف سيارة العودة">
            <div className="divide-y divide-slate-100">
              {atAppointment.map(({ appointment, request }) => (
                <AtAppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={phaseOf(request)}
                  onReturn={onReturn}
                />
              ))}
            </div>
          </Panel>
        )}

        {expired.length > 0 && (
          <Panel tone="red" icon={XCircle} title="انتهت مهلة الطلب" count={expired.length} description={`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد، ويجب أن تعدّل العيادة الموعد أولًا`}>
            <ul className="divide-y divide-slate-100">
              {expired.map(({ appointment }) => (
                <li key={appointment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
                  <div className="flex min-w-0 flex-1 gap-4">
                    <TimeBlock time={appointment.appointmentAt} day={dayOf(appointment)} tone="red" />
                    <div className="min-w-0 flex-1"><AppointmentInfo appointment={appointment} /></div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs font-medium text-red-700">بانتظار تعديل العيادة</span>
                    {canCancelAppointment(appointment) && <CancelAppointmentButton onClick={() => setCancelling({ appointment })} />}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {cancelled.length > 0 && (
          <Panel icon={Ban} title="مواعيد ملغاة" count={cancelled.length} description="أُلغيت اليوم مع سبب الإلغاء">
            <ul className="divide-y divide-slate-100">
              {cancelled.map((appointment) => (
                <li key={appointment.id} className="flex gap-4 p-4 opacity-90 sm:px-5">
                  <TimeBlock time={appointment.appointmentAt} day={dayOf(appointment)} />
                  <div className="min-w-0 flex-1">
                    <AppointmentInfo appointment={appointment} />
                    <p className="mt-2 w-fit rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-inset ring-red-200">
                      <span className="font-semibold">سبب الإلغاء:</span> {appointment.cancelReason || "—"}
                      {appointment.cancelledBy && <span className="text-red-700/80"> · {appointment.cancelledBy}{appointment.cancelledAt && !Number.isNaN(Date.parse(appointment.cancelledAt)) ? ` ${timeLabel(new Date(appointment.cancelledAt))}` : ""}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
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
        <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={200} rows={2} placeholder={other ? "مثال: المريض في المستشفى منذ أمس" : "أي ملاحظة لمشرف السيارات والعيادة"} className={cx(inputClass, "h-auto py-2.5")} />
      </label>
      {!valid && preset && <p className="mt-2 text-xs text-red-600">اكتب السبب (3 أحرف على الأقل)</p>}
    </Modal>
  );
}

/** بيانات الموعد: المريض، ومن أين إلى أين، والهاتف والاحتياجات. */
function AppointmentInfo({ appointment, request, driver }: { appointment: ClinicAppointment; request?: VehicleRequest; driver?: string }) {
  const pickup = appointmentPickupLabel(appointment);
  const returning = request?.direction === "عودة";
  const assistance = appointment.assistance.join("، ");
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold text-ink">{appointment.patientName}</p>
        {request && <Badge tone={returning ? "amber" : "neutral"}>{request.direction}</Badge>}
        {isNonMedical(appointment) && <Badge tone="violet">غير طبية</Badge>}
        {appointment.kind === "احتياجات خاصة" && <Badge icon={Accessibility}>احتياجات خاصة</Badge>}
      </div>
      <p className="mt-1 text-sm text-slate-600">{returning ? appointment.clinic : pickup} ← {returning ? pickup : appointment.clinic}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {appointment.mobile && <a href={`tel:${appointment.mobile}`} className="inline-flex items-center gap-1 hover:text-ink"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span></a>}
        {assistance && <span className="inline-flex items-center gap-1"><Accessibility className="h-3.5 w-3.5" />{assistance}</span>}
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

function RequestRow({ appointment, day, match, partner, now, onRequest, onCancelAppointment }: {
  appointment: ClinicAppointment;
  day?: string;
  match?: UnrequestedMatch;
  partner?: ClinicAppointment;
  now: Date;
  onRequest: RequestHandlers["onRequest"];
  onCancelAppointment: () => void;
}) {
  const [method, setMethod] = useState<VehicleRequest["notificationMethod"]>(match?.matchedRequest.notificationMethod ?? "whatsapp");
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
    onRequest(newRequest(appointment, method), appointment.id);
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <TimeBlock time={appointment.appointmentAt} day={day} />
        <div className="min-w-0 flex-1">
          <AppointmentInfo appointment={appointment} />
          {match ? (
            <p className="mt-2 flex w-fit items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
              <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-semibold">{match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} رحلة {match.matchedAppointment.patientName}</span> (مبنى {match.matchedAppointment.buildingNumber}، {match.matchedAppointment.appointmentAt} · {match.matchedRequest.status}). اطلب الآن لتُجمع معها.</span>
            </p>
          ) : partner && (
            <p className="mt-2 flex w-fit items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-800 ring-1 ring-inset ring-violet-200">
              <Link2 className="h-3.5 w-3.5 shrink-0" /> رحلة مشتركة ممكنة مع {partner.patientName} (مبنى {partner.buildingNumber}، {partner.appointmentAt})
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <span className={cx("text-xs", deadline.minutesLeft <= 15 ? "font-semibold text-red-600" : "text-slate-500")}>
          آخر موعد للطلب <span dir="ltr" className="tabular">{timeLabel(deadline.deadline)}</span>
        </span>
        <Segmented
          size="sm"
          label="طريقة تنبيه السائق"
          value={method}
          onChange={setMethod}
          options={[{ value: "whatsapp", label: "واتساب", icon: MessageCircle }, { value: "call", label: "اتصال", icon: Phone }]}
        />
        <button onClick={requestCar} className={btn("primary")}><BellRing className="h-4 w-4" /> طلب السيارة</button>
        {canCancelAppointment(appointment) && <CancelAppointmentButton onClick={onCancelAppointment} />}
      </div>
    </div>
  );
}

function ProgressRow({ appointment, request, day, driver, phase, onUpdateRequest, onCancel, onCancelAppointment }: {
  appointment: ClinicAppointment;
  request: VehicleRequest;
  day?: string;
  driver: string;
  phase: TripPhase;
  onUpdateRequest: RequestHandlers["onUpdateRequest"];
  onCancel: RequestHandlers["onCancel"];
  onCancelAppointment?: () => void;
}) {
  const returning = request.direction === "عودة";
  // الذهاب: بعد الاستلام تبقى الرحلة هنا «في الطريق إلى الوجهة» حتى تصل
  const step = request.status === "بانتظار التوزيع" ? 0 : request.status === "تم إرسال السيارة" ? 1 : request.status === "وصلت السيارة" ? 2 : returning ? 3 : 4;
  const next = request.status === "تم إرسال السيارة"
    ? { label: "وصلت السيارة", status: "وصلت السيارة" as const }
    : request.status === "وصلت السيارة"
      ? { label: "تم استلام المريض", status: "تم استلام المريض" as const }
      : null;
  const canCancel = request.status === "بانتظار التوزيع" || request.status === "تم إرسال السيارة";
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <TimeBlock time={appointment.appointmentAt} day={day} />
        <div className="min-w-0 flex-1">
          <AppointmentInfo appointment={appointment} request={request} driver={driver} />
          <div className="mt-2.5"><Steps steps={returning ? RETURN_STEPS : OUTBOUND_STEPS} current={step} /></div>
          {request.status === "بانتظار التوزيع" && <p className="mt-2 text-xs text-slate-500">بانتظار أن يرسل مشرف السيارات سيارة</p>}
          {phase.kind === "toDestination" && (
            <div className="mt-2">
              <Badge tone="blue" icon={Timer}>في الطريق إلى الوجهة · الوصول المتوقع <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span>{phase.late ? " (متأخرة)" : ""}</Badge>
              <p className="mt-1.5 text-xs text-slate-500">يُتاح طلب العودة بعد وصول السيارة إلى الوجهة</p>
            </div>
          )}
        </div>
      </div>
      {(next || canCancel || onCancelAppointment) && (
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {next && <button onClick={() => onUpdateRequest(request.id, next.status)} className={btn("dark")}><CheckCircle2 className="h-4 w-4" /> {next.label}</button>}
          {canCancel && <button onClick={() => window.confirm("إلغاء طلب السيارة فقط؟ يبقى الموعد ويمكن طلب سيارة له من جديد.") && onCancel(appointment, request)} className={btn("danger")}><XCircle className="h-4 w-4" /> إلغاء طلب السيارة</button>}
          {onCancelAppointment && <CancelAppointmentButton onClick={onCancelAppointment} />}
        </div>
      )}
    </div>
  );
}

function AtAppointmentRow({ appointment, request, day, driver, phase, onReturn }: {
  appointment: ClinicAppointment;
  request: VehicleRequest;
  day?: string;
  driver: string;
  phase: TripPhase;
  onReturn: RequestHandlers["onReturn"];
}) {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <TimeBlock time={appointment.appointmentAt} day={day} />
        <div className="min-w-0 flex-1">
          <AppointmentInfo appointment={appointment} request={request} driver={driver} />
          <div className="mt-2">
            {phase.kind === "toDestination"
              ? <Badge tone="blue" icon={Timer}>في الطريق · الوصول المتوقع <span dir="ltr" className="tabular">{timeLabel(phase.etaAt)}</span></Badge>
              : phase.kind === "arrived" && phase.at
                ? <Badge tone="green" icon={CheckCircle2}>وصل إلى الوجهة <span dir="ltr" className="tabular">{timeLabel(phase.at)}</span></Badge>
                : <Badge tone="cyan" icon={CheckCircle2}>تم استلام المريض</Badge>}
          </div>
        </div>
      </div>
      <button onClick={() => onReturn(appointment, request)} className={btn("soft")}><RotateCcw className="h-4 w-4" /> طلب العودة</button>
    </div>
  );
}
