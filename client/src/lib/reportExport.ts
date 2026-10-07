import viewerUrl from "@/report/viewer.tsx?worker&url";
import type { ReportViewerData } from "@/report/types";
import { statsPageHtml } from "@/report/page";
import { download } from "./report";

/**
 * صفحة الإحصائيات المصدرة (HTML) بنفس عرض صفحة الإحصائيات في الموقع: صفحة العرض (client/src/report، تُبنى ملفًا
 * مستقلًا فيه React وrecharts ومكونات الإحصائيات) وأنماط الموقع وشعاره وبيانات الفترة، كلها داخل ملف واحد يعمل بلا اتصال.
 */
export async function downloadStatsPage(data: ReportViewerData, fileName: string) {
  const [code, css, logo] = await Promise.all([fetchText(viewerUrl), pageCss(), dataUrl("/logo.png")]);
  download(new Blob([statsPageHtml({ ...data, logo: logo ?? undefined }, code, css)], { type: "text/html;charset=utf-8" }), fileName);
}

/** هل تعمل صفحة العرض المستقلة؟ (في التطوير يكون ملفها وحدات منفصلة لا تُضمَّن) */
export const canExportStatsPage = () => !import.meta.env.DEV;

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`تعذر تحميل ${url}`);
  return response.text();
}

/** أنماط الموقع كما في الصفحة الآن (ملفات الموقع ووسوم style)، بلا الخطوط من خارج الموقع */
async function pageCss() {
  const parts = await Promise.all(Array.from(document.styleSheets).map(async (sheet) => {
    if (sheet.href) {
      if (new URL(sheet.href).origin !== window.location.origin) return "";
      return fetchText(sheet.href).catch(() => "");
    }
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
    } catch {
      return "";
    }
  }));
  return parts.join("\n");
}

async function dataUrl(path: string) {
  try {
    const blob = await (await fetch(path)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
