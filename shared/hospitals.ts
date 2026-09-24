/**
 * دليل المستشفيات والمراكز الصحية التي تُنقل إليها الرحلات.
 * القائمة الأولية مبنية على الوجهات الأكثر تكرارًا في إحصائيات 11-07-2026 إلى 23-08-2026.
 * الإحداثيات تقريبية (verified: false) ويصححها المدير من لوحة السيارات بالنقر على الخريطة.
 */
export type Hospital = {
  id: string;
  name: string;
  nameEn: string;
  zone: string;
  lat: number;
  lng: number;
  /** كلمات تُطابق بها الوجهة المكتوبة يدويًا أو القادمة من Excel. */
  aliases: string[];
  verified: boolean;
};

/** مجمع الثمامة: نقطة انطلاق الرحلات. */
export const ORIGIN = { name: "مجمع الثمامة", lat: 25.2335, lng: 51.5435 };

/** مركز خريطة الدوحة وما حولها. */
export const DOHA_CENTER = { lat: 25.27, lng: 51.5, zoom: 11 };

const hmc = "مدينة حمد الطبية";

export const DEFAULT_HOSPITALS: Hospital[] = [
  { id: "wakra", name: "مستشفى الوكرة", nameEn: "Al Wakra Hospital", zone: "الوكرة", lat: 25.1827, lng: 51.6012, aliases: ["الوكره", "wakra"], verified: false },
  { id: "sidra", name: "مستشفى سدرة", nameEn: "Sidra Medicine", zone: "المدينة التعليمية", lat: 25.317, lng: 51.438, aliases: ["سدره", "سيدرا", "sidra"], verified: false },
  { id: "thumama-hc", name: "مركز الثمامة الصحي", nameEn: "Al Thumama Health Center", zone: "الثمامة وروضة الخيل", lat: 25.2305, lng: 51.5395, aliases: ["مركز الثمامه", "مستشفي الثمامه", "الصحي الثمامه", "thumama"], verified: false },
  { id: "rawdat-alkhail", name: "مركز روضة الخيل الصحي", nameEn: "Rawdat Al Khail Health Center", zone: "الثمامة وروضة الخيل", lat: 25.264, lng: 51.523, aliases: ["روضه الخيل", "rawdat"], verified: false },
  { id: "cuban", name: "المستشفى الكوبي", nameEn: "The Cuban Hospital", zone: "دخان", lat: 25.425, lng: 50.787, aliases: ["الكوبي", "cuban"], verified: false },
  { id: "hgh", name: "مستشفى حمد العام", nameEn: "Hamad General Hospital", zone: hmc, lat: 25.2918, lng: 51.5025, aliases: ["حمد العام", "hamad general"], verified: false },
  { id: "qri", name: "مركز قطر لإعادة التأهيل", nameEn: "Qatar Rehabilitation Institute", zone: hmc, lat: 25.298, lng: 51.4975, aliases: ["اعاده التاهيل", "حمد التاهيلي", "التاهيل", "rehabilitation", "qri hamad", "hamad bin khalifa", "hamadbin khalifa", "حمد بن خليفه", "مدينه حمد الطبيه", "hamad medical city"], verified: false },
  { id: "qri-bin-omran", name: "العلاج الطبيعي بن عمران", nameEn: "QRI Physiotherapy Bin Omran", zone: "بن عمران", lat: 25.312, lng: 51.499, aliases: ["بن عمران", "bin omran"], verified: false },
  { id: "acc", name: "مركز الرعاية المتنقلة", nameEn: "Ambulatory Care Center", zone: hmc, lat: 25.296, lng: 51.501, aliases: ["الرعايه المتنقله", "ambulatory", "amulatory"], verified: false },
  { id: "bone-joint", name: "مركز العظام والمفاصل", nameEn: "Bone and Joint Center", zone: hmc, lat: 25.2945, lng: 51.504, aliases: ["العظام والمفاصل", "bone and joint", "bone joint"], verified: false },
  { id: "surgical", name: "المركز التخصصي للجراحة", nameEn: "Surgical Specialty Center", zone: hmc, lat: 25.2935, lng: 51.499, aliases: ["حمد التخصصي", "التخصصي", "surgical", "specalist", "specilaty"], verified: false },
  { id: "mcrc", name: "مركز الرعاية الطبية والأبحاث", nameEn: "Medical Care and Research Center", zone: hmc, lat: 25.2905, lng: 51.504, aliases: ["الرعايه الطبيه والابحاث", "medical care and research"], verified: false },
  { id: "rumailah", name: "مستشفى الرميلة", nameEn: "Rumailah Hospital", zone: hmc, lat: 25.2965, lng: 51.51, aliases: ["الرميله", "رميله", "rumailah", "rumaila hospital"], verified: false },
  { id: "amal", name: "مستشفى الأمل (المركز الوطني لعلاج السرطان)", nameEn: "National Center for Cancer Care and Research", zone: hmc, lat: 25.296, lng: 51.5075, aliases: ["الامل", "علاج السرطان", "al amal", "cancer care"], verified: false },
  { id: "heart", name: "مستشفى القلب", nameEn: "Heart Hospital", zone: hmc, lat: 25.2915, lng: 51.5015, aliases: ["مستشفي القلب", "heart hospital"], verified: false },
  { id: "kidney", name: "مركز فهد بن جاسم للكلى", nameEn: "Fahad Bin Jassim Kidney Center", zone: hmc, lat: 25.2925, lng: 51.506, aliases: ["للكلي", "kidney"], verified: false },
  { id: "wwrc", name: "مركز صحة المرأة والأبحاث", nameEn: "Women's Wellness and Research Center", zone: hmc, lat: 25.289, lng: 51.5, aliases: ["المراه والابحاث", "women"], verified: false },
  { id: "cdc", name: "المركز الوطني للأمراض الانتقالية", nameEn: "Communicable Disease Center", zone: hmc, lat: 25.2935, lng: 51.5075, aliases: ["communicable disease", "الامراض الانتقاليه"], verified: false },
  { id: "aisha-attiyah", name: "مستشفى عائشة بنت حمد العطية", nameEn: "Aisha Bint Hamad Al Attiyah Hospital", zone: "شمال الدوحة", lat: 25.388, lng: 51.448, aliases: ["عائشه بنت حمد", "aisha bint hamad"], verified: false },
  { id: "hazm-mebaireek", name: "مستشفى حزم مبيريك العام", nameEn: "Hazm Mebaireek General Hospital", zone: "المنطقة الصناعية", lat: 25.197, lng: 51.399, aliases: ["حزم مبيريك", "hazm mebaireek"], verified: false },
  { id: "mesaieed", name: "مستشفى مسيعيد", nameEn: "Mesaieed Hospital", zone: "مسيعيد", lat: 24.999, lng: 51.555, aliases: ["مسيعيد", "mesaieed", "meissaid"], verified: false },
  { id: "alkhor", name: "مستشفى الخور", nameEn: "Al Khor Hospital", zone: "الخور", lat: 25.696, lng: 51.505, aliases: ["الخور", "al khor hospital"], verified: false },
  { id: "pearl-dental", name: "مركز اللؤلؤة للأسنان", nameEn: "Pearl Dental Center", zone: "الثمامة وروضة الخيل", lat: 25.25, lng: 51.535, aliases: ["اللؤلؤه للاسنان", "مركز اللؤلؤه", "pearl dental", "peral dental", "al luluah dental"], verified: false },
];

export function normalizePlaceName(value: string) {
  return value
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^0-9a-z\u0600-\u06ff\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** يزيل عبارة العودة إلى المجمع من نص الوجهة ("مستشفى الوكرة / مجمع الثمامة"). */
export function stripReturnLeg(value: string) {
  return value.split(/\/\s*(?:مجمع|محمع)\s*(?:الثمامة|الثمامه|التمامه)/)[0].replace(/(?:مجمع|محمع)\s*(?:الثمامة|الثمامه)/g, " ");
}

/**
 * يطابق نص الوجهة مع دليل المستشفيات. تُفضَّل المطابقة الأطول حتى لا تُطابق
 * كلمة عامة مثل "التخصصي" قبل "حمد التخصصي".
 */
export function matchHospital(destination: string, hospitals: Hospital[] = DEFAULT_HOSPITALS): Hospital | null {
  const text = normalizePlaceName(stripReturnLeg(destination));
  if (!text) return null;
  let best: { hospital: Hospital; length: number } | null = null;
  for (const hospital of hospitals) {
    for (const alias of [hospital.name, hospital.nameEn, ...hospital.aliases]) {
      const key = normalizePlaceName(alias);
      if (key && text.includes(key) && (!best || key.length > best.length)) best = { hospital, length: key.length };
    }
  }
  return best?.hospital ?? null;
}

/** المسافة بالكيلومتر بين نقطتين (صيغة هافرساين). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** مستشفيات تبعد أقل من المسافة المحددة، مرتبة من الأقرب. */
export function nearbyHospitals(hospital: Hospital, hospitals: Hospital[], maxKm = 3) {
  return hospitals
    .filter((other) => other.id !== hospital.id)
    .map((other) => ({ hospital: other, km: distanceKm(hospital, other) }))
    .filter((item) => item.km <= maxKm)
    .sort((a, b) => a.km - b.km);
}
