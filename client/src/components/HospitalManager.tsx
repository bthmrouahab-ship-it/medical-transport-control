import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Hospital as HospitalIcon, MapPin, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { nearbyHospitals, type Hospital } from "@shared/hospitals";
import LiveMap from "./LiveMap";
import { Badge, EmptyState, Panel, btn, cx, inputClass, labelClass } from "./ui-kit";

type Draft = { id: string; name: string; nameEn: string; zone: string; aliases: string; lat: number; lng: number };

const toDraft = (hospital: Hospital): Draft => ({ ...hospital, aliases: hospital.aliases.join("، ") });

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `h-${Date.now().toString(36)}`;
}

/** إدارة دليل المستشفيات: الاسم، المنطقة، الأسماء البديلة، والموقع على الخريطة. */
export default function HospitalManager({ hospitals, tripCounts, onSave }: {
  hospitals: Hospital[];
  tripCounts: Record<string, number>;
  onSave: (next: Hospital[], message: string) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [query, setQuery] = useState("");
  const zones = Array.from(new Set(hospitals.map((hospital) => hospital.zone)));
  const visible = hospitals.filter((hospital) => `${hospital.name} ${hospital.nameEn} ${hospital.zone}`.toLowerCase().includes(query.toLowerCase()));

  function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const zone = draft.zone.trim();
    if (name.length < 2 || !zone) {
      toast.error("أدخل اسم المستشفى والمنطقة");
      return;
    }
    let id = draft.id;
    if (isNew) {
      const base = slug(draft.nameEn || name);
      id = base;
      for (let index = 2; hospitals.some((item) => item.id === id); index += 1) id = `${base}-${index}`;
    }
    const hospital: Hospital = {
      id,
      name,
      nameEn: draft.nameEn.trim(),
      zone,
      lat: draft.lat,
      lng: draft.lng,
      aliases: draft.aliases.split(/[،,\n]/).map((alias) => alias.trim()).filter(Boolean),
      verified: true,
    };
    const next = isNew ? [...hospitals, hospital] : hospitals.map((item) => (item.id === hospital.id ? hospital : item));
    onSave(next, `${isNew ? "إضافة" : "تعديل"} المستشفى ${hospital.name}`);
    toast.success("تم حفظ المستشفى");
    setDraft(null);
  }

  function remove(hospital: Hospital) {
    if (!window.confirm(`حذف ${hospital.name} من الدليل؟ لن تُحذف المواعيد المسجلة.`)) return;
    onSave(hospitals.filter((item) => item.id !== hospital.id), `حذف المستشفى ${hospital.name}`);
    setDraft(null);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-4">
        <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">بحث</span>
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث عن مستشفى أو منطقة" className={cx(inputClass, "pr-9")} />
          </label>
          <button onClick={() => { setIsNew(true); setDraft({ id: "", name: "", nameEn: "", zone: zones[0] ?? "", aliases: "", lat: 25.28, lng: 51.52 }); }} className={cx(btn("primary"), "h-11")}><Plus className="h-4 w-4" /> إضافة</button>
        </div>

        {draft && (
          <Panel tone="brand" icon={HospitalIcon} title={isNew ? "مستشفى جديد" : `تعديل ${draft.name}`}>
            <form onSubmit={(event) => { event.preventDefault(); save(); }} className="grid gap-4 p-5">
              <label><span className={labelClass}>الاسم بالعربية</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></label>
              <label><span className={labelClass}>الاسم بالإنجليزية</span><input dir="ltr" value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} className={inputClass} /></label>
              <label><span className={labelClass}>المنطقة</span><input list="zone-options" value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })} className={inputClass} /></label>
              <datalist id="zone-options">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
              <label><span className={labelClass}>أسماء بديلة (مفصولة بفاصلة)</span><textarea value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} rows={2} className={cx(inputClass, "h-auto py-2.5")} /></label>
              <p className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-inset ring-blue-200"><MapPin className="h-4 w-4 shrink-0" /> الموقع: انقر على الخريطة لتحديده · <span dir="ltr" className="tabular">{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</span></p>
              <div className="flex gap-2">
                <button className={cx(btn("primary"), "flex-1")}><CheckCircle2 className="h-4 w-4" /> حفظ</button>
                <button type="button" onClick={() => setDraft(null)} className={btn("secondary")}>إلغاء</button>
              </div>
            </form>
          </Panel>
        )}

        <Panel icon={HospitalIcon} title="دليل المستشفيات" count={visible.length} description="حجم الدائرة على الخريطة حسب عدد الرحلات السابقة">
          {visible.length ? (
            <ul className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {visible.map((hospital) => {
                const near = nearbyHospitals(hospital, hospitals).slice(0, 3);
                return (
                  <li key={hospital.id} className={cx("flex items-start justify-between gap-3 px-5 py-3.5", draft?.id === hospital.id && "bg-brand-50/60")}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">{hospital.name}{!hospital.verified && <Badge tone="amber">الموقع تقريبي</Badge>}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{hospital.zone} · <span className="tabular">{tripCounts[hospital.id] ?? 0}</span> رحلة سابقة</p>
                      {near.length > 0 && <p className="mt-1 text-xs text-slate-500">قريب من: {near.map((item) => `${item.hospital.name} (${item.km.toFixed(1)} كم)`).join("، ")}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button onClick={() => { setIsNew(false); setDraft(toDraft(hospital)); }} aria-label={`تعديل ${hospital.name}`} title="تعديل" className={cx(btn("ghost", "sm"), "w-9 px-0")}><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => remove(hospital)} aria-label={`حذف ${hospital.name}`} title="حذف" className={cx(btn("ghost", "sm"), "w-9 px-0 text-red-600 hover:bg-red-50 hover:text-red-700")}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={Search} title="لا توجد نتائج" />}
        </Panel>
      </div>
      <div className="min-w-0 lg:sticky lg:top-24">
        <LiveMap
          hospitals={draft ? [...hospitals.filter((item) => item.id !== draft.id), { ...toHospital(draft) }] : hospitals}
          locations={[]}
          tripCounts={tripCounts}
          selectedHospitalId={draft?.id || "__draft"}
          onPick={draft ? (point) => setDraft({ ...draft, ...point }) : undefined}
          onSelectHospital={(id) => { const hospital = hospitals.find((item) => item.id === id); if (hospital) { setIsNew(false); setDraft(toDraft(hospital)); } }}
          height={600}
        />
      </div>
    </div>
  );
}

function toHospital(draft: Draft): Hospital {
  return { id: draft.id || "__draft", name: draft.name || "موقع جديد", nameEn: draft.nameEn, zone: draft.zone, lat: draft.lat, lng: draft.lng, aliases: [], verified: true };
}
