package com.sifrqr.althumama.driver;

/** نصوص الإشعارات بلغة السائق في صفحته: العربية والإنجليزية والأردية. */
final class Texts {
    private Texts() {}

    private static String pick(String lang, String ar, String en, String ur) {
        if ("en".equals(lang)) return en;
        if ("ur".equals(lang)) return ur;
        return ar;
    }

    static String sharingTitle(String lang, String plate) {
        return pick(lang, "مشاركة موقع السيارة " + plate + " مفعّلة", "Sharing the location of vehicle " + plate, "گاڑی " + plate + " کی لوکیشن شیئر ہو رہی ہے");
    }

    static String sharingText(String lang) {
        return pick(lang, "يُرسل الموقع ولو فتحت تطبيق الملاحة", "The location is sent even while you use navigation", "نیویگیشن استعمال کرتے وقت بھی لوکیشن بھیجی جاتی ہے");
    }

    static String stopSharing(String lang) {
        return pick(lang, "إيقاف المشاركة", "Stop sharing", "شیئرنگ بند کریں");
    }

    static String newTrips(String lang, int count) {
        if (count == 1) return pick(lang, "رحلة جديدة", "New trip", "نیا ٹرپ");
        return pick(lang, "رحلات جديدة (" + count + ")", "New trips (" + count + ")", "نئے ٹرپ (" + count + ")");
    }

    static String newTripText(String lang) {
        return pick(lang, "افتح التطبيق لترى تفاصيلها", "Open the app to see the details", "تفصیل دیکھنے کے لیے ایپ کھولیں");
    }

    static String cancelledTrips(String lang, int count) {
        if (count == 1) return pick(lang, "أُلغيت رحلة", "A trip was cancelled", "ایک ٹرپ منسوخ ہو گیا");
        return pick(lang, "أُلغيت رحلات (" + count + ")", "Trips cancelled (" + count + ")", "ٹرپ منسوخ ہو گئے (" + count + ")");
    }

    static String denied(String lang) {
        return pick(lang, "مشرف المبنى نفى ما سجّلته", "The building supervisor rejected your update", "بلڈنگ سپروائزر نے آپ کا اندراج مسترد کر دیا");
    }

    static String deniedText(String lang) {
        return pick(lang, "افتح التطبيق وتواصل مع مشرف المبنى", "Open the app and contact the building supervisor", "ایپ کھولیں اور بلڈنگ سپروائزر سے رابطہ کریں");
    }

    static String arrived(String lang) {
        return pick(lang, "وصلت إلى الوجهة", "Arrived at the destination", "منزل پر پہنچ گئے");
    }

    static String arrivedText(String lang) {
        return pick(lang, "سُجّل وصولك تلقائيًا", "Your arrival was recorded automatically", "آپ کی آمد خود بخود درج ہو گئی");
    }

    static String signedOut(String lang) {
        return pick(lang, "توقفت مشاركة الموقع", "Location sharing stopped", "لوکیشن شیئرنگ بند ہو گئی");
    }

    static String signedOutText(String lang) {
        return pick(lang, "انتهت جلسة الدخول. افتح التطبيق وسجّل الدخول ثم شغّل الموقع", "You were signed out. Open the app, sign in and turn the location on", "آپ سائن آؤٹ ہو گئے۔ ایپ کھولیں، سائن ان کریں اور لوکیشن آن کریں");
    }

    static String noVehicleText(String lang) {
        return pick(lang, "لا توجد سيارة مخصصة لك الآن", "No vehicle is assigned to you now", "اس وقت آپ کو کوئی گاڑی نہیں دی گئی");
    }

    static String sharingChannel(String lang) {
        return pick(lang, "مشاركة الموقع", "Location sharing", "لوکیشن شیئرنگ");
    }

    static String tripsChannel(String lang) {
        return pick(lang, "الرحلات", "Trips", "ٹرپ");
    }
}
