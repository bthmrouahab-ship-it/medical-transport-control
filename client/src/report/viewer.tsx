import { createRoot } from "react-dom/client";
import ReportViewer from "./ReportViewer";
import type { ReportViewerData } from "./types";

/**
 * نقطة تشغيل صفحة الإحصائيات المصدرة: يُبنى كملف مستقل (?worker&url في reportExport.ts) ويُضمَّن في ملف HTML
 * مع بياناته (report-data) وأنماط الموقع، فيعمل بلا اتصال بالموقع.
 */
const source = document.getElementById("report-data");
const root = document.getElementById("report-root");
if (source && root) {
  const data = JSON.parse(source.textContent || "{}") as ReportViewerData;
  createRoot(root).render(<ReportViewer data={data} />);
}
