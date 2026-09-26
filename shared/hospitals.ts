/**
 * دليل المستشفيات والمراكز الصحية التي تُنقل إليها الرحلات.
 * القائمة الأولية مبنية على الوجهات الأكثر تكرارًا في إحصائيات 11-07-2026 إلى 23-08-2026.
 * كل الإحداثيات مؤكدة من خرائط جوجل (رمز Plus Code بجانب كل مستشفى)، ويستطيع المدير تعديلها من لوحة السيارات.
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

/** مجمع الثمامة: نقطة انطلاق الرحلات (Plus Code: 6HH9+FG الدوحة). */
export const ORIGIN = { name: "مجمع الثمامة", lat: 25.228688, lng: 51.568813 };

/** مركز خريطة الدوحة وما حولها. */
export const DOHA_CENTER = { lat: 25.27, lng: 51.5, zoom: 11 };

const HMC = "مدينة حمد الطبية";

// verified: true = إحداثيات من مصدر موثق (خرائط/رموز Plus Code للمبنى نفسه).
// verified: false = تقدير داخل الحي أو الحرم الطبي، ويُصحَّح من «دليل المستشفيات» بالنقر على الخريطة (لا يوجد حاليًا).
export const DEFAULT_HOSPITALS: Hospital[] = [
  { id: "wakra", name: "مستشفى الوكرة", nameEn: "Al Wakra Hospital", zone: "الوكرة", lat: 25.166902, lng: 51.587844, aliases: ["الوكره", "wakra"], verified: true },
  { id: "sidra", name: "مستشفى سدرة", nameEn: "Sidra Medicine", zone: "المدينة التعليمية", lat: 25.323187, lng: 51.445562, aliases: ["سدره", "سيدرا", "sidra"], verified: true }, // 8CFW+76 الريان
  { id: "thumama-hc", name: "مركز الثمامة الصحي", nameEn: "Al Thumama Health Center", zone: "الثمامة وروضة الخيل", lat: 25.232313, lng: 51.560813, aliases: ["مركز الثمامه", "مستشفي الثمامه", "الصحي الثمامه", "thumama"], verified: true }, // 6HJ6+W8 الدوحة
  { id: "rawdat-alkhail", name: "مركز روضة الخيل الصحي", nameEn: "Rawdat Al Khail Health Center", zone: "الثمامة وروضة الخيل", lat: 25.275312, lng: 51.518938, aliases: ["روضه الخيل", "rawdat"], verified: true }, // 7GG9+4H الدوحة
  { id: "cuban", name: "المستشفى الكوبي", nameEn: "The Cuban Hospital", zone: "دخان", lat: 25.43853, lng: 50.85839, aliases: ["الكوبي", "cuban"], verified: true },
  { id: "hgh", name: "مستشفى حمد العام", nameEn: "Hamad General Hospital", zone: HMC, lat: 25.294196, lng: 51.502853, aliases: ["حمد العام", "hamad general"], verified: true },
  { id: "surgical", name: "المركز التخصصي للجراحة", nameEn: "Surgical Specialty Center", zone: HMC, lat: 25.293363, lng: 51.500547, aliases: ["حمد التخصصي", "التخصصي", "surgical", "specalist", "specilaty"], verified: true },
  { id: "qri", name: "مركز قطر لإعادة التأهيل", nameEn: "Qatar Rehabilitation Institute", zone: HMC, lat: 25.293937, lng: 51.508437, aliases: ["اعاده التاهيل", "حمد التاهيلي", "التاهيل", "rehabilitation", "qri hamad", "hamad bin khalifa", "hamadbin khalifa", "حمد بن خليفه", "مدينه حمد الطبيه", "hamad medical city", "qri"], verified: true }, // 7GV5+H9 الدوحة
  { id: "qri-bin-omran", name: "العلاج الطبيعي بن عمران", nameEn: "Physiotherapy Bin Omran", zone: HMC, lat: 25.299313, lng: 51.499859, aliases: ["بن عمران", "bin omran"], verified: true },
  { id: "acc", name: "مركز الرعاية المتنقلة", nameEn: "Ambulatory Care Center", zone: HMC, lat: 25.298188, lng: 51.506859, aliases: ["الرعايه المتنقله", "ambulatory", "amulatory"], verified: true }, // 7GX4+7PH الدوحة
  { id: "wwrc", name: "مركز صحة المرأة والأبحاث", nameEn: "Women's Wellness and Research Center", zone: HMC, lat: 25.295137, lng: 51.506203, aliases: ["المراه والابحاث", "women"], verified: true }, // 7GW4+3F4 الدوحة
  { id: "bone-joint", name: "مركز العظام والمفاصل", nameEn: "Bone and Joint Center", zone: HMC, lat: 25.285262, lng: 51.543578, aliases: ["العظام والمفاصل", "bone and joint", "bone joint"], verified: true }, // 7GPV+4C4 الدوحة
  { id: "heart", name: "مستشفى القلب", nameEn: "Heart Hospital", zone: HMC, lat: 25.292013, lng: 51.509828, aliases: ["مستشفي القلب", "heart hospital"], verified: true }, // 7GR5+RW4 الدوحة
  { id: "kidney", name: "مركز فهد بن جاسم للكلى", nameEn: "Fahad Bin Jassim Kidney Center", zone: HMC, lat: 25.295237, lng: 51.496453, aliases: ["للكلي", "kidney"], verified: true }, // 7FWW+3HW الدوحة
  { id: "mcrc", name: "مركز الرعاية الطبية والأبحاث", nameEn: "Medical Care and Research Center", zone: HMC, lat: 25.294313, lng: 51.507937, aliases: ["الرعايه الطبيه والابحاث", "medical care and research"], verified: true }, // 7GV5+P5 الدوحة
  { id: "cdc", name: "المركز الوطني للأمراض الانتقالية", nameEn: "Communicable Disease Center", zone: HMC, lat: 25.291562, lng: 51.507937, aliases: ["communicable disease", "الامراض الانتقاليه"], verified: true }, // 7GR5+J5 الدوحة
  { id: "amal", name: "المركز الوطني لعلاج وأبحاث السرطان (الأمل)", nameEn: "National Center for Cancer Care and Research", zone: HMC, lat: 25.292813, lng: 51.511078, aliases: ["الامل", "علاج السرطان", "al amal", "cancer care"], verified: true },
  { id: "rumailah", name: "مستشفى الرميلة", nameEn: "Rumailah Hospital", zone: HMC, lat: 25.292887, lng: 51.512578, aliases: ["الرميله", "رميله", "rumailah", "rumaila hospital"], verified: true },
  { id: "aisha-attiyah", name: "مستشفى عائشة بنت حمد العطية", nameEn: "Aisha Bint Hamad Al Attiyah Hospital", zone: "الشمال (الخور)", lat: 25.607062, lng: 51.462437, aliases: ["عائشه بنت حمد", "aisha bint hamad"], verified: true }, // JF46+RX تنباك
  { id: "alkhor", name: "مستشفى الخور", nameEn: "Al Khor Hospital", zone: "الشمال (الخور)", lat: 25.715937, lng: 51.516062, aliases: ["الخور", "al khor hospital"], verified: true }, // PG88+9C الذخيرة
  { id: "hazm-mebaireek", name: "مستشفى حزم مبيريك العام", nameEn: "Hazm Mebaireek General Hospital", zone: "المنطقة الصناعية", lat: 25.18089, lng: 51.4307, aliases: ["حزم مبيريك", "hazm mebaireek"], verified: true },
  { id: "mesaieed", name: "مستشفى مسيعيد", nameEn: "Mesaieed Hospital", zone: "مسيعيد", lat: 25.013462, lng: 51.559984, aliases: ["مسيعيد", "mesaieed", "meissaid"], verified: true },
  { id: "pearl-dental", name: "مركز اللؤلؤة للأسنان", nameEn: "Pearl Dental Center", zone: "الدوحة", lat: 25.315137, lng: 51.472453, aliases: ["اللؤلؤه للاسنان", "مركز اللؤلؤه", "pearl dental", "peral dental", "al luluah dental", "pearl hospital"], verified: true }, // 8F8C+3X4 الدوحة
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

/**
 * يحدّث المستشفيات المحفوظة التي لم يؤكد المدير موقعها بإحداثيات الدليل الحالي،
 * مع الإبقاء على الأسماء البديلة التي أضافها. ما عدّله المدير (verified) لا يتغير.
 */
export function syncHospitals(stored: Hospital[], defaults: Hospital[] = DEFAULT_HOSPITALS) {
  const byId = new Map(defaults.map((hospital) => [hospital.id, hospital]));
  return stored.map((hospital) => {
    const fresh = byId.get(hospital.id);
    if (hospital.verified || !fresh) return hospital;
    return { ...fresh, aliases: Array.from(new Set([...fresh.aliases, ...hospital.aliases])) };
  });
}
