import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Hospital } from "@shared/hospitals";
import type { ClinicAppointment } from "@shared/transport";
import { tripEndpoints, type Arrival } from "@shared/trips";

/** تنبيه الجهاز عند الوصول (يفعّله مشرف السيارات من صفحته، ويُحفظ على هذا الجهاز). */
export const NOTIFY_KEY = "fox_arrival_notify";
/** الوصولات التي ظهرت رسالتها في هذه الجلسة، حتى لا تتكرر عند التنقل بين التوزيع والخريطة. */
const SEEN_KEY = "fox_seen_arrivals";

function readSeen(): Set<string> | null {
  try {
    const stored = sessionStorage.getItem(SEEN_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : null;
  } catch {
    return null;
  }
}

function writeSeen(seen: Set<string>) {
  try {
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(seen).slice(-500)));
  } catch {
    /* التخزين غير متاح */
  }
}

export function deviceNotificationsOn() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === "on" && "Notification" in window && Notification.permission === "granted";
  } catch {
    return false;
  }
}

/**
 * رسالة لمشرف السيارات عند وصول سيارة إلى وجهتها: في الصفحة دائمًا، وعلى الجهاز إن فعّله والصفحة في الخلفية.
 * الوصولات الموجودة عند أول فتح للصفحة لا تظهر لها رسالة (تظهر في قائمة الوصول فقط).
 */
export function useArrivalAlerts({ arrivals, appointments, hospitals, driverOf, enabled = true }: {
  arrivals: Arrival[];
  appointments: ClinicAppointment[];
  hospitals: Hospital[];
  driverOf: (plate: string | undefined, fallback?: string) => string;
  enabled?: boolean;
}) {
  const seen = useRef<Set<string> | null>(null);
  const latest = useRef({ appointments, hospitals, driverOf });
  latest.current = { appointments, hospitals, driverOf };

  useEffect(() => {
    if (!enabled) return;
    if (!seen.current) {
      const stored = readSeen();
      seen.current = stored ?? new Set(arrivals.map((item) => item.request.id));
      if (!stored) {
        writeSeen(seen.current);
        return;
      }
    }
    const fresh = arrivals.filter((item) => !seen.current!.has(item.request.id));
    if (!fresh.length) return;
    fresh.forEach((item) => seen.current!.add(item.request.id));
    writeSeen(seen.current);

    const { appointments, hospitals, driverOf } = latest.current;
    const byPlate = new Map<string, Arrival[]>();
    for (const item of fresh) byPlate.set(item.request.vehiclePlate ?? "", [...(byPlate.get(item.request.vehiclePlate ?? "") ?? []), item]);
    for (const [plate, items] of Array.from(byPlate)) {
      const source = items[0].source;
      const destinations = Array.from(new Set(items.map((item) => {
        const appointment = appointments.find((entry) => entry.id === item.request.appointmentId);
        return appointment ? tripEndpoints(appointment, item.request.direction, hospitals).destination : "";
      }).filter(Boolean))).join("، ");
      const driver = driverOf(plate, items[0].request.driver);
      const title = source === "estimate" ? `انتهت المدة التقديرية لرحلة السيارة ${plate}` : `وصلت السيارة ${plate} إلى وجهتها`;
      const body = `${driver ? `السائق ${driver} · ` : ""}${destinations ? `${destinations} · ` : ""}السيارة متاحة الآن لرحلة جديدة${source === "gps" ? " (GPS)" : source === "estimate" ? " (بلا GPS)" : ""}`;
      toast.success(title, { description: body, duration: 15000 });
      if (document.hidden && deviceNotificationsOn()) {
        try {
          new Notification(title, { body, icon: "/favicon.svg", tag: `arrival-${plate}` });
        } catch {
          /* المتصفح لا يدعم التنبيه هنا */
        }
      }
    }
  }, [arrivals, enabled]);
}
