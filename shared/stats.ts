import { DEFAULT_HOSPITALS, matchHospital, normalizePlaceName, type Hospital } from "./hospitals";
import type { HistorySummary } from "./history";
import type { ClinicAppointment, Vehicle, VehicleRequest } from "./transport";

/**
 * سجلات الرحلات للإحصائيات: رحلة واحدة لكل موعد، بلا اسم المريض أو رقمه أو شقته.
 * مصادرها: ملفات Excel المستوردة (تُحفظ يومًا بيوم)، ورحلات النظام نفسه (تُحسب مباشرة من المواعيد والطلبات).
 */

export type TripKind = "سيدان" | "احتياجات خاصة" | "باص";
export const TRIP_KINDS: TripKind[] = ["سيدان", "احتياجات خاصة", "باص"];

export type TripStat = {
  /** تاريخ الرحلة YYYY-MM-DD */
  date: string;
  /** ساعة خروج السيارة */
  hour: number | null;
  /** نوع المركبة التي خرجت؛ null = لم تخرج سيارة */
  kind: TripKind | null;
  hospitalId: string | null;
  /** اسم الوجهة (للوجهات خارج دليل المستشفيات) */
  place: string;
  plate: string | null;
  driver: string | null;
  building: string | null;
  /** مدة الرحلة من خروج السيارة إلى عودتها */
  minutes: number | null;
  nonMedical: boolean;
  /** من الملخص القديم: العدد اليومي ونوع المركبة فقط، بلا ساعة أو وجهة أو سيارة */
  legacy?: boolean;
};

/** مستند يوم في المجموعة statsDays: رحلات يوم واحد من ملف Excel. */
export type StatsDay = { date: string; source: string; importedAt: string; trips: TripStat[] };

export type StatsSource = "all" | "excel" | "system";
export type StatsCategory = "all" | "medical" | "nonMedical";

export type StatsFilter = {
  /** "" = بلا حد */
  from: string;
  to: string;
  source: StatsSource;
  kind: TripKind | "all";
  zone: string;
  destination: string;
  plate: string;
  building: string;
  category: StatsCategory;
};

export const EMPTY_FILTER: StatsFilter = {
  from: "",
  to: "",
  source: "all",
  kind: "all",
  zone: "all",
  destination: "all",
  plate: "all",
  building: "all",
  category: "all",
};

export type DailyStat = { date: string; weekday: string; total: number; completed: number; sedan: number; special: number; bus: number };
export type DestinationStat = { key: string; name: string; hospitalId: string | null; zone: string | null; trips: number; avgMinutes: number | null };

export type StatsSummary = {
  from: string;
  to: string;
  totalTrips: number;
  completedTrips: number;
  activeDays: number;
  avgTripMinutes: number | null;
  daily: DailyStat[];
  byWeekday: { weekday: string; trips: number; days: number }[];
  byHour: { hour: number; trips: number }[];
  byKind: { kind: TripKind; trips: number }[];
  destinations: DestinationStat[];
  zones: { zone: string; trips: number }[];
  vehicles: { plate: string; driver: string; trips: number }[];
  buildings: { building: string; trips: number }[];
  unmatchedDestinations: number;
  /** رحلات منجزة من الملخص القديم لا تظهر في الساعات والوجهات والسيارات والمباني */
  withoutDetails?: number;
};

export const OTHER_ZONE = "وجهات أخرى";
const WEEKDAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function hospitalOf(trip: Pick<TripStat, "hospitalId">, hospitals: Hospital[]) {
  return trip.hospitalId ? hospitals.find((hospital) => hospital.id === trip.hospitalId) ?? null : null;
}

export function tripZone(trip: TripStat, hospitals: Hospital[]) {
  return hospitalOf(trip, hospitals)?.zone ?? OTHER_ZONE;
}

type Destination = { key: string; name: string; hospitalId: string | null; zone: string | null };

export function tripDestination(trip: TripStat, hospitals: Hospital[]): Destination {
  const hospital = hospitalOf(trip, hospitals);
  if (hospital) return { key: `h:${hospital.id}`, name: hospital.name, hospitalId: hospital.id, zone: hospital.zone };
  const name = trip.place || "غير محدد";
  return { key: trip.hospitalId ? `h:${trip.hospitalId}` : `t:${normalizePlaceName(name) || "غير محدد"}`, name, hospitalId: trip.hospitalId, zone: null };
}

// ————— رحلات النظام —————

function hourOf(time: string | undefined) {
  const match = time?.match(/^(\d{1,2}):\d{2}/);
  return match && Number(match[1]) < 24 ? Number(match[1]) : null;
}

/** رحلات النظام: كل موعد رحلة، وتُعتبر منجزة إذا أُرسلت لها سيارة. */
export function tripsFromSystem(
  appointments: ClinicAppointment[],
  requests: VehicleRequest[],
  fleet: Pick<Vehicle, "plate" | "kind">[],
  hospitals: Hospital[] = DEFAULT_HOSPITALS,
): TripStat[] {
  const byAppointment = new Map<string, VehicleRequest[]>();
  for (const request of requests) byAppointment.set(request.appointmentId, [...(byAppointment.get(request.appointmentId) ?? []), request]);
  return appointments.map((appointment) => {
    const sent = (byAppointment.get(appointment.id) ?? []).filter((request) => request.vehiclePlate);
    const request = sent.find((item) => item.direction === "ذهاب") ?? sent[0];
    const nonMedical = appointment.category === "غير طبية";
    const hospital = nonMedical
      ? null
      : (appointment.hospitalId && hospitals.find((item) => item.id === appointment.hospitalId)) || matchHospital(appointment.clinic, hospitals);
    const fleetKind = request ? fleet.find((vehicle) => vehicle.plate === request.vehiclePlate)?.kind : undefined;
    const kind: TripKind | null = request ? fleetKind ?? (appointment.kind === "احتياجات خاصة" ? "احتياجات خاصة" : "سيدان") : null;
    const building = appointment.buildingNumber.trim();
    return {
      date: appointment.appointmentDate,
      hour: hourOf(request?.notificationSentAt) ?? hourOf(appointment.appointmentAt),
      kind,
      hospitalId: hospital?.id ?? (nonMedical ? null : appointment.hospitalId ?? null),
      place: hospital?.name ?? appointment.clinic,
      plate: request?.vehiclePlate ?? null,
      driver: request?.driver ?? null,
      building: building && building !== "غير محدد" ? building : null,
      minutes: null,
      nonMedical,
    };
  });
}

// ————— الملخص القديم (إجماليات فقط) —————

/** الملخص القديم يحفظ لكل يوم العدد ونوع المركبة فقط؛ يُحوَّل إلى سجلات بلا تفاصيل. */
export function legacyTrips(summary: HistorySummary): TripStat[] {
  const trips: TripStat[] = [];
  const make = (date: string, kind: TripKind | null): TripStat => ({
    date, hour: null, kind, hospitalId: null, place: "", plate: null, driver: null, building: null, minutes: null, nonMedical: false, legacy: true,
  });
  for (const day of summary.daily) {
    for (let index = 0; index < day.sedan; index += 1) trips.push(make(day.date, "سيدان"));
    for (let index = 0; index < day.special; index += 1) trips.push(make(day.date, "احتياجات خاصة"));
    for (let index = 0; index < day.bus; index += 1) trips.push(make(day.date, "باص"));
    for (let index = 0; index < day.total - day.completed; index += 1) trips.push(make(day.date, null));
  }
  return trips;
}

function groupByDate(trips: TripStat[]) {
  const days = new Map<string, TripStat[]>();
  for (const trip of trips) days.set(trip.date, [...(days.get(trip.date) ?? []), trip]);
  return days;
}

/**
 * يجمع المصادر. لكل يوم مصدر واحد حتى لا تُحسب الرحلة مرتين:
 * ملف Excel المستورد لذلك اليوم، ثم الملخص القديم، ثم رحلات النظام.
 * تفاصيل الملخص القديم (الساعات والوجهات والسيارات) لا تُستخدم إلا إذا لم يُستبدل أي يوم منه.
 */
export function selectTrips(
  sources: { imported: StatsDay[]; legacy: HistorySummary | null; system: TripStat[] },
  source: StatsSource,
) {
  const excelDays = new Map<string, TripStat[]>();
  for (const day of sources.imported) excelDays.set(day.date, day.trips);
  const importedDates = new Set(excelDays.keys());
  let legacyUsable = Boolean(sources.legacy);
  if (sources.legacy) {
    for (const [date, trips] of Array.from(groupByDate(legacyTrips(sources.legacy)))) {
      if (importedDates.has(date)) legacyUsable = false;
      else excelDays.set(date, trips);
    }
  }
  const systemDays = groupByDate(sources.system);
  const trips: TripStat[] = [];
  let excelCount = 0;
  let systemCount = 0;
  if (source !== "system") {
    for (const list of Array.from(excelDays.values())) trips.push(...list);
    excelCount = excelDays.size;
  }
  if (source !== "excel") {
    for (const [date, list] of Array.from(systemDays)) {
      if (source === "all" && excelDays.has(date)) continue;
      trips.push(...list);
      systemCount += 1;
    }
  }
  return {
    trips,
    legacy: source !== "system" && legacyUsable ? sources.legacy : null,
    days: { excel: excelCount, system: systemCount },
  };
}

// ————— الفلترة —————

export function inRange(date: string, filter: Pick<StatsFilter, "from" | "to">) {
  return (!filter.from || date >= filter.from) && (!filter.to || date <= filter.to);
}

/** فلاتر لا يستطيع الملخص القديم تطبيقها على الساعات والوجهات والسيارات. */
export function hasDetailFilters(filter: StatsFilter) {
  return filter.kind !== "all" || filter.zone !== "all" || filter.destination !== "all"
    || filter.plate !== "all" || filter.building !== "all" || filter.category !== "all";
}

export function matchesFilter(trip: TripStat, filter: StatsFilter, hospitals: Hospital[]) {
  if (!inRange(trip.date, filter)) return false;
  if (filter.kind !== "all" && trip.kind !== filter.kind) return false;
  if (filter.category === "medical" && trip.nonMedical) return false;
  if (filter.category === "nonMedical" && !trip.nonMedical) return false;
  if (filter.plate !== "all" && trip.plate !== filter.plate) return false;
  if (filter.building !== "all" && trip.building !== filter.building) return false;
  if (filter.zone !== "all" && (trip.legacy || tripZone(trip, hospitals) !== filter.zone)) return false;
  if (filter.destination !== "all" && (trip.legacy || tripDestination(trip, hospitals).key !== filter.destination)) return false;
  return true;
}

/** قيم قوائم الفلترة من رحلات الفترة المختارة، الأكثر تكرارًا أولًا. */
export function filterOptions(trips: TripStat[], hospitals: Hospital[]) {
  const zones = new Map<string, number>();
  const destinations = new Map<string, { name: string; zone: string; trips: number }>();
  const plates = new Map<string, number>();
  const buildings = new Map<string, number>();
  for (const trip of trips) {
    if (trip.legacy) continue;
    const zone = tripZone(trip, hospitals);
    zones.set(zone, (zones.get(zone) ?? 0) + 1);
    const destination = tripDestination(trip, hospitals);
    const entry = destinations.get(destination.key) ?? { name: destination.name, zone, trips: 0 };
    entry.trips += 1;
    destinations.set(destination.key, entry);
    if (trip.plate) plates.set(trip.plate, (plates.get(trip.plate) ?? 0) + 1);
    if (trip.building) buildings.set(trip.building, (buildings.get(trip.building) ?? 0) + 1);
  }
  const ranked = <T,>(map: Map<string, T>, count: (value: T) => number) =>
    Array.from(map).sort((a, b) => count(b[1]) - count(a[1]));
  return {
    zones: ranked(zones, (value) => value).map(([zone]) => zone),
    destinations: ranked(destinations, (value) => value.trips).map(([key, value]) => ({ key, name: value.name, zone: value.zone })),
    plates: ranked(plates, (value) => value).map(([plate]) => plate),
    buildings: Array.from(buildings.keys()).sort((a, b) => a.localeCompare(b, "ar", { numeric: true })),
  };
}

// ————— التجميع —————

const sortDesc = <T extends { trips: number }>(items: T[]) => items.sort((a, b) => b.trips - a.trips);

/**
 * يلخّص الرحلات للمخططات. الساعات والوجهات والسيارات والمباني ومدة الرحلة تُحسب للرحلات المنجزة فقط.
 * legacy: تفاصيل الملخص القديم تُضاف كما هي عندما تشمل الفترة المختارة كل أيامه ولا توجد فلاتر أخرى.
 */
export function summarizeTrips(trips: TripStat[], hospitals: Hospital[] = DEFAULT_HOSPITALS, legacy: HistorySummary | null = null): StatsSummary {
  const daily = new Map<string, DailyStat>();
  const hours = new Map<number, number>();
  const kinds = new Map<TripKind, number>();
  const zones = new Map<string, number>();
  const vehicles = new Map<string, { drivers: Map<string, number>; trips: number }>();
  const buildings = new Map<string, number>();
  const destinations = new Map<string, DestinationStat & { minutesTotal: number; minutesCount: number }>();
  let completedTrips = 0;
  let unmatched = 0;
  let withoutDetails = 0;
  let minutesTotal = 0;
  let minutesCount = 0;

  const addDestination = (destination: Destination, count: number, minutes: number, minutesWeight: number) => {
    const entry = destinations.get(destination.key) ?? { ...destination, trips: 0, avgMinutes: null, minutesTotal: 0, minutesCount: 0 };
    entry.trips += count;
    entry.minutesTotal += minutes;
    entry.minutesCount += minutesWeight;
    destinations.set(destination.key, entry);
  };
  const addVehicle = (plate: string, driver: string, count: number) => {
    const entry = vehicles.get(plate) ?? { drivers: new Map<string, number>(), trips: 0 };
    entry.trips += count;
    for (const name of driver.split(" / ").map((item) => item.trim()).filter(Boolean)) entry.drivers.set(name, (entry.drivers.get(name) ?? 0) + count);
    vehicles.set(plate, entry);
  };

  for (const trip of trips) {
    const day = daily.get(trip.date) ?? { date: trip.date, weekday: weekdayOf(trip.date), total: 0, completed: 0, sedan: 0, special: 0, bus: 0 };
    daily.set(trip.date, day);
    day.total += 1;
    if (!trip.kind) continue;
    completedTrips += 1;
    day.completed += 1;
    if (trip.kind === "سيدان") day.sedan += 1;
    else if (trip.kind === "احتياجات خاصة") day.special += 1;
    else day.bus += 1;
    kinds.set(trip.kind, (kinds.get(trip.kind) ?? 0) + 1);
    if (trip.legacy) {
      withoutDetails += 1;
      continue;
    }
    if (trip.hour !== null) hours.set(trip.hour, (hours.get(trip.hour) ?? 0) + 1);
    if (trip.minutes !== null) {
      minutesTotal += trip.minutes;
      minutesCount += 1;
    }
    const destination = tripDestination(trip, hospitals);
    if (!destination.hospitalId) unmatched += 1;
    addDestination(destination, 1, trip.minutes ?? 0, trip.minutes === null ? 0 : 1);
    const zone = tripZone(trip, hospitals);
    zones.set(zone, (zones.get(zone) ?? 0) + 1);
    if (trip.plate) addVehicle(trip.plate, trip.driver ?? "", 1);
    if (trip.building) buildings.set(trip.building, (buildings.get(trip.building) ?? 0) + 1);
  }

  if (legacy) {
    withoutDetails = 0;
    for (const item of legacy.byHour) hours.set(item.hour, (hours.get(item.hour) ?? 0) + item.trips);
    for (const item of legacy.destinations) {
      const hospital = item.hospitalId ? hospitals.find((entry) => entry.id === item.hospitalId) : undefined;
      const destination = hospital
        ? { key: `h:${hospital.id}`, name: hospital.name, hospitalId: hospital.id, zone: hospital.zone }
        : { key: item.key, name: item.name, hospitalId: item.hospitalId, zone: item.zone };
      addDestination(destination, item.trips, (item.avgMinutes ?? 0) * item.trips, item.avgMinutes === null ? 0 : item.trips);
    }
    for (const item of legacy.zones) zones.set(item.zone, (zones.get(item.zone) ?? 0) + item.trips);
    for (const item of legacy.vehicles) addVehicle(item.plate, item.driver, item.trips);
    for (const item of legacy.buildings) buildings.set(item.building, (buildings.get(item.building) ?? 0) + item.trips);
    if (legacy.avgTripMinutes !== null) {
      minutesTotal += legacy.avgTripMinutes * legacy.completedTrips;
      minutesCount += legacy.completedTrips;
    }
    unmatched += legacy.unmatchedDestinations;
  }

  const days = Array.from(daily.values()).sort((a, b) => a.date.localeCompare(b.date));
  const weekdayMap = new Map<string, { trips: number; days: number }>();
  for (const day of days) {
    const entry = weekdayMap.get(day.weekday) ?? { trips: 0, days: 0 };
    entry.trips += day.total;
    entry.days += 1;
    weekdayMap.set(day.weekday, entry);
  }

  return {
    from: days[0]?.date ?? "",
    to: days[days.length - 1]?.date ?? "",
    totalTrips: trips.length,
    completedTrips,
    activeDays: days.length,
    avgTripMinutes: minutesCount ? Math.round(minutesTotal / minutesCount) : null,
    daily: days,
    byWeekday: WEEKDAYS.map((weekday) => ({ weekday, trips: weekdayMap.get(weekday)?.trips ?? 0, days: weekdayMap.get(weekday)?.days ?? 0 })),
    byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, trips: hours.get(hour) ?? 0 })),
    byKind: TRIP_KINDS.map((kind) => ({ kind, trips: kinds.get(kind) ?? 0 })),
    destinations: sortDesc(Array.from(destinations.values()).map(({ minutesTotal: total, minutesCount: count, ...item }) => ({
      ...item,
      avgMinutes: count ? Math.round(total / count) : null,
    }))),
    zones: sortDesc(Array.from(zones, ([zone, count]) => ({ zone, trips: count }))),
    vehicles: sortDesc(Array.from(vehicles, ([plate, vehicle]) => ({
      plate,
      driver: Array.from(vehicle.drivers).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3).join(" / "),
      trips: vehicle.trips,
    }))),
    buildings: sortDesc(Array.from(buildings, ([building, count]) => ({ building, trips: count }))),
    unmatchedDestinations: unmatched,
    withoutDetails,
  };
}
