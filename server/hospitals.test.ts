import { describe, expect, it } from "vitest";
import { DEFAULT_HOSPITALS, ORIGIN, distanceKm, insideQatar, matchHospital, nearbyHospitals, syncHospitals } from "../shared/hospitals";
import { excelDate, excelMinutes, parseDriverList, summarizeHistory } from "../shared/history";

describe("hospital catalog", () => {
  it("matches Arabic, English and misspelled destinations", () => {
    expect(matchHospital("Al Wakra Hospital")?.id).toBe("wakra");
    expect(matchHospital("مستشفى الوكرة / مجمع الثمامة")?.id).toBe("wakra");
    expect(matchHospital("ALWAKRA HOSPITAL")?.id).toBe("wakra");
    expect(matchHospital("sidra hosital")?.id).toBe("sidra");
    expect(matchHospital("حمد التخصصي")?.id).toBe("surgical");
    expect(matchHospital("المول")).toBeNull();
    // المراكز المضافة بأسمائها في ملفات المواعيد
    expect(matchHospital("Expert Dental center")?.id).toBe("expert-dental");
    expect(matchHospital("Gardenia medical center")?.id).toBe("gardenia");
    expect(matchHospital("Psychiatric Hospital")?.id).toBe("psychiatric");
    expect(matchHospital("sama medical care")?.id).toBe("sama");
    expect(matchHospital("Medical Care & Research Center")?.id).toBe("mcrc");
    // مراكز أكتوبر 2026: مركز الوكرة الصحي ليس مستشفى الوكرة
    expect(matchHospital("مركز الوكرة الصحي")?.id).toBe("wakra-hc");
    expect(matchHospital("Al Wakra Health Center")?.id).toBe("wakra-hc");
    expect(matchHospital("مستشفى الوكرة")?.id).toBe("wakra");
    expect(matchHospital("مركز الشفلح")?.id).toBe("shafallah");
    expect(matchHospital("IRIS OPTIC")?.id).toBe("iris-optic");
    expect(matchHospital("روضة الجيوان")?.id).toBe("al-jiwan");
    expect(matchHospital("The View Hospital")?.id).toBe("the-view");
    expect(matchHospital("مستشفى الأمان")?.id).toBe("al-aman");
    expect(matchHospital("Old Airport Health Center")?.id).toBe("old-airport-hc");
    expect(matchHospital("طوارئ أطفال السد")?.id).toBe("pediatric-sadd");
    expect(matchHospital("طوارئ أطفال الريان")).toBeNull();
    expect(matchHospital("Al Ahli Hospital")?.id).toBe("al-ahli");
    expect(matchHospital("مركز معيذر الصحي")?.id).toBe("muaither-hc");
    // مركز غسيل الكلى والعلاج الطبيعي في الوكرة: ليس مستشفى الوكرة ولا مركز الكلى ولا العلاج الطبيعي بن عمران
    expect(matchHospital("مركز غسيل الكلى والعلاج الطبيعي")?.id).toBe("wakra-dialysis");
    expect(matchHospital("Haemodalysis and Physiotherapy Center")?.id).toBe("wakra-dialysis");
    expect(matchHospital("Haemodialysis and Physiotherapy Center")?.id).toBe("wakra-dialysis");
    expect(matchHospital("العلاج الطبيعي بن عمران")?.id).toBe("qri-bin-omran");
    expect(matchHospital("مركز فهد بن جاسم للكلى")?.id).toBe("kidney");
    // سباركل لطب الأسنان: ليس اكسبرت ولا اللؤلؤة
    expect(matchHospital("سباركل لطب الأسنان")?.id).toBe("sparkle-dental");
    expect(matchHospital("Sparkle Dental Center")?.id).toBe("sparkle-dental");
    expect(matchHospital("مركز اكسبرت لطب الأسنان")?.id).toBe("expert-dental");
    expect(matchHospital("Pearl Dental Center")?.id).toBe("pearl-dental");
    expect(matchHospital("مركز الوجبة الصحي")?.id).toBe("wajbah-hc");
    expect(matchHospital("Al Wajbah Health Center")?.id).toBe("wajbah-hc");
    expect(matchHospital("الجمعية القطرية للسكري")?.id).toBe("qatar-diabetes");
    expect(matchHospital("Qatar Diabetes Association")?.id).toBe("qatar-diabetes");
    // مراكز صحية أخرى لا تذهب إلى الوجبة
    expect(matchHospital("مركز معيذر الصحي")?.id).toBe("muaither-hc");
    expect(matchHospital("مركز الوكرة الصحي")?.id).toBe("wakra-hc");
    // وجهة الرحلة غير الطبية «أنصار جاليري المطار القديم» ليست المركز الصحي
    expect(matchHospital("أنصار جاليري المطار القديم")).toBeNull();
  });

  it("adds the new centers to a directory already saved, unless the admin added them", () => {
    const stored = DEFAULT_HOSPITALS.filter((hospital) => !["expert-dental", "gardenia", "psychiatric", "sama"].includes(hospital.id));
    const synced = syncHospitals(stored);
    expect(synced).toHaveLength(DEFAULT_HOSPITALS.length);
    const ownGardenia = { ...DEFAULT_HOSPITALS.find((hospital) => hospital.id === "gardenia")!, id: "h-own", name: "غاردينيا", nameEn: "Gardenia" };
    expect(syncHospitals([...stored, ownGardenia]).filter((hospital) => hospital.id === "gardenia")).toHaveLength(0);
    expect(syncHospitals(DEFAULT_HOSPITALS)).toHaveLength(DEFAULT_HOSPITALS.length);
    // مركز الوكرة الصحي يُضاف رغم أن اسمه يطابق «الوكرة» في الدليل المحفوظ
    const withoutWakraHc = DEFAULT_HOSPITALS.filter((hospital) => hospital.id !== "wakra-hc");
    expect(syncHospitals(withoutWakraHc).some((hospital) => hospital.id === "wakra-hc")).toBe(true);
    const withoutDialysis = DEFAULT_HOSPITALS.filter((hospital) => hospital.id !== "wakra-dialysis");
    expect(syncHospitals(withoutDialysis).find((hospital) => hospital.id === "wakra-dialysis")).toMatchObject({ lat: 25.172663, lng: 51.595984 });
    const withoutSparkle = DEFAULT_HOSPITALS.filter((hospital) => hospital.id !== "sparkle-dental");
    expect(syncHospitals(withoutSparkle).find((hospital) => hospital.id === "sparkle-dental")).toMatchObject({ lat: 25.372562, lng: 51.472437 });
    const withoutNew = DEFAULT_HOSPITALS.filter((hospital) => !["wajbah-hc", "qatar-diabetes"].includes(hospital.id));
    expect(syncHospitals(withoutNew).filter((hospital) => ["wajbah-hc", "qatar-diabetes"].includes(hospital.id))).toHaveLength(2);
  });

  it("finds hospitals on the same campus", () => {
    const hgh = DEFAULT_HOSPITALS.find((hospital) => hospital.id === "hgh")!;
    const near = nearbyHospitals(hgh, DEFAULT_HOSPITALS).map((item) => item.hospital.id);
    expect(near).toContain("heart");
    expect(near).not.toContain("wakra");
    expect(distanceKm(hgh, DEFAULT_HOSPITALS.find((hospital) => hospital.id === "cuban")!)).toBeGreaterThan(50);
  });

  it("keeps the complex and every hospital inside the Qatar map bounds", () => {
    expect(insideQatar(ORIGIN)).toBe(true);
    for (const hospital of DEFAULT_HOSPITALS) expect(insideQatar(hospital), hospital.id).toBe(true);
    expect(insideQatar({ lat: 26.228, lng: 50.586 })).toBe(false); // المنامة
    expect(insideQatar({ lat: 24.453, lng: 54.377 })).toBe(false); // أبوظبي
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
