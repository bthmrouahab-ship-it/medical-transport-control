import { useEffect, useState } from "react";
import { Satellite } from "lucide-react";
import type { Vehicle } from "@shared/transport";
import { api } from "@/lib/api";
import { ageText } from "@/lib/vehicleLocation";
import { Badge, Panel } from "./ui-kit";

/** رد tracker-status: آخر سؤال لخدمة التتبع، والسيارات التي وصل موقعها، وأرقام الجهاز التي لا تطابق سيارة. */
type TrackerStatusResponse = {
  configured: boolean;
  ok?: boolean | null;
  error?: string | null;
  checkedAt?: string | null;
  received?: number;
  matched?: Record<string, string>;
  unmatched?: Record<string, string>;
};

const REFRESH_MS = 30_000;
const minutesSince = (iso?: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 60000 : Number.NaN);

/**
 * حالة الربط بجهاز التتبع في السيارات (للمدير، فوق قائمة السيارات): هل يصل الخادم إلى خدمة التتبع،
 * وأي سيارات يصل موقعها منها، وأرقام في الخدمة لا تطابق سيارة في القائمة. لا يظهر قبل ضبط المفتاح.
 */
export function TrackerStatus({ vehicles }: { vehicles: Vehicle[] }) {
  const [status, setStatus] = useState<TrackerStatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api<TrackerStatusResponse>("tracker-status").then((data) => { if (alive) setStatus(data); }).catch(() => {});
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!status?.configured) return null;
  const matched = status.matched ?? {};
  const unmatched = Object.keys(status.unmatched ?? {});
  const withTracker = vehicles.filter((vehicle) => matched[vehicle.plate]);
  const without = vehicles.filter((vehicle) => !matched[vehicle.plate]);
  const checkedAgo = minutesSince(status.checkedAt);
  // يُسأل كل 15 ثانية ما دامت صفحة مفتوحة أو cron يعمل
  const idle = !(checkedAgo <= 5);
  const tone = status.ok === false ? "red" : idle ? "amber" : "green";

  return (
    <Panel
      icon={Satellite}
      tone={tone}
      title="جهاز التتبع في السيارات"
      description={status.ok === false
        ? status.error ?? "تعذر الاتصال بخدمة التتبع"
        : status.checkedAt
          ? `آخر اتصال بخدمة التتبع ${ageText(checkedAgo)}${idle ? " · لم يُسأل منذ مدة: تأكد من تشغيل cron في hPanel" : ""}`
          : "لم يتصل الخادم بخدمة التتبع بعد"}
      count={withTracker.length || undefined}
      className="mb-6"
    >
      <div className="grid gap-4 p-5 text-sm">
        <div>
          <p className="mb-2 font-semibold text-ink">يصل موقعها من الجهاز ({withTracker.length} من {vehicles.length})</p>
          {withTracker.length ? (
            <div className="flex flex-wrap gap-1.5">
              {withTracker.map((vehicle) => <Badge key={vehicle.plate} tone="green"><span dir="ltr" className="tabular">{vehicle.plate}</span></Badge>)}
            </div>
          ) : <p className="text-slate-500">لم يصل بعد موقع أي سيارة من القائمة.</p>}
        </div>
        {without.length > 0 && (
          <div>
            <p className="mb-2 font-semibold text-ink">بلا موقع من الجهاز ({without.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {without.map((vehicle) => <Badge key={vehicle.plate}><span dir="ltr" className="tabular">{vehicle.plate}</span></Badge>)}
            </div>
          </div>
        )}
        {unmatched.length > 0 && (
          <div>
            <p className="mb-1 font-semibold text-amber-800">أرقام في خدمة التتبع لا تطابق سيارة في القائمة ({unmatched.length})</p>
            <p className="mb-2 text-xs text-slate-500">إن كانت سيارة من سياراتنا برقم مكتوب بطريقة أخرى، صحّح رقمها هنا ليطابق رقمها في خدمة التتبع.</p>
            <div className="flex flex-wrap gap-1.5">
              {unmatched.map((number) => <Badge key={number} tone="amber"><span dir="ltr" className="tabular">{number}</span></Badge>)}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
