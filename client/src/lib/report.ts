import { BOOKING_LABELS, DELAY_LABELS, DELAY_STAGES, bookingOf, clockText, durationText, requestTiming, type ServiceSummary, type StatsSummary } from "@shared/stats";
import type { GuestRecord, guestStats } from "@shared/guests";
import { DEFAULT_HOSPITALS, type Hospital } from "@shared/hospitals";
import { BUS_ROLE_LABELS, statusText, type ClinicAppointment, type VehicleRequest } from "@shared/transport";
import {
  CANCEL_STAGES,
  CANCEL_STAGE_LABELS,
  OUTCOMES,
  OUTCOME_LABELS,
  RETURN_OUTCOMES,
  RETURN_OUTCOME_LABELS,
  appointmentOutcome,
  approvalInfo,
  cancelStage,
  returnOutcome,
  type OperationsSummary,
} from "@shared/operations";
import { ACTIVITY_ROLES, ACTIVITY_TYPES, DETAIL_LABELS, activityDate, activityTime, type ActivityItem } from "./activity";

/**
 * تقرير الإحصائيات: نفس الأقسام تُصدَّر إلى ملف Excel (ورقة لكل قسم) أو صفحة HTML مستقلة.
 */

type Cell = string | number;
export type ReportSection = {
  title: string;
  /** اسم الورقة في Excel (31 حرفًا على الأكثر) */
  sheet: string;
  columns: string[];
  rows: Cell[][];
  /** عمود رقمي يُرسم بجانبه شريط في صفحة HTML */
  bar?: number;
  note?: string;
};
export type Report = {
  title: string;
  subtitle: string;
  kpis: { label: string; value: string }[];
  sections: ReportSection[];
};

const hm = (iso?: string) => (iso && !Number.isNaN(Date.parse(iso)) ? activityTime(iso).slice(0, 5) : "");

// ————— أقسام الإحصائيات —————

/** بالساعات بخانتين عشريتين (للجمع في Excel) */
const decimalHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export function statsReport(summary: StatsSummary, title: string, subtitle: string, service: ServiceSummary | null = null, ops: OperationsSummary | null = null): Report {
  const completion = summary.totalTrips ? Math.round((summary.completedTrips / summary.totalTrips) * 100) : 0;
  const zoneTotal = summary.zones.reduce((total, zone) => total + zone.trips, 0);
  const work = summary.workHours;
  const singleDay = new Set(work?.days.map((day) => day.date)).size === 1;
  const directions = summary.directions ?? { go: summary.completedTrips, back: 0, unknown: 0, backOnly: 0 };
  const booking = summary.booking;
  const delays = summary.delays;
  const kinds = summary.workingVehicles?.byKind.filter((item) => item.vehicles).map((item) => `${item.kind} ${item.vehicles}`).join(" · ");
  const workOf = new Map((work?.vehicles ?? []).map((item) => [item.plate, item.minutes]));
  return {
    title,
    subtitle,
    kpis: [
      { label: "إجمالي المواعيد", value: summary.totalTrips.toLocaleString("en") },
      { label: "الرحلات المنجزة (ذهاب وعودة)", value: (directions.go + directions.back + directions.unknown).toLocaleString("en") },
      { label: "رحلات الذهاب", value: directions.go.toLocaleString("en") },
      { label: "رحلات العودة", value: directions.back.toLocaleString("en") },
      { label: "المواعيد المنجزة", value: summary.completedTrips.toLocaleString("en") },
      ...(directions.backOnly ? [{ label: "منها طلبات عودة فقط من المستشفى (بلا رحلة ذهاب)", value: directions.backOnly.toLocaleString("en") }] : []),
      { label: "المواعيد غير المنجزة", value: (summary.totalTrips - summary.completedTrips).toLocaleString("en") },
      { label: "نسبة الإنجاز", value: `${completion}%` },
      ...(booking && booking.scheduled + booking.sameDay
        ? [
          { label: "مواعيد مجدولة (قبل يومها)", value: booking.scheduled.toLocaleString("en") },
          { label: "مواعيد عاجلة (في يومها)", value: booking.sameDay.toLocaleString("en") },
        ]
        : []),
      ...(delays?.trips ? [{ label: "رحلات فيها تأخير", value: `${delays.late} من ${delays.trips}` }] : []),
      ...(delays?.lateToAppointment.measured ? [{ label: "وصل الضيف بعد موعده", value: `${delays.lateToAppointment.trips} من ${delays.lateToAppointment.measured}` }] : []),
      { label: "أيام العمل", value: String(summary.activeDays) },
      { label: "السيارات العاملة", value: `${summary.workingVehicles?.total ?? summary.vehicles.length}${kinds ? ` (${kinds})` : ""}` },
      ...(summary.workingVehicles?.dailyAverage && summary.activeDays > 1
        ? [{ label: "متوسط السيارات يوميًا", value: `${summary.workingVehicles.dailyAverage} (أعلى ${summary.workingVehicles.dailyMax})` }]
        : []),
      ...(work?.days.length
        ? [
          { label: "ساعات عمل السيارات", value: durationText(work.totalMinutes) },
          { label: "متوسط ساعات السيارة في اليوم", value: durationText(work.avgDayMinutes ?? 0) },
        ]
        : []),
      ...(service?.days.length ? [{ label: "التوفر في الخدمة", value: durationText(service.totalMinutes) }] : []),
      ...(summary.activeDays > 1 ? [{ label: "متوسط المواعيد يوميًا", value: String(Math.round(summary.totalTrips / summary.activeDays)) }] : []),
      ...operationsKpis(ops),
    ],
    sections: [
      {
        title: "المواعيد يوميًا",
        sheet: "يوميًا",
        columns: ["التاريخ", "اليوم", "إجمالي المواعيد", "المنجزة", "سيدان", "احتياجات خاصة", "باص", "السيارات العاملة"],
        rows: summary.daily.map((day) => [day.date, day.weekday, day.total, day.completed, day.sedan, day.special, day.bus, day.vehicles ?? ""]),
        bar: 2,
      },
      { title: "خروج السيارات حسب الساعة", sheet: "حسب الساعة", columns: ["الساعة", "الرحلات"], rows: summary.byHour.filter((item) => item.trips).map((item) => [`${item.hour}:00`, item.trips]), bar: 1 },
      {
        title: "متوسط المواعيد حسب اليوم",
        sheet: "حسب اليوم",
        columns: ["اليوم", "متوسط المواعيد", "عدد الأيام"],
        rows: summary.byWeekday.filter((item) => item.days).map((item) => [item.weekday, Math.round(item.trips / item.days), item.days]),
        bar: 1,
      },
      {
        title: "الوجهات",
        sheet: "الوجهات",
        columns: ["الوجهة", "المنطقة", "الرحلات", "متوسط المدة (دقيقة)"],
        rows: summary.destinations.map((item) => [item.name, item.zone ?? "أخرى", item.trips, item.avgMinutes ?? ""]),
        bar: 2,
      },
      { title: "الرحلات حسب المنطقة", sheet: "المناطق", columns: ["المنطقة", "الرحلات", "النسبة"], rows: summary.zones.map((zone) => [zone.zone, zone.trips, `${zoneTotal ? Math.round((zone.trips / zoneTotal) * 100) : 0}%`]), bar: 1 },
      {
        title: "نوع المركبة",
        sheet: "نوع المركبة",
        columns: ["النوع", "الرحلات", "السيارات العاملة"],
        rows: summary.byKind.map((item) => [item.kind, item.trips, summary.workingVehicles?.byKind.find((entry) => entry.kind === item.kind)?.vehicles ?? ""]),
        bar: 1,
      },
      { title: "السيارات", sheet: "السيارات", columns: ["السيارة", "النوع", "السائق", "الرحلات"], rows: summary.vehicles.map((item) => [item.plate, item.kind ?? "", item.driver, item.trips]), bar: 3 },
      { title: "المباني", sheet: "المباني", columns: ["المبنى", "الرحلات"], rows: summary.buildings.map((item) => [`مبنى ${item.building}`, item.trips]), bar: 1 },
      ...(work?.days.length
        ? [
          {
            title: "ساعات عمل السيارات",
            sheet: "ساعات العمل",
            note: "من خروج السيارة حتى عودتها إلى المجمع، بلا تكرار الرحلات المتداخلة (العودة بعد رحلة الذهاب تقديرية)",
            columns: ["السيارة", "السائق", "النوع", "أيام العمل", "ساعات العمل", "بالساعات", "متوسط اليوم", ...(singleDay ? ["أول خروج", "آخر عودة"] : [])],
            rows: work.vehicles.map((item) => [
              item.plate, item.driver, item.kind, item.days, durationText(item.minutes), decimalHours(item.minutes), durationText(item.minutes / item.days),
              ...(singleDay ? [clockText(item.first), clockText(item.last)] : []),
            ]),
            bar: 5,
          },
          {
            title: "ساعات عمل السيارات يوميًا",
            sheet: "ساعات العمل يوميًا",
            columns: ["التاريخ", "السيارة", "السائق", "أول خروج", "آخر عودة", "ساعات العمل", "بالساعات"],
            rows: work.days.map((day) => [day.date, day.plate, day.driver, clockText(day.first), clockText(day.last), durationText(day.minutes), decimalHours(day.minutes)]),
            bar: 6,
          },
        ]
        : []),
      ...(delays?.trips
        ? [{
          title: "تأخير الرحلات",
          sheet: "التأخير",
          note: `${delays.late} من ${delays.trips} رحلة سيارة فيها تأخير (من رحلات النظام)`,
          columns: ["متى", "المرحلة", "الشرط", "الرحلات", "متوسط التأخير (د)"],
          rows: DELAY_STAGES.map((item) => {
            const stat = delays.stages.find((entry) => entry.stage === item.stage)!;
            return [item.when, item.label, item.hint, stat.trips, stat.avgMinutes ?? ""];
          }),
          bar: 3,
        }]
        : []),
      ...(service?.days.length
        ? [
          {
            title: "التوفر في الخدمة",
            sheet: "التوفر في الخدمة",
            note: "من تشغيل السيارة (متاحة ولها سائق) حتى إيقافها، ونسبة التشغيل: ساعات العمل من ساعات التوفر",
            columns: ["السيارة", "السائق", "النوع", "تخصيص الباص", "أيام الخدمة", "التوفر في الخدمة", "بالساعات", "ساعات العمل", "نسبة التشغيل", ...(singleDay ? ["التشغيل", "الإيقاف"] : [])],
            rows: service.vehicles.map((item) => {
              const worked = workOf.get(item.plate) ?? 0;
              return [
                item.plate, item.driver, item.kind, item.busRoles.map((role) => BUS_ROLE_LABELS[role]).join("، "), item.days, durationText(item.minutes), decimalHours(item.minutes),
                worked ? durationText(worked) : "", item.minutes ? `${Math.round((Math.min(worked, item.minutes) / item.minutes) * 100)}%` : "",
                ...(singleDay ? [clockText(item.first), clockText(item.last)] : []),
              ];
            }),
            bar: 6,
          },
          {
            title: "التوفر في الخدمة يوميًا",
            sheet: "التوفر يوميًا",
            columns: ["التاريخ", "السيارة", "السائق", "النوع", "تخصيص الباص", "التشغيل", "الإيقاف", "التوفر في الخدمة", "بالساعات"],
            rows: service.days.map((day) => [day.date, day.plate, day.driver, day.kind, day.busRole ? BUS_ROLE_LABELS[day.busRole] : "", clockText(day.first), clockText(day.last), durationText(day.minutes), decimalHours(day.minutes)]),
            bar: 8,
          },
        ]
        : []),
      ...operationsSections(ops),
    ],
  };
}

// ————— سير العمل: مصير المواعيد والإلغاء والعودة والجمع وتغيير السيارات وموافقة العيادة —————

const pct = (part: number, total: number) => `${total ? Math.round((part / total) * 100) : 0}%`;

function operationsKpis(ops: OperationsSummary | null): Report["kpis"] {
  if (!ops?.appointments) return [];
  const count = (value: number) => value.toLocaleString("en");
  const unserved = ops.outcomes.filter((item) => item.outcome !== "served" && item.outcome !== "open").reduce((sum, item) => sum + item.count, 0);
  const { cancel, grouping, incidents, approval } = ops;
  return [
    { label: "مواعيد لم تُخدم بسيارة", value: `${count(unserved)} (${pct(unserved, ops.appointments)})` },
    { label: "مواعيد ملغاة", value: `${count(cancel.total)} (${pct(cancel.total, ops.appointments)})` },
    ...(cancel.wastedCars !== null ? [{ label: "سيارات أُرسلت ثم أُلغي طلبها", value: count(cancel.wastedCars) }] : []),
    ...(grouping.trips
      ? [
        { label: "رحلات مجمّعة", value: `${count(grouping.grouped)} من ${count(grouping.trips)} (${pct(grouping.grouped, grouping.trips)})` },
        { label: "متوسط الأشخاص في الرحلة", value: (grouping.persons / grouping.trips).toFixed(1) },
        { label: "إشغال المقاعد", value: pct(grouping.persons, grouping.seats) },
      ]
      : []),
    ...(incidents.changes !== null ? [{ label: "تغيير السيارة بعد إرسالها", value: `${count(incidents.changes)} (منها ${count(incidents.faults)} أعطال وحوادث)` }] : []),
    ...(incidents.removals !== null ? [{ label: "إزالة ضيف من رحلة", value: count(incidents.removals) }] : []),
    ...(approval.total
      ? [
        { label: "مواعيد استبعدها مسؤول العيادة", value: `${count(approval.excluded)} (${pct(approval.excluded, approval.total)})` },
        { label: "بانتظار موافقة مسؤول العيادة", value: `${count(approval.pending)}${approval.pendingPast ? ` (منها ${count(approval.pendingPast)} فات وقتها)` : ""}` },
        ...(approval.avgWaitMinutes !== null ? [{ label: "متوسط انتظار الموافقة", value: durationText(approval.avgWaitMinutes) }] : []),
      ]
      : []),
  ];
}

function operationsSections(ops: OperationsSummary | null): ReportSection[] {
  if (!ops?.appointments) return [];
  const { cancel, returns, grouping, incidents, approval } = ops;
  const average = (persons: number, trips: number) => (trips ? Math.round((persons / trips) * 10) / 10 : "");
  return [
    {
      title: "مصير المواعيد",
      sheet: "مصير المواعيد",
      note: "مواعيد النظام في الفترة والفلاتر المختارة",
      columns: ["النتيجة", "الشرح", "المواعيد", "النسبة"],
      rows: OUTCOMES.map((meta) => {
        const value = ops.outcomes.find((item) => item.outcome === meta.outcome)!.count;
        return [meta.label, meta.hint, value, pct(value, ops.appointments)];
      }),
      bar: 2,
    },
    ...(cancel.total
      ? [{
        title: "إلغاء المواعيد",
        sheet: "الإلغاء",
        note: `${cancel.total} موعدًا ملغى · سيارات أُرسلت ثم أُلغي طلبها: ${cancel.wastedCars ?? "—"}`,
        columns: ["القسم", "البند", "المواعيد", "النسبة"],
        rows: [
          ...(cancel.stages ?? []).map((item) => ["متى أُلغي", CANCEL_STAGES.find((meta) => meta.stage === item.stage)!.label, item.count, pct(item.count, cancel.total)]),
          ...cancel.reasons.map((item) => ["السبب", item.name, item.count, pct(item.count, cancel.total)]),
          ...cancel.by.map((item) => ["من ألغى", item.name, item.count, pct(item.count, cancel.total)]),
        ],
        bar: 2,
      }]
      : []),
    ...(returns.total
      ? [{
        title: "العودة إلى المجمع",
        sheet: "العودة",
        note: `${returns.total} ضيفًا استُلموا في رحلة الذهاب`,
        columns: ["العودة", "الشرح", "الضيوف", "النسبة"],
        rows: RETURN_OUTCOMES.map((meta) => {
          const value = returns.items.find((item) => item.outcome === meta.outcome)!.count;
          return [meta.label, meta.hint, value, pct(value, returns.total)];
        }),
        bar: 2,
      }]
      : []),
    ...(grouping.trips
      ? [{
        title: "جمع الضيوف وإشغال المقاعد",
        sheet: "الجمع",
        note: `الرحلة المجمّعة رحلة واحدة · وفّر الجمع ${grouping.requests - grouping.trips} رحلة · الإشغال من مقاعد السيارة المعتمدة`,
        columns: ["نوع السيارة", "الرحلات", "المجمّعة", "نسبة المجمّعة", "الأشخاص", "المقاعد", "متوسط الأشخاص", "الإشغال"],
        rows: [
          ...grouping.byKind.map((item) => [item.kind, item.trips, item.grouped, pct(item.grouped, item.trips), item.persons, item.seats, average(item.persons, item.trips), pct(item.persons, item.seats)]),
          ["الكل", grouping.trips, grouping.grouped, pct(grouping.grouped, grouping.trips), grouping.persons, grouping.seats, average(grouping.persons, grouping.trips), pct(grouping.persons, grouping.seats)],
        ],
        bar: 1,
      }]
      : []),
    ...(incidents.changes || incidents.removals
      ? [
        {
          title: "تغيير السيارات وإزالة الضيوف حسب السيارة",
          sheet: "تغيير السيارات",
          note: "تغييرها: تغيّرت هذه السيارة في رحلة بعد إرسالها (الرحلة المجمّعة مرة واحدة)",
          columns: ["السيارة", "تغييرها", "منها أعطال وحوادث", "إزالة ضيف"],
          rows: incidents.vehicles.map((item) => [item.plate, item.changes, item.faults, item.removals]),
          bar: 1,
        },
        {
          title: "أسباب تغيير السيارة وإزالة الضيف",
          sheet: "أسباب التغيير",
          columns: ["الإجراء", "السبب", "العدد"],
          rows: [
            ...incidents.changeReasons.map((item) => ["تغيير السيارة", item.name, item.count]),
            ...incidents.removeReasons.map((item) => ["إزالة ضيف من رحلة", item.name, item.count]),
          ],
          bar: 2,
        },
      ]
      : []),
    ...(approval.people.length
      ? [{
        title: "موافقة مسؤول العيادة",
        sheet: "موافقة العيادة",
        note: `موافق عليها ${approval.approved} · مستبعدة ${approval.excluded} · بانتظار الموافقة ${approval.pending}${approval.medianWaitMinutes !== null ? ` · وسيط الانتظار ${durationText(approval.medianWaitMinutes)}` : ""}`,
        columns: ["المسؤول", "موافقة", "استبعاد"],
        rows: approval.people.map((item) => [item.name, item.approved, item.excluded]),
        bar: 1,
      }]
      : []),
  ];
}

// ————— الرحلات بتفاصيلها: من طلبها ومن أرسل السيارة ومتى في كل مرحلة —————

export function tripsSection(
  appointments: ClinicAppointment[],
  requests: VehicleRequest[],
  activity: ActivityItem[],
  from?: string,
  to?: string,
  /** ضيف الموعد من القائمة (للرقم الصحي والعمر: في الإحصائيات فقط) */
  guestOf?: (appointment: ClinicAppointment) => GuestRecord | undefined,
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
): ReportSection {
  const inPeriod = (date: string) => (!from || date >= from) && (!to || date <= to);
  // أقدم عملية أولًا حتى يُحفظ أول تسجيل لكل مرحلة
  const events = new Map<string, ActivityItem[]>();
  for (const item of [...activity].sort((a, b) => a.id - b.id)) {
    const id = item.details.appointment;
    if (id) events.set(id, [...(events.get(id) ?? []), item]);
  }
  const who = (item?: ActivityItem) => (item ? `${hm(item.at)} · ${item.userName}` : "");
  // عودة الـ Nurse فقط ليست رحلة الضيف: لا تظهر في أعمدة عودته
  const nurseIds = new Set(requests.filter((request) => request.nurseOnly).map((request) => request.id));
  const transfers = new Set(requests.flatMap((request) => (request.fromAppointmentId ? [request.fromAppointmentId] : [])));
  const APPROVAL_TEXT = { pending: "بانتظار الموافقة", approved: "موافق عليه", excluded: "مستبعد" } as const;
  const rows = appointments
    .filter((appointment) => inPeriod(appointment.appointmentDate))
    .sort((a, b) => `${a.appointmentDate} ${a.appointmentAt}`.localeCompare(`${b.appointmentDate} ${b.appointmentAt}`))
    .map((appointment) => {
      const list = events.get(appointment.id) ?? [];
      const find = (action: string, direction?: string) => list.find((item) => item.action === action && (!direction || item.details.direction === direction)
        && !nurseIds.has(item.details.request ?? ""));
      const out = requests.filter((request) => request.appointmentId === appointment.id && request.direction === "ذهاب").at(-1);
      const back = requests.filter((request) => request.appointmentId === appointment.id && request.direction === "عودة" && !request.nurseOnly).at(-1);
      // الضيف عاد بنفسه بلا سيارة عودة
      const selfReturn = appointment.returnedSelf
        ? `عاد بنفسه${appointment.returnedSelfAt ? ` ${hm(appointment.returnedSelfAt)}` : ""}${appointment.returnedSelfBy ? ` · ${appointment.returnedSelfBy}` : ""}`
        : "";
      const step = (action: string, direction: string, fallback = "") => who(find(action, direction)) || fallback;
      const arrival = (direction: string, request?: VehicleRequest) => {
        const event = find("request.arrived", direction);
        // وقت الوصول نفسه (التقديري يساوي الوقت المتوقع)، لا وقت تسجيله
        if (event) return `${hm(request?.arrivedAt ?? event.at)} · ${event.userName}${event.details.source ? ` (${event.details.source})` : ""}`;
        return request?.arrivedAt ? `${hm(request.arrivedAt)}${request.arrivalSource ? ` (${{ gps: "GPS", estimate: "تقديري", manual: "يدوي" }[request.arrivalSource]})` : ""}` : "";
      };
      const car = (request?: VehicleRequest, direction?: string) => {
        const event = direction ? find("request.dispatch", direction) : undefined;
        const plate = request?.vehiclePlate ?? event?.details.plate ?? "";
        const driver = request?.driver ?? event?.details.driver ?? "";
        return plate ? `${plate}${driver ? ` · ${driver}` : ""}` : "";
      };
      const cancel = find("appointment.cancel");
      const guest = appointment.category === "غير طبية" ? undefined : guestOf?.(appointment);
      const booking = bookingOf(appointment);
      const own = requests.filter((request) => request.appointmentId === appointment.id);
      const stages = Array.from(new Set(own.flatMap((request) => requestTiming(request, appointment, hospitals)?.stages ?? [])));
      const outcome = appointmentOutcome(appointment, own);
      const cancels = list.filter((item) => item.action === "request.cancel").map((item) => ({ plate: item.details.plate, stage: item.details.stage }));
      const returned = returnOutcome(appointment, own, transfers);
      const approval = approvalInfo(appointment);
      return [
        appointment.appointmentDate,
        appointment.appointmentAt,
        appointment.patientName,
        guest?.healthNumber ?? "",
        guest?.age ?? "",
        appointment.buildingNumber,
        appointment.apartmentNumber,
        appointment.mobile,
        appointment.clinic,
        appointment.category === "غير طبية" ? "غير طبية" : appointment.kind,
        appointment.assistance.join("، "),
        statusText(appointment.status),
        who(find("appointment.create")),
        booking ? BOOKING_LABELS[booking] : "",
        step("request.create", "ذهاب", out?.createdAt ?? ""),
        step("request.dispatch", "ذهاب", out?.notificationSentAt ?? ""),
        car(out, "ذهاب"),
        step("request.car_arrived", "ذهاب"),
        step("request.pickup", "ذهاب", hm(out?.pickedUpAt)),
        arrival("ذهاب", out),
        step("request.create", "عودة", back?.createdAt ?? "") || selfReturn,
        step("request.dispatch", "عودة", back?.notificationSentAt ?? ""),
        car(back, "عودة"),
        step("request.pickup", "عودة", hm(back?.pickedUpAt)),
        arrival("عودة", back),
        appointment.status === "ملغي" ? `${appointment.cancelReason ?? ""}${appointment.cancelledBy ? ` (${appointment.cancelledBy}${cancel ? ` ${hm(cancel.at)}` : ""})` : ""}` : "",
        stages.map((stage) => DELAY_LABELS[stage]).join("، "),
        outcome === "cancelled" ? `${OUTCOME_LABELS[outcome]} · ${CANCEL_STAGE_LABELS[cancelStage(cancels)]}` : OUTCOME_LABELS[outcome],
        returned ? RETURN_OUTCOME_LABELS[returned] : "",
        approval ? `${APPROVAL_TEXT[approval.state]}${approval.by ? ` · ${approval.by}` : ""}` : "",
      ];
    });
  return {
    title: "الرحلات بالتفصيل",
    sheet: "الرحلات",
    note: "كل مرحلة: الوقت ثم من نفّذها",
    columns: [
      "التاريخ", "وقت الموعد", "الضيف", "الرقم الصحي", "العمر", "المبنى", "الشقة", "الموبايل", "الوجهة", "نوع الرحلة", "الاحتياجات", "حالة الموعد", "إضافة الموعد", "التسجيل",
      "طلب الذهاب", "إرسال سيارة الذهاب", "سيارة الذهاب", "وصول السيارة للاستلام", "استلام الضيف", "الوصول إلى الوجهة",
      "طلب العودة", "إرسال سيارة العودة", "سيارة العودة", "استلام العودة", "الوصول إلى المجمع", "إلغاء الموعد", "التأخير", "النتيجة", "العودة", "موافقة العيادة",
    ],
    rows,
  };
}

// ————— الضيوف: العمر والرقم الصحي (في الإحصائيات فقط) —————

export function guestSections(stats: ReturnType<typeof guestStats>): ReportSection[] {
  return [
    {
      title: "الضيوف حسب الفئة العمرية",
      sheet: "الفئات العمرية",
      columns: ["الفئة العمرية", "الضيوف", "المواعيد", "السيارات المرسلة"],
      rows: stats.ageGroups.map((group) => [group.label, group.guests, group.appointments, group.trips]),
      bar: 1,
    },
    {
      title: "الضيوف: العمر والرقم الصحي",
      sheet: "الضيوف",
      note: "المواعيد الطبية في الفترة (بلا المستبعد)، والسيارات المرسلة ذهابًا وعودة ونقلًا",
      columns: ["الضيف", "الرقم الصحي", "العمر", "الجنس", "المبنى", "الشقة", "المواعيد", "الملغاة", "السيارات المرسلة"],
      rows: stats.rows.map((row) => [
        row.listed ? row.name : `${row.name} (غير موجود في القائمة)`,
        row.healthNumber ?? "",
        row.age ?? "",
        row.gender ?? "",
        row.buildingNumber,
        row.apartmentNumber,
        row.appointments,
        row.cancelled,
        row.trips,
      ]),
    },
  ];
}

// ————— سجل العمليات —————

export function activitySection(items: ActivityItem[], truncated = false): ReportSection {
  return {
    title: "سجل العمليات",
    sheet: "العمليات",
    note: truncated ? "السجل طويل جدًا: يظهر أحدث 50,000 عملية في الفترة" : "كل عملية في النظام مع من نفّذها ووقتها",
    columns: ["التاريخ", "الوقت", "المستخدم", "الدور", "النوع", "العملية", ...DETAIL_LABELS.map(([, label]) => label)],
    rows: items.map((item) => [
      activityDate(item.at),
      activityTime(item.at),
      item.userName,
      ACTIVITY_ROLES[item.role] ?? item.role,
      ACTIVITY_TYPES[item.type] ?? item.type,
      item.summary,
      ...DETAIL_LABELS.map(([key]) => item.details[key] ?? ""),
    ]),
  };
}

// ————— التصدير —————

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function downloadExcel(report: Report, fileName: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  const summary = XLSX.utils.aoa_to_sheet([[report.title], [report.subtitle], [], ...report.kpis.map((kpi) => [kpi.label, kpi.value])]);
  summary["!cols"] = [{ wch: 26 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, summary, "الملخص");
  for (const section of report.sections) {
    const sheet = XLSX.utils.aoa_to_sheet([section.columns, ...section.rows]);
    // زر الفلترة في عنوان كل عمود
    if (section.rows.length && sheet["!ref"]) sheet["!autofilter"] = { ref: sheet["!ref"] };
    sheet["!cols"] = section.columns.map((column, index) => ({
      wch: Math.min(60, Math.max(column.length + 2, ...section.rows.slice(0, 300).map((row) => String(row[index] ?? "").length + 2))),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, section.sheet.slice(0, 31));
  }
  XLSX.writeFile(workbook, fileName);
}

const escapeHtml = (value: Cell) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** أعمدة النص الطويل في الجداول العريضة: تلتف أسطرها، وبقية الخانات في سطر واحد. */
const LONG_COLUMNS = new Set(["العملية", "التغييرات", "إلغاء الموعد", "الشرط", "التأخير", "الشرح", "النتيجة"]);

function sectionHtml(section: ReportSection) {
  const max = section.bar === undefined ? 0 : Math.max(1, ...section.rows.map((row) => Number(row[section.bar!]) || 0));
  const wide = section.columns.length > 8;
  const cell = (value: Cell, index: number) => {
    if (index !== section.bar) return `<td${wide && LONG_COLUMNS.has(section.columns[index]) ? ' class="long"' : ""}>${escapeHtml(value)}</td>`;
    const width = Math.round(((Number(value) || 0) / max) * 100);
    return `<td class="num"><span class="bar"><i style="width:${width}%"></i></span><b>${escapeHtml(value)}</b></td>`;
  };
  return `<section>
  <h2>${escapeHtml(section.title)} <small>${section.rows.length.toLocaleString("en")}</small></h2>
  ${section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : ""}
  ${section.rows.length
    ? `<div class="scroll"><table${wide ? ' class="wide"' : ""}><thead><tr>${section.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${section.rows.map((row) => `<tr>${row.map(cell).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<p class="empty">لا توجد بيانات</p>`}
</section>`;
}

/** صفحة HTML مستقلة (تعمل بلا اتصال، وتُطبع). */
export function reportHtml(report: Report) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
  :root { --ink:#0f1f35; --muted:#64748b; --line:#e2e8f0; --page:#f4f6f9; --brand:#da291c; --navy:#0b2545; --bar:#2a78d6; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.6 "IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif; }
  header { background: var(--navy); color: #fff; border-top: 4px solid var(--brand); padding: 28px 32px; }
  header h1 { margin: 0; font-size: 24px; }
  header p { margin: 4px 0 0; color: #cbd5e1; }
  main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 48px; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; }
  .kpi span { display: block; color: var(--muted); font-size: 13px; }
  .kpi b { font-size: 24px; }
  section { background: #fff; border: 1px solid var(--line); border-radius: 16px; padding: 18px 20px; margin-bottom: 20px; }
  h2 { margin: 0 0 4px; font-size: 17px; }
  h2 small { background: #f1f5f9; color: var(--muted); border-radius: 999px; padding: 1px 8px; font-size: 12px; font-weight: 600; margin-inline-start: 6px; }
  .note { margin: 0 0 12px; color: var(--muted); font-size: 12px; }
  .scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { position: sticky; top: 0; background: #f8fafc; color: var(--muted); font-weight: 600; text-align: start; white-space: nowrap; }
  th, td { border-bottom: 1px solid var(--line); padding: 7px 10px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fbfcfd; }
  td.num { white-space: nowrap; }
  table.wide { width: max-content; min-width: 100%; }
  table.wide td { white-space: nowrap; }
  table.wide td.long { white-space: normal; min-width: 320px; max-width: 480px; }
  .bar { display: inline-block; width: 120px; height: 8px; border-radius: 99px; background: #f1f5f9; margin-inline-end: 8px; vertical-align: middle; }
  .bar i { display: block; height: 100%; border-radius: 99px; background: var(--bar); }
  .empty { color: var(--muted); }
  footer { color: var(--muted); font-size: 12px; text-align: center; }
  @page { size: A4 landscape; margin: 10mm; }
  @media print { body { background: #fff; font-size: 11px; } table.wide { width: 100%; } table.wide td { white-space: normal; } table.wide td.long { min-width: 0; } header { color: #000; background: #fff; border-bottom: 2px solid var(--brand); } header p { color: #333; } section { border-color: #ccc; } .kpi, tr { break-inside: avoid; } .scroll { overflow: visible; } }
</style>
</head>
<body>
<header><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.subtitle)}</p></header>
<main>
  ${report.kpis.length ? `<div class="kpis">${report.kpis.map((kpi) => `<div class="kpi"><span>${escapeHtml(kpi.label)}</span><b>${escapeHtml(kpi.value)}</b></div>`).join("")}</div>` : ""}
  ${report.sections.map(sectionHtml).join("\n")}
  <footer>سيارات مجمع الثمامة</footer>
</main>
</body>
</html>`;
}

export function downloadHtml(report: Report, fileName: string) {
  download(new Blob([reportHtml(report)], { type: "text/html;charset=utf-8" }), fileName);
}
