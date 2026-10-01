import type { Gender } from "./transport";

/** أدوات قراءة النصوص من ملفات Excel والنماذج (المواعيد وقائمة الضيوف). */

export function toText(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function toWesternDigits(value: string) {
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabic.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persian.indexOf(digit)));
}

export function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\s_\-\/]+/g, "");
}

export function normalizeGender(value: unknown): Gender | undefined {
  const text = toText(value).toLowerCase();
  if (!text) return undefined;
  if (/^(ذكر|رجل|male|m)$/.test(text)) return "ذكر";
  if (/^(أنثى|انثى|انثي|أنثي|امرأة|امراة|female|f)$/.test(text)) return "أنثى";
  return undefined;
}

/** قيمة العمود بأي اسم من أسمائه (بلا فرق في المسافات والهمزات والتاء المربوطة). */
export function readAliased(row: Record<string, unknown>, aliases: string[]) {
  const aliasSet = new Set(aliases.map(normalizeHeader));
  const entry = Object.entries(row).find(([key]) => aliasSet.has(normalizeHeader(key)));
  return entry?.[1];
}

export function normalizeMobile(value: unknown) {
  return toWesternDigits(toText(value)).replace(/\.0$/, "").replace(/[\s-]/g, "");
}
