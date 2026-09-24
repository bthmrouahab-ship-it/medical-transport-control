import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { nearbyHospitals, type Hospital } from "@shared/hospitals";
import LiveMap from "./LiveMap";

const inputClass = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#e6a1aa]";

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
    <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="mb-4 flex gap-2">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث عن مستشفى أو منطقة" className={inputClass} />
          <button onClick={() => { setIsNew(true); setDraft({ id: "", name: "", nameEn: "", zone: zones[0] ?? "", aliases: "", lat: 25.28, lng: 51.52 }); }} className="flex shrink-0 items-center gap-1 rounded-xl bg-[#a61d2d] px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" /> إضافة</button>
        </div>

        {draft && (
          <form onSubmit={(event) => { event.preventDefault(); save(); }} className="mb-4 grid gap-3 rounded-2xl border border-[#f0c4ca] bg-white p-4">
            <label><span className="mb-1 block text-xs font-bold text-slate-600">الاسم بالعربية</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className={inputClass} /></label>
            <label><span className="mb-1 block text-xs font-bold text-slate-600">الاسم بالإنجليزية</span><input dir="ltr" value={draft.nameEn} onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })} className={inputClass} /></label>
            <label><span className="mb-1 block text-xs font-bold text-slate-600">المنطقة (المستشفيات في نفس المنطقة تُقترح للجمع)</span><input list="zone-options" value={draft.zone} onChange={(event) => setDraft({ ...draft, zone: event.target.value })} className={inputClass} /></label>
            <datalist id="zone-options">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
            <label><span className="mb-1 block text-xs font-bold text-slate-600">أسماء بديلة (مفصولة بفاصلة) لمطابقة ما يكتبه الموظفون</span><textarea value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} rows={2} className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-[#e6a1aa]" /></label>
            <p className="flex items-center gap-2 rounded-xl bg-blue-50 p-3 text-xs font-bold text-blue-800"><MapPin className="h-4 w-4 shrink-0" /> انقر على الخريطة لتحديد الموقع · <span dir="ltr">{draft.lat.toFixed(5)}, {draft.lng.toFixed(5)}</span></p>
            <div className="flex gap-2">
              <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#a61d2d] text-sm font-bold text-white"><CheckCircle2 className="h-4 w-4" /> حفظ</button>
              <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600">إلغاء</button>
            </div>
          </form>
        )}

        <ul className="max-h-[520px] divide-y divide-slate-100 overflow-auto rounded-2xl border border-slate-200 bg-white">
          {visible.map((hospital) => {
            const near = nearbyHospitals(hospital, hospitals).slice(0, 3);
            return (
              <li key={hospital.id} className={`p-4 ${draft?.id === hospital.id ? "bg-[#fff7f7]" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">{hospital.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{hospital.zone} · {tripCounts[hospital.id] ?? 0} رحلة سابقة{hospital.verified ? "" : " · الموقع تقريبي"}</p>
                    {near.length > 0 && <p className="mt-1 text-[11px] text-blue-700">قريب من: {near.map((item) => `${item.hospital.name} (${item.km.toFixed(1)} كم)`).join("، ")}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => { setIsNew(false); setDraft(toDraft(hospital)); }} aria-label={`تعديل ${hospital.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(hospital)} aria-label={`حذف ${hospital.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg border border-red-100 text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="lg:sticky lg:top-24 lg:self-start">
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
