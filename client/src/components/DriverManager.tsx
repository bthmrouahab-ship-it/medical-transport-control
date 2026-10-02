import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CarFront, CheckCircle2, FilterX, IdCard, Pencil, Plus, Search, Smartphone, Trash2, UserRound } from "lucide-react";
import { newDriverId, validateDriver, vehicleOfDriver, type Driver } from "@shared/drivers";
import type { Vehicle } from "@shared/transport";
import type { UserProfile } from "@shared/users";
import { saveState } from "@/lib/appStore";
import { authErrorMessage, watchUsers } from "@/lib/auth";
import { useDrivers } from "@/lib/useShared";
import { Badge, EmptyState, PageHeader, Panel, btn, cx, inputClass, labelClass } from "./ui-kit";

type DriverDraft = { name: string; phone: string };

/**
 * قائمة السائقين (المدير): الاسم ورقم الموبايل، مستقلة عن السيارات. مشرف السيارات يخصص لكل سيارة سائقها
 * في بداية الشفت، وتظهر هنا السيارة التي يقودها كل سائق الآن وحساب تطبيق السائق المرتبط به (يُربط من «المستخدمين»).
 * تعديل اسم السائق أو رقمه يحدّثهما الخادم في سيارته.
 */
export default function DriverManager({ vehicles }: { vehicles: Vehicle[] }) {
  const drivers = useDrivers();
  const [users, setUsers] = useState<UserProfile[]>([]);
  // null = لا يوجد نموذج مفتوح، "" = سائق جديد، غير ذلك = رقم السائق قيد التعديل
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => watchUsers((list) => setUsers(list ?? []), (error) => toast.error(authErrorMessage(error, "تعذر تحميل حسابات السائقين"))), []);

  const usernames = useMemo(() => new Map(users.map((user) => [user.uid, user.username])), [users]);
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return drivers.filter((driver) => {
      const text = `${driver.name} ${driver.phone ?? ""} ${vehicleOfDriver(vehicles, driver.id)?.plate ?? ""} ${driver.uid ? usernames.get(driver.uid) ?? "" : ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [drivers, vehicles, usernames, query]);
  const driving = drivers.filter((driver) => vehicleOfDriver(vehicles, driver.id)).length;

  function save(draft: DriverDraft) {
    const original = editing ? drivers.find((driver) => driver.id === editing) : undefined;
    const result = validateDriver(draft, drivers, original?.id);
    if ("error" in result) {
      toast.error(result.error);
      return;
    }
    if (original) {
      saveState("fox_drivers", drivers.map((driver) => (driver.id === original.id ? { ...driver, ...result.driver } : driver)), drivers);
      toast.success("تم تحديث بيانات السائق", { description: vehicleOfDriver(vehicles, original.id) ? "ويتحدث اسمه ورقمه في سيارته" : undefined });
    } else {
      saveState("fox_drivers", [...drivers, { id: newDriverId(drivers), ...result.driver }], drivers);
      toast.success("تمت إضافة السائق", { description: "يخصصه مشرف السيارات لسيارة في بداية الشفت" });
    }
    setEditing(null);
  }

  function remove(driver: Driver) {
    const vehicle = vehicleOfDriver(vehicles, driver.id);
    const notes = [
      vehicle ? `السائق في السيارة ${vehicle.plate} الآن، وستبقى بلا سائق حتى يخصص لها مشرف السيارات غيره.` : "",
      driver.uid ? "وسيُلغى ربط حساب تطبيقه." : "",
    ].filter(Boolean).join(" ");
    if (!window.confirm(`حذف السائق ${driver.name} من قائمة السائقين؟${notes ? `\n${notes}` : ""}`)) return;
    saveState("fox_drivers", drivers.filter((item) => item.id !== driver.id), drivers);
    toast.success("تم حذف السائق");
  }

  return (
    <>
      <PageHeader
        title="السائقون"
        subtitle={`${drivers.length} سائق · ${driving} في سيارة الآن · يختار مشرف السيارات سائق كل سيارة في بداية الشفت`}
        actions={<button onClick={() => setEditing("")} className={btn("primary")}><Plus className="h-4 w-4" /> إضافة سائق</button>}
      />
      {editing === "" && <DriverForm onSave={save} onCancel={() => setEditing(null)} />}
      <Panel
        icon={IdCard}
        title="قائمة السائقين"
        count={query.trim() ? shown.length : drivers.length}
        description="الاسم ورقم الموبايل لكل سائق، والسيارة التي يقودها الآن"
        actions={query.trim() && <button type="button" onClick={() => setQuery("")} className={btn("ghost", "sm")}><FilterX className="h-4 w-4" /> مسح البحث</button>}
      >
        {drivers.length > 0 && (
          <div className="border-b border-slate-100 p-4 sm:px-5">
            <label className="relative block">
              <span className="sr-only">بحث في السائقين</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث: الاسم، الرقم، السيارة، اسم الدخول..." className={cx(inputClass, "h-10 ps-9")} />
            </label>
          </div>
        )}
        <div className="divide-y divide-slate-100">
          {drivers.length === 0 && <EmptyState icon={IdCard} title="لا يوجد سائقون مسجلون" hint="أضف السائقين بأسمائهم وأرقامهم، ثم يخصصهم مشرف السيارات للسيارات" />}
          {drivers.length > 0 && !shown.length && <EmptyState icon={Search} title="لا يوجد سائقون مطابقون" />}
          {shown.map((driver) => {
            if (editing === driver.id) return <div key={driver.id} className="bg-slate-50/70 p-3"><DriverForm initial={driver} onSave={save} onCancel={() => setEditing(null)} /></div>;
            const vehicle = vehicleOfDriver(vehicles, driver.id);
            const username = driver.uid ? usernames.get(driver.uid) : undefined;
            return (
              <div key={driver.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold", vehicle ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>{driver.name.trim().charAt(0) || "؟"}</span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{driver.name}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                      {driver.phone ? <span dir="ltr" className="tabular">{driver.phone}</span> : <span className="text-amber-700">بلا رقم موبايل</span>}
                      <span className="text-slate-300">·</span>
                      <span className="inline-flex items-center gap-1"><Smartphone className="h-3 w-3" />{username ? <>حساب التطبيق <span dir="ltr">{username}</span></> : "بلا حساب تطبيق"}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {vehicle ? <Badge tone="green" icon={CarFront}>في السيارة <span dir="ltr" className="tabular">{vehicle.plate}</span></Badge> : <Badge>بلا سيارة الآن</Badge>}
                  <button onClick={() => setEditing(driver.id)} aria-label={`تعديل السائق ${driver.name}`} className={btn("secondary", "sm")}><Pencil className="h-3.5 w-3.5" /> تعديل</button>
                  <button onClick={() => remove(driver)} aria-label={`حذف السائق ${driver.name}`} className={btn("danger", "sm")}><Trash2 className="h-3.5 w-3.5" /> حذف</button>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

function DriverForm({ initial, onSave, onCancel }: { initial?: Driver; onSave: (draft: DriverDraft) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<DriverDraft>({ name: initial?.name ?? "", phone: initial?.phone ?? "" });
  const form = (
    <form onSubmit={(event) => { event.preventDefault(); onSave(draft); }} className="grid gap-5 p-5 sm:grid-cols-2">
      <label><span className={labelClass}>اسم السائق</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></label>
      <label><span className={labelClass}>رقم الموبايل</span><input dir="ltr" type="tel" inputMode="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="55123456" className={inputClass} /></label>
      <div className="flex gap-3 sm:col-span-2">
        <button className={cx(btn("primary"), "flex-1 sm:flex-none")}><CheckCircle2 className="h-4 w-4" /> {initial ? "حفظ التعديلات" : "إضافة السائق"}</button>
        <button type="button" onClick={onCancel} className={btn("secondary")}>إلغاء</button>
      </div>
    </form>
  );
  // التعديل داخل القائمة، والإضافة في قسم مستقل فوقها
  return initial
    ? <div className="rounded-xl bg-white ring-1 ring-slate-200">{form}</div>
    : <Panel tone="brand" icon={UserRound} title="سائق جديد" className="mb-6">{form}</Panel>;
}
