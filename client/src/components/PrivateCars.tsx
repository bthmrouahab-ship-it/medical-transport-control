import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CarFront, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { hasSpecialNeeds, isNurse, normalizeUnit, planPrivateCars, unitKey, type Guest, type PrivateCar } from "@shared/guests";
import { saveState } from "@/lib/appStore";
import { api } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth";
import { Badge, EmptyState, Panel, btn, cx, inputClass } from "./ui-kit";

export type PrivateCarsPreview = { fileName: string; cars: Omit<PrivateCar, "id">[]; errors: string[] };

const byUnit = (a: Pick<PrivateCar, "buildingNumber" | "apartmentNumber">, b: Pick<PrivateCar, "buildingNumber" | "apartmentNumber">) =>
  a.buildingNumber.localeCompare(b.buildingNumber, "en", { numeric: true }) || a.apartmentNumber.localeCompare(b.apartmentNumber, "en", { numeric: true });

/**
 * مراجعة ملف السيارات الخاصة قبل الحفظ: عدد السيارات والشقق، وعدد الضيوف الذين يُمنعون (صاحب السيارة ومن يسكن معه)،
 * والشقق غير الموجودة في قائمة الضيوف. الحفظ يستبدل القائمة الحالية كلها (private-cars.import).
 */
export function PrivateCarsPreviewPanel({ preview, guests, current, onDone, onCancel }: {
  preview: PrivateCarsPreview;
  guests: Guest[];
  current: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const plan = useMemo(() => planPrivateCars(preview.cars, guests), [preview, guests]);

  async function save() {
    setSaving(true);
    try {
      const result = await api<{ cars: number; units: number; guests: number }>("private-cars.import", { entries: preview.cars });
      toast.success("حُفظت قائمة السيارات الخاصة", {
        description: `${result.cars} سيارة في ${result.units} شقة، ولا يُضاف موعد لـ ${result.guests} ضيفًا يسكنون فيها. يبقون في قائمة الضيوف.`,
        duration: 10000,
      });
      onDone();
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر حفظ قائمة السيارات الخاصة"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel tone="amber" icon={CarFront} title="مراجعة قائمة السيارات الخاصة قبل الحفظ" description={preview.fileName} className="mb-6" bodyClassName="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap gap-2">
        <Badge tone="neutral">{preview.cars.length.toLocaleString("en")} سيارة في الملف</Badge>
        <Badge tone="blue">{plan.units.toLocaleString("en")} شقة</Badge>
        <Badge tone="red">{plan.blocked.toLocaleString("en")} ضيفًا لا يُضاف لهم موعد</Badge>
        {preview.errors.length > 0 && <Badge tone="red">{preview.errors.length.toLocaleString("en")} صف لم يُقرأ</Badge>}
      </div>
      <p className="text-sm leading-6 text-slate-600">
        يُمنع كل من يسكن في هذه الشقق (صاحب السيارة وعائلته) من سيارات المجمع: لا تُضاف لهم مواعيد ولا رحلات، وتظهر للعيادة رسالة
        «هذا الشخص يمتلك سيارة خاصة ولا يمكنه استخدام سيارات المجمع». يبقون في قائمة الضيوف، والممرضات خارج هذا الشرط.
        {current > 0 && <> القائمة الجديدة تحل محل القائمة الحالية ({current.toLocaleString("en")} سيارة).</>}
      </p>
      {plan.unlisted.length > 0 && (
        <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">
          <p className="font-semibold">{plan.unlisted.length.toLocaleString("en")} شقة ليس فيها ضيوف في القائمة الحالية (تُحفظ وتُطبَّق عند إضافة ضيوفها):</p>
          <p className="mt-1">{plan.unlisted.slice(0, 30).map((car) => `مبنى ${car.buildingNumber} شقة ${car.apartmentNumber}`).join("، ")}{plan.unlisted.length > 30 ? "…" : ""}</p>
        </div>
      )}
      {preview.errors.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800 ring-1 ring-inset ring-red-200">
          {preview.errors.slice(0, 50).map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={saving || !preview.cars.length} onClick={save} className={btn("primary")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ قائمة السيارات الخاصة
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className={btn("secondary")}>إلغاء</button>
      </div>
    </Panel>
  );
}

/** قائمة السيارات الخاصة: لكل شقة صاحب السيارة ورقم المركبة وعدد من يسكن فيها من القائمة، مع الحذف والإضافة. */
export function PrivateCarsPanel({ cars, guests }: { cars: PrivateCar[]; guests: Guest[] }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ buildingNumber: "", apartmentNumber: "", name: "", plate: "" });
  const family = useMemo(() => {
    const count = new Map<string, number>();
    for (const guest of guests) {
      // الممرضات وصاحب الاحتياجات الخاصة خارج المنع
      if (isNurse(guest) || hasSpecialNeeds(guest)) continue;
      const key = unitKey(guest.buildingNumber, guest.apartmentNumber);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return count;
  }, [guests]);
  const sorted = useMemo(() => [...cars].sort(byUnit), [cars]);
  const blocked = sorted.reduce((sum, car) => sum + (family.get(unitKey(car.buildingNumber, car.apartmentNumber)) ?? 0), 0);

  function remove(car: PrivateCar) {
    const place = `مبنى ${car.buildingNumber} شقة ${car.apartmentNumber}`;
    if (!window.confirm(`حذف السيارة الخاصة لـ${place}${car.name ? ` (${car.name})` : ""}؟\nيُسمح بعدها بإضافة مواعيد لمن يسكن في هذه الشقة.`)) return;
    saveState("fox_private_cars", cars.filter((item) => item.id !== car.id), cars);
    toast.success(`حُذفت السيارة الخاصة لـ${place}`);
  }

  function add(event: React.FormEvent) {
    event.preventDefault();
    const buildingNumber = normalizeUnit(form.buildingNumber);
    const apartmentNumber = normalizeUnit(form.apartmentNumber);
    if (!buildingNumber || !apartmentNumber) {
      toast.error("اكتب رقم المبنى ورقم الشقة.");
      return;
    }
    if (buildingNumber.length > 20 || apartmentNumber.length > 20 || form.plate.trim().length > 20) {
      toast.error("رقم المبنى أو الشقة أو المركبة غير صحيح.");
      return;
    }
    const car: PrivateCar = {
      id: `PC-${Date.now().toString(36)}`,
      buildingNumber,
      apartmentNumber,
      ...(form.name.trim() ? { name: form.name.trim().replace(/\s+/g, " ").slice(0, 120) } : {}),
      ...(form.plate.trim() ? { plate: form.plate.trim() } : {}),
    };
    saveState("fox_private_cars", [...cars, car], cars);
    toast.success(`أُضيفت سيارة خاصة لمبنى ${buildingNumber} شقة ${apartmentNumber}`, { description: `لا يُضاف موعد لـ ${family.get(unitKey(buildingNumber, apartmentNumber)) ?? 0} ضيف يسكنون فيها.` });
    setForm({ buildingNumber: "", apartmentNumber: "", name: "", plate: "" });
    setAdding(false);
  }

  const cell = "px-4 py-2.5 align-middle";
  return (
    <Panel
      id="private-cars"
      tone="red"
      icon={CarFront}
      title="السيارات الخاصة"
      count={cars.length}
      className="mt-6"
      description={cars.length ? `${blocked.toLocaleString("en")} ضيفًا يسكنون في هذه الشقق لا يُضاف لهم موعد ولا رحلة` : "من يسكن في شقة لها سيارة خاصة لا يُضاف له موعد"}
      actions={!adding && <button type="button" onClick={() => setAdding(true)} className={btn("secondary", "sm")}><Plus className="h-4 w-4" /> إضافة شقة</button>}
    >
      {adding && (
        <form onSubmit={add} className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[110px_110px_minmax(0,1fr)_140px_auto] sm:px-5">
          <input aria-label="رقم المبنى" placeholder="المبنى" value={form.buildingNumber} onChange={(event) => setForm({ ...form, buildingNumber: event.target.value })} dir="ltr" required autoFocus className={cx(inputClass, "h-10")} />
          <input aria-label="رقم الشقة" placeholder="الشقة" value={form.apartmentNumber} onChange={(event) => setForm({ ...form, apartmentNumber: event.target.value })} dir="ltr" required className={cx(inputClass, "h-10")} />
          <input aria-label="اسم صاحب السيارة" placeholder="اسم صاحب السيارة (اختياري)" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={cx(inputClass, "h-10")} />
          <input aria-label="رقم المركبة" placeholder="رقم المركبة" value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value })} dir="ltr" className={cx(inputClass, "h-10")} />
          <div className="flex gap-1.5">
            <button type="submit" className={btn("primary", "sm")}><Check className="h-4 w-4" /> إضافة</button>
            <button type="button" onClick={() => setAdding(false)} aria-label="إلغاء" className={cx(btn("ghost", "sm"), "w-9 px-0")}><X className="h-4 w-4" /></button>
          </div>
        </form>
      )}
      {!cars.length ? (
        <EmptyState icon={CarFront} title="لا توجد سيارات خاصة" hint="ارفع ملف Excel بالأعمدة: اسم الضيف، رقم المركبة، المبنى، الشقة." />
      ) : (
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">المبنى والشقة</th>
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">صاحب السيارة</th>
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">رقم المركبة</th>
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">يسكن فيها من القائمة</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((car) => {
                const members = family.get(unitKey(car.buildingNumber, car.apartmentNumber)) ?? 0;
                return (
                  <tr key={car.id} className="hover:bg-slate-50/70">
                    <td className={cx(cell, "tabular font-medium text-slate-700")}>مبنى {car.buildingNumber} · شقة {car.apartmentNumber}</td>
                    <td className={cx(cell, "text-ink")}>{car.name ?? <span className="text-slate-300">—</span>}</td>
                    <td className={cx(cell, "text-slate-600")}>{car.plate ? <span dir="ltr" className="tabular">{car.plate}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className={cell}>{members ? <Badge tone="red">{members.toLocaleString("en")} ضيف</Badge> : <span className="text-xs text-amber-700">لا أحد في القائمة الحالية</span>}</td>
                    <td className={cx(cell, "text-end")}>
                      <button type="button" onClick={() => remove(car)} aria-label={`حذف السيارة الخاصة لمبنى ${car.buildingNumber} شقة ${car.apartmentNumber}`} title="حذف" className={cx(btn("danger", "sm"), "w-9 px-0")}><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
