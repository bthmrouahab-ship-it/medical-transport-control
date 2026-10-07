import { describe, expect, it } from "vitest";
import {
  COMPLAINT_SIGNATURE_MAX,
  buildComplaint,
  complaintError,
  complaintMatches,
  normalizeComplaint,
  signaturePath,
  sortComplaints,
  type ComplaintDraft,
} from "../shared/complaints";
import { complaintFormHtml } from "../client/src/lib/complaints";

// بيانات مصطنعة فقط
const draft = (extra: Partial<ComplaintDraft> = {}): ComplaintDraft => ({
  date: "2026-10-07", time: "14:30", guestName: "ضيف تجربة", buildingNumber: "17", apartmentNumber: "3", text: "تأخرت السيارة ساعة عن الموعد", ...extra,
});

describe("complaint form", () => {
  it("needs the guest, the building and apartment, and the complaint text", () => {
    expect(complaintError(draft())).toBeNull();
    expect(complaintError(draft({ guestName: " " }))).toBe("اكتب اسم الضيف");
    expect(complaintError(draft({ apartmentNumber: "" }))).toBe("اكتب رقم المبنى والشقة");
    expect(complaintError(draft({ text: "لا" }))).toBe("اكتب نص الشكوى");
    expect(complaintError(draft({ mobile: "123" }))).toBe("رقم الهاتف غير صحيح");
    expect(complaintError(draft({ date: "2026-02-30" }))).toBe("اختر تاريخ الشكوى ووقتها");
    expect(complaintError(draft({ witnesses: [{ name: "" }] }))).toBe("اكتب اسم الشاهد أو احذفه");
    expect(complaintError(draft({ witnesses: [{ name: "أ" }, { name: "ب" }, { name: "ج" }] }))).toBe("شاهدان على الأكثر");
    expect(complaintError(draft({ guestSignature: "<script>" }))).toBe("التوقيع غير صالح، امسحه ووقّع من جديد");
  });

  it("saves trimmed text without empty fields, and the phone in western digits", () => {
    const complaint = buildComplaint(draft({ guestName: "  ضيف تجربة ", mobile: "٥٥٥ ٠٠٠ ١١", witnesses: [{ name: " شاهد " }, { name: "  " }] }), "CMP-1");
    expect(complaint).toEqual({
      id: "CMP-1", date: "2026-10-07", time: "14:30", guestName: "ضيف تجربة", buildingNumber: "17", apartmentNumber: "3",
      mobile: "55500011", text: "تأخرت السيارة ساعة عن الموعد", witnesses: [{ name: "شاهد" }],
    });
    // ما يكتبه الخادم لا يُرسل من الاستمارة
    expect(complaint).not.toHaveProperty("createdBy");
    expect(complaint).not.toHaveProperty("number");
  });

  it("stores the on-screen signature as short SVG lines the server accepts", () => {
    const path = signaturePath([[[10.4, 20.6], [10.9, 20.9], [40, 50], [400, -5]], [[100, 60]]]);
    // النقطة الأقرب من بكسلين تُهمل، والخارجة عن المساحة تُقص، واللمسة الواحدة خط قصير
    expect(path).toBe("M10 21L40 50L300 0M100 60L101 60");
    expect(/^M[\d .\-ML]*$/.test(path)).toBe(true);
    expect(complaintError(draft({ guestSignature: path }))).toBeNull();
    expect(complaintError(draft({ guestSignature: `M${"1 1L".repeat(COMPLAINT_SIGNATURE_MAX)}` }))).not.toBeNull();
  });
});

describe("complaints list", () => {
  const list = [
    normalizeComplaint({ id: "A", number: 1, ...draft(), createdAt: "2026-10-06T08:00:00.000Z", createdByName: "مشرف 1" })!,
    normalizeComplaint({ id: "B", number: 2, ...draft({ guestName: "ضيف آخر", buildingNumber: "5", vehiclePlate: "111", driver: "علي" }), createdAt: "2026-10-07T08:00:00.000Z", status: "resolved", resolution: "تم التنبيه على السائق" })!,
  ];

  it("shows the newest first and finds complaints by number, guest, building or text", () => {
    expect(sortComplaints(list).map((complaint) => complaint.id)).toEqual(["B", "A"]);
    expect(list.filter((complaint) => complaintMatches(complaint, "#2")).map((complaint) => complaint.id)).toEqual(["B"]);
    expect(list.filter((complaint) => complaintMatches(complaint, "مبنى 5")).map((complaint) => complaint.id)).toEqual(["B"]);
    expect(list.filter((complaint) => complaintMatches(complaint, "111 علي")).map((complaint) => complaint.id)).toEqual(["B"]);
    expect(list.filter((complaint) => complaintMatches(complaint, "مشرف 1")).map((complaint) => complaint.id)).toEqual(["A"]);
    expect(list.filter((complaint) => complaintMatches(complaint, "تأخرت")).length).toBe(2);
  });

  it("reads saved complaints safely", () => {
    expect(list[0].status).toBe("open");
    expect(list[1]).toMatchObject({ status: "resolved", resolution: "تم التنبيه على السائق", vehiclePlate: "111", driver: "علي" });
    expect(normalizeComplaint({ id: "C", ...draft(), witnesses: [{ name: "" }, { name: "ش" }] })).toMatchObject({ witnesses: [{ name: "ش" }] });
    // الشكاوى للنقل والسيارات فقط: لا موضوع
    expect(normalizeComplaint({ id: "C", ...draft(), category: "النظافة" })).not.toHaveProperty("category");
    expect(normalizeComplaint(null)).toBeNull();
  });
});

describe("printed complaint form", () => {
  it("fills the approved form, escapes the text, and leaves lines for missing signatures", () => {
    const html = complaintFormHtml({
      ...buildComplaint(draft({ text: "<b>نص</b>", guestSignature: "M10 10L20 20", witnesses: [{ name: "شاهد تجربة" }] }), "CMP-1"),
      number: 7, createdByName: "مشرف تجربة", createdAt: "2026-10-07T11:00:00.000Z",
    });
    expect(html).toContain("استمارة الشكاوى لجميع الخدمات المقدمة في مجمع الثمامة");
    expect(html).toContain("إدارة مجمع الثمامة");
    expect(html).toContain("<b>7</b>");
    expect(html).toContain("07/10/2026");
    expect(html).toContain("&lt;b&gt;نص&lt;/b&gt;");
    expect(html).not.toContain("<b>نص</b>");
    expect(html).toContain('d="M10 10L20 20"');
    expect(html).toContain("شاهد تجربة");
    expect(html).toContain("مشرف تجربة");
    // توقيع المشرف والشاهدين بلا توقيع على الشاشة: خط فارغ للتوقيع باليد
    expect(html.match(/sig-blank/g)).toHaveLength(3);
    // على ورقة الهلال الأحمر القطري كما في النموذج المعتمد
    expect(html).toContain('src="/qrcs-letterhead-top.png"');
    expect(html).toContain('src="/qrcs-letterhead-bottom.png"');
  });
});
