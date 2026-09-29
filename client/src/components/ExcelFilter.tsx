import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownAZ, ArrowDownZA, ChevronDown, Filter, FilterX, Search } from "lucide-react";
import { btn, cx } from "@/components/ui-kit";

/**
 * فلترة مثل جدول Excel: زر ▾ في عنوان كل عمود يفتح قائمة فيها الفرز تصاعديًا وتنازليًا، وبحث،
 * وقيم العمود بمربعات اختيار مع «تحديد الكل» وعدد كل قيمة، ثم «موافق» أو «إلغاء».
 * قيم كل عمود محسوبة من الصفوف التي تبقى بعد فلاتر الأعمدة الأخرى (كما في Excel).
 */
export type FilterColumn<T> = {
  key: string;
  label: string;
  /** النص الذي تُفلتر به القيم ويظهر في القائمة (كما يظهر في الخلية) */
  value: (row: T) => string;
  /** قيمة الفرز إن اختلفت عن النص (التاريخ ISO، أو رقم) */
  sortValue?: (row: T) => string;
  /** محتوى الخلية (الافتراضي: النص) */
  cell?: (row: T) => ReactNode;
  /** false: عمود بلا فلتر (مثل الأزرار) */
  filterable?: boolean;
  className?: string;
};

export type FilterLabels = {
  sortAsc: string;
  sortDesc: string;
  clear: (column: string) => string;
  search: string;
  selectAll: string;
  empty: string;
  ok: string;
  cancel: string;
  filter: (column: string) => string;
  noMatch: string;
};

export const FILTER_LABELS_AR: FilterLabels = {
  sortAsc: "فرز تصاعدي (أ ← ي، 1 ← 9)",
  sortDesc: "فرز تنازلي (ي ← أ، 9 ← 1)",
  clear: (column) => `مسح الفلتر من «${column}»`,
  search: "بحث",
  selectAll: "(تحديد الكل)",
  empty: "(فارغ)",
  ok: "موافق",
  cancel: "إلغاء",
  filter: (column) => `فلترة «${column}»`,
  noMatch: "لا توجد قيم مطابقة",
};

export const FILTER_LABELS_EN: FilterLabels = {
  sortAsc: "Sort A → Z, 1 → 9",
  sortDesc: "Sort Z → A, 9 → 1",
  clear: (column) => `Clear filter from "${column}"`,
  search: "Search",
  selectAll: "(Select all)",
  empty: "(Blanks)",
  ok: "OK",
  cancel: "Cancel",
  filter: (column) => `Filter "${column}"`,
  noMatch: "No matching values",
};

/** للبحث: بلا فرق في الأحرف الكبيرة والهمزات والتاء المربوطة */
export const searchable = (text: string) => text.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
const compare = (a: string, b: string) => a.localeCompare(b, "ar", { numeric: true, sensitivity: "base" });

type Sort = { key: string; dir: 1 | -1 } | null;

/** حالة الفلاتر والفرز لجدول: الصفوف المعروضة، وقيم كل عمود مع عددها. */
export function useColumnFilters<T>(rows: T[], columns: FilterColumn<T>[]) {
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<Sort>(null);
  const byKey = useMemo(() => new Map(columns.map((column) => [column.key, column])), [columns]);

  const passes = (row: T, except?: string) => Object.entries(filters).every(([key, values]) => {
    const column = byKey.get(key);
    return key === except || !column || values.includes(column.value(row));
  });

  const shown = useMemo(() => {
    const list = rows.filter((row) => passes(row));
    const column = sort && byKey.get(sort.key);
    if (!sort || !column) return list;
    const key = column.sortValue ?? column.value;
    return [...list].sort((a, b) => compare(key(a), key(b)) * sort.dir);
  }, [rows, filters, sort, byKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** قيم العمود (بعد فلاتر الأعمدة الأخرى) مرتبة، مع عدد كل قيمة */
  function optionsFor(key: string) {
    const column = byKey.get(key);
    if (!column) return [];
    const counts = new Map<string, { count: number; sort: string }>();
    for (const row of rows) {
      if (!passes(row, key)) continue;
      const value = column.value(row);
      const entry = counts.get(value);
      if (entry) entry.count += 1;
      else counts.set(value, { count: 1, sort: (column.sortValue ?? column.value)(row) });
    }
    return Array.from(counts, ([value, { count, sort }]) => ({ value, count, sort }))
      .sort((a, b) => (a.value === "" ? 1 : b.value === "" ? -1 : compare(a.sort, b.sort)))
      .map(({ value, count }) => ({ value, count }));
  }

  return {
    shown,
    filters,
    sort,
    active: Object.keys(filters).length,
    optionsFor,
    setFilter: (key: string, values: string[] | null) => setFilters((current) => {
      const next = { ...current };
      if (values) next[key] = values;
      else delete next[key];
      return next;
    }),
    setSort,
    clear: () => {
      setFilters({});
      setSort(null);
    },
  };
}

export type ColumnFilters<T> = ReturnType<typeof useColumnFilters<T>>;

/** جدول بعناوين أعمدة فيها فلترة Excel. على الشاشة الضيقة يتحرك الجدول أفقيًا. */
export function FilterTable<T>({ rows, columns, state, rowKey, rowClassName, labels, dir, empty }: {
  rows: T[];
  columns: FilterColumn<T>[];
  state: ColumnFilters<T>;
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  labels: FilterLabels;
  dir: "rtl" | "ltr";
  empty: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cx("px-2 py-1.5 text-start align-bottom font-semibold", column.className)}>
                {column.filterable === false
                  ? <span className="block px-1.5 py-1.5 text-xs text-slate-500">{column.label}</span>
                  : <HeaderFilter column={column} state={state} labels={labels} dir={dir} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={cx("border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70", rowClassName?.(row))}>
              {columns.map((column) => (
                <td key={column.key} className={cx("px-3.5 py-3 align-top text-slate-700", column.className)}>
                  {column.cell ? column.cell(row) : column.value(row) || <span className="text-slate-300">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && empty}
    </div>
  );
}

function HeaderFilter<T>({ column, state, labels, dir }: { column: FilterColumn<T>; state: ColumnFilters<T>; labels: FilterLabels; dir: "rtl" | "ltr" }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const active = Boolean(state.filters[column.key]);
  const sorted = state.sort?.key === column.key ? state.sort.dir : 0;
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={labels.filter(column.label)}
        onClick={() => setOpen(!open)}
        className={cx(
          "inline-flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-xs transition",
          active ? "bg-brand-50 text-brand-700" : "text-slate-500 hover:bg-slate-200/60 hover:text-ink",
        )}
      >
        <span>{column.label}{sorted ? <span aria-hidden="true" className="ms-1">{sorted === 1 ? "↑" : "↓"}</span> : null}</span>
        <span className={cx("flex h-5 w-5 items-center justify-center rounded-md ring-1 ring-inset", active ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-slate-300")}>
          {active ? <Filter className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </span>
      </button>
      {open && button.current && (
        <FilterMenu
          anchor={button.current}
          dir={dir}
          labels={labels}
          column={column.label}
          options={state.optionsFor(column.key)}
          selected={state.filters[column.key]}
          active={active}
          onSort={(value) => { state.setSort({ key: column.key, dir: value }); setOpen(false); }}
          onApply={(values) => { state.setFilter(column.key, values); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FilterMenu({ anchor, dir, labels, column, options, selected, active, onSort, onApply, onClose }: {
  anchor: HTMLElement;
  dir: "rtl" | "ltr";
  labels: FilterLabels;
  column: string;
  options: { value: string; count: number }[];
  selected?: string[];
  active: boolean;
  onSort: (dir: 1 | -1) => void;
  onApply: (values: string[] | null) => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(() => new Set(selected ?? options.map((option) => option.value)));
  const [place, setPlace] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  const words = searchable(query.trim());
  const visible = words ? options.filter((option) => searchable(option.value || labels.empty).includes(words)) : options;
  const allVisible = visible.length > 0 && visible.every((option) => checked.has(option.value));
  const someVisible = visible.some((option) => checked.has(option.value));

  // تحت زر العمود، ومحصورة داخل الشاشة، وتتبع الزر إذا تحركت الصفحة أو الجدول
  const place_ = useCallback(() => {
    const rect = anchor.getBoundingClientRect();
    const width = menu.current?.offsetWidth ?? 272;
    const height = menu.current?.offsetHeight ?? 360;
    const left = dir === "rtl" ? rect.right - width : rect.left;
    const top = rect.bottom + 6 + height > window.innerHeight - 8 ? Math.max(8, rect.top - 6 - height) : rect.bottom + 6;
    setPlace({ top, left: Math.min(Math.max(8, left), window.innerWidth - width - 8) });
  }, [anchor, dir]);

  useLayoutEffect(() => {
    place_();
    // التركيز على البحث بلا تحريك الصفحة
    searchInput.current?.focus({ preventScroll: true });
  }, [place_]);

  // تُغلق بالنقر خارجها أو Escape
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const follow = (event: Event) => !menu.current?.contains(event.target as Node) && place_();
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", place_);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("touchstart", outside);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", place_);
    };
  }, [anchor, onClose, place_]);

  function toggleAll() {
    setChecked((current) => {
      const next = new Set(current);
      for (const option of visible) {
        if (allVisible) next.delete(option.value);
        else next.add(option.value);
      }
      return next;
    });
  }

  function apply() {
    // مع البحث (كما في Excel): القيم الظاهرة المختارة فقط
    const values = (words ? visible : options).filter((option) => checked.has(option.value)).map((option) => option.value);
    onApply(values.length === options.length ? null : values);
  }

  const optionClass = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-[13px] text-slate-700 hover:bg-slate-100";
  return createPortal(
    <div
      ref={menu}
      role="dialog"
      aria-label={labels.filter(column)}
      dir={dir}
      style={{ top: place.top, left: place.left, visibility: place.top < -1000 ? "hidden" : undefined }}
      className="animate-rise fixed z-[2000] w-[272px] rounded-xl bg-white p-1.5 text-ink shadow-raised ring-1 ring-slate-900/10"
    >
      <button type="button" onClick={() => onSort(1)} className={optionClass}><ArrowDownAZ className="h-4 w-4 text-slate-500" /> {labels.sortAsc}</button>
      <button type="button" onClick={() => onSort(-1)} className={optionClass}><ArrowDownZA className="h-4 w-4 text-slate-500" /> {labels.sortDesc}</button>
      <button type="button" disabled={!active} onClick={() => onApply(null)} className={cx(optionClass, "disabled:pointer-events-none disabled:opacity-40")}><FilterX className="h-4 w-4 text-slate-500" /> {labels.clear(column)}</button>
      <div className="my-1.5 h-px bg-slate-100" />
      <label className="relative mx-1 block">
        <span className="sr-only">{labels.search}</span>
        <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          className="h-9 w-full rounded-lg border border-slate-300 bg-white ps-8 pe-2 text-[13px] outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/15"
        />
      </label>
      <div className="mx-1 mt-1.5 max-h-60 overflow-y-auto rounded-lg border border-slate-200 p-1">
        {visible.length ? (
          <>
            <label className={cx(optionClass, "cursor-pointer font-medium")}>
              <input
                type="checkbox"
                checked={allVisible}
                ref={(element) => { if (element) element.indeterminate = !allVisible && someVisible; }}
                onChange={toggleAll}
                className="h-4 w-4 accent-brand-600"
              />
              {labels.selectAll}
            </label>
            {visible.map((option) => (
              <label key={option.value} className={cx(optionClass, "cursor-pointer")}>
                <input
                  type="checkbox"
                  checked={checked.has(option.value)}
                  onChange={() => setChecked((current) => {
                    const next = new Set(current);
                    if (next.has(option.value)) next.delete(option.value);
                    else next.add(option.value);
                    return next;
                  })}
                  className="h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className={cx("min-w-0 flex-1 truncate", !option.value && "text-slate-400")}>{option.value || labels.empty}</span>
                <span className="text-[11px] text-slate-400 tabular">{option.count}</span>
              </label>
            ))}
          </>
        ) : <p className="px-2 py-3 text-center text-xs text-slate-400">{labels.noMatch}</p>}
      </div>
      <div className="mt-2 flex justify-end gap-2 px-1 pb-0.5">
        <button type="button" onClick={onClose} className={btn("secondary", "sm")}>{labels.cancel}</button>
        <button type="button" disabled={!someVisible} onClick={apply} className={btn("primary", "sm")}>{labels.ok}</button>
      </div>
    </div>,
    document.body,
  );
}
