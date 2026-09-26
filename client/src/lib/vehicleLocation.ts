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

export type ActiveTrip = { id: string; hospitalId: string; plate?: string; label: string };

/** حالة إشارة GPS حسب عمر آخر تحديث. */
export function locationFreshness(location: VehicleLocation, now = Date.now()) {
  const ageMinutes = (now - new Date(location.updatedAt).getTime()) / 60000;
  if (location.sharing && ageMinutes <= 2) return { state: "live" as const, label: "مباشر", color: "#1baf7a", ageMinutes };
  if (location.sharing && ageMinutes <= 15) return { state: "stale" as const, label: `منذ ${Math.round(ageMinutes)} د`, color: "#eda100", ageMinutes };
  return { state: "offline" as const, label: "غير متصل", color: "#8a8983", ageMinutes };
}
