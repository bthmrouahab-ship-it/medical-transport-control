import { describe, expect, it } from "vitest";
import { activitySection, reportHtml, tripsSection } from "../client/src/lib/report";
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
