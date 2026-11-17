// عامل خدمة تطبيق السائق: يفتح الصفحات المحفوظة حين لا توجد شبكة.
// الصفحات: الشبكة أولاً ثم النسخة المحفوظة؛ ملفات التصميم والبرمجة الثابتة: المحفوظة أولاً.
const CACHE = "driver-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate" && url.pathname.startsWith("/driver")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.match(url.pathname).then((hit) => hit || caches.match("/driver"))),
    );
  }
});

// ───────────── الإشعارات الفورية ─────────────
// يُظهر الإشعار، ويخبر صفحات التطبيق المفتوحة لتحدّث نفسها، ويفتح الرابط عند الضغط عليه.
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || "الكمال", { body: d.body || "", tag: d.tag, data: { url: d.url || "/driver" }, icon: "/driver/app-icon/192", badge: "/driver/app-icon/192", dir: "auto" }),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: "push" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/driver", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => new URL(x.url).pathname.startsWith("/driver"));
      if (!c) return self.clients.openWindow(url);
      return c.focus().then(() => (c.navigate ? c.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    }),
  );
});
