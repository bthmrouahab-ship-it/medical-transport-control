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

/** رقم الهاتف بلا مسافات ولا شرطات، وبلا رمز قطر (+974 أو 00974 أو 974) قبل الأرقام الثمانية */
export function normalizeMobile(value: unknown) {
  const digits = toWesternDigits(toText(value)).replace(/\.0$/, "").replace(/[\s\-()]/g, "");
  return digits.match(/^(?:\+|00)?974(\d{8})$/)?.[1] ?? digits;
}

/** عدد أرقام الهاتف في قطر: 8 أرقام بالضبط */
export const MOBILE_DIGITS = 8;

/** رقم هاتف قطري صالح (بعد normalizeMobile): 8 أرقام لا أكثر ولا أقل (valid_mobile في الخادم) */
export function isValidMobile(value: string) {
  return /^\d{8}$/.test(value);
}

export const MOBILE_ERROR = "رقم الهاتف يجب أن يكون 8 أرقام";
