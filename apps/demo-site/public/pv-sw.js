/* PushVault service worker — upload to the site root as /pv-sw.js */
self.addEventListener("push", (e) => {
  const d = e.data.json();
  e.waitUntil(
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: d.icon,
      image: d.image,
      // keep full actions (incl. per-action url / tel:) in data — the
      // notification's own `actions` only carries {action, title}
      data: { url: d.url, send_id: d.send_id, actions: d.actions || [] },
      actions: (d.actions || []).map((a) => ({ action: a.action, title: a.title })),
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const { url, send_id } = e.notification.data || {};
  let target = (e.action && (e.notification.data.actions || []).find((a) => a.action === e.action)?.url) || url;
  // tag the landing URL with the send id so the page pixel can attribute revenue
  if (send_id && /^https?:/.test(target)) {
    try {
      const u = new URL(target);
      u.searchParams.set("pv_sid", send_id);
      target = u.toString();
    } catch (_) {}
  }
  // Android can launch the dialer straight from the notification tap, so for a
  // click-to-call target we dial tel: directly and skip the bridge page — no
  // URL is ever shown. iOS blocks tel: from a service worker, so it keeps using
  // the bridge page (the only way that works there).
  let dial = null;
  const ua = (self.navigator && self.navigator.userAgent) || "";
  if (/Android/i.test(ua) && target) {
    try {
      const u = new URL(target);
      if (/\/public\/call$/.test(u.pathname)) {
        const n = u.searchParams.get("n");
        if (n) dial = "tel:" + n.replace(/[^\d+]/g, "");
      }
    } catch (_) {}
  }
  e.waitUntil(
    (async () => {
      try {
        await fetch("http://localhost:3000/api/v1/public/event/click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_id }),
          keepalive: true,
        });
      } catch (_) {}
      if (dial) {
        try {
          return await clients.openWindow(dial);
        } catch (_) {
          /* fall back to the bridge page below */
        }
      }
      const all = await clients.matchAll({ type: "window" });
      for (const c of all) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      return clients.openWindow(target);
    })(),
  );
});
