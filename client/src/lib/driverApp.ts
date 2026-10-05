/**
 * تطبيق السائق لشاشة السيارة (APK في مجلد android): يفتح صفحة السائق داخل WebView ويضيف window.AlthumamaApp.
 * عند تشغيل الموقع في الصفحة تبدأ خدمة في التطبيق ترسل الموقع وتنبّه بالرحلات والتطبيق في الخلفية
 * (مثل فتح خرائط جوجل أو Waze للملاحة)، والصفحة ظاهرة ترسله بنفسها كما في المتصفح.
 */

type DriverAppBridge = {
  /** تشغيل الخدمة أو إيقافها، مع رقم السيارة ولغة الإشعارات */
  setSharing(on: boolean, plate: string, lang: string): void;
  /** الخدمة تعمل (بعد إعادة تحميل الصفحة تعود المشاركة) */
  isSharing(): boolean;
  version(): string;
};

/** أحداث من التطبيق إلى الصفحة */
export const APP_SHARING_EVENT = "althumama-sharing";
export const APP_OPEN_EVENT = "althumama-open";

export function driverApp(): DriverAppBridge | null {
  return (window as Window & { AlthumamaApp?: DriverAppBridge }).AlthumamaApp ?? null;
}

/** الصفحة داخل تطبيق السائق (والعلامة في وكيل المتصفح تظهر قبل تحميل الصفحة أيضًا). */
export const inDriverApp = () => driverApp() !== null || /AlthumamaDriverApp\//.test(navigator.userAgent);
