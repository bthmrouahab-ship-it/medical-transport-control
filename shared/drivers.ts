import { normalizeMobile, toText } from "./text";
import type { Vehicle } from "./transport";

/**
 * السائق مستقل عن السيارة: اسمه ورقم موبايله، وحساب تطبيق السائق المرتبط به (uid، يربطه المدير من «المستخدمين»).
 * مشرف السيارات يختار السائق لكل سيارة في بداية الشفت، ويبقى آخر تخصيص محفوظًا حتى يغيّره.
 */
export type Driver = { id: string; name: string; phone?: string; uid?: string };

/** بداية الاسم المركب: «عبد الله» و«أبو بكر» كلمة واحدة في الاسم المختصر */
const COMPOUND_PREFIXES = new Set(["عبد", "ابو", "أبو", "abd", "abdul", "abu"]);
/** الكلمة الأقصر من هذا (مثل «Md» و«M.») لا تكفي وحدها، فتُضاف إليها الكلمة التالية */
const SHORT_WORD_LETTERS = 3;

/**
 * اسم السائق المختصر في قائمة «السيارات» وعلى الخريطة: أول كلمة من اسمه، ومعها التالية ما دامت الكلمة أقصر من
 * ثلاثة أحرف أو بداية اسم مركب («Md Rahim»، و«عبد الله»، و«Md abu bokor» كاملًا).
 * الاسم الكامل يظهر عند المرور على السيارة وفي تفاصيلها.
 */
export function shortDriverName(name?: string) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  // الحروف اللاتينية والعربية فقط (بلا النقطة والشرطة)
  const needsNext = (word: string) => (word.match(/[A-Za-z\u00C0-\u024F\u0600-\u06FF]/g) ?? []).length < SHORT_WORD_LETTERS || COMPOUND_PREFIXES.has(word.toLowerCase());
  let count = 1;
  while (count < words.length && needsNext(words[count - 1])) count += 1;
  return words.slice(0, count).join(" ");
}

/** يتحقق من بيانات سائق قبل الحفظ (المدير) ويعيدها بصيغة موحدة، أو رسالة الخطأ. */
export function validateDriver(
  input: { name: string; phone: string },
  drivers: Driver[],
  originalId?: string,
): { driver: { name: string; phone: string } } | { error: string } {
  const name = toText(input.name).replace(/\s+/g, " ");
  const phone = normalizeMobile(input.phone);
  if (name.length < 2 || name.length > 60) return { error: "اسم السائق يجب أن يكون من 2 إلى 60 حرفًا" };
  if (!/^\+?\d{8,15}$/.test(phone)) return { error: "رقم موبايل السائق يجب أن يكون من 8 إلى 15 رقمًا" };
  if (drivers.some((driver) => driver.id !== originalId && driver.name === name && (driver.phone ?? "") === phone)) {
    return { error: `السائق ${name} مسجل مسبقًا بنفس الرقم` };
  }
  return { driver: { name, phone } };
}

/** رقم سائق جديد: D-1، D-2، ... */
export function newDriverId(drivers: Pick<Driver, "id">[]) {
  const top = drivers.reduce((max, driver) => Math.max(max, Number(/^D-(\d+)$/.exec(driver.id)?.[1] ?? 0)), 0);
  return `D-${top + 1}`;
}

/** السيارة التي يقودها السائق الآن */
export const vehicleOfDriver = (vehicles: Vehicle[], driverId: string) => vehicles.find((vehicle) => vehicle.driverId === driverId);

/** السائق المرتبط بحساب تطبيق السائق */
export const driverOfAccount = (drivers: Driver[], uid: string) => drivers.find((driver) => driver.uid === uid);

/** السيارة مع سائقها (اسمه ورقمه منسوخان فيها لكل الصفحات)، أو بلا سائق. */
function withDriver(vehicle: Vehicle, driver: Driver | undefined, now: Date): Vehicle {
  const { driverId: _id, driverSince: _since, ...rest } = vehicle;
  return driver
    ? { ...rest, driverId: driver.id, driver: driver.name, phone: driver.phone ?? "", driverSince: now.toISOString() }
    : { ...rest, driver: "", phone: "" };
}

/**
 * تخصيص السائقين للسيارات: assignments رقم السيارة ← رقم السائق (أو null = بلا سائق).
 * السائق في سيارة واحدة فقط: إن خُصّص لسيارة وهو في غيرها تبقى السابقة بلا سائق (ما لم يُخصّص لها غيره).
 * السيارة التي لم يتغير سائقها تبقى كما هي (ومعها وقت استلامه لها).
 */
export function assignDrivers(vehicles: Vehicle[], drivers: Driver[], assignments: Map<string, string | null>, now = new Date()): Vehicle[] {
  const byId = new Map(drivers.map((driver) => [driver.id, driver]));
  const moved = new Set(Array.from(assignments.values()).filter((id): id is string => Boolean(id)));
  return vehicles.map((vehicle) => {
    if (assignments.has(vehicle.plate)) {
      const driver = byId.get(assignments.get(vehicle.plate) ?? "");
      if ((driver?.id ?? null) === (vehicle.driverId ?? null) && (driver || !vehicle.driver)) return vehicle;
      return withDriver(vehicle, driver, now);
    }
    if (vehicle.driverId && moved.has(vehicle.driverId)) return withDriver(vehicle, undefined, now);
    return vehicle;
  });
}
