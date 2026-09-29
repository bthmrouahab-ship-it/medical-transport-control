// عامل الخدمة: يجعل الموقع قابلًا للتثبيت على الهاتف، ويعرض إشعارات الرحلات للسائق.
// لا يخزّن شيئًا، فالبيانات والصفحة تأتي دائمًا من الخادم؛ وعند انقطاع الإنترنت تظهر رسالة بدل صفحة خطأ المتصفح.
const OFFLINE_PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#0b2545" />
<title>لا يوجد اتصال · سيارات الثمامة</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6f9; color: #0f1f35;
    font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { background: #fff; border-radius: 16px; padding: 28px 24px; max-width: 360px; text-align: center;
    box-shadow: 0 1px 3px rgba(15, 39, 66, 0.12); }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: #475569; line-height: 1.7; }
  button { background: #da291c; color: #fff; border: 0; border-radius: 10px; padding: 10px 22px; font: inherit;
    font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>تأكد من اتصال الهاتف بالإنترنت ثم أعد المحاولة.<br />No internet connection.<br />انٹرنیٹ کنکشن نہیں ہے۔</p>
  <button onclick="location.reload()">إعادة المحاولة</button>
</main>
</body>
</html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});

// إشعار من الخادم (رحلة جديدة، إلغاء رحلة، نفي مشرف المبنى): يظهر دائمًا ولو كان التطبيق مغلقًا
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "سيارات الثمامة", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: data.tag || "trip",
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 400],
      // لغة تطبيق السائق (العربية أو الإنجليزية أو الأردية)
      lang: data.lang || "ar",
      dir: data.dir || "rtl",
      data: { url: data.url || "/" },
    })
  );
});

// الضغط على الإشعار يفتح التطبيق (أو يعيده إلى الواجهة إن كان مفتوحًا)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => "focus" in client);
      return open ? open.focus() : self.clients.openWindow(url);
    })
  );
});
