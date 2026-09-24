import { useEffect, useState } from "react";
import { DEFAULT_HOSPITALS, type Hospital } from "@shared/hospitals";
import { loadState, subscribeState, type SharedKey } from "./appStore";

/** قيمة مشتركة من قاعدة البيانات تتحدث تلقائيًا عند تغييرها من مستخدم آخر. */
export function useSharedState<T>(key: SharedKey, fallback: T): T {
  const [value, setValue] = useState<T>(() => loadState(key, fallback));
  useEffect(() => subscribeState((changed) => {
    if (changed === key) setValue(loadState(key, fallback));
  }), [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
