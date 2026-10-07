import { useEffect, useMemo, useState } from "react";
import { DEFAULT_HOSPITALS, type Hospital } from "@shared/hospitals";
import type { Guest, PrivateCar, SpecialNeed } from "@shared/guests";
import type { Driver } from "@shared/drivers";
import type { RoleSchedules } from "@shared/transport";
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

/** قائمة ضيوف المجمع (تصل للمدير والعيادة فقط، بلا العمر والرقم الصحي). */
export function useGuests(): Guest[] {
  return useSharedState<Guest[]>("fox_guests", []);
}

/** السيارات الخاصة (تصل للمدير فقط): ضيوف كل شقة فيها لا يُضاف لهم موعد. */
export function usePrivateCars(): PrivateCar[] {
  return useSharedState<PrivateCar[]>("fox_private_cars", []);
}

/** ذوو الاحتياجات الخاصة (تصل للمدير فقط): مستثنون من منع السيارات الخاصة. */
export function useSpecialNeeds(): SpecialNeed[] {
  return useSharedState<SpecialNeed[]>("fox_special_needs", []);
}

/** قائمة السائقين (تصل للمدير ومشرف السيارات): مستقلة عن السيارات. */
export function useDrivers(): Driver[] {
  return useSharedState<Driver[]>("fox_drivers", []);
}

/** أوقات سيارات المدارس وباص الجامعة المحفوظة (يعدّلها مشرف السيارات)، وما لم يُحفظ يأخذ الافتراضي (scheduleOf). */
export function useSchedules(): RoleSchedules | null {
  return useSharedState<RoleSchedules | null>("fox_schedules", null);
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
