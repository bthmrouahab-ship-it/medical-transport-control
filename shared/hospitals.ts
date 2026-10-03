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

/** حدود دولة قطر مع هامش صغير (من أبو سمرة جنوبًا إلى رأس ركن شمالًا): الخريطة لا تخرج عنها. */
export const QATAR_BOUNDS = { south: 24.4, west: 50.65, north: 26.25, east: 51.75 };

export const insideQatar = (point: { lat: number; lng: number }) =>
  point.lat >= QATAR_BOUNDS.south && point.lat <= QATAR_BOUNDS.north && point.lng >= QATAR_BOUNDS.west && point.lng <= QATAR_BOUNDS.east;

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
  { id: "mcrc", name: "مركز الرعاية الطبية والأبحاث", nameEn: "Medical Care and Research Center", zone: HMC, lat: 25.294313, lng: 51.507937, aliases: ["الرعايه الطبيه والابحاث", "medical care and research", "medical care research"], verified: true }, // 7GV5+P5 الدوحة
  { id: "cdc", name: "المركز الوطني للأمراض الانتقالية", nameEn: "Communicable Disease Center", zone: HMC, lat: 25.291562, lng: 51.507937, aliases: ["communicable disease", "الامراض الانتقاليه"], verified: true }, // 7GR5+J5 الدوحة
  { id: "amal", name: "المركز الوطني لعلاج وأبحاث السرطان (الأمل)", nameEn: "National Center for Cancer Care and Research", zone: HMC, lat: 25.292813, lng: 51.511078, aliases: ["الامل", "علاج السرطان", "al amal", "cancer care"], verified: true },
  { id: "rumailah", name: "مستشفى الرميلة", nameEn: "Rumailah Hospital", zone: HMC, lat: 25.292887, lng: 51.512578, aliases: ["الرميله", "رميله", "rumailah", "rumaila hospital"], verified: true },
  { id: "aisha-attiyah", name: "مستشفى عائشة بنت حمد العطية", nameEn: "Aisha Bint Hamad Al Attiyah Hospital", zone: "الشمال (الخور)", lat: 25.607062, lng: 51.462437, aliases: ["عائشه بنت حمد", "aisha bint hamad"], verified: true }, // JF46+RX تنباك
  { id: "alkhor", name: "مستشفى الخور", nameEn: "Al Khor Hospital", zone: "الشمال (الخور)", lat: 25.715937, lng: 51.516062, aliases: ["الخور", "al khor hospital"], verified: true }, // PG88+9C الذخيرة
  { id: "hazm-mebaireek", name: "مستشفى حزم مبيريك العام", nameEn: "Hazm Mebaireek General Hospital", zone: "المنطقة الصناعية", lat: 25.18089, lng: 51.4307, aliases: ["حزم مبيريك", "hazm mebaireek"], verified: true },
  { id: "mesaieed", name: "مستشفى مسيعيد", nameEn: "Mesaieed Hospital", zone: "مسيعيد", lat: 25.013462, lng: 51.559984, aliases: ["مسيعيد", "mesaieed", "meissaid"], verified: true },
  { id: "pearl-dental", name: "مركز اللؤلؤة للأسنان", nameEn: "Pearl Dental Center", zone: "الدوحة", lat: 25.315137, lng: 51.472453, aliases: ["اللؤلؤه للاسنان", "مركز اللؤلؤه", "pearl dental", "peral dental", "al luluah dental", "pearl hospital"], verified: true }, // 8F8C+3X4 الدوحة
  // مراكز أضافها المستخدم من خرائط جوجل (سبتمبر 2026)
  { id: "expert-dental", name: "مركز اكسبرت لطب الأسنان", nameEn: "Expert Dental Center", zone: "الدوحة", lat: 25.261813, lng: 51.533313, aliases: ["اكسبرت", "expert dental"], verified: true }, // 7G6M+P8 الدوحة
  { id: "gardenia", name: "مجمع غاردينيا الطبي", nameEn: "Gardenia Medical Complex", zone: "الدوحة", lat: 25.334062, lng: 51.475187, aliases: ["غاردينيا", "جاردينيا", "gardenia"], verified: true }, // 8FMG+J3 الدوحة
  { id: "psychiatric", name: "مستشفى الطب النفسي", nameEn: "Hamad Psychiatric Hospital", zone: "الثمامة وروضة الخيل", lat: 25.276313, lng: 51.516312, aliases: ["الطب النفسي", "psychiatric"], verified: true }, // 7GG8+GG الدوحة
  { id: "sama", name: "مركز سما ميديكال كير الطبي", nameEn: "Sama Medical Care", zone: "الدوحة", lat: 25.250812, lng: 51.485312, aliases: ["سما ميديكال", "sama medical"], verified: true }, // 7F2P+84 الدوحة
  // مراكز أضافها المستخدم من خرائط جوجل (أكتوبر 2026)
  { id: "shafallah", name: "مركز الشفلح للأشخاص ذوي الإعاقة", nameEn: "Al-Shafallah Center for Persons with Disabilities", zone: "لوسيل", lat: 25.392188, lng: 51.515937, aliases: ["الشفلح", "shafallah", "shafalah"], verified: true }, // 9GR8+V9 لوسيل
  { id: "iris-optic", name: "ايريس للنظارات", nameEn: "IRIS OPTIC", zone: "أم صلال", lat: 25.468063, lng: 51.402313, aliases: ["ايريس", "ايرس للنظارات", "iris optic", "iris optics"], verified: true }, // FC92+6W أم صلال علي
  { id: "al-jiwan", name: "روضة الجيوان للتدخل المبكر", nameEn: "Al Jiwan Kindergarten for Early Intervention", zone: "الدوحة", lat: 25.333437, lng: 51.477516, aliases: ["الجيوان", "jiwan"], verified: true }, // 8FMH+92C الدوحة
  { id: "the-view", name: "The View Hospital", nameEn: "The View Hospital", zone: "لوسيل", lat: 25.368062, lng: 51.525562, aliases: ["ذا فيو", "مستشفى ذا فيو", "the view", "view hospital"], verified: true }, // 9G9G+66 الدوحة
  { id: "al-aman", name: "مستشفى الأمان", nameEn: "Al Aman Hospital", zone: "الثمامة وروضة الخيل", lat: 25.232188, lng: 51.574813, aliases: ["مستشفى الامان", "al aman hospital", "aman hospital"], verified: true }, // 6HJF+VW الدوحة
  { id: "old-airport-hc", name: "مركز المطار القديم", nameEn: "Old Airport Health Center", zone: "الدوحة", lat: 25.256062, lng: 51.557937, aliases: ["مركز المطار القديم الصحي", "صحي المطار القديم", "old airport health"], verified: true }, // 7H45+C5 الدوحة
  { id: "pediatric-sadd", name: "طوارئ أطفال السد", nameEn: "Hamad Pediatric Emergency - Al Sadd", zone: "الدوحة", lat: 25.280688, lng: 51.506422, aliases: ["طوارئ اطفال السد", "طوارئ الاطفال السد", "طوارئ الاطفال بالسد", "pediatric emergency al sadd", "pediatric emergency sadd", "al sadd pediatric"], verified: true }, // 7GJ4+7HF الطريق الدائري الثالث، الدوحة
  { id: "al-ahli", name: "مستشفى الأهلي", nameEn: "Al Ahli Hospital", zone: "الدوحة", lat: 25.307562, lng: 51.499688, aliases: ["الاهلي", "al ahli", "ahli hospital"], verified: true }, // 8F5X+2V الدوحة
  { id: "wakra-hc", name: "مركز الوكرة الصحي", nameEn: "Al Wakra Health Center", zone: "الوكرة", lat: 25.173437, lng: 51.595562, aliases: ["مركز الوكره", "الوكره الصحي", "wakra health"], verified: true }, // 5HFW+96 الوكرة
  { id: "muaither-hc", name: "مركز معيذر الصحي", nameEn: "Muaither Health Center", zone: "الريان", lat: 25.234437, lng: 51.394812, aliases: ["معيذر", "muaither", "muaithar"], verified: true }, // 69MV+QW الريان
  { id: "wakra-dialysis", name: "مركز غسيل الكلى والعلاج الطبيعي", nameEn: "Haemodialysis and Physiotherapy Center", zone: "الوكرة", lat: 25.172663, lng: 51.595984, aliases: ["غسيل الكلى والعلاج الطبيعي", "غسيل الكلى بالوكرة", "غسيل الكلى الوكرة", "haemodalysis and physiotherapy", "hemodialysis and physiotherapy", "wakra dialysis", "wakra hemodialysis"], verified: true }, // 5HFW+399 الوكرة
  { id: "sparkle-dental", name: "سباركل لطب الأسنان", nameEn: "Sparkle Dental Center", zone: "الدوحة", lat: 25.372562, lng: 51.472437, aliases: ["سباركل", "سباركل للاسنان", "مركز سباركل", "sparkle dental", "sparkle"], verified: true }, // 9FFC+2X الدوحة
  { id: "wajbah-hc", name: "مركز الوجبة الصحي", nameEn: "Al Wajbah Health Center", zone: "الريان", lat: 25.282313, lng: 51.402313, aliases: ["الوجبة", "الوجبه", "مركز الوجبه", "صحي الوجبة", "wajbah", "al wajba", "wajba health"], verified: true }, // 7CJ2+WW الريان
  { id: "qatar-diabetes", name: "الجمعية القطرية للسكري", nameEn: "Qatar Diabetes Association", zone: "الثمامة وروضة الخيل", lat: 25.270562, lng: 51.517813, aliases: ["جمعية السكري", "الجمعية القطرية للسكر", "جمعية السكر", "qatar diabetes", "diabetes association"], verified: true }, // 7GC9+64 الدوحة
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
  const updated = stored.map((hospital) => {
    const fresh = byId.get(hospital.id);
    if (hospital.verified || !fresh) return hospital;
    return { ...fresh, aliases: Array.from(new Set([...fresh.aliases, ...hospital.aliases])) };
  });
  // المراكز التي أُضيفت إلى الدليل بعد حفظه في قاعدة البيانات، إلا إن كان المدير أضافها باسم آخر
  // (تطابق اسمها مع مستشفى من الدليل الأصلي، مثل «مركز الوكرة الصحي» مع «الوكرة»، لا يعني أنه أضافها)
  const ids = new Set(stored.map((hospital) => hospital.id));
  const known = new Set(defaults.map((hospital) => hospital.id));
  const addedByAdmin = (hospital: Hospital) => [hospital.name, hospital.nameEn].some((name) => {
    const match = matchHospital(name, stored);
    return Boolean(match && !known.has(match.id));
  });
  const added = defaults.filter((hospital) => ADDED_LATER.includes(hospital.id) && !ids.has(hospital.id) && !addedByAdmin(hospital));
  return [...updated, ...added];
}

/** مراكز أُضيفت إلى الدليل بعد إطلاق الموقع: تُضاف إلى الدليل المحفوظ عند دخول المدير. */
const ADDED_LATER = [
  "expert-dental", "gardenia", "psychiatric", "sama",
  "shafallah", "iris-optic", "al-jiwan", "the-view", "al-aman", "old-airport-hc", "pediatric-sadd", "al-ahli", "wakra-hc", "muaither-hc",
  "wakra-dialysis", "sparkle-dental", "wajbah-hc", "qatar-diabetes",
];
