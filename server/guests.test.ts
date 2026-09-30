import { describe, expect, it } from "vitest";
import { guestIndex, guestOfAppointment, guestStats, parseGuestRows, planGuestImport, searchGuests, type GuestRecord } from "../shared/guests";
import { parseImportedAppointments, type ClinicAppointment, type VehicleRequest } from "../shared/transport";

// بيانات مصطنعة فقط (لا تُرفع بيانات الضيوف الحقيقية إلى المستودع)
const header = {
  name: "الاسم باللغة العربية", nameEn: "الاسم باللغة الإنجليزية", gender: "الجنس", age: "العمر ",
  health: "الرقم الصحي", phone: "رقم الهاتف", building: "رقم المبنى", apartment: "رقم الشقة",
};
const row = (name: string, extra: Partial<Record<keyof typeof header, unknown>> = {}) => {
  const values: Record<keyof typeof header, unknown> = { name, nameEn: "", gender: "ذكر", age: 40, health: 1234567, phone: 55500001, building: 17, apartment: 104, ...extra };
  return Object.fromEntries(Object.entries(header).map(([key, title]) => [title, values[key as keyof typeof header]]));
};

describe("complex guest list file", () => {
  it("reads the uploaded file's columns, keeping age and health number", () => {
    const { guests, errors } = parseGuestRows([
      row("ضيف أول", { nameEn: "FIRST GUEST", gender: "أنثى", age: 28, building: "r1", apartment: 103 }),
      row("ضيف ثانٍ", { nameEn: "N/A", phone: "55500002/44400002", health: "N/A" }),
    ]);
    expect(errors).toEqual([]);
    expect(guests[0]).toMatchObject({ name: "ضيف أول", nameEn: "FIRST GUEST", gender: "أنثى", age: 28, healthNumber: "1234567", mobile: "55500001", buildingNumber: "R1", apartmentNumber: "103" });
    // أكثر من رقم هاتف: الأول، والرقم الصحي N/A بلا رقم
    expect(guests[1].mobile).toBe("55500002");
    expect(guests[1].healthNumber).toBeUndefined();
    expect(guests[1].nameEn).toBeUndefined();
  });

  it("rejects rows without a building or apartment and repeated names", () => {
    const { guests, errors } = parseGuestRows([row("ضيف أول"), row("ضيف  اول"), row("ضيف ثالث", { building: "" })]);
    expect(guests).toHaveLength(1);
    expect(errors).toEqual(["الصف 3: الاسم مكرر (كما في الصف 2)", "الصف 4: رقم المبنى أو الشقة ناقص"]);
  });

  it("keeps the id of a guest already in the list when the file is uploaded again", () => {
    const existing = [{ id: "G-old-1", name: "ضيف أول", buildingNumber: "17", apartmentNumber: "104" }, { id: "G-old-2", name: "ضيف غادر", buildingNumber: "9", apartmentNumber: "201" }];
    const { guests } = parseGuestRows([row("ضيف أوّل", { building: 18 }), row("ضيف جديد")]);
    const plan = planGuestImport(guests, existing, 42);
    expect(plan.guests.map((guest) => guest.id)).toEqual(["G-old-1", "G-16-2"]);
    expect(plan.guests[0].buildingNumber).toBe("18");
    expect(plan).toMatchObject({ added: 1, updated: 1 });
    expect(plan.missing.map((guest) => guest.id)).toEqual(["G-old-2"]);
  });

  it("finds a guest by Arabic or English name, building and apartment, or phone", () => {
    const list = [
      { id: "a", name: "مريم أحمد", nameEn: "MARYAM AHMED", buildingNumber: "17", apartmentNumber: "104", mobile: "55500001" },
      { id: "b", name: "أحمد علي", nameEn: "AHMED ALI", buildingNumber: "9", apartmentNumber: "201", mobile: "55500002" },
    ];
    expect(searchGuests(list, "احمد").map((guest) => guest.id)).toEqual(["b", "a"]);
    expect(searchGuests(list, "maryam").map((guest) => guest.id)).toEqual(["a"]);
    expect(searchGuests(list, "9 201").map((guest) => guest.id)).toEqual(["b"]);
    expect(searchGuests(list, "55500002").map((guest) => guest.id)).toEqual(["b"]);
    expect(searchGuests(list, "")).toEqual([]);
  });
});

describe("appointments only for listed guests and directory hospitals", () => {
  const guests = [{ id: "G-1", name: "ضيف أول", nameEn: "FIRST GUEST", gender: "أنثى" as const, mobile: "55500001", buildingNumber: "17", apartmentNumber: "104" }];
  const base = { "تاريخ الموعد": "2026-10-01", "وقت الموعد": "09:30", "نوع الرحلة": "عادي", "رقم الموبايل": "" };

  it("takes the building, apartment, gender and phone from the list and the hospital name from the directory", () => {
    const { appointments, errors } = parseImportedAppointments([
      { ...base, "اسم الضيف": "FIRST GUEST", "اسم العيادة أو المستشفى": "hamad general hospital", "رقم المبنى": "3", "رقم الشقة": "1" },
    ], [], 1, "2026-09-30", undefined, guests);
    expect(errors).toEqual([]);
    expect(appointments[0]).toMatchObject({ guestId: "G-1", patientName: "ضيف أول", buildingNumber: "17", apartmentNumber: "104", gender: "أنثى", mobile: "55500001", clinic: "مستشفى حمد العام", hospitalId: "hgh" });
  });

  it("refuses guests outside the list and hospitals outside the directory", () => {
    const { appointments, errors } = parseImportedAppointments([
      { ...base, "اسم الضيف": "ضيف غير مسجل", "اسم العيادة أو المستشفى": "مستشفى حمد العام" },
      { ...base, "اسم الضيف": "ضيف أول", "اسم العيادة أو المستشفى": "عيادة غير معروفة" },
    ], [], 1, "2026-09-30", undefined, guests);
    expect(appointments).toEqual([]);
    expect(errors).toEqual([
      "الصف 2: الضيف «ضيف غير مسجل» غير موجود في قائمة ضيوف المجمع",
      "الصف 3: المستشفى «عيادة غير معروفة» غير موجود في دليل المستشفيات",
    ]);
  });
});

describe("guest statistics with age and health number", () => {
  const guests: GuestRecord[] = [
    { id: "G-1", name: "ضيف أول", buildingNumber: "17", apartmentNumber: "104", age: 72, healthNumber: "111" },
    { id: "G-2", name: "ضيف ثانٍ", buildingNumber: "9", apartmentNumber: "201", age: 30, healthNumber: "222" },
  ];
  const appt = (id: string, extra: Partial<ClinicAppointment>): ClinicAppointment => ({
    id, patientName: "ضيف أول", clinic: "مستشفى الوكرة", buildingNumber: "17", apartmentNumber: "104", mobile: "55500001",
    appointmentDate: "2026-10-01", appointmentAt: "09:00", kind: "عادي", assistance: [], status: "مكتملة", ...extra,
  });
  const sent = (id: string, appointmentId: string, extra: Partial<VehicleRequest> = {}) =>
    ({ id, appointmentId, direction: "ذهاب", status: "وصلت الوجهة", vehiclePlate: "100", notificationMethod: "whatsapp", createdAt: "08:00", ...extra }) as VehicleRequest;

  it("counts appointments and cars sent per guest, with age groups", () => {
    const appointments = [
      appt("A1", { guestId: "G-1" }),
      // موعد قديم بلا رقم ضيف: بالاسم والمبنى والشقة
      appt("A2", {}),
      appt("A3", { guestId: "G-2", patientName: "ضيف ثانٍ", buildingNumber: "9", apartmentNumber: "201", status: "ملغي" }),
      appt("A4", { guestId: "G-2", appointmentDate: "2026-09-01" }),
      appt("A5", { patientName: "ضيف قديم", buildingNumber: "5", apartmentNumber: "1" }),
    ];
    const requests = [sent("R1", "A1"), sent("R2", "A1", { direction: "عودة" }), sent("R3", "A1", { direction: "عودة", nurseOnly: true }), sent("R4", "A2")];
    const stats = guestStats(appointments, requests, guests, { from: "2026-10-01", to: "2026-10-01", building: "all" });
    expect(stats.rows.map((item) => [item.name, item.age, item.healthNumber, item.appointments, item.cancelled, item.trips, item.listed])).toEqual([
      ["ضيف أول", 72, "111", 2, 0, 3, true],
      ["ضيف ثانٍ", 30, "222", 1, 1, 0, true],
      ["ضيف قديم", undefined, undefined, 1, 0, 0, false],
    ]);
    expect(stats.averageAge).toBe(51);
    expect(stats.unlisted).toBe(1);
    expect(stats.ageGroups.find((group) => group.label === "60 إلى 74")).toMatchObject({ guests: 1, trips: 3 });
    expect(stats.ageGroups.find((group) => group.label === "غير محدد")).toMatchObject({ guests: 1 });
    expect(guestStats(appointments, requests, guests, { from: "", to: "", building: "9" }).rows.map((item) => item.appointments)).toEqual([2]);
  });

  it("links an appointment to its guest by id first, then by name, building and apartment", () => {
    const index = guestIndex(guests);
    expect(guestOfAppointment(index, appt("X", { guestId: "G-2" }))?.id).toBe("G-2");
    expect(guestOfAppointment(index, appt("X", {}))?.id).toBe("G-1");
    expect(guestOfAppointment(index, appt("X", { patientName: "غير موجود" }))).toBeUndefined();
  });
});
