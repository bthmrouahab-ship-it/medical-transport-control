import type { HistorySummary } from "./history";

/**
 * ملخص إحصائي أولي من ملف «حركة السيارات اليومية» (11-07-2026 إلى 23-08-2026)، بلا أسماء أو أرقام مرضى.
 * يُحفظ في meta/history عند أول دخول للمدير إن لم يكن موجودًا، ويُحمَّل مع صفحة المدير فقط.
 */
export const HISTORY_SEED: HistorySummary = {
 "source": "حركة السيارات 11-07-2026 إلى 23-08-2026",
 "importedAt": "2026-09-24T12:00:00.000Z",
 "from": "2026-07-11",
 "to": "2026-08-23",
 "totalTrips": 3843,
 "completedTrips": 2786,
 "activeDays": 39,
 "avgTripMinutes": 49,
 "daily": [
  {
   "date": "2026-07-11",
   "weekday": "السبت",
   "total": 101,
   "completed": 83,
   "sedan": 60,
   "special": 16,
   "bus": 7
  },
  {
   "date": "2026-07-12",
   "weekday": "الأحد",
   "total": 140,
   "completed": 127,
   "sedan": 73,
   "special": 37,
   "bus": 17
  },
  {
   "date": "2026-07-13",
   "weekday": "الإثنين",
   "total": 94,
   "completed": 71,
   "sedan": 41,
   "special": 18,
   "bus": 12
  },
  {
   "date": "2026-07-14",
   "weekday": "الثلاثاء",
   "total": 77,
   "completed": 66,
   "sedan": 39,
   "special": 17,
   "bus": 10
  },
  {
   "date": "2026-07-15",
   "weekday": "الأربعاء",
   "total": 59,
   "completed": 45,
   "sedan": 34,
   "special": 7,
   "bus": 4
  },
  {
   "date": "2026-07-16",
   "weekday": "الخميس",
   "total": 64,
   "completed": 48,
   "sedan": 33,
   "special": 12,
   "bus": 3
  },
  {
   "date": "2026-07-18",
   "weekday": "السبت",
   "total": 56,
   "completed": 54,
   "sedan": 42,
   "special": 12,
   "bus": 0
  },
  {
   "date": "2026-07-19",
   "weekday": "الأحد",
   "total": 145,
   "completed": 126,
   "sedan": 88,
   "special": 27,
   "bus": 11
  },
  {
   "date": "2026-07-20",
   "weekday": "الإثنين",
   "total": 124,
   "completed": 101,
   "sedan": 74,
   "special": 16,
   "bus": 11
  },
  {
   "date": "2026-07-21",
   "weekday": "الثلاثاء",
   "total": 129,
   "completed": 105,
   "sedan": 70,
   "special": 25,
   "bus": 10
  },
  {
   "date": "2026-07-22",
   "weekday": "الأربعاء",
   "total": 117,
   "completed": 107,
   "sedan": 66,
   "special": 26,
   "bus": 15
  },
  {
   "date": "2026-07-23",
   "weekday": "الخميس",
   "total": 138,
   "completed": 123,
   "sedan": 85,
   "special": 34,
   "bus": 4
  },
  {
   "date": "2026-07-25",
   "weekday": "السبت",
   "total": 57,
   "completed": 55,
   "sedan": 40,
   "special": 15,
   "bus": 0
  },
  {
   "date": "2026-07-26",
   "weekday": "الأحد",
   "total": 126,
   "completed": 115,
   "sedan": 81,
   "special": 18,
   "bus": 16
  },
  {
   "date": "2026-07-27",
   "weekday": "الإثنين",
   "total": 112,
   "completed": 83,
   "sedan": 54,
   "special": 21,
   "bus": 8
  },
  {
   "date": "2026-07-28",
   "weekday": "الثلاثاء",
   "total": 135,
   "completed": 105,
   "sedan": 86,
   "special": 15,
   "bus": 4
  },
  {
   "date": "2026-07-29",
   "weekday": "الأربعاء",
   "total": 140,
   "completed": 99,
   "sedan": 72,
   "special": 16,
   "bus": 11
  },
  {
   "date": "2026-07-30",
   "weekday": "الخميس",
   "total": 130,
   "completed": 96,
   "sedan": 59,
   "special": 25,
   "bus": 12
  },
  {
   "date": "2026-08-01",
   "weekday": "السبت",
   "total": 46,
   "completed": 34,
   "sedan": 19,
   "special": 15,
   "bus": 0
  },
  {
   "date": "2026-08-02",
   "weekday": "الأحد",
   "total": 138,
   "completed": 101,
   "sedan": 69,
   "special": 23,
   "bus": 9
  },
  {
   "date": "2026-08-03",
   "weekday": "الإثنين",
   "total": 114,
   "completed": 81,
   "sedan": 61,
   "special": 17,
   "bus": 3
  },
  {
   "date": "2026-08-04",
   "weekday": "الثلاثاء",
   "total": 102,
   "completed": 58,
   "sedan": 38,
   "special": 11,
   "bus": 9
  },
  {
   "date": "2026-08-05",
   "weekday": "الأربعاء",
   "total": 78,
   "completed": 47,
   "sedan": 34,
   "special": 10,
   "bus": 3
  },
  {
   "date": "2026-08-06",
   "weekday": "الخميس",
   "total": 85,
   "completed": 45,
   "sedan": 31,
   "special": 9,
   "bus": 5
  },
  {
   "date": "2026-08-07",
   "weekday": "الجمعة",
   "total": 29,
   "completed": 29,
   "sedan": 0,
   "special": 29,
   "bus": 0
  },
  {
   "date": "2026-08-08",
   "weekday": "السبت",
   "total": 48,
   "completed": 32,
   "sedan": 25,
   "special": 6,
   "bus": 1
  },
  {
   "date": "2026-08-09",
   "weekday": "الأحد",
   "total": 132,
   "completed": 79,
   "sedan": 50,
   "special": 21,
   "bus": 8
  },
  {
   "date": "2026-08-10",
   "weekday": "الإثنين",
   "total": 111,
   "completed": 63,
   "sedan": 39,
   "special": 17,
   "bus": 7
  },
  {
   "date": "2026-08-11",
   "weekday": "الثلاثاء",
   "total": 108,
   "completed": 65,
   "sedan": 37,
   "special": 17,
   "bus": 11
  },
  {
   "date": "2026-08-12",
   "weekday": "الأربعاء",
   "total": 88,
   "completed": 50,
   "sedan": 39,
   "special": 6,
   "bus": 5
  },
  {
   "date": "2026-08-13",
   "weekday": "الخميس",
   "total": 117,
   "completed": 62,
   "sedan": 39,
   "special": 16,
   "bus": 7
  },
  {
   "date": "2026-08-15",
   "weekday": "السبت",
   "total": 41,
   "completed": 28,
   "sedan": 21,
   "special": 5,
   "bus": 2
  },
  {
   "date": "2026-08-16",
   "weekday": "الأحد",
   "total": 97,
   "completed": 55,
   "sedan": 42,
   "special": 9,
   "bus": 4
  },
  {
   "date": "2026-08-17",
   "weekday": "الإثنين",
   "total": 96,
   "completed": 59,
   "sedan": 41,
   "special": 11,
   "bus": 7
  },
  {
   "date": "2026-08-18",
   "weekday": "الثلاثاء",
   "total": 101,
   "completed": 59,
   "sedan": 38,
   "special": 16,
   "bus": 5
  },
  {
   "date": "2026-08-19",
   "weekday": "الأربعاء",
   "total": 81,
   "completed": 53,
   "sedan": 36,
   "special": 12,
   "bus": 5
  },
  {
   "date": "2026-08-20",
   "weekday": "الخميس",
   "total": 122,
   "completed": 68,
   "sedan": 44,
   "special": 21,
   "bus": 3
  },
  {
   "date": "2026-08-22",
   "weekday": "السبت",
   "total": 55,
   "completed": 39,
   "sedan": 26,
   "special": 10,
   "bus": 3
  },
  {
   "date": "2026-08-23",
   "weekday": "الأحد",
   "total": 110,
   "completed": 70,
   "sedan": 51,
   "special": 12,
   "bus": 7
  }
 ],
 "byWeekday": [
  {
   "weekday": "الأحد",
   "trips": 888,
   "days": 7
  },
  {
   "weekday": "الإثنين",
   "trips": 651,
   "days": 6
  },
  {
   "weekday": "الثلاثاء",
   "trips": 652,
   "days": 6
  },
  {
   "weekday": "الأربعاء",
   "trips": 563,
   "days": 6
  },
  {
   "weekday": "الخميس",
   "trips": 656,
   "days": 6
  },
  {
   "weekday": "الجمعة",
   "trips": 29,
   "days": 1
  },
  {
   "weekday": "السبت",
   "trips": 404,
   "days": 7
  }
 ],
 "byHour": [
  {
   "hour": 0,
   "trips": 4
  },
  {
   "hour": 1,
   "trips": 13
  },
  {
   "hour": 2,
   "trips": 2
  },
  {
   "hour": 3,
   "trips": 2
  },
  {
   "hour": 4,
   "trips": 5
  },
  {
   "hour": 5,
   "trips": 17
  },
  {
   "hour": 6,
   "trips": 168
  },
  {
   "hour": 7,
   "trips": 266
  },
  {
   "hour": 8,
   "trips": 336
  },
  {
   "hour": 9,
   "trips": 347
  },
  {
   "hour": 10,
   "trips": 334
  },
  {
   "hour": 11,
   "trips": 308
  },
  {
   "hour": 12,
   "trips": 279
  },
  {
   "hour": 13,
   "trips": 177
  },
  {
   "hour": 14,
   "trips": 114
  },
  {
   "hour": 15,
   "trips": 92
  },
  {
   "hour": 16,
   "trips": 81
  },
  {
   "hour": 17,
   "trips": 64
  },
  {
   "hour": 18,
   "trips": 71
  },
  {
   "hour": 19,
   "trips": 47
  },
  {
   "hour": 20,
   "trips": 40
  },
  {
   "hour": 21,
   "trips": 12
  },
  {
   "hour": 22,
   "trips": 0
  },
  {
   "hour": 23,
   "trips": 1
  }
 ],
 "byKind": [
  {
   "kind": "سيدان",
   "trips": 1877
  },
  {
   "kind": "احتياجات خاصة",
   "trips": 650
  },
  {
   "kind": "باص",
   "trips": 259
  }
 ],
 "destinations": [
  {
   "key": "h:wakra",
   "name": "مستشفى الوكرة",
   "hospitalId": "wakra",
   "zone": "الوكرة",
   "trips": 398,
   "avgMinutes": 34
  },
  {
   "key": "h:thumama-hc",
   "name": "مركز الثمامة الصحي",
   "hospitalId": "thumama-hc",
   "zone": "الثمامة وروضة الخيل",
   "trips": 351,
   "avgMinutes": 27
  },
  {
   "key": "h:sidra",
   "name": "مستشفى سدرة",
   "hospitalId": "sidra",
   "zone": "المدينة التعليمية",
   "trips": 270,
   "avgMinutes": 44
  },
  {
   "key": "h:qri",
   "name": "مركز قطر لإعادة التأهيل",
   "hospitalId": "qri",
   "zone": "مدينة حمد الطبية",
   "trips": 171,
   "avgMinutes": 47
  },
  {
   "key": "h:rawdat-alkhail",
   "name": "مركز روضة الخيل الصحي",
   "hospitalId": "rawdat-alkhail",
   "zone": "الثمامة وروضة الخيل",
   "trips": 138,
   "avgMinutes": 51
  },
  {
   "key": "h:hgh",
   "name": "مستشفى حمد العام",
   "hospitalId": "hgh",
   "zone": "مدينة حمد الطبية",
   "trips": 128,
   "avgMinutes": 47
  },
  {
   "key": "h:surgical",
   "name": "المركز التخصصي للجراحة",
   "hospitalId": "surgical",
   "zone": "مدينة حمد الطبية",
   "trips": 121,
   "avgMinutes": 49
  },
  {
   "key": "h:cuban",
   "name": "المستشفى الكوبي",
   "hospitalId": "cuban",
   "zone": "دخان",
   "trips": 102,
   "avgMinutes": 189
  },
  {
   "key": "h:qri-bin-omran",
   "name": "العلاج الطبيعي بن عمران",
   "hospitalId": "qri-bin-omran",
   "zone": "مدينة حمد الطبية",
   "trips": 99,
   "avgMinutes": 48
  },
  {
   "key": "h:acc",
   "name": "مركز الرعاية المتنقلة",
   "hospitalId": "acc",
   "zone": "مدينة حمد الطبية",
   "trips": 93,
   "avgMinutes": 45
  },
  {
   "key": "h:bone-joint",
   "name": "مركز العظام والمفاصل",
   "hospitalId": "bone-joint",
   "zone": "مدينة حمد الطبية",
   "trips": 83,
   "avgMinutes": 42
  },
  {
   "key": "t:المول",
   "name": "المول",
   "hospitalId": null,
   "zone": null,
   "trips": 82,
   "avgMinutes": 27
  },
  {
   "key": "h:pearl-dental",
   "name": "مركز اللؤلؤة للأسنان",
   "hospitalId": "pearl-dental",
   "zone": "الثمامة وروضة الخيل",
   "trips": 61,
   "avgMinutes": 40
  },
  {
   "key": "h:amal",
   "name": "المركز الوطني لعلاج وأبحاث السرطان (الأمل)",
   "hospitalId": "amal",
   "zone": "مدينة حمد الطبية",
   "trips": 54,
   "avgMinutes": 45
  },
  {
   "key": "h:rumailah",
   "name": "مستشفى الرميلة",
   "hospitalId": "rumailah",
   "zone": "مدينة حمد الطبية",
   "trips": 50,
   "avgMinutes": 46
  },
  {
   "key": "t:جامعه لوسيل",
   "name": "جامعة لوسيل",
   "hospitalId": null,
   "zone": null,
   "trips": 36,
   "avgMinutes": 61
  },
  {
   "key": "h:mcrc",
   "name": "مركز الرعاية الطبية والأبحاث",
   "hospitalId": "mcrc",
   "zone": "مدينة حمد الطبية",
   "trips": 32,
   "avgMinutes": 50
  },
  {
   "key": "t:مدرسه اي سبيك",
   "name": "مدرسة اي سبيك",
   "hospitalId": null,
   "zone": null,
   "trips": 32,
   "avgMinutes": 53
  },
  {
   "key": "h:mesaieed",
   "name": "مستشفى مسيعيد",
   "hospitalId": "mesaieed",
   "zone": "مسيعيد",
   "trips": 29,
   "avgMinutes": 107
  },
  {
   "key": "h:kidney",
   "name": "مركز فهد بن جاسم للكلى",
   "hospitalId": "kidney",
   "zone": "مدينة حمد الطبية",
   "trips": 24,
   "avgMinutes": 53
  },
  {
   "key": "t:الادويه",
   "name": "الادوية",
   "hospitalId": null,
   "zone": null,
   "trips": 24,
   "avgMinutes": 229
  },
  {
   "key": "t:جامعه ليفربول",
   "name": "جامعة ليفربول",
   "hospitalId": null,
   "zone": null,
   "trips": 24,
   "avgMinutes": 40
  },
  {
   "key": "t:الرعايه اليوميه",
   "name": "الرعاية اليومية",
   "hospitalId": null,
   "zone": null,
   "trips": 23,
   "avgMinutes": 46
  },
  {
   "key": "h:aisha-attiyah",
   "name": "مستشفى عائشة بنت حمد العطية",
   "hospitalId": "aisha-attiyah",
   "zone": "الشمال (الخور)",
   "trips": 21,
   "avgMinutes": 214
  },
  {
   "key": "h:hazm-mebaireek",
   "name": "مستشفى حزم مبيريك العام",
   "hospitalId": "hazm-mebaireek",
   "zone": "المنطقة الصناعية",
   "trips": 20,
   "avgMinutes": 52
  },
  {
   "key": "t:الثمامه",
   "name": "الثمامة",
   "hospitalId": null,
   "zone": null,
   "trips": 16,
   "avgMinutes": 30
  },
  {
   "key": "t:day care medical center",
   "name": "DAY CARE MEDICAL CENTER",
   "hospitalId": null,
   "zone": null,
   "trips": 15,
   "avgMinutes": 43
  },
  {
   "key": "h:heart",
   "name": "مستشفى القلب",
   "hospitalId": "heart",
   "zone": "مدينة حمد الطبية",
   "trips": 14,
   "avgMinutes": 54
  },
  {
   "key": "t:غير محدد",
   "name": "غير محدد",
   "hospitalId": null,
   "zone": null,
   "trips": 14,
   "avgMinutes": 36
  },
  {
   "key": "t:جامعه اوريكس",
   "name": "جامعة اوريكس",
   "hospitalId": null,
   "zone": null,
   "trips": 11,
   "avgMinutes": 38
  },
  {
   "key": "t:المترو",
   "name": "المترو",
   "hospitalId": null,
   "zone": null,
   "trips": 9,
   "avgMinutes": 11
  },
  {
   "key": "t:المدرسه الفلسطينيه",
   "name": "المدرسة الفلسطينية",
   "hospitalId": null,
   "zone": null,
   "trips": 9,
   "avgMinutes": 32
  },
  {
   "key": "h:wwrc",
   "name": "مركز صحة المرأة والأبحاث",
   "hospitalId": "wwrc",
   "zone": "مدينة حمد الطبية",
   "trips": 7,
   "avgMinutes": 54
  },
  {
   "key": "t:phcc",
   "name": "phcc",
   "hospitalId": null,
   "zone": null,
   "trips": 7,
   "avgMinutes": 39
  },
  {
   "key": "t:الاطراف الصناعيه",
   "name": "الاطراف الصناعية",
   "hospitalId": null,
   "zone": null,
   "trips": 6,
   "avgMinutes": 46
  },
  {
   "key": "h:alkhor",
   "name": "مستشفى الخور",
   "hospitalId": "alkhor",
   "zone": "الشمال (الخور)",
   "trips": 5,
   "avgMinutes": 169
  },
  {
   "key": "t:مركز طبي للرعايه النهاريه",
   "name": "مركز طبي للرعاية النهارية",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": 48
  },
  {
   "key": "t:elite mahmoud medical complex",
   "name": "ELITE MAHMOUD medical complex",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": 50
  },
  {
   "key": "t:hmc dermatology and venereology clinic",
   "name": "hmc - Dermatology and Venereology clinic",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": 44
  },
  {
   "key": "t:al jiwan kindergarten",
   "name": "Al -Jiwan Kindergarten",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": 45
  },
  {
   "key": "t:ام صلال للنظارات",
   "name": "ام صلال للنظارات",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": 87
  },
  {
   "key": "t:البوابه",
   "name": "البوابة",
   "hospitalId": null,
   "zone": null,
   "trips": 5,
   "avgMinutes": null
  },
  {
   "key": "h:cdc",
   "name": "المركز الوطني للأمراض الانتقالية",
   "hospitalId": "cdc",
   "zone": "مدينة حمد الطبية",
   "trips": 3,
   "avgMinutes": 46
  },
  {
   "key": "t:مجمع النخبه الطبي",
   "name": "مجمع النخبة الطبي",
   "hospitalId": null,
   "zone": null,
   "trips": 3,
   "avgMinutes": 59
  },
  {
   "key": "t:muaither hospital",
   "name": "MUAITHER Hospital",
   "hospitalId": null,
   "zone": null,
   "trips": 3,
   "avgMinutes": 124
  },
  {
   "key": "t:sama medical center",
   "name": "Sama Medical Center",
   "hospitalId": null,
   "zone": null,
   "trips": 3,
   "avgMinutes": 71
  },
  {
   "key": "t:sama medical care",
   "name": "Sama Medical Care",
   "hospitalId": null,
   "zone": null,
   "trips": 3,
   "avgMinutes": 47
  },
  {
   "key": "t:الرعايه الاوليه",
   "name": "الرعاية الاولية",
   "hospitalId": null,
   "zone": null,
   "trips": 3,
   "avgMinutes": 45
  }
 ],
 "zones": [
  {
   "zone": "مدينة حمد الطبية",
   "trips": 879
  },
  {
   "zone": "الثمامة وروضة الخيل",
   "trips": 550
  },
  {
   "zone": "وجهات أخرى",
   "trips": 512
  },
  {
   "zone": "الوكرة",
   "trips": 398
  },
  {
   "zone": "المدينة التعليمية",
   "trips": 270
  },
  {
   "zone": "دخان",
   "trips": 102
  },
  {
   "zone": "مسيعيد",
   "trips": 29
  },
  {
   "zone": "الشمال (الخور)",
   "trips": 26
  },
  {
   "zone": "المنطقة الصناعية",
   "trips": 20
  }
 ],
 "vehicles": [
  {
   "plate": "157724",
   "driver": "محمد سراج / رامش",
   "trips": 193
  },
  {
   "plate": "41795",
   "driver": "الماحي / محمد زاكر / جودي عبد ارحمن",
   "trips": 190
  },
  {
   "plate": "932418",
   "driver": "سفيان / عبدالغني",
   "trips": 187
  },
  {
   "plate": "158774",
   "driver": "عبد الله / عبدالله",
   "trips": 175
  },
  {
   "plate": "976004",
   "driver": "رامش / انتخاب",
   "trips": 173
  },
  {
   "plate": "975532",
   "driver": "يوسف بشير / يوسف / علي طيب",
   "trips": 167
  },
  {
   "plate": "975536",
   "driver": "خيرالدين",
   "trips": 162
  },
  {
   "plate": "956479",
   "driver": "كمال",
   "trips": 160
  },
  {
   "plate": "943438",
   "driver": "خرم",
   "trips": 134
  },
  {
   "plate": "956405",
   "driver": "إسماعيل",
   "trips": 123
  },
  {
   "plate": "975517",
   "driver": "نترا",
   "trips": 119
  },
  {
   "plate": "975529",
   "driver": "بن علي",
   "trips": 114
  },
  {
   "plate": "278320",
   "driver": "تطهير",
   "trips": 110
  },
  {
   "plate": "957153",
   "driver": "عبادشاه",
   "trips": 108
  },
  {
   "plate": "108443",
   "driver": "جودي عبد ارحمن / بن علي",
   "trips": 93
  },
  {
   "plate": "975534",
   "driver": "محمد حسين / محمد ادم / سعيد يوسف",
   "trips": 84
  },
  {
   "plate": "977544",
   "driver": "معاذ",
   "trips": 84
  },
  {
   "plate": "329538",
   "driver": "عادل",
   "trips": 83
  },
  {
   "plate": "106270",
   "driver": "قولزار",
   "trips": 65
  },
  {
   "plate": "937455",
   "driver": "الطاف",
   "trips": 50
  },
  {
   "plate": "976007",
   "driver": "غلفام",
   "trips": 43
  },
  {
   "plate": "975519",
   "driver": "نترا",
   "trips": 37
  },
  {
   "plate": "954605",
   "driver": "إسماعيل",
   "trips": 32
  },
  {
   "plate": "976493",
   "driver": "سفيان",
   "trips": 29
  },
  {
   "plate": "947370",
   "driver": "رامش / سعيد يوسف",
   "trips": 27
  },
  {
   "plate": "965357",
   "driver": "عبادشاه",
   "trips": 17
  },
  {
   "plate": "931455",
   "driver": "غلفام",
   "trips": 12
  },
  {
   "plate": "939274",
   "driver": "سيد صابر",
   "trips": 6
  },
  {
   "plate": "18",
   "driver": "عادل",
   "trips": 1
  },
  {
   "plate": "8",
   "driver": "عبادشاه",
   "trips": 1
  },
  {
   "plate": "10",
   "driver": "الطاف",
   "trips": 1
  },
  {
   "plate": "21",
   "driver": "الماحي",
   "trips": 1
  }
 ],
 "buildings": [
  {
   "building": "17",
   "trips": 277
  },
  {
   "building": "26",
   "trips": 208
  },
  {
   "building": "27",
   "trips": 176
  },
  {
   "building": "23",
   "trips": 164
  },
  {
   "building": "18",
   "trips": 164
  },
  {
   "building": "28",
   "trips": 155
  },
  {
   "building": "8",
   "trips": 145
  },
  {
   "building": "21",
   "trips": 142
  },
  {
   "building": "24",
   "trips": 130
  },
  {
   "building": "19",
   "trips": 129
  },
  {
   "building": "11",
   "trips": 116
  },
  {
   "building": "10",
   "trips": 113
  },
  {
   "building": "9",
   "trips": 111
  },
  {
   "building": "25",
   "trips": 96
  },
  {
   "building": "22",
   "trips": 85
  },
  {
   "building": "12",
   "trips": 83
  },
  {
   "building": "20",
   "trips": 79
  },
  {
   "building": "R2",
   "trips": 77
  },
  {
   "building": "3",
   "trips": 70
  },
  {
   "building": "R1",
   "trips": 69
  },
  {
   "building": "6",
   "trips": 69
  },
  {
   "building": "13",
   "trips": 35
  },
  {
   "building": "7",
   "trips": 26
  },
  {
   "building": "1",
   "trips": 12
  },
  {
   "building": "2",
   "trips": 4
  },
  {
   "building": "الضيف",
   "trips": 3
  },
  {
   "building": "24 / 18",
   "trips": 2
  },
  {
   "building": "18 // 12",
   "trips": 2
  },
  {
   "building": "5",
   "trips": 2
  },
  {
   "building": "21 / 26",
   "trips": 2
  },
  {
   "building": "r1",
   "trips": 2
  },
  {
   "building": "8 + 12",
   "trips": 2
  },
  {
   "building": "20/9/11",
   "trips": 2
  },
  {
   "building": "20-9",
   "trips": 2
  },
  {
   "building": "19_r1_r2",
   "trips": 2
  },
  {
   "building": "20 + 9 + 11",
   "trips": 2
  },
  {
   "building": "19 // 6",
   "trips": 1
  },
  {
   "building": "23 / 21 / 24",
   "trips": 1
  },
  {
   "building": "23 (5)",
   "trips": 1
  },
  {
   "building": "10/21",
   "trips": 1
  },
  {
   "building": "21 / 17",
   "trips": 1
  },
  {
   "building": "22 + 26",
   "trips": 1
  },
  {
   "building": "08",
   "trips": 1
  },
  {
   "building": "5 (23)",
   "trips": 1
  },
  {
   "building": "11+ 17",
   "trips": 1
  },
  {
   "building": "09",
   "trips": 1
  },
  {
   "building": "301",
   "trips": 1
  },
  {
   "building": "6_9",
   "trips": 1
  },
  {
   "building": "18 + 25",
   "trips": 1
  },
  {
   "building": "r2",
   "trips": 1
  },
  {
   "building": "11_12",
   "trips": 1
  },
  {
   "building": "23/R2",
   "trips": 1
  },
  {
   "building": "23-10",
   "trips": 1
  },
  {
   "building": "9_20_11",
   "trips": 1
  },
  {
   "building": "13 + 6",
   "trips": 1
  },
  {
   "building": "11+20+9",
   "trips": 1
  },
  {
   "building": "21 + 19",
   "trips": 1
  },
  {
   "building": "9*20",
   "trips": 1
  },
  {
   "building": "17-21",
   "trips": 1
  }
 ],
 "requesters": [
  {
   "type": "مشرف مبنى",
   "trips": 2075
  },
  {
   "type": "العيادة",
   "trips": 477
  },
  {
   "type": "0",
   "trips": 85
  },
  {
   "type": "إدارة",
   "trips": 83
  },
  {
   "type": "عيادة",
   "trips": 37
  },
  {
   "type": "أخصائية إجتماعية",
   "trips": 15
  },
  {
   "type": "تصريح",
   "trips": 7
  },
  {
   "type": "مشرف امن",
   "trips": 4
  },
  {
   "type": "109",
   "trips": 2
  },
  {
   "type": "مشرف مواصلات",
   "trips": 1
  }
 ],
 "unmatchedDestinations": 512
};
