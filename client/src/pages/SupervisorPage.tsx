import { useState } from "react";
import { toast } from "sonner";
import { Accessibility, Ban, BellRing, Building2, CheckCircle2, Hospital, Link2, MessageCircle, Phone, RotateCcw, Timer, Truck, XCircle } from "lucide-react";
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
const PROGRESS_STEPS = ["طُلبت السيارة", "أُرسلت", "وصلت السيارة", "استُلم المريض"];

type Row = { appointment: ClinicAppointment; request?: VehicleRequest };
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
  // متابعة الطلب لصاحبه فقط: موعد طلب له مشرف آخر سيارة لا يظهر هنا
  const followed = (appointment: ClinicAppointment) => followsRequest(latest.get(appointment.id), uid);

  // مواعيد اليوم فقط، مع أي رحلة من يوم سابق لم يُستلم مريضها بعد (مثل عودة بعد منتصف الليل)
  const activeIds = new Set(requests.filter((request) => BEFORE_PICKUP.includes(request.status)).map((request) => request.appointmentId));
  const todays = appointments.filter((appointment) => appointment.appointmentDate === today
    || (appointment.appointmentDate < today && activeIds.has(appointment.id)));
  const mine = todays.filter(followed);
  const pending = mine.filter((appointment) => appointment.status !== "مكتملة" && appointment.status !== "ملغي");

  // فلتر المباني: اختيار مبنى أو أكثر، ويُحفظ على هذا الجهاز
  const buildingCounts = new Map<string, number>();
  for (const appointment of pending) buildingCounts.set(appointment.buildingNumber, (buildingCounts.get(appointment.buildingNumber) ?? 0) + 1);
  const buildingNumbers = Array.from(new Set([...Array.from(buildingCounts.keys()), ...buildings]))
    .sort((first, second) => first.localeCompare(second, "ar", { numeric: true }));
  const inFilter = (appointment: ClinicAppointment) => !buildings.length || buildings.includes(appointment.buildingNumber);
  function chooseBuildings(next: string[]) {
    setBuildings(next);
    try { localStorage.setItem(BUILDINGS_KEY, JSON.stringify(next)); } catch { /* التخزين غير متاح */ }
  }

  const rows: Row[] = pending.filter(inFilter).sort(byAppointmentTime).map((appointment) => ({ appointment, request: latest.get(appointment.id) }));

  // المواعيد حسب ما تحتاجه الآن من مشرف المبنى
  const toRequest = rows.filter((row) => !row.request && requestWindow(row.appointment, now).open);
  const expired = rows.filter((row) => !row.request && !requestWindow(row.appointment, now).open);
  const inProgress = rows.filter((row): row is Required<Row> => Boolean(row.request && (BEFORE_PICKUP.includes(row.request.status) || row.request.direction === "عودة")));
  const atAppointment = rows.filter((row): row is Required<Row> => Boolean(row.request && !BEFORE_PICKUP.includes(row.request.status) && row.request.direction === "ذهاب"));
  const completed = mine.filter((appointment) => appointment.status === "مكتملة" && inFilter(appointment)).length;
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
      <PageHeader title="طلبات السيارات" subtitle={`${longDate(today)} · مواعيد اليوم`} />

      <BuildingFilter all={pending.length} counts={buildingCounts} buildings={buildingNumbers} selected={buildings} onChange={chooseBuildings} />

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

        <Panel tone="blue" icon={Truck} title="طلبات جارية" count={inProgress.length} description="من طلب السيارة حتى استلام المريض">
          {inProgress.length ? (
            <div className="divide-y divide-slate-100">
              {inProgress.map(({ appointment, request }) => (
                <ProgressRow
                  key={appointment.id}
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  onUpdateRequest={onUpdateRequest}
                  onCancel={onCancel}
                  onCancelAppointment={canCancelAppointment(appointment, request) ? () => setCancelling({ appointment, request }) : undefined}
                />
              ))}
            </div>
          ) : <EmptyState icon={Truck} title="لا توجد طلبات جارية" />}
        </Panel>

        {atAppointment.length > 0 && (
          <Panel tone="cyan" icon={Hospital} title="مرضى في الموعد" count={atAppointment.length} description="عند انتهاء الموعد اطلب سيارة العودة">
            <div className="divide-y divide-slate-100">
              {atAppointment.map(({ appointment, request }) => (
                <AtAppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  request={request}
                  day={dayOf(appointment)}
                  driver={driverOf(request)}
                  phase={tripPhase(request, now, Boolean(request.vehiclePlate && liveGps.has(request.vehiclePlate)))}
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

/** فلتر المباني: «كل المباني» أو مبنى واحد أو أكثر. */
function BuildingFilter({ all, counts, buildings, selected, onChange }: {
  all: number;
  counts: Map<string, number>;
  buildings: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  if (!buildings.length) return null;
  const chip = (active: boolean) => cx(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium ring-1 ring-inset transition",
    active ? "bg-navy-900 text-white ring-navy-900" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50 hover:text-ink",
  );
  const count = (value: number, active: boolean) => <span className={cx("rounded-full px-1.5 text-xs tabular", active ? "bg-white/15" : "bg-slate-100 text-slate-500")}>{value}</span>;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="فلتر المباني">
      <span className="me-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500"><Building2 className="h-4 w-4" /> المباني</span>
      <button type="button" aria-pressed={!selected.length} onClick={() => onChange([])} className={chip(!selected.length)}>الكل {count(all, !selected.length)}</button>
      {buildings.map((building) => {
        const active = selected.includes(building);
        return (
          <button
            key={building}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(active ? selected.filter((item) => item !== building) : [...selected, building])}
            className={chip(active)}
          >
            مبنى {building} {count(counts.get(building) ?? 0, active)}
          </button>
        );
      })}
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

function ProgressRow({ appointment, request, day, driver, onUpdateRequest, onCancel, onCancelAppointment }: {
  appointment: ClinicAppointment;
  request: VehicleRequest;
  day?: string;
  driver: string;
  onUpdateRequest: RequestHandlers["onUpdateRequest"];
  onCancel: RequestHandlers["onCancel"];
  onCancelAppointment?: () => void;
}) {
  const step = request.status === "بانتظار التوزيع" ? 0 : request.status === "تم إرسال السيارة" ? 1 : request.status === "وصلت السيارة" ? 2 : 3;
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
          <div className="mt-2.5"><Steps steps={PROGRESS_STEPS} current={step} /></div>
          {request.status === "بانتظار التوزيع" && <p className="mt-2 text-xs text-slate-500">بانتظار أن يرسل مشرف السيارات سيارة</p>}
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
