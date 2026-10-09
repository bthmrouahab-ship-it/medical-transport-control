import { useEffect, useMemo, useState } from "react";
import { ORIGIN, distanceKm } from "@shared/hospitals";
import { NON_MEDICAL_DESTINATIONS } from "@shared/transport";
import { fetchRoadMatrix, fetchRoute, roadKey, setRoadMatrix, type RoadMatrix, type RoadPoint, type RoadRoute } from "@shared/roads";
import { saveState } from "./appStore";
import { useHospitals, useSharedState } from "./useShared";

/** الأماكن في جدول مسافات الطرق: المجمع، والمستشفيات في الدليل، ووجهات الرحلات غير الطبية ذات الموقع */
export function roadPoints(hospitals: { id: string; lat: number; lng: number }[]): RoadPoint[] {
  const points: RoadPoint[] = [{ id: "origin", lat: ORIGIN.lat, lng: ORIGIN.lng }];
  for (const hospital of hospitals) points.push({ id: hospital.id, lat: hospital.lat, lng: hospital.lng });
  for (const destination of NON_MEDICAL_DESTINATIONS) if (destination.place) points.push({ id: destination.place.id, lat: destination.place.lat, lng: destination.place.lng });
  const seen = new Set<string>();
  return points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && !seen.has(point.id) && seen.add(point.id));
}

let requested = "";

/**
 * يستعمل جدول مسافات الطرق المحفوظ (meta/roads) في جمع الرحلات، و(للمدير ومشرف السيارات: canUpdate) يعيد حسابه من خدمة الطرق
 * مرة واحدة إذا لم يُحسب بعد أو تغيّرت المستشفيات أو مواقعها. قبل حسابه (أو إن تعذر) تُقدَّر المسافة من الخط المستقيم.
 */
export function useRoadMatrix(canUpdate: boolean) {
  const stored = useSharedState<RoadMatrix | null>("fox_roads", null);
  const hospitals = useHospitals();
  // قبل عرض الصفحة: الجمع يقرأ الجدول من shared/roads
  useMemo(() => setRoadMatrix(stored), [stored]);
  const points = useMemo(() => roadPoints(hospitals), [hospitals]);
  const key = useMemo(() => roadKey(points), [points]);
  useEffect(() => {
    if (!canUpdate || stored?.key === key || requested === key) return;
    requested = key;
    fetchRoadMatrix(points)
      .then((matrix) => saveState("fox_roads", matrix, stored))
      .catch((error) => console.warn("[roads] تعذر حساب مسافات الطرق، تُقدَّر من الخط المستقيم", error));
  }, [canUpdate, key, points, stored]);
}

// ————— مسار الطريق للرحلات الجارية على الخريطة —————

type Point = { lat: number; lng: number };
/** جزء الطريق المرسوم: من السيارة (أو نقطة البداية) إلى المحطة التالية */
export type RouteLeg = { key: string; from: Point; to: Point };

/** يُعاد طلب المسار إذا ابتعدت السيارة عن بدايته هذه المسافة (وبعد دقيقة على الأقل من الطلب السابق) */
export const ROUTE_REFRESH_KM = 0.5;
const ROUTE_MIN_GAP_MS = 60000;
/** بعد تعذر الخدمة لا يُعاد الطلب قبل 5 دقائق (يُرسم خط مستقيم) */
const ROUTE_RETRY_MS = 5 * 60000;

type Cached = { from: Point; to: Point; at: number; route: RoadRoute | null; loading: boolean };
const routeCache = new Map<string, Cached>();

const samePoint = (a: Point, b: Point) => distanceKm(a, b) < 0.05;

/**
 * مسار الطريق الفعلي (OSRM) لكل جزء من الرحلات الجارية: يُطلب مرة لكل جزء، ويُعاد إذا ابتعدت السيارة عن بداية
 * المسار أو تغيّرت المحطة. يعيد المسارات المعروفة الآن (رقم الجزء ← المسار)؛ وما لم يُعرف بعد يُرسم خطًا مستقيمًا.
 */
export function useTripRoutes(legs: RouteLeg[]) {
  const [version, setVersion] = useState(0);
  const signature = legs.map((leg) => `${leg.key}@${leg.from.lat.toFixed(3)},${leg.from.lng.toFixed(3)}>${leg.to.lat.toFixed(4)},${leg.to.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    const now = Date.now();
    for (const leg of legs) {
      const cached = routeCache.get(leg.key);
      if (cached?.loading) continue;
      const stale = !cached || !samePoint(cached.to, leg.to)
        || (cached.route ? distanceKm(cached.from, leg.from) > ROUTE_REFRESH_KM && now - cached.at > ROUTE_MIN_GAP_MS : now - cached.at > ROUTE_RETRY_MS);
      if (!stale) continue;
      const entry: Cached = { from: leg.from, to: leg.to, at: now, route: cached && samePoint(cached.to, leg.to) ? cached.route : null, loading: true };
      routeCache.set(leg.key, entry);
      fetchRoute([leg.from, leg.to])
        .then((route) => { entry.route = route; })
        .catch((error) => { console.warn("[roads] تعذر رسم مسار الطريق، يُرسم خط مستقيم", error); })
        .finally(() => { entry.loading = false; entry.at = Date.now(); setVersion((value) => value + 1); });
    }
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => new Map(legs.flatMap((leg) => {
    const route = routeCache.get(leg.key)?.route;
    return route ? [[leg.key, route] as const] : [];
  })), [signature, version]); // eslint-disable-line react-hooks/exhaustive-deps
}
