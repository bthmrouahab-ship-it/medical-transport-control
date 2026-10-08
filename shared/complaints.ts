import { normalizeMobile, toText } from "./text";

/**
 * الشكاوى: «استمارة الشكاوى لجميع الخدمات المقدمة في مجمع الثمامة» (النموذج المعتمد) يسجّلها مشرف المبنى ومسؤولهم.
 * لا يعدّلها أحد بعد تسجيلها، ولا يحذفها إلا مدير النظام، والمدير يتابعها (تمت المعالجة مع ملاحظة).
 * رقم الشكوى ومن سجّلها ومتى ومن عالجها يكتبها الخادم وحده (stamp_complaint في api/lib/rules.php، بنفس القيم هنا).
 */
export const COMPLAINT_FORM_TITLE = "استمارة الشكاوى لجميع الخدمات المقدمة في مجمع الثمامة";
export const COMPLAINT_FORM_FOOTER = "إدارة مجمع الثمامة";

/** الشكاوى في هذا النظام للنقل والسيارات فقط */
export const COMPLAINT_TOPIC = "النقل والسيارات";

export const COMPLAINT_TEXT_MAX = 3000;
export const COMPLAINT_TEXT_MIN = 3;
export const COMPLAINT_RESOLUTION_MAX = 1000;
/** التوقيع خطوط SVG (M وL وأرقام) في مساحة SIGNATURE_WIDTH × SIGNATURE_HEIGHT */
export const COMPLAINT_SIGNATURE_MAX = 12000;
export const COMPLAINT_MAX_WITNESSES = 2;
export const SIGNATURE_WIDTH = 300;
export const SIGNATURE_HEIGHT = 110;

export type ComplaintStatus = "open" | "resolved";
export type ComplaintWitness = { name: string; signature?: string };

export type Complaint = {
  id: string;
  /** رقم تسلسلي يكتبه الخادم عند التسجيل */
  number?: number;
  /** تاريخ الشكوى ووقتها كما في الاستمارة (افتراضيًا وقت تسجيلها) */
  date: string;
  time: string;
  guestName: string;
  buildingNumber: string;
  apartmentNumber: string;
  mobile?: string;
  text: string;
  /** الموعد الذي سُجّلت الشكوى منه (اختياري)، وسيارته وسائقها */
  appointmentId?: string;
  vehiclePlate?: string;
  driver?: string;
  guestSignature?: string;
  supervisorSignature?: string;
  witnesses?: ComplaintWitness[];
  /** يكتبها الخادم: وقت التسجيل ورقم حساب المشرف واسمه */
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  /** متابعة المدير */
  status?: ComplaintStatus;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  /**
   * شكوى ورقية يضيفها مدير النظام من استمارة مكتوبة باليد، واسم المشرف كما في الورقة. صورة الاستمارة أو ملف PDF يرفعها المدير
   * (api/index.php: complaint-file)، ونوعها وحجمها ووقت رفعها يكتبها الخادم.
   */
  paper?: true;
  paperSupervisor?: string;
  scanType?: ScanType;
  scanSize?: number;
  scanAt?: string;
  /** تحويل الشكوى إلى المعني بها مع ملاحظة، ورده (يُضاف ولا يُعدّل) */
  referrals?: ComplaintReferral[];
};

/**
 * تحويل الشكوى: المدير يحوّلها مع ملاحظة إلى حساب (مسؤول العيادة، أو مشرف المبنى المعني، أو المشرف الذي سجّلها ليخبر الضيف)،
 * فتصله الشكوى ويرد عليها مرة واحدة. المدير يرسل to وnote فقط، والمحوَّل إليه reply فقط، والخادم يكتب الأسماء والأوقات.
 */
export type ComplaintReferral = {
  /** رقم حساب المحوَّل إليه، واسمه ودوره (يكتبهما الخادم من حسابه) */
  to: string;
  toName?: string;
  toRole?: string;
  note: string;
  by?: string;
  at?: string;
  reply?: string;
  replyBy?: string;
  repliedAt?: string;
};
export const COMPLAINT_NOTE_MAX = 1000;
export const COMPLAINT_REFERRAL_MAX = 10;
/** من تُحوَّل إليه الشكوى (نفس COMPLAINT_REFERRAL_ROLES في api/lib/rules.php) */
export const COMPLAINT_REFERRAL_ROLES = ["clinicLead", "clinic", "buildingSupervisor", "buildingLead", "fleetSupervisor"] as const;

/** التحويلات إلى هذا الحساب (مع ترتيبها في الشكوى، للرد) */
export const referralsTo = (complaint: Pick<Complaint, "referrals">, uid: string | undefined) =>
  (complaint.referrals ?? []).map((referral, index) => ({ referral, index })).filter(({ referral }) => !!uid && referral.to === uid);

/** تحويل إلى هذا الحساب لم يُرد عليه بعد */
export const awaitsReply = (complaint: Pick<Complaint, "referrals">, uid: string | undefined) =>
  referralsTo(complaint, uid).some(({ referral }) => !referral.reply);

/** صورة الاستمارة الورقية أو ملف PDF (حتى COMPLAINT_SCAN_MAX، نفس القيم في api/lib/rules.php) */
export type ScanType = "image/jpeg" | "image/png" | "application/pdf";
export const SCAN_TYPES: ScanType[] = ["image/jpeg", "image/png", "application/pdf"];
export const COMPLAINT_SCAN_MAX = 5 * 1024 * 1024;
/** نص الشكوى الورقية إن لم يُكتب ملخصها */
export const PAPER_COMPLAINT_TEXT = "الشكوى في الاستمارة الورقية المرفقة";

/** ما يكتبه المشرف في الاستمارة (بلا ما يكتبه الخادم) */
export type ComplaintDraft = Omit<Complaint, "id" | "number" | "createdAt" | "createdBy" | "createdByName" | "status" | "resolution" | "resolvedBy" | "resolvedAt" | "scanType" | "scanSize" | "scanAt" | "referrals">;

export const isResolved = (complaint: Pick<Complaint, "status">) => complaint.status === "resolved";

const isDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};
const isSignature = (value: string | undefined) => value === undefined || (value.length <= COMPLAINT_SIGNATURE_MAX && /^M[\d .\-ML]*$/.test(value));

/** سبب عدم صلاحية الاستمارة (نفس فحص valid_complaint في الخادم)، أو null */
export function complaintError(draft: ComplaintDraft): string | null {
  if (!draft.guestName.trim()) return "اكتب اسم الضيف";
  if (!draft.buildingNumber.trim() || !draft.apartmentNumber.trim()) return "اكتب رقم المبنى والشقة";
  if (draft.text.trim().length < COMPLAINT_TEXT_MIN) return "اكتب نص الشكوى";
  if (draft.text.length > COMPLAINT_TEXT_MAX) return `الشكوى أطول من ${COMPLAINT_TEXT_MAX} حرف`;
  if (draft.mobile && !/^\+?\d{7,15}$/.test(draft.mobile)) return "رقم الهاتف غير صحيح";
  if (!isDate(draft.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return "اختر تاريخ الشكوى ووقتها";
  if ((draft.witnesses?.length ?? 0) > COMPLAINT_MAX_WITNESSES) return `شاهدان على الأكثر`;
  if (draft.witnesses?.some((witness) => !witness.name.trim())) return "اكتب اسم الشاهد أو احذفه";
  if (draft.paperSupervisor !== undefined && draft.paperSupervisor.trim().length > 80) return "اسم المشرف طويل";
  if (![draft.guestSignature, draft.supervisorSignature, ...(draft.witnesses ?? []).map((witness) => witness.signature)].every(isSignature)) return "التوقيع غير صالح، امسحه ووقّع من جديد";
  return null;
}

/** الشكوى كما تُحفظ: النصوص بلا مسافات زائدة، وبلا الخانات الفارغة */
export function buildComplaint(draft: ComplaintDraft, id: string): Complaint {
  const text = (value: string | undefined) => (value ?? "").trim();
  const mobile = normalizeMobile(draft.mobile ?? "");
  const witnesses = (draft.witnesses ?? [])
    .filter((witness) => witness.name.trim())
    .map((witness) => ({ name: witness.name.trim(), ...(witness.signature ? { signature: witness.signature } : {}) }));
  return {
    id,
    date: draft.date,
    time: draft.time,
    guestName: text(draft.guestName),
    buildingNumber: text(draft.buildingNumber),
    apartmentNumber: text(draft.apartmentNumber),
    ...(mobile ? { mobile } : {}),
    text: text(draft.text),
    ...(draft.appointmentId ? { appointmentId: draft.appointmentId } : {}),
    ...(draft.vehiclePlate ? { vehiclePlate: draft.vehiclePlate } : {}),
    ...(draft.driver ? { driver: draft.driver } : {}),
    ...(draft.guestSignature ? { guestSignature: draft.guestSignature } : {}),
    ...(draft.supervisorSignature ? { supervisorSignature: draft.supervisorSignature } : {}),
    ...(witnesses.length ? { witnesses } : {}),
    ...(draft.paper ? { paper: true as const, ...(text(draft.paperSupervisor) ? { paperSupervisor: text(draft.paperSupervisor) } : {}) } : {}),
  };
}

/** رقم الشكوى قبل أن يكتب الخادم رقمها التسلسلي */
export const complaintNumber = (complaint: Pick<Complaint, "number">) => (complaint.number ? `#${complaint.number}` : "يُحفظ…");

/** الأحدث أولًا (بوقت التسجيل، وإلا بتاريخ الشكوى ووقتها) */
export function sortComplaints<T extends Complaint>(complaints: T[]): T[] {
  const key = (complaint: Complaint) => complaint.createdAt ?? `${complaint.date}T${complaint.time}`;
  return [...complaints].sort((a, b) => key(b).localeCompare(key(a)) || (b.number ?? 0) - (a.number ?? 0));
}

/** البحث في الشكاوى: الرقم أو الضيف أو المبنى أو الشقة أو النص أو السيارة أو السائق أو من سجّلها */
export function complaintMatches(complaint: Complaint, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [complaint.number ? `#${complaint.number} ${complaint.number}` : "", complaint.guestName, `مبنى ${complaint.buildingNumber}`,
    `شقة ${complaint.apartmentNumber}`, complaint.text, complaint.createdByName, complaint.paperSupervisor, complaint.paper ? "ورقية" : "", complaint.vehiclePlate, complaint.driver, complaint.mobile,
    ...(complaint.referrals ?? []).flatMap((referral) => ["محوّلة", referral.toName, referral.note, referral.reply])]
    .filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** شكوى من قاعدة البيانات (أو null إن لم تكن صالحة) */
export function normalizeComplaint(raw: unknown): Complaint | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = toText(item.id);
  if (!id) return null;
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const referrals = Array.isArray(item.referrals)
    ? item.referrals.flatMap((entry): ComplaintReferral[] => {
      const referral = (entry ?? {}) as Record<string, unknown>;
      const to = text(referral.to);
      const note = text(referral.note);
      if (!to || !note) return [];
      return [{ to, note, ...Object.fromEntries((["toName", "toRole", "by", "at", "reply", "replyBy", "repliedAt"] as const)
        .flatMap((field) => (text(referral[field]) ? [[field, text(referral[field])]] : []))) }];
    })
    : [];
  const witnesses = Array.isArray(item.witnesses)
    ? item.witnesses.flatMap((witness) => {
      const name = text((witness as Record<string, unknown>)?.name);
      const signature = text((witness as Record<string, unknown>)?.signature);
      return name ? [{ name, ...(signature ? { signature } : {}) }] : [];
    })
    : [];
  return {
    id,
    ...(typeof item.number === "number" ? { number: item.number } : {}),
    date: toText(item.date),
    time: toText(item.time),
    guestName: toText(item.guestName),
    buildingNumber: toText(item.buildingNumber),
    apartmentNumber: toText(item.apartmentNumber),
    ...(text(item.mobile) ? { mobile: text(item.mobile) } : {}),
    text: toText(item.text),
    ...Object.fromEntries((["appointmentId", "vehiclePlate", "driver", "guestSignature", "supervisorSignature", "createdAt", "createdBy", "createdByName", "resolution", "resolvedBy", "resolvedAt"] as const)
      .flatMap((field) => (text(item[field]) ? [[field, text(item[field])]] : []))),
    ...(witnesses.length ? { witnesses } : {}),
    ...(item.paper === true ? { paper: true as const, ...(text(item.paperSupervisor) ? { paperSupervisor: text(item.paperSupervisor) } : {}) } : {}),
    ...(SCAN_TYPES.includes(item.scanType as ScanType)
      ? { scanType: item.scanType as ScanType, ...(typeof item.scanSize === "number" ? { scanSize: item.scanSize } : {}), ...(text(item.scanAt) ? { scanAt: text(item.scanAt) } : {}) }
      : {}),
    ...(referrals.length ? { referrals } : {}),
    status: item.status === "resolved" ? "resolved" : "open",
  };
}

/** خطوط التوقيع (كل خط نقاط [x, y]) إلى مسار SVG مختصر: نقاط بلا كسور، وتُهمل النقطة الأقرب من بكسلين للسابقة */
export function signaturePath(strokes: [number, number][][]): string {
  const parts: string[] = [];
  for (const stroke of strokes) {
    let last: [number, number] | null = null;
    const points: [number, number][] = [];
    for (const [x, y] of stroke) {
      const point: [number, number] = [Math.round(Math.min(Math.max(x, 0), SIGNATURE_WIDTH)), Math.round(Math.min(Math.max(y, 0), SIGNATURE_HEIGHT))];
      if (last && Math.abs(point[0] - last[0]) < 2 && Math.abs(point[1] - last[1]) < 2) continue;
      points.push(point);
      last = point;
    }
    if (!points.length) continue;
    // نقطة واحدة (لمسة): خط قصير حتى تظهر
    if (points.length === 1) points.push([points[0][0] + 1, points[0][1]]);
    parts.push(`M${points[0][0]} ${points[0][1]}` + points.slice(1).map(([x, y]) => `L${x} ${y}`).join(""));
  }
  return parts.join("");
}
