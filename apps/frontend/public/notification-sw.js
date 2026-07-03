/* global self */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "Nytt Trondheim";
  const options = {
    body: typeof payload.body === "string" ? payload.body : "Ny viktig oppdatering.",
    tag: typeof payload.tag === "string" ? payload.tag : undefined,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    data: payload && typeof payload === "object" && "data" in payload ? payload.data : { url: "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client && client.url.endsWith(url)) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
