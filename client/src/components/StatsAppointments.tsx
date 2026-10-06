import { useMemo, useState } from "react";
import { CalendarSearch, Filter, X } from "lucide-react";
import { BOOKING_LABELS, DELAY_LABELS, stageMinutes, type DelayStage, type TripStat } from "@shared/stats";
import { OUTCOMES, RETURN_OUTCOMES, type Outcome, type ReturnOutcome } from "@shared/operations";
import { RETURN_ONLY_LABEL, isNonMedical, isReturnOnly, statusText, type ClinicAppointment, type VehicleRequest } from "@shared/transport";
import { FILTER_LABELS_AR, FilterTable, useColumnFilters, type FilterColumn } from "./ExcelFilter";
import { Badge, EmptyState, Panel, btn } from "./ui-kit";

const PAGE = 100;
const outcomeMeta = (outcome: Outcome) => OUTCOMES.find((item) => item.outcome === outcome)!;
const returnMeta = (outcome: ReturnOutcome) => RETURN_OUTCOMES.find((item) => item.outcome === outcome)!;

type Row = {
  id: string;
  date: string;
  time: string;
  guest: string;
  building: string;
  destination: string;
  category: string;
  booking: string;
  status: string;
  outcome: Outcome | null;
  cancelReason: string;
  back: ReturnOutcome | null;
  plates: string;
  trips: string;
  stages: DelayStage[];
  delay: string;
  /** أطول مرحلة متأخرة بالدقائق */
  worst: number | null;
};

/**
 * المواعيد بالتفصيل في الإحصائيات (رحلات النظام في الفترة والفلاتر المختارة): جدول بفلترة أعمدة مثل Excel،
 * ومعه نوع التسجيل (مجدولة أو عاجلة) ومراحل التأخير لكل موعد.
 */
export default function StatsAppointments({ trips, appointments, requests }: {
  trips: TripStat[];
  appointments: ClinicAppointment[];
  requests: VehicleRequest[];
}) {
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const byId = new Map(appointments.map((appointment) => [appointment.id, appointment]));
    const requestsOf = new Map<string, VehicleRequest[]>();
    for (const request of requests) requestsOf.set(request.appointmentId, [...(requestsOf.get(request.appointmentId) ?? []), request]);
    return trips.flatMap((trip): Row[] => {
      const appointment = trip.appointmentId ? byId.get(trip.appointmentId) : undefined;
      if (!appointment) return [];
      const timings = trip.timings ?? [];
      const stages = Array.from(new Set(timings.flatMap((timing) => timing.stages)));
      const minutes = timings.flatMap((timing) => timing.stages.map((stage) => stageMinutes(timing, stage) ?? 0));
      const plates = Array.from(new Set((requestsOf.get(appointment.id) ?? []).flatMap((request) => (request.vehiclePlate ? [request.vehiclePlate] : []))));
      return [{
        id: appointment.id,
        date: appointment.appointmentDate,
        time: appointment.appointmentAt,
        guest: appointment.patientName,
        building: appointment.buildingNumber,
        destination: appointment.clinic,
        category: isNonMedical(appointment) ? "غير طبية" : isReturnOnly(appointment) ? RETURN_ONLY_LABEL : "طبية",
        booking: trip.booking ? BOOKING_LABELS[trip.booking] : "",
        status: statusText(appointment.status),
        outcome: trip.outcome ?? null,
        cancelReason: trip.cancel?.reason ?? "",
        back: trip.returnOutcome ?? null,
        plates: plates.join("، "),
        trips: trip.goTrips || trip.returnTrips ? `ذهاب ${trip.goTrips ?? 0} · عودة ${trip.returnTrips ?? 0}` : "",
        stages,
        delay: !timings.length ? "" : stages.length ? stages.map((stage) => DELAY_LABELS[stage]).join("، ") : "بلا تأخير",
        worst: minutes.length ? Math.max(...minutes) : null,
      }];
    });
  }, [trips, appointments, requests]);

  const columns = useMemo<FilterColumn<Row>[]>(() => [
    { key: "date", label: "التاريخ", value: (row) => row.date, cell: (row) => <span dir="ltr" className="whitespace-nowrap text-xs tabular">{row.date}</span> },
    { key: "time", label: "الوقت", value: (row) => row.time, cell: (row) => <span dir="ltr" className="font-semibold tabular text-ink">{row.time}</span> },
    { key: "guest", label: "الضيف", value: (row) => row.guest, cell: (row) => <span className="block min-w-[140px] max-w-[220px] whitespace-normal font-medium text-ink">{row.guest}</span> },
    { key: "building", label: "المبنى", value: (row) => row.building, cell: (row) => <span className="tabular">{row.building}</span> },
    { key: "destination", label: "الوجهة", value: (row) => row.destination, cell: (row) => <span className="block max-w-[200px] whitespace-normal">{row.destination}</span> },
    { key: "category", label: "الفئة", value: (row) => row.category },
    {
      key: "booking",
      label: "التسجيل",
      value: (row) => row.booking,
      cell: (row) => (row.booking ? <Badge tone={row.booking === BOOKING_LABELS.sameDay ? "amber" : "blue"}>{row.booking}</Badge> : <span className="text-slate-300">—</span>),
    },
    { key: "status", label: "الحالة", value: (row) => row.status },
    {
      key: "outcome",
      label: "النتيجة",
      value: (row) => (row.outcome ? outcomeMeta(row.outcome).label : ""),
      cell: (row) => (row.outcome ? (
        <span className="flex min-w-[130px] flex-col items-start gap-0.5">
          <Badge tone={outcomeMeta(row.outcome).tone}>{outcomeMeta(row.outcome).label}</Badge>
          {row.cancelReason && <span className="max-w-[200px] whitespace-normal text-xs text-slate-500">{row.cancelReason}</span>}
        </span>
      ) : <span className="text-slate-300">—</span>),
    },
    {
      key: "back",
      label: "العودة",
      value: (row) => (row.back ? returnMeta(row.back).label : ""),
      cell: (row) => (row.back ? <Badge tone={returnMeta(row.back).tone}>{returnMeta(row.back).label}</Badge> : <span className="text-slate-300">—</span>),
    },
    { key: "plates", label: "السيارة", value: (row) => row.plates, cell: (row) => (row.plates ? <span dir="ltr" className="tabular">{row.plates}</span> : <span className="text-slate-300">—</span>) },
    { key: "trips", label: "الرحلات", value: (row) => row.trips, cell: (row) => <span className="whitespace-nowrap text-xs text-slate-600">{row.trips || "—"}</span> },
    {
      key: "delay",
      label: "التأخير",
      value: (row) => row.delay,
      cell: (row) => (row.stages.length
        ? <span className="flex min-w-[160px] flex-wrap gap-1">{row.stages.map((stage) => <Badge key={stage} tone="red">{DELAY_LABELS[stage]}</Badge>)}</span>
        : <span className="text-xs text-slate-400">{row.delay || "—"}</span>),
    },
    {
      key: "worst",
      label: "أطول تأخير",
      value: (row) => (row.worst === null ? "" : `${row.worst} د`),
      sortValue: (row) => String(row.worst ?? -1).padStart(6, "0"),
      cell: (row) => (row.worst === null ? <span className="text-slate-300">—</span> : <span className="font-semibold tabular text-red-700">{row.worst} د</span>),
    },
  ], []);
  const table = useColumnFilters(rows, columns);
  const visible = table.shown.slice(0, limit);

  return (
    <Panel
      icon={CalendarSearch}
      title="المواعيد بالتفصيل"
      count={table.shown.length}
      description={table.active
        ? `${table.shown.length.toLocaleString("en")} نتيجة · ${table.active} ${table.active === 1 ? "فلتر" : "فلاتر"}`
        : "من رحلات النظام في الفترة والفلاتر المختارة · اضغط ▾ في عنوان أي عمود للفرز والفلترة كما في Excel"}
      actions={(table.active || table.sort) ? <button type="button" onClick={table.clear} className={btn("ghost", "sm")}><X className="h-4 w-4" /> مسح فلاتر الجدول</button> : undefined}
    >
      <FilterTable
        rows={visible}
        columns={columns}
        state={table}
        rowKey={(row) => row.id}
        rowClassName={(row) => (row.stages.length ? "bg-red-50/30" : undefined)}
        labels={FILTER_LABELS_AR}
        dir="rtl"
        empty={<EmptyState icon={table.active ? Filter : CalendarSearch} title={table.active || rows.length ? "لا توجد نتائج" : "لا توجد مواعيد من النظام في هذه الفترة"} />}
      />
      {table.shown.length > visible.length && (
        <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-3 text-xs text-slate-500">
          يظهر {visible.length.toLocaleString("en")} من {table.shown.length.toLocaleString("en")}
          <button type="button" onClick={() => setLimit((current) => current + PAGE * 3)} className={btn("secondary", "sm")}>عرض المزيد</button>
        </div>
      )}
    </Panel>
  );
}
