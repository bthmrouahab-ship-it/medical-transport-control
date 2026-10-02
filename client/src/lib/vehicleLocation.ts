export type VehicleLocation = {
  plate: string;
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  driver?: string;
  sharing?: boolean;
  updatedAt: string;
};

type Point = { lat: number; lng: number };

/** رحلة جارية على الخريطة: من نقطة الاستلام إلى الوجهة، ومرحلتها الآن. */
export type MapTrip = {
  id: string;
  plate?: string;
  phase: "toPickup" | "toDestination";
  from: Point | null;
  to: Point | null;
  label: string;
};

/** حالة إشارة GPS حسب عمر آخر تحديث. */
export function locationFreshness(location: VehicleLocation, now = Date.now()) {
  const ageMinutes = (now - new Date(location.updatedAt).getTime()) / 60000;
  if (location.sharing && ageMinutes <= 2) return { state: "live" as const, label: "مباشر", color: "#1baf7a", ageMinutes };
  if (location.sharing && ageMinutes <= 15) return { state: "stale" as const, label: `منذ ${Math.round(ageMinutes)} د`, color: "#eda100", ageMinutes };
  return { state: "offline" as const, label: "غير متصل", color: "#8a8983", ageMinutes };
}

/**
 * الخريطة تُخفي السائق الذي لم يصل موقعه منذ أكثر من 5 دقائق (غير متصل أو توقف موقعه)، فلا يزدحم بها
 * آخر موقع قديم. يظهر من جديد عند البحث عنه (اسم السائق أو رقم السيارة) أو اختياره من قائمة السيارات.
 */
export const MAP_HIDE_AFTER_MINUTES = 5;

export function hiddenOnMap(location: VehicleLocation, now = Date.now()) {
  return !(locationFreshness(location, now).ageMinutes <= MAP_HIDE_AFTER_MINUTES);
}

/** منذ متى وصل آخر موقع: «منذ 7 د»، «منذ 3 س»، «منذ يومين». */
export function ageText(minutes: number) {
  if (!Number.isFinite(minutes)) return "";
  const rounded = Math.max(0, Math.round(minutes));
  if (rounded < 1) return "منذ أقل من دقيقة";
  if (rounded < 60) return `منذ ${rounded} د`;
  const hours = Math.round(rounded / 60);
  if (hours < 24) return `منذ ${hours} س`;
  const days = Math.round(hours / 24);
  return days === 1 ? "منذ يوم" : days === 2 ? "منذ يومين" : days <= 10 ? `منذ ${days} أيام` : `منذ ${days} يومًا`;
}

/** ألوان الخريطة (نفسها في مفتاح الخريطة بلوحة السيارات). */
export const MAP_COLORS = { hospital: "#0e7490", origin: "#0b2545", toPickup: "#d97706", toDestination: "#2563eb" };
