import type { ReportViewerData } from "./types";

/**
 * ملف HTML واحد لصفحة الإحصائيات المصدرة: أنماط الموقع، وبيانات الفترة (JSON)، وصفحة العرض (code: الملف المبني من
 * viewer.tsx). الصفحة فاتحة دائمًا (only light) حتى لا يقلب المتصفح ألوانها في الوضع الداكن.
 */
export function statsPageHtml(data: ReportViewerData, code: string, css: string) {
  // داخل وسم script: لا «</script» ولا «<!--» حتى لا يُغلق الوسم مبكرًا
  const safe = (text: string) => text.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const title = data.title.replace(/[<&]/g, "");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="only light" />
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>${css.replace(/<\/style/gi, "<\\/style")}</style>
<style>html, body { background: #f4f6f9; } @media print { .recharts-wrapper, svg { break-inside: avoid; } }</style>
</head>
<body>
<div id="report-root"><p style="padding:24px;font-family:system-ui">جارٍ عرض الإحصائيات…</p></div>
<script type="application/json" id="report-data">${json}</script>
<script>${safe(code)}</script>
</body>
</html>`;
}
