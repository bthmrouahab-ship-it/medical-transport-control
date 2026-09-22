import { describe, expect, it } from "vitest";
import { chooseVehicle, type VehicleCandidate } from "../shared/dispatch";

const vehicles: VehicleCandidate[] = [
  { plate: "A", driver: "سائق سيدان", kind: "سيدان", available: true },
  { plate: "B", driver: "سائق خاص", kind: "احتياجات خاصة", available: true },
  { plate: "C", driver: "سائق باص", kind: "باص", available: false },
];

describe("chooseVehicle", () => {
  it("prefers an accessibility vehicle for special-needs trips", () => {
    expect(chooseVehicle(vehicles, { kind: "احتياجات خاصة" })?.plate).toBe("B");
  });

  it("does not select a busy vehicle", () => {
    expect(chooseVehicle(vehicles, { kind: "باص" })?.plate).toBe("A");
  });

  it("returns null when no vehicle is available", () => {
    const busy = vehicles.map((vehicle) => ({ ...vehicle, available: false }));
    expect(chooseVehicle(busy, { kind: "سيدان" })).toBeNull();
  });
});
