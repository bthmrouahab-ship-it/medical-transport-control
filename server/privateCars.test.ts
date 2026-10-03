import { describe, expect, it } from "vitest";
import { PRIVATE_CAR_NAME_HEADERS, hasPrivateCar, parsePrivateCarRows, planPrivateCars, tableRows, unitKey, type Guest } from "../shared/guests";
import { parseImportedAppointments } from "../shared/transport";
import { DEFAULT_HOSPITALS } from "../shared/hospitals";

// بيانات مصطنعة فقط (لا تُرفع بيانات الضيوف الحقيقية إلى المستودع)
const matrix: unknown[][] = [
  ["  تصريح دخول السيارات داخل المجمع - سكان", "", "", "", ""],
  ["الرقم", "اسم الضيف ", "رقم المركبة  ", "المبني  ", "شقة "],
  ["1", "صاحب سيارة أول", "100001", "18", "209"],
  ["2", "صاحب سيارة ثانٍ", 100002, 3, 7],
  ["3", "بلا شقة", "100003", "12", ""],
  ["4", "", "", "", ""],
];

describe("private cars: the owner's whole apartment cannot use the complex cars", () => {
  it("reads the permit file under its title row", () => {
    const table = tableRows(matrix, [...PRIVATE_CAR_NAME_HEADERS, "المبني"]);
    expect(table.firstRow).toBe(3);
    const { cars, errors } = parsePrivateCarRows(table.rows, table.firstRow);
    expect(cars).toEqual([
      { name: "صاحب سيارة أول", plate: "100001", buildingNumber: "18", apartmentNumber: "209" },
      { name: "صاحب سيارة ثانٍ", plate: "100002", buildingNumber: "3", apartmentNumber: "7" },
    ]);
    expect(errors).toEqual(["الصف 5: رقم المبنى أو الشقة ناقص"]);
  });

  it("matches the apartment regardless of leading zeros and letter case", () => {
    expect(unitKey("03", "007")).toBe(unitKey("3", "7"));
    expect(unitKey("r1", "101")).toBe("R1/101");
    expect(unitKey("18", "209")).not.toBe(unitKey("18", "210"));
  });

  it("counts every guest of the apartment except the nurses", () => {
    const guests: Guest[] = [
      { id: "G-1", name: "صاحب سيارة أول", buildingNumber: "18", apartmentNumber: "209" },
      { id: "G-2", name: "ابن صاحب السيارة", buildingNumber: "18", apartmentNumber: "209" },
      { id: "G-3", name: "جار في شقة أخرى", buildingNumber: "18", apartmentNumber: "210" },
      { id: "N-1", name: "ممرضة", buildingNumber: "03", apartmentNumber: "007", nurse: true },
    ];
    const plan = planPrivateCars([{ buildingNumber: "18", apartmentNumber: "209" }, { buildingNumber: "3", apartmentNumber: "7" }, { buildingNumber: "40", apartmentNumber: "1" }], guests);
    expect(plan.units).toBe(3);
    expect(plan.blocked).toBe(2);
    // شقة الممرضة وشقة بلا ضيوف: ليس فيهما ضيوف يُمنعون
    expect(plan.unlisted.map((car) => car.buildingNumber)).toEqual(["3", "40"]);
  });

  it("the Excel appointment import refuses a guest of a private-car apartment with the message", () => {
    const guests: Guest[] = [
      { id: "G-1", name: "ابن صاحب السيارة", buildingNumber: "18", apartmentNumber: "209", mobile: "55500001", gender: "ذكر", privateCar: true },
      { id: "G-2", name: "ضيف بلا سيارة", buildingNumber: "18", apartmentNumber: "210", mobile: "55500002", gender: "ذكر" },
    ];
    expect(hasPrivateCar(guests[0])).toBe(true);
    const row = (name: string) => ({ "اسم الضيف أو الرقم": name, "اسم العيادة أو المستشفى": "مستشفى حمد العام", "تاريخ الموعد": "2026-10-05", "وقت الموعد": "10:00", "نوع الرحلة": "عادي" });
    const { appointments, errors } = parseImportedAppointments([row("ابن صاحب السيارة"), row("ضيف بلا سيارة")], [], 1, "2026-10-04", DEFAULT_HOSPITALS, guests);
    expect(appointments.map((appointment) => appointment.guestId)).toEqual(["G-2"]);
    expect(errors).toEqual(["الصف 2: «ابن صاحب السيارة»: هذا الشخص يمتلك سيارة خاصة ولا يمكنه استخدام سيارات المجمع"]);
  });
});
