self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Orienta reminder";
  const body = payload.body || "Return to the passenger app to continue.";
  const url = payload.url || "/pax/app";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "orienta-away",
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/pax/app";
  event.waitUntil(self.clients.openWindow(url));
});
