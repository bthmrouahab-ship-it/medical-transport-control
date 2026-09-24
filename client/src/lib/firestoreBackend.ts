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
};
/** سجل العمليات (آخر 50 عملية) يُحفظ في مستند واحد. */
const AUDIT = { col: "meta", id: "audit" };

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
      const audit = await getDoc(doc(db, AUDIT.col, AUDIT.id));
      out.fox_audit = audit.exists() ? audit.data().items : undefined;
      return out;
    },

    async write(key, next, previous) {
      pending.set(key, (pending.get(key) ?? 0) + 1);
      try {
        if (key === "fox_audit") {
          await chain(`${AUDIT.col}/${AUDIT.id}`, () => setDoc(doc(db, AUDIT.col, AUDIT.id), { items: clean(next) }));
          return;
        }
        const cfg = COLLECTIONS[key]!;
        const before = new Map<string, string>();
        for (const item of (Array.isArray(previous) ? previous : []) as Rec[]) {
          before.set(docId(item[cfg.idField]), JSON.stringify(item));
        }
        const ops: Promise<void>[] = [];
        const seen = new Set<string>();
        const base = Date.now();
        ((Array.isArray(next) ? next : []) as Rec[]).forEach((item, index) => {
          const id = docId(item[cfg.idField]);
          seen.add(id);
          if (before.get(id) === JSON.stringify(item)) return; // لم يتغير
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
      offs.push(
        onSnapshot(
          doc(db, AUDIT.col, AUDIT.id),
          (snap) => deliver("fox_audit", snap.exists() ? snap.data().items : undefined),
          (error) => console.error("[firestore] audit", error),
        ),
      );
      return () => offs.forEach((off) => off());
    },
  };
}
