import type { SharedBackend, SharedKey } from "./appStore";
import { api } from "./api";

type Rec = Record<string, unknown>;
type SyncResponse = { rev: number; full: boolean; docs: { col: string; id: string; data: Rec | null }[] };
type WriteOp =
  | { col: string; id: string; op: "set"; data: Rec }
  | { col: string; id: string; op: "update"; set: Rec; unset: string[] }
  | { col: string; id: string; op: "delete" };

/** كل قائمة مجموعة في قاعدة البيانات، وكل عنصر فيها مستند مستقل. */
const COLLECTIONS: Partial<Record<SharedKey, { col: string; idField: string; sort?: (a: Rec, b: Rec) => number }>> = {
  fox_appointments: {
    col: "appointments",
    idField: "id",
    sort: (a, b) => String(a.appointmentAt ?? "").localeCompare(String(b.appointmentAt ?? "")),
  },
  fox_requests: { col: "requests", idField: "id" },
  fox_fleet: { col: "fleet", idField: "plate" },
  fox_hospitals: { col: "hospitals", idField: "id" },
  // مواقع GPS يرسلها السائقون من صفحتهم؛ هنا للقراءة والمتابعة فقط
  fox_locations: { col: "vehicleLocations", idField: "plate" },
};
/** قيم تُحفظ كمستند واحد: سجل العمليات (آخر 50 عملية) وملخص الإحصائيات القديم. */
const SINGLE_DOCS: Partial<Record<SharedKey, { col: string; id: string; field: string }>> = {
  fox_audit: { col: "meta", id: "audit", field: "items" },
  fox_history: { col: "meta", id: "history", field: "data" },
};

/** كل كم ثانية يسأل الموقع عن تغييرات المستخدمين الآخرين (أبطأ عندما تكون الصفحة في الخلفية). */
const POLL_MS = 4000;
const HIDDEN_POLL_MS = 20000;

/** مقارنة المحتوى بغض النظر عن ترتيب الحقول (القيم undefined تُهمل كما في JSON). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Rec).filter((key) => (value as Rec)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Rec)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const docId = (value: unknown) => String(value ?? "").replace(/\//g, "_") || "_";
const strip = ({ _o, ...rest }: Rec) => rest;
/** JSON لا يحفظ القيم undefined. */
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/**
 * قاعدة البيانات المشتركة عبر خادم PHP: تحميل كامل عند الدخول، ثم مزامنة التغييرات كل بضع ثوانٍ،
 * وكل حفظ يُرسل دفعة واحدة من العمليات (كلها أو لا شيء).
 */
export function createApiBackend(): SharedBackend {
  const docs = new Map<string, Map<string, Rec>>(); // col -> id -> data
  const pending = new Map<SharedKey, number>();
  let rev = 0;
  let emit: (key: SharedKey, value: unknown) => void = () => {};
  let syncing: Promise<void> | null = null;

  const collection = (col: string) => {
    if (!docs.has(col)) docs.set(col, new Map());
    return docs.get(col)!;
  };

  function valueOf(key: SharedKey): unknown {
    const single = SINGLE_DOCS[key];
    if (single) return collection(single.col).get(single.id)?.[single.field];
    const cfg = COLLECTIONS[key]!;
    const rows = Array.from(collection(cfg.col).values());
    rows.sort((a, b) => Number(a._o ?? 0) - Number(b._o ?? 0));
    if (cfg.sort) rows.sort(cfg.sort);
    return rows.length ? rows.map(strip) : undefined;
  }

  const keysOf = (col: string, id: string) => (Object.keys({ ...COLLECTIONS, ...SINGLE_DOCS }) as SharedKey[])
    .filter((key) => (COLLECTIONS[key]?.col === col) || (SINGLE_DOCS[key]?.col === col && SINGLE_DOCS[key]?.id === id));

  function apply(response: SyncResponse) {
    const changed = new Set<SharedKey>();
    if (response.full) {
      docs.clear();
      (Object.keys({ ...COLLECTIONS, ...SINGLE_DOCS }) as SharedKey[]).forEach((key) => changed.add(key));
    }
    for (const item of response.docs) {
      if (item.data === null) collection(item.col).delete(item.id);
      else collection(item.col).set(item.id, item.data);
      keysOf(item.col, item.id).forEach((key) => changed.add(key));
    }
    rev = response.rev;
    return changed;
  }

  function sync() {
    // طلب مزامنة واحد في كل مرة
    syncing ??= api<SyncResponse>("sync", undefined, { since: rev })
      .then((response) => {
        // أثناء وجود حفظ محلي معلّق نؤجل عرض التغييرات حتى لا تظهر حالة جزئية
        for (const key of Array.from(apply(response))) if (!pending.get(key)) emit(key, valueOf(key));
      })
      .finally(() => {
        syncing = null;
      });
    return syncing;
  }

  function opsFor(key: SharedKey, next: unknown, previous: unknown): WriteOp[] {
    const single = SINGLE_DOCS[key];
    if (single) return [{ col: single.col, id: single.id, op: "set", data: clean({ [single.field]: next }) }];
    const cfg = COLLECTIONS[key]!;
    const current = collection(cfg.col);
    const before = new Map<string, Rec>();
    for (const item of (Array.isArray(previous) ? previous : []) as Rec[]) before.set(docId(item[cfg.idField]), clean(item));
    const ops: WriteOp[] = [];
    const seen = new Set<string>();
    const base = Date.now();
    ((Array.isArray(next) ? next : []) as Rec[]).forEach((item, index) => {
      const id = docId(item[cfg.idField]);
      seen.add(id);
      const old = before.get(id);
      const value = clean(item);
      if (old && stableStringify(old) === stableStringify(value)) return; // لم يتغير
      if (!old) {
        const order = current.get(id)?._o ?? base + index / 1000;
        ops.push({ col: cfg.col, id, op: "set", data: { ...value, _o: order } });
        return;
      }
      // عنصر موجود: تُكتب الخانات المتغيرة فقط، فلا يمس التعديل ما غيّره مستخدم آخر في نفس العنصر
      const set: Rec = {};
      const unset: string[] = [];
      for (const field of Array.from(new Set([...Object.keys(old), ...Object.keys(value)]))) {
        if (field === "_o") continue;
        if (!(field in value)) unset.push(field);
        else if (stableStringify(old[field]) !== stableStringify(value[field])) set[field] = value[field];
      }
      ops.push({ col: cfg.col, id, op: "update", set, unset });
    });
    for (const id of Array.from(before.keys())) {
      if (!seen.has(id)) ops.push({ col: cfg.col, id, op: "delete" });
    }
    return ops;
  }

  return {
    async init() {
      apply(await api<SyncResponse>("sync", undefined, { since: 0 }));
      const out: Partial<Record<SharedKey, unknown>> = {};
      for (const key of Object.keys({ ...COLLECTIONS, ...SINGLE_DOCS }) as SharedKey[]) out[key] = valueOf(key);
      return out;
    },

    async write(key, next, previous) {
      const ops = opsFor(key, next, previous);
      if (!ops.length) return;
      pending.set(key, (pending.get(key) ?? 0) + 1);
      try {
        await api("write", { ops });
      } finally {
        // جلب النسخة المحفوظة فورًا (أو إعادة القيمة الصحيحة إن رفض الخادم الحفظ).
        // مزامنة بدأت قبل الحفظ لا تحتويه، لذلك ننتظرها ثم نزامن من جديد.
        await syncing?.catch(() => {});
        await sync().catch(() => {});
        const left = (pending.get(key) ?? 1) - 1;
        pending.set(key, left);
        if (left === 0) emit(key, valueOf(key));
      }
    },

    watch(onChange) {
      emit = onChange;
      let timer = 0;
      let stopped = false;
      const tick = async () => {
        await sync().catch((error) => console.error("[sync]", error));
        if (!stopped) timer = window.setTimeout(tick, document.hidden ? HIDDEN_POLL_MS : POLL_MS);
      };
      const onVisible = () => {
        if (document.hidden || stopped) return;
        window.clearTimeout(timer);
        tick();
      };
      timer = window.setTimeout(tick, POLL_MS);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        stopped = true;
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}
