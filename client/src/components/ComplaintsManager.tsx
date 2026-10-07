import { useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, MessageSquareWarning, Search } from "lucide-react";
import { complaintMatches, isResolved, type Complaint } from "@shared/complaints";
import { toWesternDigits } from "@shared/text";
import { localDateString } from "@shared/transport";
import { useComplaints } from "@/lib/useShared";
import { dayText, deleteComplaint, followUpComplaint, stampText } from "@/lib/complaints";
import { ComplaintRow, ComplaintView } from "./Complaints";
import { EmptyState, PageHeader, Panel, Segmented, btn, cx, inputClass } from "./ui-kit";

type StatusFilter = "open" | "resolved" | "all";
const PAGE = 50;

/** صف الشكوى في ملف Excel */
const EXPORT_COLUMNS = ["رقم الشكوى", "التاريخ", "الوقت", "الضيف", "المبنى", "الشقة", "الهاتف", "الشكوى", "السيارة", "السائق",
  "توقيع الضيف", "الشهود", "سجّلها", "وقت التسجيل", "الحالة", "المعالجة", "عالجها", "وقت المعالجة"];
const exportRow = (complaint: Complaint) => [
  complaint.number ?? "", dayText(complaint.date), complaint.time, complaint.guestName, complaint.buildingNumber, complaint.apartmentNumber,
  complaint.mobile ?? "", complaint.text, complaint.vehiclePlate ?? "", complaint.driver ?? "",
  complaint.guestSignature ? "نعم" : "لا", (complaint.witnesses ?? []).map((witness) => witness.name).join("، "),
  complaint.createdByName ?? "", stampText(complaint.createdAt), isResolved(complaint) ? "تمت المعالجة" : "جديدة",
  complaint.resolution ?? "", complaint.resolvedBy ?? "", stampText(complaint.resolvedAt),
];

/**
 * الشكاوى للمدير: كل الشكاوى التي سجّلها مشرفو المباني، مع البحث والفلترة والتصدير. المدير وحده يتابع الشكوى
 * (تمت المعالجة مع ملاحظة، أو إعادة فتحها) ويحذفها؛ كل ذلك في سجل العمليات.
 */
export default function ComplaintsManager() {
  const complaints = useComplaints();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  const openCount = complaints.filter((complaint) => !isResolved(complaint)).length;
  const filtered = complaints.filter((complaint) => (status === "all" || (status === "resolved") === isResolved(complaint))
    && complaintMatches(complaint, toWesternDigits(query)));
  const opened = openId ? complaints.find((complaint) => complaint.id === openId) : undefined;

  async function exportExcel() {
    const { downloadExcel } = await import("@/lib/report");
    await downloadExcel({
      title: "الشكاوى",
      subtitle: `${filtered.length} شكوى · ${status === "open" ? "الجديدة" : status === "resolved" ? "تمت معالجتها" : "كل الشكاوى"}`,
      kpis: [
        { label: "الشكاوى", value: String(filtered.length) },
        { label: "جديدة", value: String(filtered.filter((complaint) => !isResolved(complaint)).length) },
        { label: "تمت المعالجة", value: String(filtered.filter(isResolved).length) },
      ],
      sections: [{ title: "الشكاوى", sheet: "الشكاوى", columns: EXPORT_COLUMNS, rows: filtered.map(exportRow) }],
    }, `althumama-complaints-${localDateString()}.xlsx`);
  }

  return (
    <>
      <PageHeader title="الشكاوى" subtitle="شكاوى النقل والسيارات · يسجّلها مشرفو المباني بالاستمارة المعتمدة · لا يعدّلها ولا يحذفها أحد غير مدير النظام" />
      <Panel
        icon={MessageSquareWarning}
        tone={openCount ? "amber" : "green"}
        title={openCount ? "شكاوى تنتظر المعالجة" : "لا شكاوى جديدة"}
        count={openCount}
        actions={<button type="button" onClick={exportExcel} disabled={!filtered.length} className={btn("secondary", "sm")}><FileSpreadsheet className="h-3.5 w-3.5" /> تصدير Excel</button>}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <Segmented
            label="حالة الشكوى"
            size="sm"
            value={status}
            onChange={(value) => { setStatus(value); setShown(PAGE); }}
            options={[
              { value: "open", label: `جديدة (${openCount})` },
              { value: "resolved", label: `تمت المعالجة (${complaints.length - openCount})` },
              { value: "all", label: `الكل (${complaints.length})` },
            ]}
          />
          <label className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setShown(PAGE); }} placeholder="بحث بالرقم أو الضيف أو المبنى أو السيارة أو السائق أو النص أو المشرف" aria-label="بحث في الشكاوى" className={cx(inputClass, "h-9 ps-9 text-xs")} />
          </label>
        </div>
        {filtered.length ? (
          <div className="divide-y divide-slate-100">
            {filtered.slice(0, shown).map((complaint) => <ComplaintRow key={complaint.id} complaint={complaint} showAuthor onOpen={() => setOpenId(complaint.id)} />)}
          </div>
        ) : (
          <EmptyState icon={MessageSquareWarning} title={complaints.length ? "لا توجد شكوى تطابق الفلاتر" : "لم تُسجَّل شكاوى بعد"} />
        )}
        {filtered.length > shown && (
          <div className="border-t border-slate-100 px-5 py-2.5 text-center">
            <button type="button" onClick={() => setShown((count) => count + PAGE)} className={btn("ghost", "sm")}>عرض المزيد ({filtered.length - shown})</button>
          </div>
        )}
      </Panel>

      {opened && (
        <ComplaintView
          complaint={opened}
          admin
          onResolve={(resolution) => { followUpComplaint(opened.id, resolution); toast.success(`الشكوى #${opened.number}: تمت المعالجة`); }}
          onReopen={() => followUpComplaint(opened.id, null)}
          onDelete={() => { deleteComplaint(opened.id); setOpenId(null); toast.success(`حُذفت الشكوى #${opened.number}`); }}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
