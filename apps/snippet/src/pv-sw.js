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
  const target = (e.action && (e.notification.data.actions || []).find((a) => a.action === e.action)?.url) || url;
  e.waitUntil(
    (async () => {
      try {
        await fetch("__APP_BASE__/api/v1/public/event/click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_id }),
          keepalive: true,
        });
      } catch (_) {}
      const all = await clients.matchAll({ type: "window" });
      for (const c of all) {
        if (c.url === target && "focus" in c) return c.focus();
      }
      return clients.openWindow(target);
    })(),
  );
});
