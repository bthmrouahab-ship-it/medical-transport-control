import { describe, expect, it } from "vitest";
import { appointmentOutcome, approvalInfo, returnOutcome, summarizeOperations, type OpsEvent } from "../shared/operations";
import { tripsFromSystem } from "../shared/stats";
import { appointmentDateTime, type ClinicAppointment, type Vehicle, type VehicleRequest } from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

// بيانات مصطنعة: اليوم 2026-10-06 الساعة 12:00، وأمس 2026-10-05
const today = "2026-10-06";
const yesterday = "2026-10-05";
const now = appointmentDateTime({ appointmentDate: today, appointmentAt: "12:00" });
const iso = (time: string, date = today) => appointmentDateTime({ appointmentDate: date, appointmentAt: time }).toISOString();
const appointment = (id: string, extra: Partial<ClinicAppointment> = {}) => ({
  id, patientName: `ضيف ${id}`, clinic: "مستشفى حمد العام", hospitalId: "hgh", buildingNumber: "5", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: yesterday, appointmentAt: "10:00", kind: "عادي", assistance: [], status: "بانتظار طلب السيارة", ...extra,
}) as ClinicAppointment;
const request = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}) => ({
  id, appointmentId, direction: "ذهاب", status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt: "09:00", ...extra,
}) as VehicleRequest;
const sent = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}) =>
  request(id, appointmentId, { status: "وصلت الوجهة", vehiclePlate: "111", driver: "سائق", notificationSentAt: "09:05", pickedUpAt: iso("09:20", yesterday), ...extra });
const fleet: (Pick<Vehicle, "plate" | "kind"> & { fullCapacity?: boolean })[] = [{ plate: "111", kind: "سيدان" }, { plate: "222", kind: "سيدان" }, { plate: "900", kind: "باص" }];

describe("what happened to each appointment", () => {
  it("served, cancelled, excluded, not approved, expired, requested without a car, and still open", () => {
    expect(appointmentOutcome(appointment("A"), [sent("R", "A")], now)).toBe("served");
    expect(appointmentOutcome(appointment("A", { status: "ملغي" }), [], now)).toBe("cancelled");
    expect(appointmentOutcome(appointment("A", { approval: "excluded" }), [], now)).toBe("excluded");
    expect(appointmentOutcome(appointment("A", { approval: "pending" }), [], now)).toBe("unapproved");
    expect(appointmentOutcome(appointment("A"), [], now)).toBe("expired");
    expect(appointmentOutcome(appointment("A", { status: "تم طلب السيارة" }), [request("R", "A")], now)).toBe("undispatched");
    // طلب العودة فقط وعاد الضيف بنفسه قبل إرسال السيارة
    expect(appointmentOutcome(appointment("A", { returnOnly: true, status: "مكتملة", returnedSelf: true }), [], now)).toBe("self");
    // اليوم: لم يحن وقته، أو طُلبت سيارته ولم تُرسل بعد
    expect(appointmentOutcome(appointment("A", { appointmentDate: today, appointmentAt: "15:00" }), [], now)).toBe("open");
    expect(appointmentOutcome(appointment("A", { appointmentDate: today, appointmentAt: "11:00", status: "تم طلب السيارة" }), [request("R", "A")], now)).toBe("open");
    // اليوم بعد مهلة الطلب بلا طلب
    expect(appointmentOutcome(appointment("A", { appointmentDate: today, appointmentAt: "11:00" }), [], now)).toBe("expired");
  });

  it("how the guest came back to the complex", () => {
    const go = sent("G", "A");
    const none = new Set<string>();
    expect(returnOutcome(appointment("A", { status: "مكتملة" }), [go, sent("B", "A", { direction: "عودة" })], none, now)).toBe("car");
    expect(returnOutcome(appointment("A", { status: "مكتملة" }), [go], new Set(["A"]), now)).toBe("transfer");
    expect(returnOutcome(appointment("A", { status: "مكتملة", returnedSelf: true }), [go], none, now)).toBe("self");
    expect(returnOutcome(appointment("A", { status: "طلب عودة" }), [go, request("B", "A", { direction: "عودة" })], none, now)).toBe("requested");
    expect(returnOutcome(appointment("A", { status: "تم استلام المريض" }), [go], none, now)).toBe("unrecorded");
    expect(returnOutcome(appointment("A", { appointmentDate: today, status: "تم استلام المريض" }), [sent("G", "A")], none, now)).toBe("atAppointment");
    // عودة الـ Nurse فقط ليست عودة الضيف
    expect(returnOutcome(appointment("A", { status: "تم استلام المريض" }), [go, sent("N", "A", { direction: "عودة", nurseOnly: true })], none, now)).toBe("unrecorded");
    // لم يُستلم في الذهاب، أو طلب العودة فقط: لا تُحسب
    expect(returnOutcome(appointment("A"), [], none, now)).toBeNull();
    expect(returnOutcome(appointment("A", { returnOnly: true }), [go], none, now)).toBeNull();
  });

  it("clinic lead approval: added by the lead, waited, and pending past its time", () => {
    expect(approvalInfo(appointment("A", { approval: "approved", approvedBy: "مسؤول", addedAt: iso("08:00"), approvedAt: iso("08:00") }), now)).toEqual({ state: "approved", by: "مسؤول", direct: true });
    expect(approvalInfo(appointment("A", { approval: "approved", approvedBy: "مسؤول", addedAt: iso("08:00"), approvedAt: iso("09:30") }), now)).toEqual({ state: "approved", by: "مسؤول", waitMinutes: 90 });
    expect(approvalInfo(appointment("A", { approval: "pending" }), now)).toEqual({ state: "pending", past: true });
    expect(approvalInfo(appointment("A", { approval: "excluded", excludedBy: "مسؤول" }), now)).toEqual({ state: "excluded", by: "مسؤول" });
    // بلا موافقة: طلب العودة فقط والرحلة غير الطبية
    expect(approvalInfo(appointment("A", { returnOnly: true }), now)).toBeNull();
    expect(approvalInfo(appointment("A", { category: "غير طبية" }), now)).toBeNull();
  });
});

describe("summary of the workflow", () => {
  const appointments = [
    appointment("A1", { status: "مكتملة", assistance: ["يحتاج مرافق"] }),
    appointment("A2", { status: "مكتملة" }),
    appointment("A3", { status: "ملغي", cancelReason: "الضيف لا يرغب في الذهاب", cancelledBy: "مشرف 1" }),
    appointment("A4", { status: "ملغي", cancelReason: "الضيف لا يرغب في الذهاب", cancelledBy: "مشرف 2" }),
    appointment("A5", { status: "ملغي", cancelReason: "أُلغي الموعد من المستشفى", cancelledBy: "مشرف 1" }),
    appointment("A6", { status: "ملغي", cancelReason: "سبب آخر", cancelledBy: "مشرف 1" }),
    appointment("A7", { approval: "excluded", excludedBy: "مسؤول العيادة" }),
  ];
  const requests = [
    // الضيفان A1 (مع مرافق) وA2 في رحلة مجمّعة واحدة بالسيدان 111
    sent("R1", "A1", { groupId: "G1" }),
    sent("R2", "A2", { groupId: "G1" }),
    // عودة A1 وحده بالسيارة 222
    sent("R1b", "A1", { direction: "عودة", vehiclePlate: "222" }),
  ];
  const event = (action: OpsEvent["action"], appointmentId: string, extra: Partial<OpsEvent> = {}): OpsEvent => ({
    at: iso("09:10", yesterday), action, appointment: appointmentId, request: `R-${appointmentId}`, direction: "ذهاب", plate: "", previous: "", reason: "", stage: "", by: "مستخدم", ...extra,
  });
  const events: OpsEvent[] = [
    event("request.cancel", "A3", { plate: "111", stage: "وصلت السيارة" }),
    event("request.cancel", "A4", { plate: "222", stage: "تم إرسال السيارة" }),
    event("request.cancel", "A5"),
    // الرحلة المجمّعة تغيّرت سيارتها لراكبيها معًا (عطل): تُحسب مرة واحدة
    event("request.change_car", "A1", { plate: "111", previous: "333", reason: "عطل في السيارة" }),
    event("request.change_car", "A2", { plate: "111", previous: "333", reason: "عطل في السيارة" }),
    event("request.change_car", "A1", { at: iso("13:00", yesterday), direction: "عودة", plate: "222", previous: "444", reason: "تأخر السيارة" }),
    event("request.remove_from_trip", "A2", { plate: "333", reason: "لم يركب السيارة" }),
    // موعد خارج الفترة والفلاتر: لا يُحسب
    event("request.cancel", "OTHER", { plate: "111" }),
  ];
  const trips = tripsFromSystem(appointments, requests, fleet, DEFAULT_HOSPITALS, now);
  const ops = summarizeOperations(trips, events);

  it("outcomes and cancellations by stage, reason and who cancelled", () => {
    expect(ops.appointments).toBe(7);
    expect(ops.outcomes.find((item) => item.outcome === "served")?.count).toBe(2);
    expect(ops.outcomes.find((item) => item.outcome === "cancelled")?.count).toBe(4);
    expect(ops.outcomes.find((item) => item.outcome === "excluded")?.count).toBe(1);
    expect(ops.cancel.stages).toEqual([
      { stage: "beforeRequest", count: 1 }, { stage: "requested", count: 1 }, { stage: "dispatched", count: 1 }, { stage: "atPickup", count: 1 },
    ]);
    expect(ops.cancel.wastedCars).toBe(2);
    expect(ops.cancel.reasons[0]).toEqual({ name: "الضيف لا يرغب في الذهاب", count: 2 });
    expect(ops.cancel.by[0]).toEqual({ name: "مشرف 1", count: 3 });
  });

  it("returns, grouping and seat occupancy", () => {
    expect(ops.returns.total).toBe(2);
    expect(ops.returns.items.find((item) => item.outcome === "car")?.count).toBe(1);
    expect(ops.returns.items.find((item) => item.outcome === "unrecorded")?.count).toBe(1);
    // 3 طلبات في رحلتين: المجمّعة (3 أشخاص في سيدان بـ 3 مقاعد) والعودة (شخصان)
    expect(ops.grouping).toMatchObject({ requests: 3, trips: 2, grouped: 1, groupedRequests: 2, persons: 5, seats: 6 });
  });

  it("vehicle changes (a grouped trip once), faults and removals per vehicle", () => {
    expect(ops.incidents).toMatchObject({ changes: 2, faults: 1, removals: 1 });
    expect(ops.incidents.vehicles.find((item) => item.plate === "333")).toEqual({ plate: "333", changes: 1, faults: 1, removals: 1 });
    expect(ops.incidents.changeReasons).toEqual([{ name: "تأخر السيارة", count: 1 }, { name: "عطل في السيارة", count: 1 }]);
  });

  it("approvals and the log not loaded yet", () => {
    expect(ops.approval).toMatchObject({ total: 7, approved: 6, excluded: 1, pending: 0 });
    expect(ops.approval.people).toEqual([{ name: "مسؤول العيادة", approved: 0, excluded: 1 }]);
    const loading = summarizeOperations(trips, null);
    expect(loading.cancel.stages).toBeNull();
    expect(loading.cancel.wastedCars).toBeNull();
    expect(loading.incidents.changes).toBeNull();
    expect(loading.cancel.total).toBe(4);
  });
});
