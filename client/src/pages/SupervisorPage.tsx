import { useState } from "react";
import { toast } from "sonner";
import { Accessibility, BellRing, Building2, CalendarDays, CheckCircle2, Clock3, Link2, Phone, RotateCcw, Truck, XCircle } from "lucide-react";
import {
  appointmentPickupLabel,
  calculateTripGroupingScore,
  canRequestVehicle,
  findUnrequestedMatches,
  isNonMedical,
  REQUEST_GRACE_MINUTES,
  requestWindow,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import { byAppointmentTime, formatDay, PageHeading, SectionCard, timeLabel } from "@/components/ui-kit";
import { useHospitals, useNow } from "@/lib/useShared";

const WAITING = "بانتظار طلب السيارة";

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

export function SupervisorHome({ appointments, requests, onRequest, onUpdateRequest, onCancel, onReturn }: {
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [buildingFilter, setBuildingFilter] = useState("all");
  const now = useNow();
  const hospitals = useHospitals();
  const pending = appointments.filter((appointment) => appointment.status !== "مكتملة");
  const buildingNumbers = Array.from(new Set(pending.map((appointment) => appointment.buildingNumber))).sort((first, second) => first.localeCompare(second, "ar", { numeric: true }));
  const inFilter = (appointment: ClinicAppointment) => buildingFilter === "all" || appointment.buildingNumber === buildingFilter;
  const isExpired = (appointment: ClinicAppointment) => appointment.status === WAITING && !requestWindow(appointment, now).open;
  const visibleAppointments = pending.filter(inFilter).sort((a, b) => Number(isExpired(a)) - Number(isExpired(b)) || byAppointmentTime(a, b));

  // مواعيد بلا طلب ولها رحلة قائمة لنفس الوجهة في نفس التوقيت
  const matches = findUnrequestedMatches(appointments, requests, hospitals, now).filter((match) => inFilter(match.appointment));
  // مواعيد بلا طلب يمكن طلبها معًا (نفس الوجهة أو وجهة مجاورة خلال 30 دقيقة)
  const requested = new Set(requests.map((request) => request.appointmentId));
  const openUnrequested = appointments.filter((appointment) => appointment.status === WAITING && !requested.has(appointment.id) && requestWindow(appointment, now).open);
  const partnerOf = (appointment: ClinicAppointment) => openUnrequested.find((other) => {
    if (other.id === appointment.id) return false;
    const details = calculateTripGroupingScore(appointment, other, hospitals);
    return details.timeGapMinutes <= 30 && (details.sameDestination || details.nearbyDestination);
  });

  return (
    <>
      <PageHeading
        title="طلبات السيارات"
        action={(
          <select aria-label="رقم المبنى" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)} className="h-11 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-[#d88994]">
            <option value="all">كل المباني ({pending.length})</option>
            {buildingNumbers.map((building) => <option key={building} value={building}>مبنى {building}</option>)}
          </select>
        )}
      />

      {matches.length > 0 && (
        <div className="mb-6">
          <SectionCard tone="amber" title={<><BellRing className="h-5 w-5 text-amber-700" /> مواعيد لنفس وجهة رحلة قائمة ولم يُطلب لها سيارة</>} badge={<span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">{matches.length}</span>}>
            <ul className="divide-y divide-amber-100">
              {matches.map((match) => (
                <li key={match.appointment.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="flex-1 text-sm">
                    <p className="font-bold">{match.appointment.patientName} <span className="font-semibold text-slate-500">· {appointmentPickupLabel(match.appointment)} · {match.appointment.appointmentAt}</span></p>
                    <p className="mt-1 text-xs text-slate-600">{match.appointment.clinic} — {match.sameDestination ? "نفس وجهة" : "وجهة مجاورة لـ"} {match.matchedAppointment.patientName} (مبنى {match.matchedAppointment.buildingNumber}، {match.matchedAppointment.appointmentAt}) · فارق {match.gapMinutes} د · {match.matchedRequest.status}</p>
                  </div>
                  <button onClick={() => onRequest(newRequest(match.appointment, match.matchedRequest.notificationMethod), match.appointment.id)} className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700"><BellRing className="h-4 w-4" /> طلب السيارة الآن</button>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      )}

      <div className="grid gap-4">
        {visibleAppointments.length
          ? visibleAppointments.map((appointment) => {
            const request = [...requests].reverse().find((item) => item.appointmentId === appointment.id);
            const partner = !request ? partnerOf(appointment) : undefined;
            return <SupervisorAppointment key={appointment.id} appointment={appointment} partner={partner} now={now} request={request} onRequest={onRequest} onUpdateRequest={onUpdateRequest} onCancel={onCancel} onReturn={onReturn} />;
          })
          : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-300" /><p className="mt-3 font-bold text-slate-500">لا توجد مواعيد</p></div>}
      </div>
    </>
  );
}

function SupervisorAppointment({ appointment, partner, now, request, onRequest, onUpdateRequest, onCancel, onReturn }: {
  appointment: ClinicAppointment;
  partner?: ClinicAppointment;
  now: Date;
  request?: VehicleRequest;
  onRequest: (request: VehicleRequest, appointmentId: string) => void;
  onUpdateRequest: (requestId: string, status: VehicleRequest["status"]) => void;
  onCancel: (appointment: ClinicAppointment, request: VehicleRequest) => void;
  onReturn: (appointment: ClinicAppointment, request: VehicleRequest) => void;
}) {
  const [method, setMethod] = useState<VehicleRequest["notificationMethod"]>("whatsapp");
  const deadlineInfo = requestWindow(appointment, now);
  const expired = !request && !deadlineInfo.open;

  function requestCar() {
    if (!requestWindow(appointment).open) {
      toast.error(`مضى أكثر من ${REQUEST_GRACE_MINUTES} دقيقة على الموعد. يجب أن تعدّل العيادة الموعد أولًا.`);
      return;
    }
    if (!canRequestVehicle(appointment, request)) {
      toast.error("لا يوجد موعد قابل للطلب");
      return;
    }
    onRequest(newRequest(appointment, method), appointment.id);
  }

  const nextAction = request?.status === "تم إرسال السيارة"
    ? { label: "وصلت السيارة", status: "وصلت السيارة" as const }
    : request?.status === "وصلت السيارة"
      ? { label: "تم استلام المريض", status: "تم استلام المريض" as const }
      : null;
  const pickup = appointmentPickupLabel(appointment);
  const assistance = appointment.assistance.join("، ");
  const canCancel = request?.status === "بانتظار التوزيع" || request?.status === "تم إرسال السيارة";
  const returning = request?.direction === "عودة";

  return (
    <div className={`rounded-2xl border bg-white p-5 shadow-[0_8px_30px_rgba(25,45,85,.04)] ${expired ? "border-red-100 opacity-80" : "border-slate-200"}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex flex-1 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#eef4f7] text-[#a61d2d]"><CalendarDays className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><p className="font-bold">{appointment.patientName}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{appointment.id}</span>{isNonMedical(appointment) && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">غير طبية</span>}</div>
            <p className="mt-1 text-xs text-slate-500">{formatDay(appointment.appointmentDate, now)} {appointment.appointmentAt} · {returning ? appointment.clinic : pickup} ← {returning ? pickup : appointment.clinic} · {appointment.kind}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400"><Phone className="h-3.5 w-3.5" /><span dir="ltr">{appointment.mobile}</span>{assistance && <><span>·</span><Accessibility className="h-3.5 w-3.5" /><span>{assistance}</span></>}</p>
            {partner && <p className="mt-2 flex w-fit items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700"><Link2 className="h-3.5 w-3.5" /> رحلة مشتركة ممكنة مع {partner.patientName} (مبنى {partner.buildingNumber}، {partner.appointmentAt})</p>}
          </div>
        </div>

        {request?.status === "بانتظار التوزيع" && (
          <span className="flex w-fit items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"><Clock3 className="h-4 w-4" /> بانتظار إرسال السيارة</span>
        )}
        {request?.vehiclePlate && request.status !== "بانتظار التوزيع" && (
          <span className="flex items-center gap-2 text-xs font-bold text-slate-700"><Truck className="h-4 w-4 text-[#a61d2d]" /><span dir="ltr">{request.vehiclePlate}</span> · {request.driver}{request.groupId && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">رحلة مجمّعة</span>}</span>
        )}
        {request && request.status !== "بانتظار التوزيع" && <span className="w-fit rounded-full bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700">{request.status}</span>}

        {expired && (
          <span className="flex max-w-xs items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold leading-5 text-red-700"><XCircle className="mt-0.5 h-4 w-4 shrink-0" /> انتهت مهلة الطلب ({REQUEST_GRACE_MINUTES} دقيقة بعد الموعد). بانتظار تعديل العيادة.</span>
        )}
        {!request && !expired && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-bold ${deadlineInfo.minutesLeft <= 15 ? "text-red-600" : "text-slate-400"}`}>حتى {timeLabel(deadlineInfo.deadline)}</span>
            <select aria-label="طريقة التنبيه" value={method} onChange={(event) => setMethod(event.target.value as VehicleRequest["notificationMethod"])} className="h-10 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold"><option value="whatsapp">واتساب</option><option value="call">اتصال</option></select>
            <button onClick={requestCar} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#a61d2d] px-3 text-xs font-bold text-white hover:bg-[#8b1725]"><BellRing className="h-4 w-4" /> طلب السيارة</button>
          </div>
        )}
        {request && nextAction && <button onClick={() => onUpdateRequest(request.id, nextAction.status)} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#a61d2d] px-3 text-xs font-bold text-white hover:bg-[#8b1725]"><CheckCircle2 className="h-4 w-4" /> {nextAction.label}</button>}
        {request && canCancel && <button onClick={() => window.confirm("هل تريد إلغاء طلب السيارة؟") && onCancel(appointment, request)} className="flex min-h-10 items-center gap-1 rounded-xl border border-red-100 px-3 text-xs font-bold text-red-600 hover:bg-red-50"><XCircle className="h-4 w-4" /> إلغاء</button>}
        {request?.status === "تم استلام المريض" && request.direction === "ذهاب" && <button onClick={() => onReturn(appointment, request)} className="flex min-h-10 items-center gap-1 rounded-xl border border-[#e6b7b7] bg-[#fff7f7] px-3 text-xs font-bold text-[#b33b3b]"><RotateCcw className="h-4 w-4" /> طلب العودة</button>}
      </div>
    </div>
  );
}
