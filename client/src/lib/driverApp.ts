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
  /** خدمة الموقع (GPS) مفتوحة في الجهاز (من النسخة 1.1) */
  locationEnabled?(): boolean;
  /** فتح إعدادات الموقع ليشغّل السائق GPS (من النسخة 1.1) */
  openLocationSettings?(): void;
  /** تنبيه الرحلة بصوت قوي على قناة المنبّه مع اهتزاز (من النسخة 1.2) */
  alarm?(): void;
};

/** أحداث من التطبيق إلى الصفحة */
export const APP_SHARING_EVENT = "althumama-sharing";
export const APP_OPEN_EVENT = "althumama-open";
/** عاد التطبيق إلى الواجهة (مثل الرجوع من إعدادات الموقع)، ومعه هل GPS مفتوح */
export const APP_RESUME_EVENT = "althumama-resume";

export function driverApp(): DriverAppBridge | null {
  return (window as Window & { AlthumamaApp?: DriverAppBridge }).AlthumamaApp ?? null;
}

/** الصفحة داخل تطبيق السائق (والعلامة في وكيل المتصفح تظهر قبل تحميل الصفحة أيضًا). */
export const inDriverApp = () => driverApp() !== null || /AlthumamaDriverApp\//.test(navigator.userAgent);
