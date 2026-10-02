import { describe, expect, it } from "vitest";
import {
  DEFAULT_VEHICLES,
  assignVehicle,
  inService,
  vehicleRestriction,
  type ClinicAppointment,
  type Vehicle,
} from "../shared/transport";
import { assignDrivers, driverOfAccount, newDriverId, validateDriver, vehicleOfDriver, type Driver } from "../shared/drivers";
import { DRIVERS_SEED } from "../shared/seedData";

const drivers: Driver[] = [
  { id: "D-1", name: "سائق أول", phone: "55500001", uid: "7" },
  { id: "D-2", name: "سائق ثان", phone: "55500002" },
  { id: "D-3", name: "سائق ثالث", phone: "55500003" },
];
const car = (plate: string, driver?: Driver): Vehicle => ({
  plate, kind: "سيدان", available: true,
  ...(driver ? { driverId: driver.id, driver: driver.name, phone: driver.phone ?? "", driverSince: "2026-10-01T03:00:00.000Z" } : { driver: "", phone: "" }),
});
const appointment = { id: "A1", kind: "عادي", assistance: [], category: "طبية" } as unknown as ClinicAppointment;
const now = new Date("2026-10-02T04:00:00.000Z");

describe("drivers separate from vehicles", () => {
  it("validates and normalizes a driver", () => {
    expect(validateDriver({ name: "  أحمد   علي ", phone: "5512 3456" }, drivers)).toEqual({ driver: { name: "أحمد علي", phone: "55123456" } });
    expect(validateDriver({ name: "ع", phone: "55123456" }, drivers)).toHaveProperty("error");
    expect(validateDriver({ name: "علي", phone: "123" }, drivers)).toHaveProperty("error");
    // نفس الاسم والرقم مسجل، إلا عند تعديل نفس السائق
    expect(validateDriver({ name: "سائق أول", phone: "55500001" }, drivers)).toHaveProperty("error");
    expect(validateDriver({ name: "سائق أول", phone: "55500001" }, drivers, "D-1")).toHaveProperty("driver");
    // اسمان متشابهان برقمين مختلفين: سائقان مختلفان
    expect(validateDriver({ name: "سائق أول", phone: "55500009" }, drivers)).toHaveProperty("driver");
    expect(newDriverId(drivers)).toBe("D-4");
    expect(newDriverId([])).toBe("D-1");
    expect(driverOfAccount(drivers, "7")?.id).toBe("D-1");
  });

  it("assigns a driver to a vehicle, copying the name and phone", () => {
    const next = assignDrivers([car("111"), car("222", drivers[1])], drivers, new Map([["111", "D-1"]]), now);
    expect(next[0]).toMatchObject({ plate: "111", driverId: "D-1", driver: "سائق أول", phone: "55500001", driverSince: now.toISOString() });
    // السيارة التي لم يتغير سائقها تبقى كما هي
    expect(next[1]).toEqual(car("222", drivers[1]));
    expect(vehicleOfDriver(next, "D-1")?.plate).toBe("111");
  });

  it("moves a driver between vehicles: the previous one is left without a driver", () => {
    const vehicles = [car("111", drivers[0]), car("222", drivers[1])];
    const next = assignDrivers(vehicles, drivers, new Map([["222", "D-1"]]), now);
    expect(next.find((vehicle) => vehicle.plate === "222")).toMatchObject({ driverId: "D-1", driver: "سائق أول" });
    const left = next.find((vehicle) => vehicle.plate === "111")!;
    expect(left.driverId).toBeUndefined();
    expect(left.driver).toBe("");
    expect(left.phone).toBe("");
    // تبديل السائقين بين سيارتين في حفظ واحد
    const swapped = assignDrivers(vehicles, drivers, new Map([["111", "D-2"], ["222", "D-1"]]), now);
    expect(swapped.map((vehicle) => vehicle.driverId)).toEqual(["D-2", "D-1"]);
  });

  it("clears a vehicle's driver (null) and keeps unchanged vehicles", () => {
    const vehicles = [car("111", drivers[0]), car("222")];
    const next = assignDrivers(vehicles, drivers, new Map<string, string | null>([["111", null], ["222", null]]), now);
    expect(next[0]).toMatchObject({ driver: "", phone: "" });
    expect(next[0].driverSince).toBeUndefined();
    expect(next[1]).toBe(vehicles[1]);
  });

  it("a vehicle without a driver is not sent on trips", () => {
    const empty = car("111");
    const driven = car("222", drivers[0]);
    expect(inService(empty)).toBe(false);
    expect(inService(driven)).toBe(true);
    expect(inService({ ...driven, available: false })).toBe(false);
    expect(vehicleRestriction(empty, { appointments: [appointment] }, { now })).toBe("بلا سائق");
    expect(vehicleRestriction({ ...empty, available: false }, { appointments: [appointment] }, { now })).toBe("خارج الخدمة");
    expect(vehicleRestriction(driven, { appointments: [appointment] }, { now })).toBeNull();
    expect(assignVehicle([empty, driven], "عادي")?.plate).toBe("222");
    expect(assignVehicle([empty], "عادي")).toBeNull();
  });

  it("the initial fleet: each vehicle assigned to its own driver", () => {
    expect(DRIVERS_SEED).toHaveLength(DEFAULT_VEHICLES.length);
    DEFAULT_VEHICLES.forEach((vehicle, index) => {
      expect(vehicle.driverId).toBe(DRIVERS_SEED[index].id);
      expect(vehicle.driver).toBe(DRIVERS_SEED[index].name);
      expect(vehicle.phone).toBe(DRIVERS_SEED[index].phone);
    });
    expect(new Set(DRIVERS_SEED.map((driver) => driver.id)).size).toBe(DRIVERS_SEED.length);
  });
});
