import type { StatsSummary } from "@shared/stats";
import { statusText, type ClinicAppointment, type VehicleRequest } from "@shared/transport";
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

export function statsReport(summary: StatsSummary, title: string, subtitle: string): Report {
  const completion = summary.totalTrips ? Math.round((summary.completedTrips / summary.totalTrips) * 100) : 0;
  const zoneTotal = summary.zones.reduce((total, zone) => total + zone.trips, 0);
  return {
    title,
    subtitle,
    kpis: [
      { label: "إجمالي المواعيد", value: summary.totalTrips.toLocaleString("en") },
      { label: "الرحلات المنجزة", value: summary.completedTrips.toLocaleString("en") },
      { label: "نسبة الإنجاز", value: `${completion}%` },
      { label: "أيام العمل", value: String(summary.activeDays) },
      { label: "متوسط المواعيد يوميًا", value: String(summary.activeDays ? Math.round(summary.totalTrips / summary.activeDays) : 0) },
      { label: "متوسط مدة الرحلة", value: summary.avgTripMinutes ? `${summary.avgTripMinutes} دقيقة` : "—" },
    ],
    sections: [
      {
        title: "المواعيد يوميًا",
        sheet: "يوميًا",
        columns: ["التاريخ", "اليوم", "إجمالي المواعيد", "المنجزة", "سيدان", "احتياجات خاصة", "باص"],
        rows: summary.daily.map((day) => [day.date, day.weekday, day.total, day.completed, day.sedan, day.special, day.bus]),
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
      { title: "نوع المركبة", sheet: "نوع المركبة", columns: ["النوع", "الرحلات"], rows: summary.byKind.map((item) => [item.kind, item.trips]), bar: 1 },
      { title: "السيارات", sheet: "السيارات", columns: ["السيارة", "السائق", "الرحلات"], rows: summary.vehicles.map((item) => [item.plate, item.driver, item.trips]), bar: 2 },
      { title: "المباني", sheet: "المباني", columns: ["المبنى", "الرحلات"], rows: summary.buildings.map((item) => [`مبنى ${item.building}`, item.trips]), bar: 1 },
    ],
  };
}

// ————— الرحلات بتفاصيلها: من طلبها ومن أرسل السيارة ومتى في كل مرحلة —————

export function tripsSection(appointments: ClinicAppointment[], requests: VehicleRequest[], activity: ActivityItem[], from?: string, to?: string): ReportSection {
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
      return [
        appointment.appointmentDate,
        appointment.appointmentAt,
        appointment.patientName,
        appointment.buildingNumber,
        appointment.apartmentNumber,
        appointment.mobile,
        appointment.clinic,
        appointment.category === "غير طبية" ? "غير طبية" : appointment.kind,
        appointment.assistance.join("، "),
        statusText(appointment.status),
        who(find("appointment.create")),
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
      ];
    });
  return {
    title: "الرحلات بالتفصيل",
    sheet: "الرحلات",
    note: "كل مرحلة: الوقت ثم من نفّذها",
    columns: [
      "التاريخ", "وقت الموعد", "الضيف", "المبنى", "الشقة", "الموبايل", "الوجهة", "نوع الرحلة", "الاحتياجات", "حالة الموعد", "إضافة الموعد",
      "طلب الذهاب", "إرسال سيارة الذهاب", "سيارة الذهاب", "وصول السيارة للاستلام", "استلام الضيف", "الوصول إلى الوجهة",
      "طلب العودة", "إرسال سيارة العودة", "سيارة العودة", "استلام العودة", "الوصول إلى المجمع", "إلغاء الموعد",
    ],
    rows,
  };
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
    sheet["!cols"] = section.columns.map((column, index) => ({
      wch: Math.min(60, Math.max(column.length + 2, ...section.rows.slice(0, 300).map((row) => String(row[index] ?? "").length + 2))),
    }));
    XLSX.utils.book_append_sheet(workbook, sheet, section.sheet.slice(0, 31));
  }
  XLSX.writeFile(workbook, fileName);
}

const escapeHtml = (value: Cell) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** أعمدة النص الطويل في الجداول العريضة: تلتف أسطرها، وبقية الخانات في سطر واحد. */
const LONG_COLUMNS = new Set(["العملية", "التغييرات", "إلغاء الموعد"]);

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
  <footer>سيارات مجمع الثمامة · الهلال الأحمر القطري</footer>
</main>
</body>
</html>`;
}

export function downloadHtml(report: Report, fileName: string) {
  download(new Blob([reportHtml(report)], { type: "text/html;charset=utf-8" }), fileName);
}
