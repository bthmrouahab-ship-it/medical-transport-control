import { useMemo, useState } from "react";
import { Accessibility, ArrowLeftRight, Ban, CalendarDays, Clock3, Eye, Footprints, Ribbon, Search, Stethoscope, Truck, Users, UsersRound, X } from "lucide-react";
import {
  appointmentPickupLabel,
  isNonMedical,
  isPriority,
  personsText,
  requestPersons,
  requestWindow,
  tripPersons,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import GuestContact from "@/components/GuestContact";
import { Badge, EmptyState, Panel, Segmented, Stat, StatusBadge, TimeBlock, btn, cx, formatDay, inputClass, longDate, timeLabel } from "@/components/ui-kit";

const WAITING = "بانتظار طلب السيارة";
type StatusFilter = "all" | "waiting" | "active" | "done" | "cancelled";
const STATUS_GROUPS: Record<Exclude<StatusFilter, "all">, string[]> = {
  waiting: [WAITING],
  active: ["تم طلب السيارة", "تم استلام المريض", "طلب عودة"],
  done: ["مكتملة"],
  cancelled: ["ملغي"],
};
/** للبحث: بلا فرق في الأحرف الكبيرة والهمزات والتاء المربوطة */
const searchable = (text: string) => text.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");

/**
 * كل المواعيد لمشرف السيارات للعرض فقط (الطبية وغير الطبية): حالة كل موعد وطلبات سيارته ومن أرسلت إليه.
 * طلب السيارة للموعد الطبي من مشرف المبنى وحده، فلا أزرار هنا.
 */
export function AppointmentsOverview({ appointments, requests, date, now }: {
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  date: string;
  now: Date;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<"day" | "all">("day");
  const dayAppointments = useMemo(
    () => appointments.filter((appointment) => appointment.appointmentDate === date).sort((a, b) => a.appointmentAt.localeCompare(b.appointmentAt)),
    [appointments, date],
  );
  const filtering = Boolean(query.trim()) || status !== "all";
  const shown = useMemo(() => {
    const words = searchable(query.trim()).split(/\s+/).filter(Boolean);
    const list = scope === "all" && filtering
      ? [...appointments].sort((a, b) => `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`))
      : dayAppointments;
    return list
      .filter((appointment) => status === "all" || STATUS_GROUPS[status].includes(appointment.status))
      .filter((appointment) => {
        if (!words.length) return true;
        const text = searchable([appointment.patientName, appointment.mobile, appointment.clinic, appointment.id,
          `مبنى ${appointment.buildingNumber}`, `شقة ${appointment.apartmentNumber}`, appointment.buildingNumber, appointment.apartmentNumber].join(" "));
        return words.every((word) => text.includes(word));
      });
  }, [appointments, dayAppointments, query, status, scope, filtering]);
  const byAppointment = useMemo(() => {
    const map = new Map<string, VehicleRequest[]>();
    for (const request of requests) map.set(request.appointmentId, [...(map.get(request.appointmentId) ?? []), request]);
    return map;
  }, [requests]);

  const count = (group: Exclude<StatusFilter, "all">) => dayAppointments.filter((appointment) => STATUS_GROUPS[group].includes(appointment.status)).length;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat icon={CalendarDays} tone="neutral" label="مواعيد اليوم المحدد" value={dayAppointments.length} hint={`${dayAppointments.filter(isNonMedical).length} رحلة غير طبية`} />
        <Stat icon={Clock3} tone="amber" label="لم يُطلب لها سيارة" value={count("waiting")} hint="يطلبها مشرف المبنى" />
        <Stat icon={Truck} tone="blue" label="طُلبت لها سيارة" value={count("active") + count("done")} hint={`${count("done")} مكتملة`} />
        <Stat icon={Ban} tone="red" label="ملغاة" value={count("cancelled")} />
      </div>

      <Panel
        icon={UsersRound}
        title="كل المواعيد"
        count={filtering ? shown.length : dayAppointments.length}
        description={<span className="inline-flex flex-wrap items-center gap-1"><Eye className="h-3.5 w-3.5" /> للعرض فقط · طلب السيارة من مشرف المبنى · {scope === "all" && filtering ? "كل الأيام" : longDate(date)}</span>}
        actions={filtering && <button type="button" onClick={() => { setQuery(""); setStatus("all"); }} className={btn("ghost", "sm")}><X className="h-4 w-4" /> مسح البحث</button>}
      >
        <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center sm:px-5">
          <label className="relative block">
            <span className="sr-only">بحث</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث: الاسم، الموبايل، المبنى، الشقة، الوجهة" className={cx(inputClass, "h-10 ps-9")} />
          </label>
          <select aria-label="حالة الموعد" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className={cx(inputClass, "h-10", status !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
            <option value="all">كل الحالات</option>
            <option value="waiting">لم يُطلب لها سيارة</option>
            <option value="active">جارية</option>
            <option value="done">مكتملة</option>
            <option value="cancelled">ملغاة</option>
          </select>
          <Segmented size="sm" label="نطاق البحث" value={scope} onChange={setScope} options={[{ value: "day", label: "اليوم المحدد" }, { value: "all", label: "كل الأيام" }]} />
        </div>
        {shown.length ? (
          <div className="divide-y divide-slate-100">
            {shown.map((appointment) => (
              <OverviewRow key={appointment.id} appointment={appointment} requests={byAppointment.get(appointment.id) ?? []} all={requests} now={now} />
            ))}
          </div>
        ) : <EmptyState icon={filtering ? Search : UsersRound} title={filtering ? "لا توجد نتائج" : "لا توجد مواعيد في هذا اليوم"} />}
      </Panel>
    </>
  );
}

/** نوع الطلب: ذهاب، عودة، نقل بين موعدين، أو عودة الـ Nurse فقط */
const requestKind = (request: VehicleRequest) => (request.nurseOnly ? "عودة الـ Nurse فقط" : request.fromAppointmentId ? "نقل بين موعدين" : request.direction);

function OverviewRow({ appointment, requests, all, now }: {
  appointment: ClinicAppointment;
  /** طلبات السيارات لهذا الموعد */
  requests: VehicleRequest[];
  all: VehicleRequest[];
  now: Date;
}) {
  const guestRequest = requests.filter((request) => !request.nurseOnly).at(-1);
  const persons = guestRequest ? requestPersons(guestRequest, appointment, all) : tripPersons(appointment);
  const deadline = requestWindow(appointment, now);
  const waiting = appointment.status === WAITING && !requests.length;
  return (
    <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 gap-4">
        <TimeBlock time={appointment.appointmentAt} day={formatDay(appointment.appointmentDate, now)} tone={waiting && !deadline.open ? "red" : "neutral"} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-ink">{appointment.patientName}</p>
            {isNonMedical(appointment) && <Badge tone="violet">غير طبية</Badge>}
            {appointment.kind === "احتياجات خاصة" && <Badge tone="amber" icon={Accessibility}>احتياجات خاصة</Badge>}
            {isPriority(appointment) && <Badge tone="red" icon={Ribbon}>أولوية · حالة سرطان</Badge>}
            {appointment.gender && <span className="text-xs text-slate-500">{appointment.gender}</span>}
          </div>
          <p className="mt-1 text-sm text-slate-600">{appointmentPickupLabel(appointment)} ← {appointment.clinic}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {appointment.mobile && appointment.mobile !== "-" && <GuestContact mobile={appointment.mobile} />}
            {appointment.assistance.length > 0 && <span className="inline-flex items-center gap-1"><Accessibility className="h-3.5 w-3.5" />{appointment.assistance.join("، ")}</span>}
            {persons > 1 && <span className="inline-flex items-center gap-1"><Users className="h-3.5 w-3.5" />{personsText(persons)}</span>}
          </p>

          {requests.length > 0 && (
            <ul className="mt-2 space-y-1">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                  <Badge tone={request.nurseOnly || request.direction === "عودة" ? "amber" : request.fromAppointmentId ? "cyan" : "neutral"} icon={request.nurseOnly ? Stethoscope : request.fromAppointmentId ? ArrowLeftRight : undefined}>{requestKind(request)}</Badge>
                  <StatusBadge status={request.status} />
                  {request.createdAt && <span>طُلبت {request.createdAt}</span>}
                  {request.vehiclePlate && <span className="inline-flex items-center gap-1 text-slate-700"><Truck className="h-3.5 w-3.5" /><span dir="ltr" className="font-semibold">{request.vehiclePlate}</span>{request.driver ? ` · ${request.driver}` : ""}{request.groupId ? " · مجمّعة" : ""}</span>}
                  {request.arrivedAt && !Number.isNaN(Date.parse(request.arrivedAt)) && <span>وصلت <span dir="ltr" className="tabular">{timeLabel(new Date(request.arrivedAt))}</span></span>}
                </li>
              ))}
            </ul>
          )}
          {waiting && (
            <p className={cx("mt-2 text-xs", deadline.open ? "text-amber-800" : "font-medium text-red-700")}>
              {deadline.open ? <>لم يطلب مشرف المبنى سيارة بعد · آخر موعد للطلب <span dir="ltr" className="tabular">{timeLabel(deadline.deadline)}</span></> : "انتهت مهلة طلب السيارة"}
            </p>
          )}
          {appointment.returnedSelf && (
            <p className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-200">
              <Footprints className="h-3.5 w-3.5" /> عاد إلى المجمع بنفسه{appointment.returnedSelfBy ? ` (سجّله ${appointment.returnedSelfBy})` : ""}
            </p>
          )}
          {appointment.status === "ملغي" && (
            <p className="mt-2 w-fit rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-800 ring-1 ring-inset ring-red-200">
              <span className="font-semibold">سبب الإلغاء:</span> {appointment.cancelReason || "—"}{appointment.cancelledBy ? ` · ${appointment.cancelledBy}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="shrink-0"><StatusBadge status={appointment.status} /></div>
    </div>
  );
}
