import { describe, expect, it } from "vitest";
import { activitySection, reportHtml, tripsSection } from "../client/src/lib/report";
import { calendarDays, completionPercent, dayRating, weekdayOf } from "../shared/stats";
import type { ActivityItem } from "../client/src/lib/activity";
import type { ClinicAppointment, VehicleRequest } from "../shared/transport";

const appointment: ClinicAppointment = {
  id: "APT-1", patientName: "مريض تجربة", clinic: "مستشفى الوكرة", buildingNumber: "17", apartmentNumber: "3", mobile: "55500000",
  appointmentDate: "2026-09-27", appointmentAt: "10:00", hospitalId: "wakra", kind: "عادي", assistance: [], status: "تم استلام المريض",
};
const outbound: VehicleRequest = {
  id: "REQ-1", appointmentId: "APT-1", vehiclePlate: "943438", driver: "خرم", direction: "ذهاب", status: "وصلت الوجهة",
  notificationMethod: "whatsapp", createdAt: "09:30", arrivalSource: "gps",
};
const event = (id: number, action: string, userName: string, at: string, details: Record<string, string> = {}): ActivityItem => ({
  id, at, userId: "1", userName, role: "buildingSupervisor", type: "request", action, ref: "REQ-1", summary: action,
  details: { appointment: "APT-1", direction: "ذهاب", ...details },
});

describe("statistics report", () => {
  const activity = [
    event(4, "request.arrived", "خرم شهزاد", "2026-09-27T07:05:00.000Z", { source: "GPS" }),
    event(1, "request.create", "مشرف المبنى 17", "2026-09-27T06:30:00.000Z"),
    event(2, "request.dispatch", "مشرف الحركة", "2026-09-27T06:35:00.000Z", { plate: "943438", driver: "خرم" }),
    event(3, "request.pickup", "مشرف المبنى 17", "2026-09-27T06:45:00.000Z"),
  ];

  it("shows who did each step of a trip and when", () => {
    const section = tripsSection([appointment], [outbound], activity, "2026-09-27", "2026-09-27");
    const row = Object.fromEntries(section.columns.map((column, index) => [column, section.rows[0][index]]));
    expect(row["الضيف"]).toBe("مريض تجربة");
    expect(row["طلب الذهاب"]).toMatch(/مشرف المبنى 17$/);
    expect(row["إرسال سيارة الذهاب"]).toMatch(/مشرف الحركة$/);
    expect(row["سيارة الذهاب"]).toBe("943438 · خرم");
    expect(row["الوصول إلى الوجهة"]).toMatch(/خرم شهزاد \(GPS\)$/);
    // خارج الفترة لا يظهر
    expect(tripsSection([appointment], [outbound], activity, "2026-09-28").rows).toHaveLength(0);
  });

  it("lists every operation with its user and details, and escapes the HTML page", () => {
    const section = activitySection([{ ...activity[0], summary: "<script>x</script>" }]);
    expect(section.columns.slice(0, 6)).toEqual(["التاريخ", "الوقت", "المستخدم", "الدور", "النوع", "العملية"]);
    expect(section.rows[0][2]).toBe("خرم شهزاد");
    const html = reportHtml({ title: "تقرير", subtitle: "", kpis: [], sections: [section] });
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("days calendar in the exported statistics", () => {
  const stat = (date: string, total: number, completed: number) => ({ date, weekday: weekdayOf(date), total, completed, sedan: completed, special: 0, bus: 0 });
  // من الخميس 01-10 إلى الإثنين 05-10، والجمعة 02-10 والأحد 04-10 بلا مواعيد
  const daily = [stat("2026-10-01", 20, 18), stat("2026-10-03", 10, 7), stat("2026-10-05", 10, 6)];

  it("lists every day of the period from Saturday to Friday, with empty days as zeros", () => {
    const days = calendarDays(daily);
    expect(days.map((day) => day.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    // الخميس 5، والجمعة 6، والسبت 0
    expect(days.map((day) => day.day)).toEqual([5, 6, 0, 1, 2]);
    expect(days[1]).toMatchObject({ total: 0, completed: 0, weekday: "الجمعة" });
    // فلتر الفترة يمدها إلى أيامه، ويوم واحد بلا تقويم
    expect(calendarDays(daily, "2026-09-30", "2026-10-06")).toHaveLength(7);
    expect(calendarDays([stat("2026-10-01", 5, 5)])).toEqual([]);
    expect(calendarDays(daily, "2026-10-03", "2026-10-03")).toEqual([]);
  });

  it("rates each finished day by its completion", () => {
    const days = calendarDays(daily);
    expect(completionPercent(days[0])).toBe(90);
    expect(dayRating(days[0], "2026-10-07")).toBe("excellent");
    expect(dayRating(days[1], "2026-10-07")).toBe("holiday");
    expect(dayRating(days[2], "2026-10-07")).toBe("average");
    expect(dayRating(days[3], "2026-10-07")).toBe("none");
    expect(dayRating(days[4], "2026-10-07")).toBe("weak");
    // اليوم والأيام القادمة لم تنتهِ
    expect(dayRating(days[4], "2026-10-05")).toBe("today");
    expect(dayRating(days[2], "2026-10-01")).toBe("upcoming");
  });

  it("shows selectable day cards only for more than one day", () => {
    const calendar = { days: calendarDays(daily), today: "2026-10-07" };
    const html = reportHtml({ title: "تقرير", subtitle: "", kpis: [], sections: [], calendar });
    expect(html).toContain('id="cal-data"');
    // الأيام التي فيها مواعيد فقط تُحدد، والأيام بلا مواعيد بطاقة بلا زر
    expect(html.match(/<button[^>]*class="day"[^>]*data-date=/g)).toHaveLength(3);
    expect(html.match(/class="day empty"/g)).toHaveLength(2);
    expect(html).toContain("ممتاز");
    expect(html).toContain("عطلة");
    expect(reportHtml({ title: "تقرير", subtitle: "", kpis: [], sections: [] })).not.toContain('id="cal-data"');
  });
});
