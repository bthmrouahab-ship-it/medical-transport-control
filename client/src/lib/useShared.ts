import { useEffect, useMemo, useState } from "react";
import { DEFAULT_HOSPITALS, type Hospital } from "@shared/hospitals";
import { loadState, subscribeState, type SharedKey } from "./appStore";
import { locationFreshness, type VehicleLocation } from "./vehicleLocation";

/** قيمة مشتركة من قاعدة البيانات تتحدث تلقائيًا عند تغييرها من مستخدم آخر. */
export function useSharedState<T>(key: SharedKey, fallback: T): T {
  const [value, setValue] = useState<T>(() => loadState(key, fallback));
  useEffect(() => {
    const refresh = () => setValue(loadState(key, fallback));
    const stop = subscribeState((changed) => {
      if (changed === key) refresh();
    });
    // تغيير وصل بين أول عرض للصفحة وبدء الاشتراك
    refresh();
    return stop;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

/** دليل المستشفيات: من قاعدة البيانات إن حفظه المدير، وإلا القائمة الأولية. */
export function useHospitals(): Hospital[] {
  const hospitals = useSharedState<Hospital[]>("fox_hospitals", DEFAULT_HOSPITALS);
  return hospitals.length ? hospitals : DEFAULT_HOSPITALS;
}

/** الوقت الحالي، يتحدث كل فترة حتى تُغلق مهلة الطلب تلقائيًا على الشاشة. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** السيارات التي يصل موقعها مباشرة الآن من هاتف السائق، حسب رقم اللوحة (ومعها اسم السائق الذي يقودها). */
export function useLiveVehicles(now: Date) {
  const locations = useSharedState<VehicleLocation[]>("fox_locations", []);
  return useMemo(() => new Map(locations
    .filter((location) => locationFreshness(location, now.getTime()).state === "live")
    .map((location) => [location.plate, location])), [locations, now]);
}
