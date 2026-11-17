// عامل خدمة شاشات المكتب: للإشعارات الفورية فقط (لا يحفظ صفحات).
// يُظهر الإشعار، ويخبر الصفحات المفتوحة لتحدّث الجرس، ويفتح الرابط عند الضغط عليه.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const office = (c) => !new URL(c.url).pathname.startsWith("/driver");

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {}
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || "الكمال", { body: d.body || "", tag: d.tag, data: { url: d.url || "/notifications" }, icon: "/driver/app-icon/192", dir: "rtl", lang: "ar" }),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.filter(office).forEach((c) => c.postMessage({ type: "push" }))),
    ]),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/notifications", self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      const c = cs.find(office);
      if (!c) return self.clients.openWindow(url);
      return c.focus().then(() => (c.navigate ? c.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    }),
  );
});
