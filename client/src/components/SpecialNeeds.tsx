import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Accessibility, Check, Link2, Loader2, Search, Trash2, X } from "lucide-react";
import { isNurse, searchGuests, unitKey, type Guest, type SpecialNeed } from "@shared/guests";
import { saveState } from "@/lib/appStore";
import { api } from "@/lib/api";
import { authErrorMessage } from "@/lib/auth";
import { Badge, EmptyState, Panel, btn, cx, inputClass } from "./ui-kit";

export type SpecialNeedsPreview = { fileName: string; people: Omit<SpecialNeed, "id" | "guestId">[]; errors: string[] };
type MatchRow = { row: number; match: "health" | "name" | null; guestId: string | null; guestName: string | null; guestUnit: string | null };
type MatchResult = { rows: MatchRow[]; counts: { health: number; name: number; unmatched: number; privateCar: number } };

const unitText = (item: { buildingNumber?: string; apartmentNumber?: string }) =>
  item.buildingNumber || item.apartmentNumber ? `مبنى ${item.buildingNumber ?? "—"} · شقة ${item.apartmentNumber ?? "—"}` : "—";

/**
 * مراجعة قائمة ذوي الاحتياجات الخاصة قبل الحفظ: الخادم يطابق كل شخص بضيف من القائمة (الرقم الصحي، ثم الاسم والشقة)
 * بلا حفظ (dryRun)، ثم الحفظ يستبدل القائمة الحالية كلها (special-needs.import).
 */
export function SpecialNeedsPreviewPanel({ preview, current, onDone, onCancel }: {
  preview: SpecialNeedsPreview;
  current: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [result, setResult] = useState<MatchResult | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let alive = true;
    api<MatchResult>("special-needs.import", { entries: preview.people, dryRun: true })
      .then((value) => alive && setResult(value))
      .catch((error) => alive && toast.error(authErrorMessage(error, "تعذر مطابقة القائمة بقائمة الضيوف")));
    return () => { alive = false; };
  }, [preview]);

  async function save() {
    setSaving(true);
    try {
      const saved = await api<MatchResult & { saved: number }>("special-needs.import", { entries: preview.people });
      const matched = saved.counts.health + saved.counts.name;
      toast.success("حُفظت قائمة ذوي الاحتياجات الخاصة", {
        description: `${saved.saved} شخصًا، طوبق منهم ${matched} بضيوف القائمة${saved.counts.privateCar ? `، ويُستثنى ${saved.counts.privateCar} من منع السيارات الخاصة` : ""}. يمكن ربط الباقين من القسم أدناه.`,
        duration: 10000,
      });
      onDone();
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر حفظ قائمة ذوي الاحتياجات الخاصة"));
    } finally {
      setSaving(false);
    }
  }

  const unmatched = result ? result.rows.filter((row) => !row.guestId).map((row) => preview.people[row.row]) : [];
  return (
    <Panel tone="amber" icon={Accessibility} title="مراجعة قائمة ذوي الاحتياجات الخاصة قبل الحفظ" description={preview.fileName} className="mb-6" bodyClassName="space-y-4 p-4 sm:p-5">
      {!result ? (
        <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> مطابقة الأسماء بقائمة الضيوف…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{preview.people.length.toLocaleString("en")} شخصًا في الملف</Badge>
            <Badge tone="green">{result.counts.health.toLocaleString("en")} طوبقوا بالرقم الصحي</Badge>
            {result.counts.name > 0 && <Badge tone="blue">{result.counts.name.toLocaleString("en")} بالاسم والشقة</Badge>}
            {result.counts.unmatched > 0 && <Badge tone="amber">{result.counts.unmatched.toLocaleString("en")} غير مطابقين</Badge>}
            {result.counts.privateCar > 0 && <Badge tone="violet">{result.counts.privateCar.toLocaleString("en")} يُستثنون من منع السيارات الخاصة</Badge>}
            {preview.errors.length > 0 && <Badge tone="red">{preview.errors.length.toLocaleString("en")} صف لم يُقرأ</Badge>}
          </div>
          <p className="text-sm leading-6 text-slate-600">
            صاحب الاحتياجات الخاصة نفسه يُستثنى من منع السيارات الخاصة (ويبقى المنع لمن يسكن معه)، وتظهر للعيادة ملاحظة «احتياجات خاصة»
            عند تسجيل موعده. المطابقة بالرقم الصحي، ثم بالاسم في نفس المبنى والشقة، وغير المطابقين يُربطون من القسم أدناه بعد الحفظ.
            {current > 0 && <> القائمة الجديدة تحل محل القائمة الحالية ({current.toLocaleString("en")} شخصًا).</>}
          </p>
          {unmatched.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900 ring-1 ring-inset ring-amber-200">
              <p className="font-semibold">غير موجودين في قائمة الضيوف بالرقم الصحي أو الاسم (يُحفظون ويُربطون يدويًا):</p>
              <ul className="mt-1 space-y-0.5">{unmatched.slice(0, 30).map((person, index) => <li key={index}><bdi>{person.name ?? person.healthNumber}</bdi> · {unitText(person)}</li>)}</ul>
            </div>
          )}
        </>
      )}
      {preview.errors.length > 0 && (
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-800 ring-1 ring-inset ring-red-200">
          {preview.errors.slice(0, 50).map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
        <button type="button" disabled={saving || !result} onClick={save} className={btn("primary")}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} حفظ قائمة ذوي الاحتياجات الخاصة
        </button>
        <button type="button" disabled={saving} onClick={onCancel} className={btn("secondary")}>إلغاء</button>
      </div>
    </Panel>
  );
}

/** ربط صاحب احتياجات خاصة بضيف: من يسكن في نفس الشقة أولًا، أو البحث بالاسم */
function LinkGuest({ entry, guests, onLink, onCancel }: { entry: SpecialNeed; guests: Guest[]; onLink: (guest: Guest) => void; onCancel: () => void }) {
  const [query, setQuery] = useState("");
  const sameUnit = useMemo(() => (entry.buildingNumber && entry.apartmentNumber
    ? guests.filter((guest) => !isNurse(guest) && unitKey(guest.buildingNumber, guest.apartmentNumber) === unitKey(entry.buildingNumber, entry.apartmentNumber))
    : []), [entry, guests]);
  const found = query.trim().length >= 2 ? searchGuests(guests.filter((guest) => !isNurse(guest)), query, 8) : sameUnit;
  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
      <div className="flex items-center gap-1.5">
        <span className="relative flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input autoFocus aria-label="بحث عن الضيف" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو الهاتف…" className={cx(inputClass, "h-9 ps-8 text-xs")} />
        </span>
        <button type="button" onClick={onCancel} aria-label="إلغاء الربط" className={cx(btn("ghost", "sm"), "w-9 px-0")}><X className="h-4 w-4" /></button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-slate-500">{query.trim().length >= 2 ? "نتائج البحث" : sameUnit.length ? "يسكنون في نفس الشقة" : "اكتب حرفين من الاسم للبحث"}</p>
      <ul className="mt-1 space-y-1">
        {found.map((guest) => (
          <li key={guest.id}>
            <button type="button" onClick={() => onLink(guest)} className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5 text-start text-xs ring-1 ring-inset ring-slate-200 hover:bg-brand-50">
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{guest.name}</span>{guest.nameEn && <bdi className="block truncate text-slate-500">{guest.nameEn}</bdi>}</span>
              <span className="shrink-0 tabular text-slate-500">مبنى {guest.buildingNumber} · شقة {guest.apartmentNumber}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** قائمة ذوي الاحتياجات الخاصة: لكل شخص ضيف القائمة المطابق (أو «ربط بضيف»)، مع الحذف. */
export function SpecialNeedsPanel({ entries, guests }: { entries: SpecialNeed[]; guests: Guest[] }) {
  const [linking, setLinking] = useState<string | null>(null);
  const byId = useMemo(() => new Map(guests.map((guest) => [guest.id, guest])), [guests]);
  const unmatched = entries.filter((entry) => !entry.guestId || !byId.has(entry.guestId)).length;

  function link(entry: SpecialNeed, guest: Guest) {
    saveState("fox_special_needs", entries.map((item) => (item.id === entry.id ? { ...item, guestId: guest.id } : item)), entries);
    toast.success(`رُبط ${entry.name ?? "الشخص"} بالضيف ${guest.name}`, { description: "يُستثنى من منع السيارات الخاصة، وتظهر ملاحظة «احتياجات خاصة» عند تسجيل موعده." });
    setLinking(null);
  }

  function remove(entry: SpecialNeed) {
    if (!window.confirm(`حذف ${entry.name ?? "هذا الشخص"} من قائمة ذوي الاحتياجات الخاصة؟\nيعود إليه منع السيارات الخاصة إن كانت شقته فيها.`)) return;
    saveState("fox_special_needs", entries.filter((item) => item.id !== entry.id), entries);
    toast.success(`حُذف ${entry.name ?? "الشخص"} من قائمة ذوي الاحتياجات الخاصة`);
  }

  const cell = "px-4 py-2.5 align-top";
  return (
    <Panel
      id="special-needs"
      tone="violet"
      icon={Accessibility}
      title="ذوو الاحتياجات الخاصة"
      count={entries.length}
      className="mt-6"
      description={entries.length ? `مستثنون من منع السيارات الخاصة، وتظهر ملاحظة «احتياجات خاصة» عند تسجيل مواعيدهم${unmatched ? ` · ${unmatched} غير مربوطين بضيف` : ""}` : "صاحب الاحتياجات الخاصة يُستثنى من منع السيارات الخاصة"}
    >
      {!entries.length ? (
        <EmptyState icon={Accessibility} title="لا توجد قائمة ذوي الاحتياجات الخاصة" hint="ارفع ملف Excel بالأعمدة: NAME، gender، HC (الرقم الصحي)، building، ROOM." />
      ) : (
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50">
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">الاسم في الملف</th>
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">المبنى والشقة</th>
                <th scope="col" className="px-4 py-2.5 text-start font-semibold">ضيف القائمة</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">إجراءات</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const guest = entry.guestId ? byId.get(entry.guestId) : undefined;
                return (
                  <tr key={entry.id} className="hover:bg-slate-50/70">
                    <td className={cx(cell, "text-ink")}><bdi>{entry.name ?? "—"}</bdi>{entry.healthNumber && <span dir="ltr" className="block text-[11px] tabular text-slate-400">HC {entry.healthNumber}</span>}</td>
                    <td className={cx(cell, "tabular text-slate-600")}>{unitText(entry)}</td>
                    <td className={cell}>
                      {guest ? (
                        <span className="flex flex-col">
                          <span className="font-medium text-ink">{guest.name}</span>
                          <span className="text-xs text-slate-500">مبنى {guest.buildingNumber} · شقة {guest.apartmentNumber}</span>
                        </span>
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          <Badge tone="amber">غير مربوط بضيف</Badge>
                          {linking === entry.id
                            ? <LinkGuest entry={entry} guests={guests} onLink={(chosen) => link(entry, chosen)} onCancel={() => setLinking(null)} />
                            : <button type="button" onClick={() => setLinking(entry.id)} className={btn("secondary", "sm")}><Link2 className="h-3.5 w-3.5" /> ربط بضيف</button>}
                        </span>
                      )}
                    </td>
                    <td className={cx(cell, "text-end")}>
                      <button type="button" onClick={() => remove(entry)} aria-label={`حذف ${entry.name ?? ""} من قائمة ذوي الاحتياجات الخاصة`} title="حذف" className={cx(btn("danger", "sm"), "w-9 px-0")}><Trash2 className="h-3.5 w-3.5" /></button>
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
