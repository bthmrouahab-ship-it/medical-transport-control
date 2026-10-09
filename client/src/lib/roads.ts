import { useEffect, useMemo } from "react";
import { ORIGIN } from "@shared/hospitals";
import { NON_MEDICAL_DESTINATIONS } from "@shared/transport";
import { fetchRoadMatrix, roadKey, setRoadMatrix, type RoadMatrix, type RoadPoint } from "@shared/roads";
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
