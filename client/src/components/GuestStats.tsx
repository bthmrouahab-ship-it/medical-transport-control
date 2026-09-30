import { useMemo, useState } from "react";
import { Contact, Loader2, Search } from "lucide-react";
import { normalizeGuestName, type guestStats } from "@shared/guests";
import { EmptyState, Panel, btn, cx, inputClass } from "./ui-kit";

const PAGE = 30;

/**
 * الضيوف في الإحصائيات فقط: العمر والرقم الصحي لكل ضيف له موعد طبي في الفترة، مع عدد مواعيده
 * والسيارات التي أُرسلت له، والفئات العمرية. (لا تظهر هذه البيانات عند طلب الموعد.)
 */
export default function GuestStats({ stats, loading, periodLabel }: {
  stats: ReturnType<typeof guestStats>;
  loading: boolean;
  periodLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const words = normalizeGuestName(query).split(" ").filter(Boolean);
    if (!words.length) return stats.rows;
    return stats.rows.filter((row) => {
      const text = ` ${normalizeGuestName(row.name)} ${row.healthNumber ?? ""} ${row.buildingNumber.toLowerCase()} ${row.apartmentNumber.toLowerCase()} `;
      return words.every((word) => text.includes(word));
    });
  }, [stats.rows, query]);
  const visible = rows.slice(0, limit);
  const head = "px-4 py-2.5 text-start text-xs font-semibold text-slate-500";
  const cell = "px-4 py-2.5 align-middle";

  return (
    <Panel
      icon={Contact}
      tone="violet"
      title="الضيوف: العمر والرقم الصحي"
      count={stats.rows.length}
      description={`${periodLabel} · المواعيد الطبية حسب الفترة والمبنى المختارين · لا تظهر هذه البيانات عند طلب الموعد`}
    >
      {loading ? (
        <p className="flex items-center justify-center gap-2 p-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل قائمة الضيوف...</p>
      ) : !stats.rows.length ? (
        <EmptyState icon={Contact} title="لا توجد مواعيد طبية لضيوف في هذه الفترة" />
      ) : (
        <>
          <div className="grid gap-4 border-b border-slate-100 p-4 sm:p-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <dl className="grid grid-cols-3 gap-3 lg:grid-cols-1">
              <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
                <dt className="text-xs text-slate-500">الضيوف</dt>
                <dd className="mt-0.5 text-xl font-bold tabular text-ink">{stats.rows.length.toLocaleString("en")}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
                <dt className="text-xs text-slate-500">متوسط العمر</dt>
                <dd className="mt-0.5 text-xl font-bold tabular text-ink">{stats.averageAge ?? "—"}{stats.averageAge !== null && <span className="ms-1 text-xs font-medium text-slate-500">سنة</span>}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200/70">
                <dt className="text-xs text-slate-500">غير موجودين في القائمة</dt>
                <dd className="mt-0.5 text-xl font-bold tabular text-ink">{stats.unlisted.toLocaleString("en")}</dd>
              </div>
            </dl>
            <div className="overflow-x-auto rounded-xl ring-1 ring-inset ring-slate-200/70">
              <table className="w-full min-w-[420px] text-sm">
                <caption className="sr-only">الضيوف حسب الفئة العمرية</caption>
                <thead className="bg-slate-50/80">
                  <tr>
                    <th scope="col" className={head}>الفئة العمرية</th>
                    <th scope="col" className={head}>الضيوف</th>
                    <th scope="col" className={head}>المواعيد</th>
                    <th scope="col" className={head}>السيارات المرسلة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stats.ageGroups.map((group) => (
                    <tr key={group.label}>
                      <th scope="row" className={cx(cell, "text-start font-medium text-ink")}>{group.label}</th>
                      <td className={cx(cell, "tabular text-slate-700")}>{group.guests.toLocaleString("en")}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{group.appointments.toLocaleString("en")}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{group.trips.toLocaleString("en")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-b border-slate-100 p-4 sm:px-5">
            <label className="relative block max-w-md">
              <span className="sr-only">بحث في الضيوف</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} placeholder="بحث: الاسم، الرقم الصحي، المبنى والشقة..." className={cx(inputClass, "h-10 ps-9")} />
            </label>
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80">
                  <tr>
                    {["الضيف", "الرقم الصحي", "العمر", "الجنس", "المبنى", "الشقة", "المواعيد", "الملغاة", "السيارات المرسلة"].map((label) => <th key={label} scope="col" className={head}>{label}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className={cell}>
                        <span className="font-medium text-ink">{row.name}</span>
                        {!row.listed && <span className="block text-[11px] text-amber-700">غير موجود في قائمة الضيوف الحالية</span>}
                      </td>
                      <td className={cx(cell, "tabular text-slate-700")}>{row.healthNumber ? <span dir="ltr">{row.healthNumber}</span> : <span className="text-slate-300">—</span>}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{row.age ?? <span className="text-slate-300">—</span>}</td>
                      <td className={cx(cell, "text-slate-600")}>{row.gender ?? <span className="text-slate-300">—</span>}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{row.buildingNumber}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{row.apartmentNumber}</td>
                      <td className={cx(cell, "tabular text-slate-700")}>{row.appointments}</td>
                      <td className={cx(cell, "tabular", row.cancelled ? "text-red-700" : "text-slate-400")}>{row.cancelled}</td>
                      <td className={cx(cell, "font-semibold tabular text-ink")}>{row.trips}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > visible.length && (
                <div className="flex items-center justify-center gap-3 border-t border-slate-100 p-3 text-xs text-slate-500">
                  يظهر {visible.length.toLocaleString("en")} من {rows.length.toLocaleString("en")}
                  <button type="button" onClick={() => setLimit((current) => current + PAGE * 5)} className={btn("secondary", "sm")}>عرض المزيد</button>
                </div>
              )}
            </div>
          ) : <EmptyState icon={Search} title="لا يوجد ضيف مطابق" />}
        </>
      )}
    </Panel>
  );
}
