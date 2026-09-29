import { describe, expect, it } from "vitest";
import { buildTripGroups, planDispatch, suggestJoinDispatched, type ClinicAppointment, type VehicleRequest } from "../shared/transport";
import { neededAt } from "../shared/trips";

const guest = (id: string, time: string, extra: Partial<ClinicAppointment> = {}): ClinicAppointment => ({
  id, patientName: `ضيف ${id}`, clinic: "The Cuban Hospital", hospitalId: "cuban", buildingNumber: "26", apartmentNumber: "1", mobile: "55500000",
  appointmentDate: "2026-09-29", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة", ...extra,
});
const ask = (appointment: ClinicAppointment, createdAt: string, direction: VehicleRequest["direction"] = "ذهاب"): VehicleRequest => ({
  id: `R-${appointment.id}`, appointmentId: appointment.id, direction, status: "بانتظار التوزيع", notificationMethod: "whatsapp", createdAt,
});
const at = (time: string) => new Date(2026, 8, 29, Number(time.slice(0, 2)), Number(time.slice(3)));
const items = (list: [ClinicAppointment, VehicleRequest][]) =>
  list.map(([appointment, request]) => ({ appointment, direction: request.direction, at: neededAt(request, appointment) }));

describe("grouping by the time the car is needed", () => {
  it("uses the request time when the car is requested late, and the departure time otherwise", () => {
    const appointment = guest("A", "08:30");
    // طلب متأخر (بعد وقت الانطلاق اللازم إلى دخان): السيارة مطلوبة الآن
    expect(neededAt(ask(appointment, "08:53"), appointment)).toEqual(at("08:53"));
    // طلب مبكر: وقت الانطلاق للوصول قبل الموعد (دخان بعيدة: أكثر من ساعة)
    const early = neededAt(ask(appointment, "05:00"), appointment);
    expect(early.getTime()).toBeLessThan(at("07:30").getTime());
    expect(early.getTime()).toBeGreaterThan(at("05:00").getTime());
    // العودة: الضيف جاهز عند طلبها، مهما كان وقت الموعد
    expect(neededAt(ask(appointment, "11:40", "عودة"), appointment)).toEqual(at("11:40"));
  });

  it("groups late requests made together even when the appointments are an hour apart", () => {
    const first = guest("A", "08:30");
    const second = guest("B", "09:30", { buildingNumber: "27" });
    // بوقت الموعد وحده: ساعة كاملة، لا تُجمع
    expect(buildTripGroups([first, second].map((appointment) => ({ appointment, direction: "ذهاب" as const })))).toHaveLength(0);
    // طُلبتا في 08:53 و08:54: تُجمعان
    const groups = buildTripGroups(items([[first, ask(first, "08:53")], [second, ask(second, "08:54")]]));
    expect(groups).toEqual([expect.objectContaining({ appointmentIds: ["A", "B"], reason: expect.stringContaining("الانطلاق خلال 1 دقيقة") })]);
    // والتوزيع التلقائي يرسلهما في سيارة واحدة
    const plan = planDispatch(
      [first, second].map((appointment, index) => ({ request: ask(appointment, index ? "08:54" : "08:53"), appointment, at: neededAt(ask(appointment, index ? "08:54" : "08:53"), appointment) })),
      [{ plate: "976004", driver: "رامش", phone: "1", kind: "سيدان", available: true }, { plate: "111", driver: "علي", phone: "2", kind: "سيدان", available: true }],
    );
    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0].requestIds).toHaveLength(2);
  });

  it("does not group return trips requested far apart, even for close appointments", () => {
    const first = guest("A", "09:00");
    const second = guest("B", "09:10");
    const groups = buildTripGroups(items([[first, ask(first, "10:00", "عودة")], [second, ask(second, "10:55", "عودة")]]));
    expect(groups).toHaveLength(0);
    // وطلبا العودة خلال 20 دقيقة: يُجمعان
    expect(buildTripGroups(items([[first, ask(first, "10:00", "عودة")], [second, ask(second, "10:20", "عودة")]]))).toEqual([
      expect.objectContaining({ reason: expect.stringContaining("طلبات العودة خلال 20 دقيقة") }),
    ]);
  });

  it("ignores the building: all complex buildings are close", () => {
    // وجهتان متجاورتان (مدينة حمد الطبية) من مبنيين مختلفين بفرق 25 دقيقة
    const hgh = guest("H", "09:00", { clinic: "Hamad General Hospital", hospitalId: "hgh", buildingNumber: "12" });
    const heart = guest("K", "09:25", { clinic: "Heart Hospital", hospitalId: "heart", buildingNumber: "30" });
    expect(buildTripGroups([hgh, heart].map((appointment) => ({ appointment, direction: "ذهاب" as const })))).toHaveLength(1);
    // وجهتان متباعدتان من نفس المبنى في نفس الوقت: لا تُجمعان
    const wakra = guest("W", "09:00", { clinic: "مستشفى الوكرة", hospitalId: "wakra", buildingNumber: "12" });
    expect(buildTripGroups([hgh, wakra].map((appointment) => ({ appointment, direction: "ذهاب" as const })))).toHaveLength(0);
  });

  it("suggests joining a car on its way when the new request is needed at the same time", () => {
    const first = guest("A", "08:30");
    const second = guest("B", "09:40", { buildingNumber: "27" });
    const sent = { ...ask(first, "08:50"), status: "تم إرسال السيارة" as const, vehiclePlate: "976004" };
    const joins = suggestJoinDispatched(
      [{ request: ask(second, "08:55"), appointment: second, at: neededAt(ask(second, "08:55"), second) }],
      [{ request: sent, appointment: first, at: neededAt(sent, first) }],
    );
    expect(joins).toEqual([expect.objectContaining({ plate: "976004" })]);
  });
});
