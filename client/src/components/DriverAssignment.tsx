import { useMemo, useState } from "react";
import { CheckCircle2, Search, UserCog } from "lucide-react";
import { assignDrivers, type Driver } from "@shared/drivers";
import { localDateString, type Vehicle } from "@shared/transport";
import { KindIcon, KindLabel } from "./VehiclePicker";
import { Modal, btn, cx, inputClass, stamp, timeLabel } from "./ui-kit";

/** منذ متى يقود السائق السيارة: الساعة اليوم، وإلا التاريخ والساعة */
function sinceText(iso: string | undefined, now: Date) {
  const since = iso ? new Date(iso) : null;
  if (!since || Number.isNaN(since.getTime())) return "";
  return localDateString(since) === localDateString(now) ? timeLabel(since) : stamp(since);
}

/**
 * تخصيص السائقين للسيارات (مشرف السيارات في بداية الشفت): لكل سيارة سائقها من قائمة السائقين أو «بلا سائق».
 * يبقى آخر تخصيص محفوظًا، فيغيّر المشرف ما تغيّر فقط. اختيار سائق في سيارة أخرى ينقله منها (تبقى بلا سائق
 * ما لم يُختر لها غيره)، والحفظ دفعة واحدة. السيارة بلا سائق لا تُرسل في الرحلات.
 */
export default function DriverAssignment({ vehicles, drivers, busy, initialQuery = "", onSave, onClose }: {
  vehicles: Vehicle[];
  drivers: Driver[];
  /** السيارات في رحلة جارية الآن */
  busy: (plate: string) => boolean;
  initialQuery?: string;
  onSave: (next: Vehicle[]) => void;
  onClose: () => void;
}) {
  const [assignments, setAssignments] = useState<Map<string, string | null>>(() => new Map());
  const [query, setQuery] = useState(initialQuery);
  const now = useMemo(() => new Date(), []);
  const draft = useMemo(() => assignDrivers(vehicles, drivers, assignments, now), [vehicles, drivers, assignments, now]);
  const original = useMemo(() => new Map(vehicles.map((vehicle) => [vehicle.plate, vehicle.driverId ?? null])), [vehicles]);
  const plateOf = new Map(draft.flatMap((vehicle) => (vehicle.driverId ? [[vehicle.driverId, vehicle.plate] as const] : [])));
  const changed = draft.filter((vehicle) => (vehicle.driverId ?? null) !== original.get(vehicle.plate));
  const withoutDriver = draft.filter((vehicle) => !vehicle.driverId);
  const freeDrivers = drivers.filter((driver) => !plateOf.has(driver.id));
  const byName = useMemo(() => [...drivers].sort((a, b) => a.name.localeCompare(b.name, "ar")), [drivers]);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = draft.filter((vehicle) => words.every((word) => `${vehicle.plate} ${vehicle.kind} ${vehicle.driver}`.toLowerCase().includes(word)));

  function choose(plate: string, driverId: string) {
    setAssignments((current) => new Map(current).set(plate, driverId || null));
  }

  function save() {
    const onTrip = changed.filter((vehicle) => busy(vehicle.plate)).map((vehicle) => vehicle.plate);
    if (onTrip.length && !window.confirm(`${onTrip.length === 1 ? "السيارة" : "السيارات"} ${onTrip.join("، ")} في رحلة جارية الآن. تغيير السائق رغم ذلك؟`)) return;
    onSave(assignDrivers(vehicles, drivers, assignments, new Date()));
  }

  return (
    <Modal
      tone="blue"
      icon={UserCog}
      title="السائقون في السيارات"
      description="اختر سائق كل سيارة في بداية الشفت. يبقى آخر تخصيص محفوظًا، فغيّر ما تغيّر فقط."
      onClose={onClose}
      footer={(
        <>
          <p className="me-auto self-center text-xs text-slate-500">
            {changed.length ? `${changed.length === 1 ? "سيارة واحدة" : `${changed.length} سيارات`} تغيّر سائقها` : "لا تغيير بعد"}
          </p>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="button" disabled={!changed.length} onClick={save} className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> حفظ السائقين</button>
        </>
      )}
    >
      <label className="relative block">
        <span className="sr-only">بحث في السيارات</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث: رقم السيارة أو اسم السائق..." className={cx(inputClass, "h-10 ps-9")} />
      </label>
      <p className="mt-3 text-xs leading-5 text-slate-500">
        {withoutDriver.length ? <span className="font-medium text-amber-700">{withoutDriver.length === 1 ? "سيارة واحدة" : `${withoutDriver.length} سيارات`} بلا سائق (لا تُرسل في الرحلات)</span> : "كل السيارات لها سائق"}
        {" · "}
        {freeDrivers.length ? `سائقون بلا سيارة: ${freeDrivers.map((driver) => driver.name).join("، ")}` : "كل السائقين في سيارات"}
      </p>
      {!drivers.length && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">لا يوجد سائقون في القائمة بعد. يضيفهم مدير النظام من تبويب «السائقون».</p>}

      <ul className="mt-3 divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200" aria-label="السيارات وسائقوها">
        {shown.map((vehicle) => {
          const isChanged = (vehicle.driverId ?? null) !== original.get(vehicle.plate);
          const since = !isChanged ? sinceText(vehicle.driverSince, now) : "";
          const status = isChanged
            ? (vehicle.driverId ? { tone: "text-blue-700", text: "سائق جديد" } : { tone: "text-amber-700", text: "ستبقى بلا سائق" })
            : vehicle.driverId ? { tone: "text-slate-500", text: since ? `يقودها منذ ${since}` : "يقودها الآن" } : { tone: "text-amber-700", text: "بلا سائق" };
          return (
            <li key={vehicle.plate} className={cx("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,200px)]", isChanged && "bg-blue-50/60")}>
              <KindIcon vehicle={vehicle} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink"><span dir="ltr" className="font-semibold tabular">{vehicle.plate}</span> · <KindLabel vehicle={vehicle} /></p>
                <p className={cx("text-xs leading-5", status.tone)}>{status.text}{busy(vehicle.plate) ? " · في رحلة جارية" : ""}</p>
              </div>
              <select
                aria-label={`سائق السيارة ${vehicle.plate}`}
                value={vehicle.driverId ?? ""}
                onChange={(event) => choose(vehicle.plate, event.target.value)}
                className={cx(inputClass, "col-span-2 h-10 sm:col-span-1", !vehicle.driverId && "bg-amber-50 text-amber-900")}
              >
                <option value="">بلا سائق</option>
                {byName.map((driver) => {
                  const elsewhere = plateOf.get(driver.id);
                  return <option key={driver.id} value={driver.id}>{driver.name}{elsewhere && elsewhere !== vehicle.plate ? ` · في ${elsewhere}` : ""}</option>;
                })}
              </select>
            </li>
          );
        })}
        {!shown.length && <li className="p-6 text-center text-sm text-slate-400">لا توجد سيارات مطابقة</li>}
      </ul>
    </Modal>
  );
}
