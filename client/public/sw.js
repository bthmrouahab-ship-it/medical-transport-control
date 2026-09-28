// عامل الخدمة: يجعل الموقع قابلًا للتثبيت على الهاتف. لا يخزّن شيئًا، فالبيانات
// والصفحة تأتي دائمًا من الخادم؛ وعند انقطاع الإنترنت تظهر رسالة بدل صفحة خطأ المتصفح.
const OFFLINE_PAGE = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="theme-color" content="#0f2742" />
<title>لا يوجد اتصال · سيارات الثمامة</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #eef2f6; color: #0f1f35;
    font-family: "IBM Plex Sans Arabic", system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { background: #fff; border-radius: 16px; padding: 28px 24px; max-width: 360px; text-align: center;
    box-shadow: 0 1px 3px rgba(15, 39, 66, 0.12); }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { margin: 0 0 20px; color: #475569; line-height: 1.7; }
  button { background: #b3202f; color: #fff; border: 0; border-radius: 10px; padding: 10px 22px; font: inherit;
    font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>تأكد من اتصال الهاتف بالإنترنت ثم أعد المحاولة.<br />No internet connection.</p>
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
