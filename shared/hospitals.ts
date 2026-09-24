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

const HMC = "مدينة حمد الطبية";

// verified: true = إحداثيات من مصدر موثق (خرائط/رموز Plus Code للمبنى نفسه).
// verified: false = تقدير داخل الحي أو الحرم الطبي، ويُصحَّح من «دليل المستشفيات» بالنقر على الخريطة.
export const DEFAULT_HOSPITALS: Hospital[] = [
  { id: "wakra", name: "مستشفى الوكرة", nameEn: "Al Wakra Hospital", zone: "الوكرة", lat: 25.166902, lng: 51.587844, aliases: ["الوكره", "wakra"], verified: true },
  { id: "sidra", name: "مستشفى سدرة", nameEn: "Sidra Medicine", zone: "المدينة التعليمية", lat: 25.3176, lng: 51.4403, aliases: ["سدره", "سيدرا", "sidra"], verified: false },
  { id: "thumama-hc", name: "مركز الثمامة الصحي", nameEn: "Al Thumama Health Center", zone: "الثمامة وروضة الخيل", lat: 25.2336, lng: 51.5462, aliases: ["مركز الثمامه", "مستشفي الثمامه", "الصحي الثمامه", "thumama"], verified: false },
  { id: "rawdat-alkhail", name: "مركز روضة الخيل الصحي", nameEn: "Rawdat Al Khail Health Center", zone: "الثمامة وروضة الخيل", lat: 25.2712, lng: 51.5213, aliases: ["روضه الخيل", "rawdat"], verified: false },
  { id: "cuban", name: "المستشفى الكوبي", nameEn: "The Cuban Hospital", zone: "دخان", lat: 25.43853, lng: 50.85839, aliases: ["الكوبي", "cuban"], verified: true },
  { id: "hgh", name: "مستشفى حمد العام", nameEn: "Hamad General Hospital", zone: HMC, lat: 25.294196, lng: 51.502853, aliases: ["حمد العام", "hamad general"], verified: true },
  { id: "surgical", name: "المركز التخصصي للجراحة", nameEn: "Surgical Specialty Center", zone: HMC, lat: 25.293363, lng: 51.500547, aliases: ["حمد التخصصي", "التخصصي", "surgical", "specalist", "specilaty"], verified: true },
  { id: "qri", name: "مركز قطر لإعادة التأهيل", nameEn: "Qatar Rehabilitation Institute", zone: HMC, lat: 25.2958, lng: 51.4988, aliases: ["اعاده التاهيل", "حمد التاهيلي", "التاهيل", "rehabilitation", "qri hamad", "hamad bin khalifa", "hamadbin khalifa", "حمد بن خليفه", "مدينه حمد الطبيه", "hamad medical city", "qri"], verified: false },
  { id: "qri-bin-omran", name: "العلاج الطبيعي بن عمران", nameEn: "Physiotherapy Bin Omran", zone: HMC, lat: 25.299313, lng: 51.499859, aliases: ["بن عمران", "bin omran"], verified: true },
  { id: "acc", name: "مركز الرعاية المتنقلة", nameEn: "Ambulatory Care Center", zone: HMC, lat: 25.2948, lng: 51.4982, aliases: ["الرعايه المتنقله", "ambulatory", "amulatory"], verified: false },
  { id: "wwrc", name: "مركز صحة المرأة والأبحاث", nameEn: "Women's Wellness and Research Center", zone: HMC, lat: 25.2963, lng: 51.4995, aliases: ["المراه والابحاث", "women"], verified: false },
  { id: "bone-joint", name: "مركز العظام والمفاصل", nameEn: "Bone and Joint Center", zone: HMC, lat: 25.2921, lng: 51.5046, aliases: ["العظام والمفاصل", "bone and joint", "bone joint"], verified: false },
  { id: "heart", name: "مستشفى القلب", nameEn: "Heart Hospital", zone: HMC, lat: 25.2931, lng: 51.5049, aliases: ["مستشفي القلب", "heart hospital"], verified: false },
  { id: "kidney", name: "مركز فهد بن جاسم للكلى", nameEn: "Fahad Bin Jassim Kidney Center", zone: HMC, lat: 25.2911, lng: 51.5063, aliases: ["للكلي", "kidney"], verified: false },
  { id: "mcrc", name: "مركز الرعاية الطبية والأبحاث", nameEn: "Medical Care and Research Center", zone: HMC, lat: 25.2917, lng: 51.5031, aliases: ["الرعايه الطبيه والابحاث", "medical care and research"], verified: false },
  { id: "cdc", name: "المركز الوطني للأمراض الانتقالية", nameEn: "Communicable Disease Center", zone: HMC, lat: 25.2925, lng: 51.5088, aliases: ["communicable disease", "الامراض الانتقاليه"], verified: false },
  { id: "amal", name: "المركز الوطني لعلاج وأبحاث السرطان (الأمل)", nameEn: "National Center for Cancer Care and Research", zone: HMC, lat: 25.292813, lng: 51.511078, aliases: ["الامل", "علاج السرطان", "al amal", "cancer care"], verified: true },
  { id: "rumailah", name: "مستشفى الرميلة", nameEn: "Rumailah Hospital", zone: HMC, lat: 25.292887, lng: 51.512578, aliases: ["الرميله", "رميله", "rumailah", "rumaila hospital"], verified: true },
  { id: "aisha-attiyah", name: "مستشفى عائشة بنت حمد العطية", nameEn: "Aisha Bint Hamad Al Attiyah Hospital", zone: "الشمال (الخور)", lat: 25.606499, lng: 51.4935, aliases: ["عائشه بنت حمد", "aisha bint hamad"], verified: false },
  { id: "alkhor", name: "مستشفى الخور", nameEn: "Al Khor Hospital", zone: "الشمال (الخور)", lat: 25.6839, lng: 51.5058, aliases: ["الخور", "al khor hospital"], verified: false },
  { id: "hazm-mebaireek", name: "مستشفى حزم مبيريك العام", nameEn: "Hazm Mebaireek General Hospital", zone: "المنطقة الصناعية", lat: 25.18089, lng: 51.4307, aliases: ["حزم مبيريك", "hazm mebaireek"], verified: true },
  { id: "mesaieed", name: "مستشفى مسيعيد", nameEn: "Mesaieed Hospital", zone: "مسيعيد", lat: 25.013462, lng: 51.559984, aliases: ["مسيعيد", "mesaieed", "meissaid"], verified: true },
  { id: "pearl-dental", name: "مركز اللؤلؤة للأسنان", nameEn: "Pearl Dental Center", zone: "الثمامة وروضة الخيل", lat: 25.25, lng: 51.535, aliases: ["اللؤلؤه للاسنان", "مركز اللؤلؤه", "pearl dental", "peral dental", "al luluah dental", "pearl hospital"], verified: false },
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
