import { useState } from "react";
import { CheckCircle2, CirclePlus } from "lucide-react";
import { VEHICLE_KINDS, validateVehicle, type Vehicle, type VehicleKind } from "@shared/transport";
import type { Driver } from "@shared/drivers";
import { KindIcon } from "./VehiclePicker";
import { Modal, btn, choiceClass, cx, inputClass, labelClass } from "./ui-kit";

/**
 * إضافة سيارة جديدة (مشرف السيارات): رقم غير مسجل في السيارات، ونوعها، وسائقها اختياري (السائق في سيارة أخرى
 * ينتقل منها). السيارة الجديدة متاحة للخدمة، ويستطيع المشرف إيقافها من القائمة؛ وحذف السيارات للمدير وحده.
 */
export default function AddVehicleDialog({ vehicles, drivers, onSave, onClose }: {
  vehicles: Vehicle[];
  drivers: Driver[];
  onSave: (vehicle: Pick<Vehicle, "plate" | "kind">, driverId: string | null) => void;
  onClose: () => void;
}) {
  const [plate, setPlate] = useState("");
  const [kind, setKind] = useState<VehicleKind>("سيدان");
  const [driverId, setDriverId] = useState("");
  const result = validateVehicle({ plate, kind }, vehicles);
  // الخطأ يظهر بعد كتابة الرقم (الرقم المسجل مسبقًا فورًا)
  const error = plate.trim() && "error" in result ? result.error : null;
  const carOf = new Map(vehicles.flatMap((vehicle) => (vehicle.driverId ? [[vehicle.driverId, vehicle.plate] as const] : [])));
  // السائقون بلا سيارة أولًا، ثم بالاسم
  const choices = [...drivers].sort((a, b) => Number(carOf.has(a.id)) - Number(carOf.has(b.id)) || a.name.localeCompare(b.name, "ar"));
  const moving = driverId ? carOf.get(driverId) : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if ("error" in result) return;
    onSave(result.vehicle, driverId || null);
  }

  return (
    <Modal
      tone="green"
      icon={CirclePlus}
      title="إضافة سيارة"
      description="برقم غير مسجل في السيارات. تُضاف متاحة للخدمة، ويمكن إيقافها من القائمة."
      onClose={onClose}
      footer={(
        <>
          <button type="button" onClick={onClose} className={btn("secondary")}>إلغاء</button>
          <button type="submit" form="add-vehicle" disabled={"error" in result} className={btn("primary")}><CheckCircle2 className="h-4 w-4" /> إضافة السيارة</button>
        </>
      )}
    >
      <form id="add-vehicle" onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className={labelClass}>رقم السيارة</span>
          <input
            autoFocus
            dir="ltr"
            inputMode="numeric"
            value={plate}
            onChange={(event) => setPlate(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="add-vehicle-error"
            placeholder="مثل 123456"
            className={cx(inputClass, "tabular", error && "ring-2 ring-red-300")}
          />
          <span id="add-vehicle-error" role="status" className={cx("mt-1 block text-xs", error ? "font-medium text-red-700" : "text-slate-500")}>
            {error ?? "من 2 إلى 12 رقمًا أو حرفًا إنجليزيًا"}
          </span>
        </label>

        <fieldset>
          <legend className={labelClass}>النوع</legend>
          <div className="grid grid-cols-3 gap-2">
            {VEHICLE_KINDS.map((item) => (
              <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)} className={cx(choiceClass(kind === item), "justify-center px-2 text-center")}>
                <KindIcon vehicle={{ kind: item }} size="sm" /> {item}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className={labelClass}>السائق (اختياري)</span>
          <select value={driverId} onChange={(event) => setDriverId(event.target.value)} className={inputClass}>
            <option value="">بلا سائق (لا تُرسل حتى تختار سائقها)</option>
            {choices.map((driver) => (
              <option key={driver.id} value={driver.id}>{driver.name}{carOf.has(driver.id) ? ` · في السيارة ${carOf.get(driver.id)}` : " · بلا سيارة"}</option>
            ))}
          </select>
          {moving && <span className="mt-1 block text-xs text-amber-800">ينتقل السائق من السيارة {moving} فتبقى بلا سائق</span>}
        </label>
      </form>
    </Modal>
  );
}
