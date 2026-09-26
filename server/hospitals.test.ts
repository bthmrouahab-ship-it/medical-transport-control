import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, distanceKm, matchHospital, nearbyHospitals } from "../shared/hospitals";
import { excelDate, excelMinutes, parseDriverList, summarizeHistory } from "../shared/history";

describe("hospital catalog", () => {
  it("matches Arabic, English and misspelled destinations", () => {
    expect(matchHospital("Al Wakra Hospital")?.id).toBe("wakra");
    expect(matchHospital("مستشفى الوكرة / مجمع الثمامة")?.id).toBe("wakra");
    expect(matchHospital("ALWAKRA HOSPITAL")?.id).toBe("wakra");
    expect(matchHospital("sidra hosital")?.id).toBe("sidra");
    expect(matchHospital("حمد التخصصي")?.id).toBe("surgical");
    expect(matchHospital("المول")).toBeNull();
  });

  it("finds hospitals on the same campus", () => {
    const hgh = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "hgh")!;
    const near = nearbyHospitals(hgh, DEFAULT_HOSPITALS).map((item) => item.hospital.id);
    expect(near).toContain("heart");
    expect(near).not.toContain("wakra");
    expect(distanceKm(hgh, DEFAULT_HOSPITALS.find((hospital) => hospital.id === "cuban")!)).toBeGreaterThan(50);
  });
});

describe("history import", () => {
  const rows: unknown[][] = [
    ["حركة اليومية لسيارات فوكس"],
    [],
    ["الجهة", "رقم", "التاريخ", "اليوم", "ID السائق", "رقم السيارة", "نوع المركبة", "اسم السائق", "رقم السائق", "خروج السيارة", "دخول السيارة", "الوجهة", "اسم المريض", "رقم التواصل مع المريض", "المبنى", "الشقة", "DI الجهة", "الجهة الطالبة"],
    ["", 1, 46214, "السبت", 6, 975536, "سيدان", "خيرالدين", 30038512, 7 / 24, 7.5 / 24, "مستشفى سدره", "سري", 50000000, 17, 301, 50, "مشرف مبنى"],
    ["", 2, 46214, "السبت", 7, 932418, "احتياجات خاصة", "سفيان", 33691475, "08:00", "09:00", "Hamad General Hospital / مجمع الثمامة", "سري", 50000000, 22, 110, 61, "العيادة"],
    ["", 3, 46215, "الأحد", 0, 0, 0, "", "", "", "", "المول", "سري", 50000000, 22, 110, 61, "مشرف مبنى"],
  ];

  it("parses Excel dates and times", () => {
    expect(excelDate(46214)).toBe("2026-07-11");
    expect(excelMinutes(7.5 / 24)).toBe(450);
    expect(excelMinutes("08:05")).toBe(485);
  });

  it("aggregates trips without keeping patient data", () => {
    const summary = summarizeHistory(rows, "test.xlsx");
    expect(summary).toMatchObject({ from: "2026-07-11", to: "2026-07-12", totalTrips: 3, completedTrips: 2, activeDays: 2, avgTripMinutes: 45 });
    expect(summary.destinations.map((item) => item.hospitalId)).toEqual(expect.arrayContaining(["sidra", "hgh"]));
    expect(summary.byKind.find((item) => item.kind === "سيدان")?.trips).toBe(1);
    expect(summary.daily[0]).toMatchObject({ weekday: "السبت", total: 2, completed: 2 });
    expect(JSON.stringify(summary)).not.toContain("سري");
    expect(JSON.stringify(summary)).not.toContain("50000000");
  });

  it("merges drivers sharing one vehicle", () => {
    const drivers = parseDriverList([
      ["ID السائق", "اسم السائق", "رقم السائق", "نوع المركبة", "رقم سيارة السائق"],
      [5, "رامش", 30226299, "سيدان", 976004],
      [11, "انتخاب", 77078517, "سيدان", 976004],
      [28, "", "", "", ""],
    ]);
    expect(drivers).toEqual([{ plate: "976004", drivers: ["رامش", "انتخاب"], phone: "30226299", kind: "سيدان" }]);
  });
});
