import type { Vehicle } from "./transport";

/**
 * قائمة السيارات والسائقين الأولية من ورقة «قائمة» في ملف «حركة السيارات اليومية».
 * تُحفظ في قاعدة البيانات عند أول دخول للمدير إن لم تكن موجودة. (الملخص الإحصائي في historySeed.ts)
 */
export const FLEET_SEED: Vehicle[] = [
  {
    "plate": "943438",
    "driver": "خرم",
    "phone": "77712995",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "956479",
    "driver": "كمال",
    "phone": "55339592",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "956405",
    "driver": "إسماعيل",
    "phone": "50503057",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "975517",
    "driver": "نترا",
    "phone": "66450012",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "976004",
    "driver": "رامش / انتخاب",
    "phone": "30226299",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "975536",
    "driver": "خيرالدين",
    "phone": "30038512",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "932418",
    "driver": "سفيان / عبدالغني",
    "phone": "33691475",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "957153",
    "driver": "عبادشاه",
    "phone": "77728452",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "975534",
    "driver": "محمد ادم / محمد حسين",
    "phone": "30353865",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "937455",
    "driver": "الطاف",
    "phone": "30830192",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "976007",
    "driver": "غلفام",
    "phone": "70163516",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "975532",
    "driver": "يوسف بشير / سنترام",
    "phone": "55752762",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "108443",
    "driver": "جودي عبد ارحمن",
    "phone": "70734689",
    "kind": "احتياجات خاصة",
    "available": true
  },
  {
    "plate": "975529",
    "driver": "بن علي",
    "phone": "39955662",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "157724",
    "driver": "محمد سراج",
    "phone": "70922766",
    "kind": "احتياجات خاصة",
    "available": true
  },
  {
    "plate": "158774",
    "driver": "عبد الله",
    "phone": "66656501",
    "kind": "احتياجات خاصة",
    "available": true
  },
  {
    "plate": "329538",
    "driver": "عادل",
    "phone": "55226916",
    "kind": "باص",
    "available": true
  },
  {
    "plate": "278320",
    "driver": "تطهير",
    "phone": "31498375",
    "kind": "باص",
    "available": true
  },
  {
    "plate": "106270",
    "driver": "قولزار",
    "phone": "30291312",
    "kind": "باص",
    "available": true
  },
  {
    "plate": "41795",
    "driver": "الماحي / محمد زاكر",
    "phone": "70284658",
    "kind": "احتياجات خاصة",
    "available": true
  },
  {
    "plate": "977544",
    "driver": "معاذ",
    "phone": "77937715",
    "kind": "سيدان",
    "available": true
  },
  {
    "plate": "939274",
    "driver": "سيد صابر",
    "phone": "31206507",
    "kind": "سيدان",
    "available": true
  }
];
