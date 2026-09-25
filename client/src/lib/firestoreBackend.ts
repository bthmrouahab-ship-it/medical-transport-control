import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { SharedBackend, SharedKey } from "./appStore";

type Rec = Record<string, unknown>;

/** كل قائمة تُحفظ كمجموعة (collection) وكل عنصر فيها مستند مستقل. */
const COLLECTIONS: Partial<Record<SharedKey, { col: string; idField: string; sort?: (a: Rec, b: Rec) => number }>> = {
  fox_appointments: {
    col: "appointments",
    idField: "id",
    sort: (a, b) => String(a.appointmentAt ?? "").localeCompare(String(b.appointmentAt ?? "")),
  },
  fox_requests: { col: "requests", idField: "id" },
  fox_fleet: { col: "fleet", idField: "plate" },
  fox_hospitals: { col: "hospitals", idField: "id" },
  // مواقع GPS يكتبها السائقون مباشرة؛ هنا للقراءة والمتابعة فقط
  fox_locations: { col: "vehicleLocations", idField: "plate" },
};
/** قيم تُحفظ كمستند واحد: سجل العمليات (آخر 50 عملية) وملخص الإحصائيات السابقة. */
const SINGLE_DOCS: Partial<Record<SharedKey, { col: string; id: string; field: string }>> = {
  fox_audit: { col: "meta", id: "audit", field: "items" },
  fox_history: { col: "meta", id: "history", field: "data" },
};

/** مقارنة المحتوى بغض النظر عن ترتيب الحقول (القيم undefined تُهمل كما في Firestore). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Rec).filter((key) => (value as Rec)[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Rec)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const docId = (value: unknown) => String(value ?? "").replace(/\//g, "_") || "_";
const strip = ({ _o, ...rest }: Rec) => rest;
/** Firestore لا يقبل القيم undefined. */
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

export function createFirestoreBackend(db: Firestore): SharedBackend {
  const order = new Map<string, number>(); // col/id -> ترتيب الإنشاء
  const queues = new Map<string, Promise<void>>();
  const pending = new Map<SharedKey, number>();
  const latest = new Map<SharedKey, unknown>();
  let emit: (key: SharedKey, value: unknown) => void = () => {};

  // كتابة واحدة في كل مرة لكل مستند
  const chain = (path: string, op: () => Promise<void>) => {
    const next = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(op);
    queues.set(path, next);
    return next;
  };

  function toArray(key: SharedKey, docs: { id: string; data(): DocumentData }[]) {
    const cfg = COLLECTIONS[key]!;
    const rows = docs.map((d) => {
      const body = d.data() as Rec;
      order.set(`${cfg.col}/${d.id}`, Number(body._o ?? 0));
      return body;
    });
    rows.sort((a, b) => Number(a._o ?? 0) - Number(b._o ?? 0));
    if (cfg.sort) rows.sort(cfg.sort);
    return rows.length ? rows.map(strip) : undefined;
  }

  // أثناء وجود كتابات محلية معلّقة نؤجل تطبيق اللقطات الواردة حتى لا تظهر حالة جزئية
  function deliver(key: SharedKey, value: unknown) {
    latest.set(key, value);
    if (!pending.get(key)) emit(key, value);
  }

  return {
    async init() {
      const out: Partial<Record<SharedKey, unknown>> = {};
      for (const key of Object.keys(COLLECTIONS) as SharedKey[]) {
        const snap = await getDocs(collection(db, COLLECTIONS[key]!.col));
        out[key] = toArray(key, snap.docs);
      }
      for (const [key, cfg] of Object.entries(SINGLE_DOCS) as [SharedKey, { col: string; id: string; field: string }][]) {
        const snap = await getDoc(doc(db, cfg.col, cfg.id));
        out[key] = snap.exists() ? snap.data()[cfg.field] : undefined;
      }
      return out;
    },

    async write(key, next, previous) {
      pending.set(key, (pending.get(key) ?? 0) + 1);
      try {
        const single = SINGLE_DOCS[key];
        if (single) {
          await chain(`${single.col}/${single.id}`, () => setDoc(doc(db, single.col, single.id), { [single.field]: clean(next) }));
          return;
        }
        const cfg = COLLECTIONS[key]!;
        const before = new Map<string, string>();
        for (const item of (Array.isArray(previous) ? previous : []) as Rec[]) {
          before.set(docId(item[cfg.idField]), stableStringify(item));
        }
        const ops: Promise<void>[] = [];
        const seen = new Set<string>();
        const base = Date.now();
        ((Array.isArray(next) ? next : []) as Rec[]).forEach((item, index) => {
          const id = docId(item[cfg.idField]);
          seen.add(id);
          if (before.get(id) === stableStringify(item)) return; // لم يتغير
          const path = `${cfg.col}/${id}`;
          if (!order.has(path)) order.set(path, base + index / 1000);
          const body = clean({ ...item, _o: order.get(path) });
          ops.push(chain(path, () => setDoc(doc(db, cfg.col, id), body)));
        });
        for (const id of Array.from(before.keys())) {
          if (seen.has(id)) continue;
          const path = `${cfg.col}/${id}`;
          ops.push(chain(path, () => deleteDoc(doc(db, cfg.col, id))));
        }
        await Promise.all(ops);
      } finally {
        const left = (pending.get(key) ?? 1) - 1;
        pending.set(key, left);
        if (left === 0 && latest.has(key)) emit(key, latest.get(key));
      }
    },

    watch(onChange) {
      emit = onChange;
      const offs = (Object.keys(COLLECTIONS) as SharedKey[]).map((key) =>
        onSnapshot(
          collection(db, COLLECTIONS[key]!.col),
          (snap) => deliver(key, toArray(key, snap.docs)),
          (error) => console.error("[firestore]", key, error),
        ),
      );
      for (const [key, cfg] of Object.entries(SINGLE_DOCS) as [SharedKey, { col: string; id: string; field: string }][]) {
        offs.push(
          onSnapshot(
            doc(db, cfg.col, cfg.id),
            (snap) => deliver(key, snap.exists() ? snap.data()[cfg.field] : undefined),
            (error) => console.error("[firestore]", key, error),
          ),
        );
      }
      return () => offs.forEach((off) => off());
    },
  };
}
