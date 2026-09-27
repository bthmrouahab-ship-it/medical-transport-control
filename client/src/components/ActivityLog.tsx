import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Download, FileCode2, Loader2, Search } from "lucide-react";
import { authErrorMessage } from "@/lib/auth";
import { ACTIVITY_ROLES, ACTIVITY_TYPES, activityDate, activityTime, fetchActivity, fetchAllActivity, type ActivityItem } from "@/lib/activity";
import { activitySection, downloadExcel, downloadHtml } from "@/lib/report";
import { Badge, EmptyState, Panel, btn, cx, inputClass, type Tone } from "./ui-kit";

const TYPE_TONE: Record<string, Tone> = {
  appointment: "neutral",
  request: "blue",
  vehicle: "green",
  hospital: "cyan",
  user: "violet",
  session: "neutral",
  location: "amber",
  stats: "violet",
};

const PAGE = 1000;

/**
 * سجل كل العمليات مع اسم من نفّذها ووقتها، في فترة محددة (أو كل الفترات)، مع فلترة وبحث وتصدير.
 */
export default function ActivityLog({ since, until, periodLabel, exportable = true }: {
  since?: string;
  until?: string;
  periodLabel: string;
  /** أزرار تصدير السجل وحده (الإحصائيات لها تصديرها الكامل) */
  exportable?: boolean;
}) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState("all");
  const [type, setType] = useState("all");
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setLoading(true);
    fetchActivity({ since, until, limit: PAGE })
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setMore(page.more);
      })
      .catch((error) => {
        if (cancelled) return;
        setItems([]);
        toast.error(authErrorMessage(error, "تعذر تحميل سجل العمليات"));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [since, until]);

  async function loadMore() {
    if (!items?.length) return;
    setLoading(true);
    try {
      const page = await fetchActivity({ since, until, limit: PAGE, before: items[items.length - 1].id });
      setItems([...items, ...page.items]);
      setMore(page.more);
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر تحميل المزيد"));
    } finally {
      setLoading(false);
    }
  }

  const users = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items ?? []) counts.set(item.userName, (counts.get(item.userName) ?? 0) + 1);
    return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [items]);
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (items ?? []).filter((item) => (user === "all" || item.userName === user)
      && (type === "all" || item.type === type)
      && (!words || `${item.summary} ${item.userName} ${Object.values(item.details).join(" ")}`.toLowerCase().includes(words)));
  }, [items, user, type, query]);

  async function exportLog(format: "excel" | "html") {
    setExporting(true);
    try {
      // التصدير يشمل كل عمليات الفترة (لا المحمّلة فقط)، مع الفلاتر المختارة
      const { items: all, truncated } = more ? await fetchAllActivity({ since, until }) : { items: items ?? [], truncated: false };
      const words = query.trim().toLowerCase();
      const rows = all.filter((item) => (user === "all" || item.userName === user) && (type === "all" || item.type === type)
        && (!words || `${item.summary} ${item.userName} ${Object.values(item.details).join(" ")}`.toLowerCase().includes(words)));
      const report = { title: "سجل العمليات · سيارات مجمع الثمامة", subtitle: `${periodLabel} · أُنشئ ${new Date().toLocaleString("en-GB")}`, kpis: [{ label: "عدد العمليات", value: rows.length.toLocaleString("en") }], sections: [activitySection(rows, truncated)] };
      const name = `activity-${new Date().toISOString().slice(0, 10)}`;
      if (format === "excel") await downloadExcel(report, `${name}.xlsx`);
      else downloadHtml(report, `${name}.html`);
      toast.success(format === "excel" ? "تم تصدير ملف Excel" : "تم تصدير صفحة HTML");
    } catch (error) {
      toast.error(authErrorMessage(error, "تعذر التصدير"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Panel
      tone="violet"
      icon={ClipboardList}
      title="سجل العمليات"
      count={items?.length}
      description={`${periodLabel} · كل عملية في النظام مع من نفّذها ووقتها`}
      actions={exportable && (
        <>
          <button disabled={exporting || !items?.length} onClick={() => exportLog("excel")} className={btn("secondary", "sm")}><Download className="h-4 w-4" /> Excel</button>
          <button disabled={exporting || !items?.length} onClick={() => exportLog("html")} className={btn("secondary", "sm")}><FileCode2 className="h-4 w-4" /> HTML</button>
        </>
      )}
    >
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-[minmax(0,1fr)_200px_200px] sm:px-5">
        <label className="relative block">
          <span className="sr-only">بحث في العمليات</span>
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث: مريض، سيارة، مبنى، سبب..." className={cx(inputClass, "h-10 pr-9")} />
        </label>
        <select aria-label="المستخدم" value={user} onChange={(event) => setUser(event.target.value)} className={cx(inputClass, "h-10", user !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
          <option value="all">كل المستخدمين</option>
          {users.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.count})</option>)}
        </select>
        <select aria-label="نوع العملية" value={type} onChange={(event) => setType(event.target.value)} className={cx(inputClass, "h-10", type !== "all" && "border-brand-600 bg-brand-50 text-brand-700")}>
          <option value="all">كل العمليات</option>
          {Object.entries(ACTIVITY_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>

      {items === null ? (
        <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</p>
      ) : filtered.length ? (
        <div className="max-h-[640px] overflow-y-auto">
          {/* جدول على الشاشات الواسعة، وعلى الهاتف كل عملية سطران: الوقت والمستخدم، ثم العملية */}
          <div className="sticky top-0 z-10 hidden grid-cols-[7.5rem_11rem_minmax(0,1fr)] gap-x-4 bg-slate-50 px-5 py-2.5 text-xs font-medium text-slate-500 sm:grid">
            <span>الوقت</span>
            <span>المستخدم</span>
            <span>العملية</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {filtered.map((item) => (
              <li key={item.id} data-activity className="grid gap-x-4 gap-y-1.5 px-5 py-2.5 text-sm hover:bg-slate-50/70 sm:grid-cols-[7.5rem_11rem_minmax(0,1fr)]">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500 sm:block">
                  <span className="font-semibold text-ink tabular sm:block" dir="ltr">{activityTime(item.at)}</span>
                  <span className="tabular" dir="ltr">{activityDate(item.at)}</span>
                  <span className="sm:hidden">·</span>
                  <span className="font-medium text-ink sm:hidden" data-user>{item.userName}</span>
                  <span className="sm:hidden">{ACTIVITY_ROLES[item.role] ?? ""}</span>
                </div>
                <div className="hidden sm:block">
                  <span className="block font-medium text-ink" data-user>{item.userName}</span>
                  <span className="text-xs text-slate-500">{ACTIVITY_ROLES[item.role] ?? "—"}</span>
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <Badge tone={TYPE_TONE[item.type] ?? "neutral"}>{ACTIVITY_TYPES[item.type] ?? item.type}</Badge>
                  <span className="min-w-0 flex-1 basis-48 text-slate-700">{item.summary}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : <EmptyState icon={ClipboardList} title={items.length ? "لا توجد عمليات مطابقة" : "لا توجد عمليات في هذه الفترة"} />}

      {more && (
        <div className="border-t border-slate-100 p-3 text-center">
          <button disabled={loading} onClick={loadMore} className={btn("secondary", "sm")}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} تحميل عمليات أقدم</button>
        </div>
      )}
    </Panel>
  );
}

/** آخر العمليات كخط زمني قصير (في صفحة مشرف السيارات)، يتحدث كل 20 ثانية. */
export function RecentActivity({ limit = 15 }: { limit?: number }) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => {
      if (document.hidden) return;
      fetchActivity({ limit }).then((page) => !stopped && setItems(page.items)).catch(() => !stopped && setItems((current) => current ?? []));
    };
    load();
    const timer = window.setInterval(load, 20000);
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [limit]);

  if (items === null) return <p className="flex items-center justify-center gap-2 p-6 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /></p>;
  if (!items.length) return <EmptyState icon={ClipboardList} title="لا توجد عمليات بعد" />;
  return (
    <ol className="max-h-80 overflow-y-auto px-5 py-4">
      {items.map((item) => (
        <li key={item.id} className="relative border-s border-slate-200 pb-4 ps-4 last:border-transparent last:pb-0">
          <span className="absolute -start-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 ring-2 ring-white" />
          <p className="text-sm text-slate-700">{item.summary}</p>
          <p className="mt-0.5 text-xs text-slate-400"><span dir="ltr" className="tabular">{activityTime(item.at).slice(0, 5)}</span> · {item.userName}</p>
        </li>
      ))}
    </ol>
  );
}
