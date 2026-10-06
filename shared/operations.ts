import type { TripKind, TripStat } from "./stats";
import {
  VEHICLE_FAULT_REASONS,
  approvalOf,
  isNonMedical,
  isReturnOnly,
  localDateString,
  requestPersons,
  requestWindow,
  vehicleSeats,
  type ClinicAppointment,
  type Vehicle,
  type VehicleRequest,
} from "./transport";

/**
 * إحصائيات سير العمل (رحلات النظام فقط): مصير كل موعد، والإلغاء ومرحلته، والعودة إلى المجمع، وجمع الضيوف
 * في السيارات وإشغال مقاعدها، وتغيير السيارات وإزالة الضيوف من الرحلات، وموافقة مسؤول العيادة.
 * ما يُحفظ في الموعد والطلب يُحسب هنا، وما لا يبقى فيهما (الطلب المحذوف عند الإلغاء، وتغيير السيارة السابق)
 * من سجل العمليات (OpsEvent من index.php?r=ops-log).
 */

/** مصير الموعد */
export type Outcome = "served" | "cancelled" | "excluded" | "unapproved" | "expired" | "undispatched" | "self" | "closed" | "open";

export const OUTCOMES: { outcome: Outcome; label: string; hint: string; tone: "green" | "red" | "amber" | "neutral" }[] = [
  { outcome: "served", label: "أُرسلت سيارة", hint: "خُدم الموعد بسيارة من المجمع", tone: "green" },
  { outcome: "cancelled", label: "أُلغي الموعد", hint: "ألغاه مشرف المبنى (أو أُوقفت الرحلة المتكررة) بسبب", tone: "red" },
  { outcome: "excluded", label: "استبعده مسؤول العيادة", hint: "لم يصل إلى مشرف المبنى", tone: "amber" },
  { outcome: "unapproved", label: "لم تتم الموافقة عليه", hint: "بقي بانتظار موافقة مسؤول العيادة حتى فات وقته", tone: "amber" },
  { outcome: "expired", label: "انتهت مهلة طلب السيارة", hint: "موافق عليه ولم يطلب مشرف المبنى سيارة حتى مرور 30 دقيقة على الموعد", tone: "red" },
  { outcome: "undispatched", label: "طُلبت سيارة ولم تُرسل", hint: "طلبها مشرف المبنى ولم يرسل مشرف السيارات سيارة في يومها", tone: "red" },
  { outcome: "self", label: "عاد بنفسه قبل إرسال السيارة", hint: "طلب عودة فقط من المستشفى، وعاد الضيف بنفسه", tone: "neutral" },
  { outcome: "closed", label: "انتهى بلا سيارة", hint: "سُجّل الموعد مكتملًا دون إرسال سيارة", tone: "neutral" },
  { outcome: "open", label: "لم يحن وقته أو قيد التنفيذ", hint: "موعد اليوم أو قادم لم يُغلق بعد", tone: "neutral" },
];
export const OUTCOME_LABELS = Object.fromEntries(OUTCOMES.map((item) => [item.outcome, item.label])) as Record<Outcome, string>;

/** مرحلة الإلغاء: قبل طلب السيارة، أو بعد طلبها وقبل إرسالها، أو بعد إرسالها، أو والسيارة عند نقطة الاستلام */
export type CancelStage = "beforeRequest" | "requested" | "dispatched" | "atPickup";
export const CANCEL_STAGES: { stage: CancelStage; label: string; hint: string }[] = [
  { stage: "beforeRequest", label: "قبل طلب السيارة", hint: "لم يُطلب له سيارة" },
  { stage: "requested", label: "بعد طلب السيارة وقبل إرسالها", hint: "أُلغي الطلب قبل أن يرسل مشرف السيارات سيارة" },
  { stage: "dispatched", label: "بعد إرسال السيارة", hint: "السيارة في الطريق: رحلة ضائعة" },
  { stage: "atPickup", label: "والسيارة عند نقطة الاستلام", hint: "وصلت السيارة ثم أُلغي: رحلة ضائعة" },
];

/** العودة إلى المجمع بعد رحلة الذهاب (لضيف استُلم في الذهاب) */
export type ReturnOutcome = "car" | "transfer" | "self" | "requested" | "unrecorded" | "atAppointment";
export const RETURN_OUTCOMES: { outcome: ReturnOutcome; label: string; hint: string; tone: "green" | "red" | "amber" | "neutral" }[] = [
  { outcome: "car", label: "عاد بسيارة المجمع", hint: "أُرسلت له سيارة عودة", tone: "green" },
  { outcome: "transfer", label: "نُقل إلى موعده التالي", hint: "من المستشفى إلى موعد آخر في نفس اليوم", tone: "green" },
  { outcome: "self", label: "عاد بنفسه", hint: "سجّل مشرف المبنى أنه عاد بنفسه", tone: "amber" },
  { outcome: "requested", label: "طُلبت عودته ولم تُرسل سيارة", hint: "بقي طلب العودة بانتظار التوزيع", tone: "red" },
  { outcome: "unrecorded", label: "لم تُسجَّل عودته", hint: "لم تُطلب له عودة ولم يُسجَّل أنه عاد بنفسه", tone: "red" },
  { outcome: "atAppointment", label: "ما زال في الموعد", hint: "موعد اليوم: لم تُطلب عودته بعد", tone: "neutral" },
];
export const RETURN_OUTCOME_LABELS = Object.fromEntries(RETURN_OUTCOMES.map((item) => [item.outcome, item.label])) as Record<ReturnOutcome, string>;

/** رحلة سيارة لطلب واحد: الرحلة المجمّعة (groupId) رحلة واحدة لكل ركابها */
export type Ride = { key: string; plate: string; kind: TripKind; persons: number; seats: number };

/** موافقة مسؤول العيادة على موعد طبي (بلا طلب العودة فقط والرحلات غير الطبية) */
export type ApprovalInfo = {
  state: "pending" | "approved" | "excluded";
  /** بانتظار الموافقة وقد فات وقت طلب سيارته */
  past?: true;
  /** من إضافة الموعد حتى الموافقة؛ بلا الخانة إن لم يُعرف وقت إضافته */
  waitMinutes?: number;
  /** أضافه مسؤول العيادة نفسه (موافق عليه عند إضافته) */
  direct?: true;
  by?: string;
};

const PICKED_UP = new Set(["تم استلام المريض", "وصلت الوجهة"]);

/** مصير الموعد من حالته وطلباته. */
export function appointmentOutcome(appointment: ClinicAppointment, requests: VehicleRequest[], now = new Date()): Outcome {
  if (requests.some((request) => request.vehiclePlate)) return "served";
  if (appointment.status === "ملغي") return "cancelled";
  if (approvalOf(appointment) === "excluded") return "excluded";
  if (appointment.returnedSelf) return "self";
  if (appointment.status === "مكتملة") return "closed";
  const past = appointment.appointmentDate < localDateString(now);
  if (approvalOf(appointment) === "pending") return past || !requestWindow(appointment, now).open ? "unapproved" : "open";
  if (!requests.length) return requestWindow(appointment, now).open ? "open" : "expired";
  return past ? "undispatched" : "open";
}

/**
 * العودة إلى المجمع: لموعد استُلم ضيفه في رحلة الذهاب (لا طلب العودة فقط). transfers: مواعيد نُقل إليها ضيف
 * من موعد آخر (fromAppointmentId في طلب الذهاب).
 */
export function returnOutcome(appointment: ClinicAppointment, requests: VehicleRequest[], transfers: Set<string>, now = new Date()): ReturnOutcome | null {
  if (isReturnOnly(appointment)) return null;
  const pickedUp = requests.some((request) => request.direction === "ذهاب" && request.vehiclePlate && PICKED_UP.has(request.status));
  if (!pickedUp) return null;
  const back = requests.filter((request) => request.direction === "عودة" && !request.nurseOnly);
  if (back.some((request) => request.vehiclePlate)) return "car";
  if (transfers.has(appointment.id)) return "transfer";
  if (appointment.returnedSelf) return "self";
  const past = appointment.appointmentDate < localDateString(now);
  if (back.length) return past ? "requested" : "atAppointment";
  return past ? "unrecorded" : "atAppointment";
}

/** رحلات السيارات للموعد (كل طلب أُرسلت له سيارة) مع عدد الأشخاص ومقاعد السيارة. */
export function ridesOf(
  appointment: ClinicAppointment,
  requests: VehicleRequest[],
  vehicleOf: (plate: string) => Pick<Vehicle, "kind" | "fullCapacity">,
): Ride[] {
  return requests.flatMap((request) => {
    if (!request.vehiclePlate) return [];
    const vehicle = vehicleOf(request.vehiclePlate);
    return [{
      key: request.groupId ? `g:${request.groupId}` : `r:${request.id}`,
      plate: request.vehiclePlate,
      kind: vehicle.kind,
      persons: requestPersons(request, appointment, requests),
      seats: vehicleSeats(vehicle),
    }];
  });
}

const minutesBetween = (from?: string, to?: string) => {
  const start = from ? new Date(from).getTime() : NaN;
  const end = to ? new Date(to).getTime() : NaN;
  return Number.isNaN(start) || Number.isNaN(end) ? null : (end - start) / 60000;
};

/** موافقة مسؤول العيادة: للمواعيد الطبية فقط (طلب العودة فقط والرحلات غير الطبية بلا موافقة). */
export function approvalInfo(appointment: ClinicAppointment, now = new Date()): ApprovalInfo | null {
  if (isReturnOnly(appointment) || isNonMedical(appointment)) return null;
  const state = approvalOf(appointment);
  if (state === "pending") {
    const past = appointment.appointmentDate < localDateString(now) || !requestWindow(appointment, now).open;
    return { state, ...(past && appointment.status !== "ملغي" ? { past: true as const } : {}) };
  }
  if (state === "excluded") return { state, ...(appointment.excludedBy ? { by: appointment.excludedBy } : {}) };
  const wait = minutesBetween(appointment.addedAt, appointment.approvedAt);
  // موافقة خلال دقيقة من الإضافة: أضافه مسؤول العيادة بنفسه
  return {
    state,
    ...(appointment.approvedBy ? { by: appointment.approvedBy } : {}),
    ...(wait === null ? {} : wait < 1 ? { direct: true as const } : { waitMinutes: Math.round(wait) }),
  };
}

// ————— أحداث سجل العمليات —————

/** ما لا يبقى في المستندات: إلغاء طلب سيارة (يُحذف الطلب)، وتغيير السيارة، وإزالة ضيف من رحلة */
export type OpsEvent = {
  at: string;
  action: "request.cancel" | "request.change_car" | "request.remove_from_trip";
  appointment: string;
  request: string;
  direction: string;
  /** السيارة: المرسلة عند الإلغاء، والجديدة عند التغيير، والتي أُزيل منها الضيف */
  plate: string;
  /** السيارة السابقة عند التغيير */
  previous: string;
  reason: string;
  /** حالة الطلب لحظة إلغائه (بعد حفظها في السجل) */
  stage: string;
  by: string;
};

/** مرحلة إلغاء الموعد من طلبات السيارة التي أُلغيت له (السيارة المرسلة وحالة الطلب لحظة إلغائه) */
export function cancelStage(cancels: { plate?: string; stage?: string }[]): CancelStage {
  const sent = cancels.filter((event) => event.plate);
  if (sent.some((event) => event.stage === "وصلت السيارة")) return "atPickup";
  if (sent.length) return "dispatched";
  return cancels.length ? "requested" : "beforeRequest";
}

export const CANCEL_STAGE_LABELS = Object.fromEntries(CANCEL_STAGES.map((item) => [item.stage, item.label])) as Record<CancelStage, string>;

const countBy = <T,>(items: T[], key: (item: T) => string) => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return Array.from(counts, ([name, total]) => ({ name, count: total })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
};

const average = (values: number[]) => (values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null);
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

export type OperationsSummary = {
  /** مواعيد النظام في الفترة والفلاتر */
  appointments: number;
  outcomes: { outcome: Outcome; count: number }[];
  cancel: {
    total: number;
    /** مراحل الإلغاء (null قبل تحميل سجل العمليات) */
    stages: { stage: CancelStage; count: number }[] | null;
    reasons: { name: string; count: number }[];
    by: { name: string; count: number }[];
    /** سيارات أُرسلت ثم أُلغي طلبها (أُلغي الموعد أو طلب السيارة وحده) */
    wastedCars: number | null;
  };
  returns: { total: number; items: { outcome: ReturnOutcome; count: number }[] };
  grouping: {
    /** طلبات أُرسلت لها سيارة */
    requests: number;
    /** رحلات السيارات (الرحلة المجمّعة رحلة واحدة) */
    trips: number;
    grouped: number;
    groupedRequests: number;
    persons: number;
    seats: number;
    byKind: { kind: TripKind; trips: number; grouped: number; persons: number; seats: number }[];
  };
  incidents: {
    /** null قبل تحميل سجل العمليات */
    changes: number | null;
    faults: number;
    changeReasons: { name: string; count: number }[];
    removals: number | null;
    removeReasons: { name: string; count: number }[];
    vehicles: { plate: string; changes: number; faults: number; removals: number }[];
  };
  approval: {
    total: number;
    approved: number;
    excluded: number;
    pending: number;
    pendingPast: number;
    direct: number;
    waited: number;
    avgWaitMinutes: number | null;
    medianWaitMinutes: number | null;
    people: { name: string; approved: number; excluded: number }[];
  };
};

/** يجمع إحصائيات سير العمل من رحلات النظام المفلترة، ومن أحداث سجل العمليات لمواعيدها (events = null قبل تحميلها). */
export function summarizeOperations(trips: TripStat[], events: OpsEvent[] | null): OperationsSummary {
  const system = trips.filter((trip) => trip.appointmentId && trip.outcome);
  const ids = new Set(system.map((trip) => trip.appointmentId!));
  const mine = (events ?? []).filter((event) => ids.has(event.appointment));

  const outcomes = OUTCOMES.map(({ outcome }) => ({ outcome, count: system.filter((trip) => trip.outcome === outcome).length }));

  // الإلغاء: مرحلته من طلبات السيارة التي أُلغيت للموعد
  const cancelled = system.filter((trip) => trip.outcome === "cancelled");
  const cancelsOf = new Map<string, OpsEvent[]>();
  for (const event of mine) if (event.action === "request.cancel") cancelsOf.set(event.appointment, [...(cancelsOf.get(event.appointment) ?? []), event]);
  const stageOf = (id: string) => cancelStage(cancelsOf.get(id) ?? []);
  const stages = events === null ? null : CANCEL_STAGES.map(({ stage }) => ({ stage, count: cancelled.filter((trip) => stageOf(trip.appointmentId!) === stage).length }));

  const returns = system.filter((trip) => trip.returnOutcome);

  // الجمع: كل رحلة سيارة مرة واحدة مع مجموع أشخاصها ومقاعد سيارتها
  const rides = new Map<string, { kind: TripKind; persons: number; seats: number; count: number }>();
  for (const trip of system) {
    for (const ride of trip.rides ?? []) {
      const entry = rides.get(ride.key) ?? { kind: ride.kind, persons: 0, seats: ride.seats, count: 0 };
      entry.persons += ride.persons;
      entry.seats = Math.max(entry.seats, ride.seats);
      entry.count += 1;
      rides.set(ride.key, entry);
    }
  }
  const list = Array.from(rides.values());
  const sum = (items: typeof list, key: "persons" | "seats" | "count") => items.reduce((total, item) => total + item[key], 0);
  const kinds = Array.from(new Set(list.map((item) => item.kind)));

  // تغيير السيارة: الرحلة المجمّعة تتغير سيارتها لكل ركابها معًا فتُحسب مرة واحدة
  const changes = new Map<string, OpsEvent>();
  for (const event of mine) {
    if (event.action === "request.change_car") changes.set(`${event.previous}|${event.plate}|${event.reason}|${event.at.slice(0, 16)}`, event);
  }
  const changeList = Array.from(changes.values());
  const removals = mine.filter((event) => event.action === "request.remove_from_trip");
  const isFault = (event: OpsEvent) => VEHICLE_FAULT_REASONS.includes(event.reason);
  const vehicles = new Map<string, { plate: string; changes: number; faults: number; removals: number }>();
  const vehicle = (plate: string) => vehicles.get(plate) ?? { plate, changes: 0, faults: 0, removals: 0 };
  for (const event of changeList) {
    const entry = vehicle(event.previous);
    vehicles.set(event.previous, { ...entry, changes: entry.changes + 1, faults: entry.faults + Number(isFault(event)) });
  }
  for (const event of removals) {
    const entry = vehicle(event.plate);
    vehicles.set(event.plate, { ...entry, removals: entry.removals + 1 });
  }

  // موافقة مسؤول العيادة
  const approvals = system.flatMap((trip) => (trip.approval ? [trip.approval] : []));
  const waits = approvals.flatMap((item) => (item.waitMinutes !== undefined ? [item.waitMinutes] : []));
  const people = new Map<string, { name: string; approved: number; excluded: number }>();
  for (const item of approvals) {
    if (!item.by || item.state === "pending") continue;
    const entry = people.get(item.by) ?? { name: item.by, approved: 0, excluded: 0 };
    entry[item.state] += 1;
    people.set(item.by, entry);
  }

  return {
    appointments: system.length,
    outcomes,
    cancel: {
      total: cancelled.length,
      stages,
      reasons: countBy(cancelled, (trip) => trip.cancel?.reason || "بلا سبب"),
      by: countBy(cancelled.filter((trip) => trip.cancel?.by), (trip) => trip.cancel!.by),
      wastedCars: events === null ? null : mine.filter((event) => event.action === "request.cancel" && event.plate).length,
    },
    returns: {
      total: returns.length,
      items: RETURN_OUTCOMES.map(({ outcome }) => ({ outcome, count: returns.filter((trip) => trip.returnOutcome === outcome).length })),
    },
    grouping: {
      requests: sum(list, "count"),
      trips: list.length,
      grouped: list.filter((item) => item.count > 1).length,
      groupedRequests: sum(list.filter((item) => item.count > 1), "count"),
      persons: sum(list, "persons"),
      seats: sum(list, "seats"),
      byKind: kinds.map((kind) => {
        const items = list.filter((item) => item.kind === kind);
        return { kind, trips: items.length, grouped: items.filter((item) => item.count > 1).length, persons: sum(items, "persons"), seats: sum(items, "seats") };
      }).sort((a, b) => b.trips - a.trips),
    },
    incidents: {
      changes: events === null ? null : changeList.length,
      faults: changeList.filter(isFault).length,
      changeReasons: countBy(changeList, (event) => event.reason || "بلا سبب"),
      removals: events === null ? null : removals.length,
      removeReasons: countBy(removals, (event) => event.reason || "بلا سبب"),
      vehicles: Array.from(vehicles.values()).sort((a, b) => b.changes + b.removals - (a.changes + a.removals) || a.plate.localeCompare(b.plate)),
    },
    approval: {
      total: approvals.length,
      approved: approvals.filter((item) => item.state === "approved").length,
      excluded: approvals.filter((item) => item.state === "excluded").length,
      pending: approvals.filter((item) => item.state === "pending").length,
      pendingPast: approvals.filter((item) => item.past).length,
      direct: approvals.filter((item) => item.direct).length,
      waited: waits.length,
      avgWaitMinutes: average(waits),
      medianWaitMinutes: median(waits),
      people: Array.from(people.values()).sort((a, b) => b.approved + b.excluded - (a.approved + a.excluded)),
    },
  };
}
