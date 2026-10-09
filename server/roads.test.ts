import { afterEach, describe, expect, it } from "vitest";
import { calculateTripGroupingScore, canShareVehicle, GROUP_GAP_MINUTES, type ClinicAppointment } from "../shared/transport";
import { DEFAULT_HOSPITALS, distanceKm } from "../shared/hospitals";
import { fetchRoadMatrix, roadKey, roadKm, setRoadMatrix } from "../shared/roads";

// بيانات مصطنعة فقط
const appt = (id: string, hospitalId: string, time = "10:00"): ClinicAppointment => {
  const hospital = DEFAULT_HOSPITALS.find((item) => item.id === hospitalId)!;
  return { id, patientName: `ضيف ${id}`, clinic: hospital.name, hospitalId, buildingNumber: "17", apartmentNumber: id, mobile: "55500000",
    appointmentDate: "2026-10-01", appointmentAt: time, kind: "عادي", assistance: [], status: "تم طلب السيارة" };
};
const shares = (a: ClinicAppointment, b: ClinicAppointment) => canShareVehicle(calculateTripGroupingScore(a, b), 60);
const hospital = (id: string) => DEFAULT_HOSPITALS.find((item) => item.id === id)!;

afterEach(() => setRoadMatrix(null));

describe("grouping by road distance", () => {
  it("does not group Hamad General with Sidra, nor Al Thumama with Rawdat Al Khail", () => {
    expect(shares(appt("1", "hgh"), appt("2", "sidra"))).toBe(false);
    expect(shares(appt("1", "thumama-hc"), appt("2", "rawdat-alkhail"))).toBe(false);
    // مستشفيات مدينة حمد الطبية متجاورة ما زالت تُجمع
    const details = calculateTripGroupingScore(appt("1", "hgh"), appt("2", "qri"));
    expect(details.nearbyDestination).toBe(true);
    expect(shares(appt("1", "hgh"), appt("2", "qri", "10:25"))).toBe(true);
  });

  it("uses the stored road matrix when there is one, the shorter of both directions", () => {
    const ids = ["hgh", "sidra", "qri"];
    // hgh→sidra 3.5 كم و sidra→hgh 9 كم (طريق باتجاه واحد): الأقصر
    const km = [0, 35, 8, 90, 0, 95, 8, 95, 0];
    setRoadMatrix({ ids, km, key: "test", at: "2026-10-01T00:00:00Z" });
    expect(roadKm(hospital("hgh"), hospital("sidra"))).toBe(3.5);
    expect(calculateTripGroupingScore(appt("1", "hgh"), appt("2", "sidra")).nearbyDestination).toBe(true);
    // مكان خارج الجدول: تقدير من الخط المستقيم × 1.4
    const straight = distanceKm(hospital("hgh"), hospital("thumama-hc"));
    expect(roadKm(hospital("hgh"), hospital("thumama-hc"))).toBeCloseTo(straight * 1.4, 5);
  });

  it("explains the road distance in the suggestion and keeps the same gaps", () => {
    expect(GROUP_GAP_MINUTES).toEqual({ sameDestination: 45, nearby: 30, sameDirection: 15 });
  });

  it("reads the road service table and fingerprints the places", async () => {
    const points = [{ id: "origin", lat: 25.2, lng: 51.5 }, { id: "hgh", lat: 25.29, lng: 51.5 }];
    let url = "";
    const fake = (async (input: string) => {
      url = input;
      return { ok: true, json: async () => ({ code: "Ok", distances: [[0, 12345], [11000, null]] }) };
    }) as unknown as typeof fetch;
    const matrix = await fetchRoadMatrix(points, fake);
    expect(url).toContain("51.500000,25.200000;51.500000,25.290000");
    expect(url).toContain("annotations=distance");
    expect(matrix.ids).toEqual(["origin", "hgh"]);
    expect(matrix.km).toEqual([0, 123, 110, -1]);
    expect(matrix.key).toBe(roadKey(points));
    expect(roadKey(points)).not.toBe(roadKey([points[0], { ...points[1], lat: 25.3 }]));
    expect(roadKey(points)).toBe(roadKey([...points].reverse()));
  });
});
