/**
 * أي متصفح يفتح الموقع، لتثبيته على الهاتف بأمان.
 * في أندرويد يُثبَّت الموقع كتطبيق من Google Chrome فقط: متصفحات أخرى (مثل Samsung Internet) تنشئ ملف
 * تثبيت لإصدار قديم من أندرويد، فيحظره Google Play Protect («تم حظر تطبيق غير آمن»). في هذه المتصفحات
 * لا يُعرض ملف التثبيت (manifest)، ويُقترح فتح الموقع في Chrome.
 */

type BrandsNavigator = Navigator & { userAgentData?: { brands?: { brand: string }[] } };

export const isAndroid = () => /android/i.test(navigator.userAgent);

/** متصفح Google Chrome نفسه (لا متصفح آخر مبني عليه، ولا نافذة داخل تطبيق مثل فيسبوك). */
export function isGoogleChrome() {
  const brands = (navigator as BrandsNavigator).userAgentData?.brands;
  if (brands?.length) return brands.some((item) => item.brand === "Google Chrome");
  const ua = navigator.userAgent;
  return /Chrome\/\d/.test(ua)
    && !/SamsungBrowser|EdgA|OPR\/|Opera|OPT\/|MiuiBrowser|XiaoMi|HuaweiBrowser|HeyTapBrowser|VivoBrowser|OppoBrowser|YaBrowser|UCBrowser|DuckDuckGo|Firefox|; wv\)|Version\/\d/.test(ua);
}

/** أندرويد بمتصفح غير Chrome: التثبيت منه يحظره Play Protect. */
export const installNeedsChrome = () => isAndroid() && !isGoogleChrome();

/** رابط يفتح الصفحة نفسها في Chrome (وإن لم يكن مثبتًا: صفحة Chrome في متجر Google Play). */
export function openInChromeLink() {
  const fallback = encodeURIComponent("https://play.google.com/store/apps/details?id=com.android.chrome");
  return `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}
