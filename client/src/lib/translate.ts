import { useEffect, useState } from "react";
import { CANCEL_REASONS } from "@shared/transport";

/** الأسباب الجاهزة لإلغاء الموعد بالإنجليزية (بنفس ترتيب CANCEL_REASONS). */
const CANCEL_REASONS_EN: Record<(typeof CANCEL_REASONS)[number], string> = {
  "الضيف لا يرغب في الذهاب": "The guest does not want to go",
  "الضيف غير موجود في الشقة": "The guest is not in the apartment",
  "أُلغي الموعد من المستشفى": "The hospital cancelled the appointment",
  "ذهب الضيف بوسيلة أخرى": "The guest went by other means",
  "حالة الضيف لا تسمح بالنقل": "The guest's condition does not allow transport",
};

export const hasArabic = (text: string) => /[؀-ۿ]/.test(text);

/**
 * مترجم Chrome المدمج (Translator API): الترجمة على الجهاز نفسه بلا خدمة خارجية، فلا يخرج النص من المتصفح.
 * متاح في Chrome على الحاسوب (138 وما بعده)؛ وفي غيره يبقى النص كما كُتب.
 */
type TranslatorApi = {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<{ translate(text: string): Promise<string> }>;
};
const api = () => (globalThis as { Translator?: TranslatorApi }).Translator;
const PAIR = { sourceLanguage: "ar", targetLanguage: "en" };

let translator: Promise<{ translate(text: string): Promise<string> }> | null = null;
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

/** available: يترجم الآن؛ downloadable: يحتاج ضغطة لتنزيل الترجمة على الجهاز أول مرة؛ unavailable: غير مدعوم */
export type TranslationState = "available" | "downloadable" | "unavailable";
let state: Promise<TranslationState> | null = null;

function translationState(): Promise<TranslationState> {
  if (!state) {
    const translatorApi = api();
    state = translatorApi
      ? translatorApi.availability(PAIR).then((result) => (result === "available" ? "available" : result === "unavailable" ? "unavailable" : "downloadable")).catch(() => "unavailable")
      : Promise.resolve("unavailable");
  }
  return state;
}

/** تجهيز المترجم (بضغطة من المستخدم إن احتاج تنزيلًا)، ثم تحديث كل النصوص المنتظرة. */
export function enableTranslation() {
  const translatorApi = api();
  if (!translatorApi) return;
  translator ??= translatorApi.create(PAIR);
  translator.then(() => {
    state = Promise.resolve("available");
    listeners.forEach((listener) => listener());
  }).catch(() => {
    translator = null;
  });
}

async function translate(text: string) {
  const cached = cache.get(text);
  if (cached) return cached;
  translator ??= api()!.create(PAIR);
  const result = await (await translator).translate(text);
  cache.set(text, result);
  return result;
}

/**
 * سبب الإلغاء بلغة الواجهة: السبب الجاهز بترجمته الثابتة، والسبب المكتوب بالعربية بمترجم المتصفح
 * على الجهاز إن توفر، وإلا يبقى كما كُتب (original).
 */
export function useCancelReason(reason: string | undefined, lang: "ar" | "en") {
  const text = (reason ?? "").trim();
  const fixed = lang === "en" ? CANCEL_REASONS_EN[text as keyof typeof CANCEL_REASONS_EN] : undefined;
  const needs = lang === "en" && !fixed && hasArabic(text);
  const [result, setResult] = useState<{ text: string; translated: string | null; status: TranslationState | "pending" }>({ text, translated: cache.get(text) ?? null, status: "pending" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!needs) return;
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [needs]);

  useEffect(() => {
    if (!needs) return;
    let alive = true;
    translationState().then((available) => {
      if (!alive) return;
      if (available !== "available") {
        setResult({ text, translated: null, status: available });
        return;
      }
      translate(text)
        .then((translated) => alive && setResult({ text, translated, status: "available" }))
        .catch(() => alive && setResult({ text, translated: null, status: "unavailable" }));
    });
    return () => { alive = false; };
  }, [text, needs, version]);

  if (!text) return { text: "", machine: false, original: null as string | null, canEnable: false };
  if (fixed) return { text: fixed, machine: false, original: null, canEnable: false };
  if (!needs) return { text, machine: false, original: null, canEnable: false };
  const translated = result.text === text ? result.translated : null;
  if (translated) return { text: translated, machine: true, original: text, canEnable: false };
  return { text, machine: false, original: null, canEnable: result.text === text && result.status === "downloadable" };
}

/** الترجمة الثابتة للسبب الجاهز (للفلترة والتصدير بلا انتظار). */
export const cancelReasonText = (reason: string | undefined, lang: "ar" | "en") =>
  (lang === "en" && CANCEL_REASONS_EN[(reason ?? "").trim() as keyof typeof CANCEL_REASONS_EN]) || (reason ?? "");
