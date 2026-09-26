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

/** ألوان الخريطة (نفسها في مفتاح الخريطة بلوحة السيارات). */
export const MAP_COLORS = { hospital: "#0e7490", origin: "#0f2742", toPickup: "#d97706", toDestination: "#2563eb" };
