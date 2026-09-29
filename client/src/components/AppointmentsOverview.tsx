import { useMemo, useState } from "react";
import { Accessibility, ArrowLeftRight, Ban, CalendarDays, Clock3, Eye, Filter, Footprints, Ribbon, Stethoscope, Truck, UsersRound, X } from "lucide-react";
import {
  isNonMedical,
  isPriority,
  personsText,
  requestPersons,
  requestWindow,
  statusText,
  tripPersons,
  type ClinicAppointment,
  type VehicleRequest,
} from "@shared/transport";
import GuestContact from "@/components/GuestContact";
import { FILTER_LABELS_AR, FilterTable, useColumnFilters, type FilterColumn } from "@/components/ExcelFilter";
import { Badge, EmptyState, Panel, Segmented, Stat, StatusBadge, btn, formatDay, longDate, timeLabel } from "@/components/ui-kit";

const WAITING = "بانتظار طلب السيارة";
const ACTIVE = ["تم طلب السيارة", "تم استلام المريض", "طلب عودة"];
const NOT_REQUESTED = "لم يُطلب بعد";

/** نوع الطلب: ذهاب، عودة، نقل بين موعدين، أو عودة الـ Nurse فقط */
const requestKind = (request: VehicleRequest) => (request.nurseOnly ? "عودة الـ Nurse فقط" : request.fromAppointmentId ? "نقل بين موعدين" : request.direction);

/**
 * كل المواعيد لمشرف السيارات للعرض فقط (الطبية وغير الطبية) في جدول بفلترة أعمدة مثل Excel:
 * حالة كل موعد وطلبات سيارته ومن أرسلت إليه. طلب السيارة للموعد الطبي من مشرف المبنى وحده، فلا أزرار هنا.
 */
export function AppointmentsOverview({ appointments, requests, date, now }: {
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
  date: string;
  now: Date;
}) {
  const [scope, setScope] = useState<"day" | "all">("day");
  const dayAppointments = useMemo(() => appointments.filter((appointment) => appointment.appointmentDate === date), [appointments, date]);
  const rows = useMemo(
    () => (scope === "all" ? [...appointments] : [...dayAppointments]).sort((a, b) => `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`)),
    [appointments, dayAppointments, scope],
  );
  const byAppointment = useMemo(() => {
    const map = new Map<string, VehicleRequest[]>();
    for (const request of requests) map.set(request.appointmentId, [...(map.get(request.appointmentId) ?? []), request]);
    return map;
  }, [requests]);
  const requestsOf = (appointment: ClinicAppointment) => byAppointment.get(appointment.id) ?? [];
  const personsOf = (appointment: ClinicAppointment) => {
    const guestRequest = requestsOf(appointment).filter((request) => !request.nurseOnly).at(-1);
    return guestRequest ? requestPersons(guestRequest, appointment, requests) : tripPersons(appointment);
  };
  const lastRequest = (appointment: ClinicAppointment) => requestsOf(appointment).filter((request) => !request.nurseOnly).at(-1);
  const plates = (appointment: ClinicAppointment) => Array.from(new Set(requestsOf(appointment).flatMap((request) => (request.vehiclePlate ? [request.vehiclePlate] : []))));
  const drivers = (appointment: ClinicAppointment) => Array.from(new Set(requestsOf(appointment).flatMap((request) => (request.driver ? [request.driver] : []))));
  const notOpen = (appointment: ClinicAppointment) => appointment.status === WAITING && !requestsOf(appointment).length && !requestWindow(appointment, now).open;

  const columns: FilterColumn<ClinicAppointment>[] = [
    ...(scope === "all" ? [{
      key: "date",
      label: "التاريخ",
      value: (a: ClinicAppointment) => a.appointmentDate,
      cell: (a: ClinicAppointment) => <span className="whitespace-nowrap text-xs"><span dir="ltr" className="tabular">{a.appointmentDate}</span><span className="block text-slate-400">{formatDay(a.appointmentDate, now)}</span></span>,
    }] : []),
    { key: "time", label: "الوقت", value: (a) => a.appointmentAt, cell: (a) => <span dir="ltr" className="font-semibold tabular text-ink">{a.appointmentAt}</span> },
    {
      key: "guest",
      label: "الضيف",
      value: (a) => a.patientName,
      cell: (a) => (
        <div className="min-w-[150px] max-w-[240px] whitespace-normal">
          <p className="font-semibold text-ink">{a.patientName}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            {a.kind === "احتياجات خاصة" && <Badge tone="amber" icon={Accessibility}>احتياجات خاصة</Badge>}
            {isPriority(a) && <Badge tone="red" icon={Ribbon}>أولوية</Badge>}
          </p>
        </div>
      ),
    },
    { key: "gender", label: "الجنس", value: (a) => a.gender ?? "" },
    { key: "building", label: "المبنى", value: (a) => a.buildingNumber, cell: (a) => <span className="tabular">{a.buildingNumber}</span> },
    { key: "apartment", label: "الشقة", value: (a) => a.apartmentNumber, cell: (a) => <span className="tabular">{a.apartmentNumber}</span> },
    { key: "mobile", label: "الموبايل", value: (a) => (a.mobile === "-" ? "" : a.mobile), cell: (a) => (a.mobile && a.mobile !== "-" ? <span className="whitespace-nowrap text-xs"><GuestContact mobile={a.mobile} /></span> : <span className="text-slate-300">—</span>) },
    { key: "destination", label: "الوجهة", value: (a) => a.clinic, cell: (a) => <span className="block max-w-[200px] whitespace-normal">{a.clinic}</span> },
    { key: "category", label: "الفئة", value: (a) => (isNonMedical(a) ? "غير طبية" : "طبية"), cell: (a) => (isNonMedical(a) ? <Badge tone="violet">غير طبية</Badge> : <span className="text-xs text-slate-500">طبية</span>) },
    { key: "needs", label: "الاحتياجات", value: (a) => a.assistance.join("، "), cell: (a) => (a.assistance.length ? <span className="block max-w-[170px] whitespace-normal text-xs">{a.assistance.join("، ")}</span> : <span className="text-slate-300">—</span>) },
    { key: "persons", label: "الأشخاص", value: (a) => personsText(personsOf(a)), sortValue: (a) => String(personsOf(a)) },
    {
      key: "status",
      label: "حالة الموعد",
      value: (a) => (notOpen(a) ? "انتهت مهلة الطلب" : statusText(a.status)),
      cell: (a) => (notOpen(a) ? <Badge tone="red">انتهت مهلة الطلب</Badge> : <StatusBadge status={a.status} />),
    },
    {
      key: "request",
      label: "طلب السيارة",
      value: (a) => {
        const request = lastRequest(a);
        return request ? `${requestKind(request)}: ${statusText(request.status)}` : NOT_REQUESTED;
      },
      cell: (a) => {
        const list = requestsOf(a);
        if (!list.length) {
          const deadline = requestWindow(a, now);
          return a.status === WAITING
            ? <span className={deadline.open ? "text-xs text-amber-800" : "text-xs font-medium text-red-700"}>{deadline.open ? <>لم يطلب مشرف المبنى بعد · حتى <span dir="ltr" className="tabular">{timeLabel(deadline.deadline)}</span></> : "انتهت مهلة الطلب"}</span>
            : <span className="text-slate-300">—</span>;
        }
        return (
          <ul className="min-w-[220px] space-y-1">
            {list.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                <Badge tone={request.nurseOnly || request.direction === "عودة" ? "amber" : request.fromAppointmentId ? "cyan" : "neutral"} icon={request.nurseOnly ? Stethoscope : request.fromAppointmentId ? ArrowLeftRight : undefined}>{requestKind(request)}</Badge>
                <StatusBadge status={request.status} />
                {request.createdAt && <span className="text-slate-400">طُلبت {request.createdAt}</span>}
                {request.arrivedAt && !Number.isNaN(Date.parse(request.arrivedAt)) && <span>وصلت <span dir="ltr" className="tabular">{timeLabel(new Date(request.arrivedAt))}</span></span>}
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      key: "vehicle",
      label: "السيارة",
      value: (a) => plates(a).join("، "),
      cell: (a) => (plates(a).length
        ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs"><Truck className="h-3.5 w-3.5 text-slate-400" /><span dir="ltr" className="font-semibold text-ink">{plates(a).join("، ")}</span>{requestsOf(a).some((request) => request.groupId) ? <span className="text-slate-400">· مجمّعة</span> : null}</span>
        : <span className="text-slate-300">—</span>),
    },
    { key: "driver", label: "السائق", value: (a) => drivers(a).join("، ") },
    {
      key: "notes",
      label: "ملاحظات",
      value: (a) => (a.status === "ملغي" ? `ألغي: ${a.cancelReason || "—"}` : a.returnedSelf ? "عاد بنفسه" : ""),
      cell: (a) => (a.status === "ملغي"
        ? <span className="block min-w-[150px] max-w-[240px] whitespace-normal text-xs text-red-800"><span className="font-semibold">سبب الإلغاء:</span> {a.cancelReason || "—"}{a.cancelledBy ? ` · ${a.cancelledBy}` : ""}</span>
        : a.returnedSelf
          ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-emerald-700"><Footprints className="h-3.5 w-3.5" /> عاد بنفسه{a.returnedSelfBy ? ` (${a.returnedSelfBy})` : ""}</span>
          : <span className="text-slate-300">—</span>),
    },
  ];
  const table = useColumnFilters(rows, columns);
  const filtering = table.active > 0;

  const count = (statuses: string[]) => dayAppointments.filter((appointment) => statuses.includes(appointment.status)).length;
  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat icon={CalendarDays} tone="neutral" label="مواعيد اليوم المحدد" value={dayAppointments.length} hint={`${dayAppointments.filter(isNonMedical).length} رحلة غير طبية`} />
        <Stat icon={Clock3} tone="amber" label="لم يُطلب لها سيارة" value={count([WAITING])} hint="يطلبها مشرف المبنى" />
        <Stat icon={Truck} tone="blue" label="طُلبت لها سيارة" value={count(ACTIVE) + count(["مكتملة"])} hint={`${count(["مكتملة"])} مكتملة`} />
        <Stat icon={Ban} tone="red" label="ملغاة" value={count(["ملغي"])} />
      </div>

      <Panel
        icon={UsersRound}
        title="كل المواعيد"
        count={table.shown.length}
        description={(
          <span className="inline-flex flex-wrap items-center gap-1">
            <Eye className="h-3.5 w-3.5" /> للعرض فقط · {scope === "all" ? "كل الأيام" : longDate(date)} · {filtering ? `${table.shown.length} نتيجة · ${table.active} ${table.active === 1 ? "فلتر" : "فلاتر"}` : "اضغط ▾ في عنوان أي عمود للفرز والفلترة كما في Excel"}
          </span>
        )}
        actions={(
          <>
            {(filtering || table.sort) && <button type="button" onClick={table.clear} className={btn("ghost", "sm")}><X className="h-4 w-4" /> مسح الفلاتر</button>}
            <Segmented size="sm" label="نطاق المواعيد" value={scope} onChange={setScope} options={[{ value: "day", label: "اليوم المحدد" }, { value: "all", label: "كل الأيام" }]} />
          </>
        )}
      >
        <FilterTable
          rows={table.shown}
          columns={columns}
          state={table}
          rowKey={(a) => a.id}
          rowClassName={(a) => (a.status === "ملغي" ? "bg-red-50/40" : undefined)}
          labels={FILTER_LABELS_AR}
          dir="rtl"
          empty={<EmptyState icon={filtering ? Filter : UsersRound} title={filtering || rows.length ? "لا توجد نتائج" : "لا توجد مواعيد في هذا اليوم"} />}
        />
      </Panel>
    </>
  );
}
