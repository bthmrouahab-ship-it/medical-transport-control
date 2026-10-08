import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, ImageUp, MessageSquareWarning, ScrollText, Search } from "lucide-react";
import { complaintMatches, isResolved, type Complaint } from "@shared/complaints";
import { toWesternDigits } from "@shared/text";
import { localDateString } from "@shared/transport";
import { useComplaints, useGuests } from "@/lib/useShared";
import { addComplaint, dayText, deleteComplaint, followUpComplaint, prepareScan, stampText, uploadComplaintScan, type PreparedScan } from "@/lib/complaints";
import { authErrorMessage } from "@/lib/auth";
import { ComplaintRow, ComplaintView, type ComplaintGuest } from "./Complaints";
import { PaperComplaintForm } from "./PaperComplaint";
import { EmptyState, PageHeader, Panel, Segmented, btn, cx, inputClass } from "./ui-kit";

type StatusFilter = "open" | "resolved" | "all";
const PAGE = 50;

/** صف الشكوى في ملف Excel */
const EXPORT_COLUMNS = ["رقم الشكوى", "النوع", "التاريخ", "الوقت", "الضيف", "المبنى", "الشقة", "الهاتف", "الشكوى", "السيارة", "السائق",
  "توقيع الضيف", "الشهود", "سجّلها", "وقت التسجيل", "الحالة", "المعالجة", "عالجها", "وقت المعالجة"];
const exportRow = (complaint: Complaint) => [
  complaint.number ?? "", complaint.paper ? "ورقية" : "من النظام", dayText(complaint.date), complaint.time, complaint.guestName, complaint.buildingNumber, complaint.apartmentNumber,
  complaint.mobile ?? "", complaint.text, complaint.vehiclePlate ?? "", complaint.driver ?? "",
  complaint.guestSignature ? "نعم" : "لا", (complaint.witnesses ?? []).map((witness) => witness.name).join("، "),
  complaint.paperSupervisor ?? complaint.createdByName ?? "", stampText(complaint.createdAt), isResolved(complaint) ? "تمت المعالجة" : "جديدة",
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
  const [addingPaper, setAddingPaper] = useState(false);
  const guestList = useGuests();
  const guests: ComplaintGuest[] = guestList.map((guest) => ({ name: guest.name, buildingNumber: guest.buildingNumber, apartmentNumber: guest.apartmentNumber, ...(guest.mobile ? { mobile: guest.mobile } : {}) }));
  // الاستمارة الورقية تُرفع بعد أن يحفظ الخادم الشكوى (يصل رقمها مع المزامنة)
  const pendingScans = useRef(new Map<string, PreparedScan>());
  const [uploading, setUploading] = useState<string | null>(null);
  async function upload(id: string, scan: PreparedScan) {
    setUploading(id);
    try {
      await uploadComplaintScan(id, scan);
      toast.success("أُرفقت الاستمارة الورقية");
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر رفع الاستمارة الورقية. أرفقها من جديد من نافذة الشكوى."));
    } finally {
      setUploading(null);
    }
  }
  useEffect(() => {
    for (const [id, scan] of Array.from(pendingScans.current)) {
      if (!complaints.find((complaint) => complaint.id === id)?.number) continue;
      pendingScans.current.delete(id);
      void upload(id, scan);
    }
  }, [complaints]);
  async function attach(id: string, file: File | undefined) {
    if (!file) return;
    try {
      await upload(id, await prepareScan(file));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر قراءة الملف");
    }
  }

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
      <PageHeader
        title="الشكاوى"
        subtitle="شكاوى النقل والسيارات · يسجّلها مشرفو المباني بالاستمارة المعتمدة، ويضيف المدير الشكاوى الورقية · لا يعدّلها ولا يحذفها أحد غير مدير النظام"
        actions={<button type="button" onClick={() => setAddingPaper(true)} className={btn("primary")}><ScrollText className="h-4 w-4" /> إضافة شكوى ورقية</button>}
      />
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
          scanAction={opened.number ? (
            <label className={cx(btn("secondary", "sm"), "cursor-pointer", uploading === opened.id && "pointer-events-none opacity-60")}>
              <ImageUp className="h-3.5 w-3.5" /> {uploading === opened.id ? "جارٍ الرفع…" : opened.scanType ? "استبدال" : "إرفاق الاستمارة الورقية"}
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(event) => { void attach(opened.id, event.target.files?.[0]); event.target.value = ""; }} />
            </label>
          ) : undefined}
        />
      )}

      {addingPaper && (
        <PaperComplaintForm
          guests={guests}
          onClose={() => setAddingPaper(false)}
          onSave={(complaint, scan) => {
            pendingScans.current.set(complaint.id, scan);
            addComplaint(complaint);
            setAddingPaper(false);
            setOpenId(complaint.id);
            toast.success(`أُضيفت الشكوى الورقية من ${complaint.guestName}`, { description: "تُرفع الاستمارة بعد حفظ الشكوى" });
          }}
        />
      )}
    </>
  );
}
