import type { CheckReply, VehicleRequest } from "./transport";

/**
 * تأكيد مشرف المبنى لما يسجّله السائق من تطبيقه (وصوله إلى نقطة الاستلام، واستلام الضيف):
 * يؤكده المشرف أو ينفيه خلال CHECK_MINUTES، وإلا يُعتبر مقبولًا تلقائيًا. السائق لا ينتظر التأكيد،
 * فهو للأمان فقط. النفي يعيد الطلب إلى المرحلة السابقة ويصل تنبيه لمشرف السيارات والسائق.
 */

export const CHECK_MINUTES = 5;
export type CheckKind = "arrival" | "pickup";
/** auto: مرّت المهلة بلا رد فقُبل تلقائيًا */
export type CheckState = "pending" | "confirmed" | "auto" | "denied";

export type DriverCheck = {
  kind: CheckKind;
  state: CheckState;
  /** وقت تسجيل السائق */
  at: Date;
  /** الثواني الباقية للرد (0 بعد انتهاء المهلة) */
  secondsLeft: number;
  /** من ردّ ومتى */
  by?: string;
  repliedAt?: Date;
};

const REPLY_FIELDS = {
  arrival: { reply: "arrivalCheck", by: "arrivalCheckBy", at: "arrivalCheckAt" },
  pickup: { reply: "pickupCheck", by: "pickupCheckBy", at: "pickupCheckAt" },
} as const;

export const checkFields = (kind: CheckKind) => REPLY_FIELDS[kind];

/** ما سجّله السائق من نوع معيّن وحالة الرد عليه، أو null إن لم يسجّله السائق. */
export function driverCheck(request: VehicleRequest, kind: CheckKind, now = new Date()): DriverCheck | null {
  const reply: CheckReply | undefined = kind === "arrival" ? request.arrivalCheck : request.pickupCheck;
  const since = kind === "arrival" ? request.driverArrivedAt : request.pickedUpAt;
  if (!reply || !since || Number.isNaN(Date.parse(since))) return null;
  const at = new Date(since);
  const secondsLeft = Math.max(0, Math.ceil((at.getTime() + CHECK_MINUTES * 60000 - now.getTime()) / 1000));
  const by = kind === "arrival" ? request.arrivalCheckBy : request.pickupCheckBy;
  const repliedAt = kind === "arrival" ? request.arrivalCheckAt : request.pickupCheckAt;
  const state: CheckState = reply === "pending" ? (secondsLeft > 0 ? "pending" : "auto") : reply;
  return { kind, state, at, secondsLeft: state === "pending" ? secondsLeft : 0, by, repliedAt: repliedAt ? new Date(repliedAt) : undefined };
}

/**
 * ما ينتظر رد مشرف المبنى الآن: الاستلام أولًا (تأكيده يؤكد الوصول معه)، ثم الوصول.
 * الوصول لا يُسأل عنه بعد أن يعود الطلب إلى «تم إرسال السيارة».
 */
export function pendingCheck(request: VehicleRequest, now = new Date()): DriverCheck | null {
  if (request.status === "تم استلام المريض") {
    const pickup = driverCheck(request, "pickup", now);
    if (pickup?.state === "pending") return pickup;
  }
  if (request.status === "وصلت السيارة" || request.status === "تم استلام المريض") {
    const arrival = driverCheck(request, "arrival", now);
    if (arrival?.state === "pending") return arrival;
  }
  return null;
}

/**
 * خانات رد مشرف المبنى: التأكيد (ومعه أي تسجيل سابق للسائق ينتظر الرد)، أو النفي الذي يعيد الطلب
 * إلى المرحلة السابقة (نفي الاستلام يحذف وقت الاستلام والوصول المتوقع).
 */
export function checkReplyChanges(request: VehicleRequest, kind: CheckKind, reply: "confirmed" | "denied", by: string, now = new Date()) {
  const stamp = { by, at: now.toISOString() };
  const set: Partial<VehicleRequest> = {};
  const unset: (keyof VehicleRequest)[] = [];
  const answer = (which: CheckKind, value: "confirmed" | "denied") => {
    const fields = REPLY_FIELDS[which];
    Object.assign(set, { [fields.reply]: value, [fields.by]: stamp.by, [fields.at]: stamp.at });
  };
  answer(kind, reply);
  if (reply === "confirmed" && kind === "pickup" && request.arrivalCheck === "pending") answer("arrival", "confirmed");
  if (reply === "denied") {
    if (kind === "arrival") set.status = "تم إرسال السيارة";
    else {
      set.status = "وصلت السيارة";
      unset.push("pickedUpAt", "etaAt", "destLat", "destLng", "pickupGps");
    }
  }
  return { set, unset };
}

/** عند تقدّم مشرف المبنى بالحالة بنفسه، أي تسجيل للسائق ينتظر الرد يُعتبر مؤكدًا منه. */
export function confirmPendingChecks(request: VehicleRequest, by: string, now = new Date()): Partial<VehicleRequest> {
  const set: Partial<VehicleRequest> = {};
  for (const kind of ["arrival", "pickup"] as CheckKind[]) {
    const fields = REPLY_FIELDS[kind];
    if (request[fields.reply] === "pending") Object.assign(set, { [fields.reply]: "confirmed", [fields.by]: by, [fields.at]: now.toISOString() });
  }
  return set;
}

export const checkLabel = (kind: CheckKind) => (kind === "arrival" ? "وصول السيارة" : "استلام الضيف");

/** نص قصير لحالة الرد (للسائق ومشرف السيارات). */
export function checkStateText(check: DriverCheck) {
  const what = checkLabel(check.kind);
  switch (check.state) {
    case "pending": return `${what}: بانتظار تأكيد مشرف المبنى`;
    case "confirmed": return `${what}: أكّده مشرف المبنى${check.by ? ` (${check.by})` : ""}`;
    case "auto": return `${what}: قُبل تلقائيًا`;
    case "denied": return `${what}: نفاه مشرف المبنى${check.by ? ` (${check.by})` : ""}`;
  }
}

export const countdownText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
