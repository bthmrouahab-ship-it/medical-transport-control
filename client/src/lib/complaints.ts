import {
  COMPLAINT_FORM_FOOTER,
  COMPLAINT_FORM_TITLE,
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  type Complaint,
} from "@shared/complaints";
import { COMPLAINT_SCAN_MAX, type ScanType } from "@shared/complaints";
import { api, apiUrl } from "./api";
import { loadState, saveState } from "./appStore";

/**
 * حفظ الشكاوى: تُكتب القائمة كما في قاعدة البيانات (بلا تحويل) حتى لا تُرسل إلا الشكوى الجديدة أو ما غيّره المدير؛
 * الخادم يرفض أي تعديل على شكوى مسجلة إلا متابعة المدير، ولا يحذفها إلا المدير.
 */
type Raw = Record<string, unknown>;
const rawComplaints = () => loadState<Raw[]>("fox_complaints", []);

export function addComplaint(complaint: Complaint) {
  const current = rawComplaints();
  saveState("fox_complaints", [...current, complaint], current);
}

/** المدير: تمت المعالجة (مع ملاحظة إلزامية)، أو إعادة فتح الشكوى (resolution = null). اسم المدير ووقتها من الخادم. */
export function followUpComplaint(id: string, resolution: string | null) {
  const current = rawComplaints();
  const next = current.map((item) => {
    if (item.id !== id) return item;
    if (resolution !== null) return { ...item, status: "resolved", resolution };
    const { resolution: _resolution, resolvedBy: _by, resolvedAt: _at, ...rest } = item;
    return { ...rest, status: "open" };
  });
  saveState("fox_complaints", next, current);
}

/** المدير فقط: حذف الشكوى (يبقى في سجل العمليات من سجّلها ومن حذفها) */
export function deleteComplaint(id: string) {
  const current = rawComplaints();
  saveState("fox_complaints", current.filter((item) => item.id !== id), current);
}

// ————— الاستمارة الورقية (المدير) —————

export type PreparedScan = { type: ScanType; data: string; size: number; name: string };
/** أطول ضلع لصورة الاستمارة بعد تصغيرها (تبقى مقروءة وحجمها صغير) */
const SCAN_MAX_SIDE = 2200;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(at, at + 0x8000)));
  return btoa(binary);
};

/**
 * صورة الاستمارة (من الكاميرا أو ملف) تُصغَّر إلى JPEG، وملف PDF يُرفع كما هو؛ حتى 5 ميجابايت. يرمي رسالة الخطأ بالعربية.
 */
export async function prepareScan(file: File): Promise<PreparedScan> {
  if (file.type === "application/pdf") {
    if (file.size > COMPLAINT_SCAN_MAX) throw new Error("ملف PDF أكبر من 5 ميجابايت");
    return { type: "application/pdf", data: toBase64(new Uint8Array(await file.arrayBuffer())), size: file.size, name: file.name };
  }
  if (!file.type.startsWith("image/")) throw new Error("اختر صورة الاستمارة أو ملف PDF");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("تعذر فتح الصورة"); });
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("تعذر تجهيز الصورة");
  if (blob.size > COMPLAINT_SCAN_MAX) throw new Error("الصورة أكبر من 5 ميجابايت");
  return { type: "image/jpeg", data: toBase64(new Uint8Array(await blob.arrayBuffer())), size: blob.size, name: file.name };
}

/** رفع الاستمارة الورقية للشكوى (بعد حفظ الشكوى في الخادم)، أو استبدالها */
export const uploadComplaintScan = (id: string, scan: PreparedScan) => api<{ rev: number }>("complaint-file", { id, type: scan.type, data: scan.data });

/** رابط عرض الاستمارة الورقية (يُفتح في نافذة جديدة) */
export const complaintScanUrl = (complaint: { id: string; scanAt?: string }) => apiUrl("complaint-file", { id: complaint.id, v: complaint.scanAt ?? "" });

// ————— طباعة الاستمارة —————

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

/** DD/MM/YYYY */
export const dayText = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split("-").reverse().join("/") : date);

/** وقت ISO بتوقيت الجهاز: DD/MM/YYYY HH:MM */
export function stampText(iso?: string) {
  if (!iso || Number.isNaN(Date.parse(iso))) return "";
  const date = new Date(iso);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

const signatureSvg = (path?: string) => (path
  ? `<svg class="sig" viewBox="0 0 ${SIGNATURE_WIDTH} ${SIGNATURE_HEIGHT}" role="img" aria-label="توقيع"><path d="${escapeHtml(path)}" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  : `<span class="blank sig-blank"></span>`);

const field = (label: string, value?: string, extra = "") => `<div class="field ${extra}"><span class="label">${label}:</span>${value ? `<span class="value">${escapeHtml(value)}</span>` : `<span class="blank"></span>`}</div>`;

/**
 * الاستمارة المعتمدة معبأة (للطباعة أو الحفظ PDF) على ورقة الهلال الأحمر القطري كما في النموذج (رأسها وتذييلها، لأن الاستمارة
 * موجهة له): الخانات الفارغة خطوط للكتابة باليد، والتوقيعات كما وُقّعت على الشاشة.
 */
export function complaintFormHtml(complaint: Complaint) {
  const witnesses = [0, 1].map((index) => complaint.witnesses?.[index]);
  const trip = [complaint.vehiclePlate ? `السيارة ${complaint.vehiclePlate}` : "", complaint.driver ? `السائق ${complaint.driver}` : ""].filter(Boolean).join(" · ");
  return `<article class="form" dir="rtl" lang="ar">
  <img class="letterhead" src="/qrcs-letterhead-top.png" alt="الهلال الأحمر القطري · Qatar Red Crescent" />
  <div class="number">رقم الشكوى: <b>${complaint.number ? escapeHtml(complaint.number) : "—"}</b></div>
  <h1>${COMPLAINT_FORM_TITLE}</h1>
  <div class="row">${field("التاريخ", dayText(complaint.date))}${field("الوقت", complaint.time)}</div>
  <div class="row">${field("اسم الضيف", complaint.guestName, "grow")}<div class="field"><span class="label">التوقيع:</span>${signatureSvg(complaint.guestSignature)}</div></div>
  <div class="row">${field("رقم المبنى", complaint.buildingNumber)}${field("رقم الشقة", complaint.apartmentNumber)}${complaint.mobile ? field("الهاتف", complaint.mobile) : ""}</div>
  <div class="complaint"><span class="label">الشكوى:</span><div class="text">${escapeHtml(complaint.text)}</div></div>
  ${trip ? `<div class="row">${field("الرحلة", trip, "grow")}</div>` : ""}
  <div class="row">${field("اسم المشرف", complaint.paperSupervisor ?? complaint.createdByName, "grow")}<div class="field"><span class="label">التوقيع:</span>${signatureSvg(complaint.supervisorSignature)}</div></div>
  <div class="witnesses">
    ${witnesses.map((witness, index) => `<div class="witness"><b>شاهد (${index + 1}):</b>${field("الاسم", witness?.name)}<div class="field"><span class="label">التوقيع:</span>${signatureSvg(witness?.signature)}</div></div>`).join("")}
  </div>
  ${complaint.status === "resolved" ? `<div class="resolution"><b>المعالجة:</b> ${escapeHtml(complaint.resolution)}<small>${escapeHtml([complaint.resolvedBy, stampText(complaint.resolvedAt)].filter(Boolean).join(" · "))}</small></div>` : ""}
  <footer>
    <b>${COMPLAINT_FORM_FOOTER}</b>
    <small>سُجّلت في نظام سيارات مجمع الثمامة${complaint.createdAt ? ` ${escapeHtml(stampText(complaint.createdAt))}` : ""}${complaint.createdByName ? ` من حساب ${escapeHtml(complaint.createdByName)}` : ""}</small>
    <img class="letterhead" src="/qrcs-letterhead-bottom.png" alt="P.O. Box 5449, Doha - Qatar · www.qrcs.qa" />
  </footer>
</article>`;
}

const PRINT_CSS = `
#complaint-print { display: none; }
@media print {
  @page { size: A4; margin: 14mm; }
  body > *:not(#complaint-print) { display: none !important; }
  html, body { background: #fff !important; }
  #complaint-print { display: block; color: #111; font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; font-size: 13pt; }
}
/* صفحة A4 واحدة: رأس الهلال الأحمر في أعلاها وتذييله في أسفلها */
#complaint-print .form { max-width: 182mm; margin: 0 auto; min-height: 255mm; display: flex; flex-direction: column; }
#complaint-print .letterhead { display: block; width: 100%; height: auto; }
#complaint-print .number { margin-top: 10px; font-size: 11pt; color: #444; text-align: left; }
#complaint-print .number b { font-size: 14pt; color: #111; }
#complaint-print h1 { text-align: center; font-size: 16pt; margin: 8px 0 20px; text-decoration: underline; text-underline-offset: 6px; }
#complaint-print .row { display: flex; gap: 24px; margin: 9px 0; align-items: flex-end; }
#complaint-print .field { display: flex; align-items: flex-end; gap: 6px; flex: 1; min-width: 0; }
#complaint-print .field.grow { flex: 2; }
#complaint-print .label { font-weight: 700; white-space: nowrap; }
#complaint-print .value { flex: 1; border-bottom: 1px solid #555; padding: 0 4px 2px; min-height: 1.3em; }
#complaint-print .blank { flex: 1; border-bottom: 1px dotted #555; min-height: 1.3em; }
#complaint-print .sig { width: 48mm; height: 16mm; border-bottom: 1px solid #555; }
#complaint-print .sig-blank { min-width: 48mm; min-height: 12mm; }
#complaint-print .complaint { margin: 12px 0; }
#complaint-print .complaint .text { margin-top: 6px; min-height: 56mm; white-space: pre-wrap; line-height: 2; padding: 0 4px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent calc(2em - 1px), #bbb calc(2em - 1px), #bbb 2em); }
#complaint-print .witnesses { display: flex; gap: 24px; margin-top: 12px; }
#complaint-print .witness .field { margin: 0; }
#complaint-print .witness { flex: 1; display: flex; flex-direction: column; gap: 8px; }
#complaint-print .resolution { margin-top: 16px; padding: 8px 10px; border: 1px solid #999; border-radius: 6px; font-size: 11pt; }
#complaint-print .resolution small { display: block; color: #555; margin-top: 4px; }
#complaint-print footer { margin-top: auto; padding-top: 16px; text-align: center; break-inside: avoid; }
#complaint-print footer .letterhead { margin-top: 10px; }
#complaint-print footer b { display: block; font-size: 13pt; }
#complaint-print footer small { display: block; color: #555; font-size: 9pt; margin-top: 4px; }
`;

/** طباعة الاستمارة من الصفحة نفسها (تعمل في المتصفح والتطبيق المثبت): تُخفى الصفحة وتُطبع الاستمارة وحدها */
export async function printComplaint(complaint: Complaint) {
  document.getElementById("complaint-print")?.remove();
  const root = document.createElement("div");
  root.id = "complaint-print";
  root.innerHTML = `<style>${PRINT_CSS}</style>${complaintFormHtml(complaint)}`;
  document.body.appendChild(root);
  // رأس الورقة وتذييلها يُحمَّلان قبل فتح نافذة الطباعة
  await Promise.race([
    Promise.all(Array.from(root.querySelectorAll("img"), (image) => image.decode().catch(() => {}))),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
  const cleanup = () => {
    window.removeEventListener("afterprint", cleanup);
    root.remove();
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
