export type VehicleCandidate = {
  plate: string;
  driver: string;
  kind: "سيدان" | "احتياجات خاصة" | "باص";
  available: boolean;
};

export type DispatchRequest = {
  kind: VehicleCandidate["kind"];
  requiresAccessibility?: boolean;
};

/**
 * Deterministic first-pass dispatcher for the MVP.
 * Accessibility requests are strict; normal requests prefer the requested type.
 */
export function chooseVehicle(vehicles: VehicleCandidate[], request: DispatchRequest) {
  const available = vehicles.filter((vehicle) => vehicle.available);
  if (request.requiresAccessibility || request.kind === "احتياجات خاصة") {
    return available.find((vehicle) => vehicle.kind === "احتياجات خاصة") ?? null;
  }
  return available.find((vehicle) => vehicle.kind === request.kind)
    ?? available.find((vehicle) => vehicle.kind === "سيدان")
    ?? available[0]
    ?? null;
}
