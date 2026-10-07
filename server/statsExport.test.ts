import { describe, expect, it } from "vitest";
import { EMPTY_FILTER, calendarDays, serviceHours, summarizeTrips, tripsFromSystem, type ServiceEvent } from "../shared/stats";
import { summarizeOperations } from "../shared/operations";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";
import type { ClinicAppointment, VehicleRequest } from "../shared/transport";
import { parseRoute, routeHash, rowDate, sectionForDates, statsForDates } from "../client/src/report/compute";
import { statsPageHtml } from "../client/src/report/page";
import type { ReportViewerData } from "../client/src/report/types";

// بيانات مصطنعة: يومان فيهما مواعيد، ويوم بينهما بلا مواعيد
const appointment = (id: string, date: string, status: ClinicAppointment["status"] = "مكتملة") => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: date, appointmentAt: "09:00", kind: "عادي", assistance: [], status,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, plate: string) => ({
  id, appointmentId, direction: "ذهاب", status: "وصلت الوجهة", notificationMethod: "whatsapp", createdAt: "08:00",
  vehiclePlate: plate, driver: `سائق ${plate}`, notificationSentAt: "08:10", arrivedAt: "2026-10-04T06:00:00.000Z", arrivalSource: "manual",
}) as VehicleRequest;
const appointments = [appointment("A1", "2026-10-04"), appointment("A2", "2026-10-04"), appointment("B1", "2026-10-06"), appointment("B2", "2026-10-06", "بانتظار طلب السيارة"), appointment("B3", "2026-10-06")];
const requests = [request("R1", "A1", "111"), request("R2", "A2", "222"), request("R3", "B1", "111"), request("R4", "B3", "111")];
const fleet = [{ plate: "111", kind: "سيدان" as const }, { plate: "222", kind: "سيدان" as const }];
const trips = tripsFromSystem(appointments, requests, fleet, DEFAULT_HOSPITALS);
// السيارة 222 في الخدمة يوم 04-10 فقط
const events: ServiceEvent[] = [
  { at: "2026-10-04T05:00:00.000Z", plate: "222", kind: "سيدان", available: true, hasDriver: true, busRole: "", driver: "سائق" },
  { at: "2026-10-04T13:00:00.000Z", plate: "222", kind: "سيدان", available: false, hasDriver: true, busRole: "", driver: "سائق" },
];
const summary = summarizeTrips(trips, DEFAULT_HOSPITALS);
const data: ReportViewerData = {
  title: "إحصائيات", subtitle: "", periodLabel: "الفترة", filter: EMPTY_FILTER, summary, operations: summarizeOperations(trips, []),
  service: serviceHours(events, "2026-10-04", "2026-10-06", new Date("2026-10-07T00:00:00Z")), trackedSince: null, opsLog: [], trips,
  appointments: [], requests: [], hospitals: DEFAULT_HOSPITALS, schedules: null, fleetKinds: [["111", "سيدان"]], guests: null,
  calendar: { days: calendarDays(summary.daily), today: "2026-10-07" },
  sections: [
    { title: "الرحلات بالتفصيل", sheet: "الرحلات", columns: ["التاريخ", "الضيف"], rows: [["2026-10-04", "ضيف A1"], ["2026-10-06", "ضيف B1"]] },
    { title: "جدول بتاريخ آخر", sheet: "جدول", columns: ["التاريخ", "العملية"], rows: [["04/10/2026", "إرسال"], ["06/10/2026", "وصول"]] },
    { title: "الضيوف", sheet: "الضيوف", columns: ["الضيف"], rows: [["ضيف A1"]] },
  ],
};

describe("exported statistics page: a page for each day", () => {
  it("opens a day or several selected days from the address", () => {
    expect(parseRoute("")).toEqual({ kind: "period" });
    expect(parseRoute("#day=2026-10-04")).toEqual({ kind: "days", dates: ["2026-10-04"] });
    expect(parseRoute("#days=2026-10-06,2026-10-04,2026-10-06")).toEqual({ kind: "days", dates: ["2026-10-04", "2026-10-06"] });
    expect(parseRoute("#day=bad")).toEqual({ kind: "period" });
    expect(routeHash(["2026-10-04"])).toBe("#day=2026-10-04");
    expect(routeHash(["2026-10-06", "2026-10-04"])).toBe("#days=2026-10-04,2026-10-06");
  });

  it("computes the day's statistics like the site does for that day", () => {
    const day = statsForDates(data, ["2026-10-06"]);
    expect(day.summary.totalTrips).toBe(3);
    expect(day.summary.completedTrips).toBe(2);
    expect(day.summary).toEqual(summarizeTrips(trips.filter((trip) => trip.date === "2026-10-06"), DEFAULT_HOSPITALS));
    // التوفر في الخدمة لأيامها فقط
    expect(day.service?.days).toHaveLength(0);
    expect(statsForDates(data, ["2026-10-04"]).service?.vehicles.map((vehicle) => vehicle.plate)).toEqual(["222"]);
    // الأيام المحددة معًا
    const both = statsForDates(data, ["2026-10-04", "2026-10-06"]);
    expect(both.summary.totalTrips).toBe(5);
    expect(both.operations.appointments).toBe(5);
  });

  it("filters the detail tables to the day's rows", () => {
    expect(rowDate("2026-10-04")).toBe("2026-10-04");
    expect(rowDate("04/10/2026")).toBe("2026-10-04");
    expect(rowDate("ضيف")).toBeNull();
    expect(sectionForDates(data.sections[0], ["2026-10-06"])?.rows).toEqual([["2026-10-06", "ضيف B1"]]);
    expect(sectionForDates(data.sections[1], ["2026-10-04"])?.rows).toEqual([["04/10/2026", "إرسال"]]);
    // الجدول بلا تاريخ لا يظهر في صفحة اليوم
    expect(sectionForDates(data.sections[2], ["2026-10-04"])).toBeNull();
  });

  it("builds one standalone page with the data and the viewer inside", () => {
    const html = statsPageHtml({ ...data, title: "إحصائيات <b>" }, 'var s = "</script><!--";', ".a{color:red}</style>");
    expect(html).toContain('<meta name="color-scheme" content="only light" />');
    expect(html).toContain('<script type="application/json" id="report-data">');
    expect(html).not.toContain('"</script><!--"');
    expect(html).toContain('var s = "<\\/script><\\!--";');
    expect(html).not.toContain(".a{color:red}</style>");
    expect(html).not.toContain("<title>إحصائيات <b></title>");
    // البيانات بلا «<» خام داخل وسم البيانات
    const json = html.slice(html.indexOf('id="report-data">') + 17, html.indexOf("</script>", html.indexOf('id="report-data">')));
    expect(JSON.parse(json).calendar.days.map((day: { date: string }) => day.date)).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
  });
});
