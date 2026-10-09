import { distanceKm } from "./hospitals";

/**
 * مسافة الطريق الفعلي بالسيارة بين الأماكن المعروفة (المستشفيات ووجهات الرحلات غير الطبية والمجمع)، لا الخط المستقيم:
 * جدول يُحسب مرة واحدة من خدمة الطرق OSRM (خرائط OpenStreetMap) ويُحفظ في meta/roads، ويُعاد حسابه عند تغيّر الأماكن.
 * يجمع الرحلات بحسبه (calculateTripGroupingScore). المكان خارج الجدول (أو قبل حسابه) يُقدَّر بالخط المستقيم × معامل الطريق.
 */
export type RoadPoint = { id: string; lat: number; lng: number };
export type RoadMatrix = {
  /** رقم كل مكان بترتيب الصفوف والأعمدة */
  ids: string[];
  /** مسافة الطريق من الصف i إلى العمود j بأعشار الكيلومتر (i * ids.length + j)، أو -1 إن لم يوجد طريق */
  km: number[];
  /** بصمة الأماكن وإحداثياتها: تغيّرها يعني إعادة الحساب */
  key: string;
  at: string;
};

/** خدمة الطرق (OSRM العامة، بلا مفتاح): جدول المسافات كلها في طلب واحد */
export const ROAD_SERVICE = "https://router.project-osrm.org/table/v1/driving/";
export const ROAD_MAX_POINTS = 100;

let current: RoadMatrix | null = null;
let index = new Map<string, number>();

/** جدول مسافات الطرق المستعمل الآن (من meta/roads)، أو null */
export function setRoadMatrix(matrix: RoadMatrix | null) {
  current = matrix && Array.isArray(matrix.ids) && Array.isArray(matrix.km) && matrix.km.length === matrix.ids.length ** 2 ? matrix : null;
  index = new Map((current?.ids ?? []).map((id, at) => [id, at]));
}

/** الطريق بالتقدير: الخط المستقيم × 1.4 داخل المدينة (أقل من 10 كم) و× 1.25 للأطول (كما في driveMinutes) */
export const estimatedRoadKm = (straightKm: number) => straightKm * (straightKm < 10 ? 1.4 : 1.25);

/**
 * مسافة الطريق بين مكانين بالكيلومتر: من الجدول (الأقصر من الاتجاهين، فبعض الطرق باتجاه واحد)، وإلا تقديرها من الخط المستقيم.
 */
export function roadKm(a: { id?: string; lat: number; lng: number }, b: { id?: string; lat: number; lng: number }) {
  if (a.id && b.id && a.id === b.id) return 0;
  const i = a.id !== undefined ? index.get(a.id) : undefined;
  const j = b.id !== undefined ? index.get(b.id) : undefined;
  if (current && i !== undefined && j !== undefined) {
    const n = current.ids.length;
    const values = [current.km[i * n + j], current.km[j * n + i]].filter((value) => typeof value === "number" && value >= 0);
    if (values.length) return Math.min(...values) / 10;
  }
  return estimatedRoadKm(distanceKm(a, b));
}

/** بصمة الأماكن (الرقم والإحداثيات بخمس خانات) لمعرفة متى يُعاد الحساب */
export function roadKey(points: RoadPoint[]) {
  const text = [...points].sort((a, b) => a.id.localeCompare(b.id)).map((point) => `${point.id}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join("|");
  let hash = 5381;
  for (let at = 0; at < text.length; at++) hash = ((hash * 33) ^ text.charCodeAt(at)) >>> 0;
  return `${points.length}-${hash.toString(36)}`;
}

/** جدول المسافات من خدمة الطرق (يُستدعى من صفحة المدير أو مشرف السيارات حين تتغير الأماكن) */
export async function fetchRoadMatrix(points: RoadPoint[], fetcher: typeof fetch = fetch): Promise<RoadMatrix> {
  const list = points.slice(0, ROAD_MAX_POINTS);
  const coordinates = list.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(";");
  const response = await fetcher(`${ROAD_SERVICE}${coordinates}?annotations=distance`);
  if (!response.ok) throw new Error(`road service ${response.status}`);
  const data = await response.json() as { code?: string; distances?: (number | null)[][] };
  if (data.code !== "Ok" || !Array.isArray(data.distances) || data.distances.length !== list.length) throw new Error("road service: bad response");
  const km = data.distances.flatMap((row) => list.map((_, j) => (typeof row?.[j] === "number" ? Math.round(row[j]! / 100) : -1)));
  return { ids: list.map((point) => point.id), km, key: roadKey(list), at: new Date().toISOString() };
}

// ————— مسار الطريق على الخريطة —————

/** خدمة المسار (OSRM العامة): خط الطريق الذي تسلكه السيارة بين نقطتين أو أكثر */
export const ROUTE_SERVICE = "https://router.project-osrm.org/route/v1/driving/";

export type RoadRoute = {
  /** نقاط الطريق [خط العرض، خط الطول] */
  path: [number, number][];
  km: number;
  minutes: number;
};

/** مسار الطريق بين النقاط بالترتيب (من السيارة إلى نقطة الاستلام أو الوجهة) */
export async function fetchRoute(points: { lat: number; lng: number }[], fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<RoadRoute> {
  if (points.length < 2) throw new Error("route: two points needed");
  const coordinates = points.map((point) => `${point.lng.toFixed(6)},${point.lat.toFixed(6)}`).join(";");
  const response = await fetcher(`${ROUTE_SERVICE}${coordinates}?overview=full&geometries=geojson`, { signal });
  if (!response.ok) throw new Error(`route service ${response.status}`);
  const data = await response.json() as { code?: string; routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] } }[] };
  const route = data.routes?.[0];
  const line = route?.geometry?.coordinates;
  if (data.code !== "Ok" || !route || !Array.isArray(line) || line.length < 2) throw new Error("route service: bad response");
  return {
    path: line.filter((pair) => Array.isArray(pair) && Number.isFinite(pair[0]) && Number.isFinite(pair[1])).map(([lng, lat]) => [lat, lng]),
    km: Math.round((route.distance ?? 0) / 100) / 10,
    minutes: Math.round((route.duration ?? 0) / 60),
  };
}
