// Service Worker der Webseite: hält App, Startseite und Symbole für den Offline-Betrieb bereit.
// Erst Netz (damit Updates sofort ankommen), ohne Netz aus dem Speicher. Die Version setzt app/build.py ein.
const CACHE = "fahrtkosten-/*VERSION*/";
const DATEIEN = ["./", "index.html", "app.html", "impressum.html", "manifest.webmanifest", "symbol-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((alle) => Promise.all(alle.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Nur eigene Seiten; APK und PDF werden nicht zwischengespeichert
  if (e.request.method !== "GET" || url.origin !== location.origin || /\.(apk|pdf)$/.test(url.pathname)) return;
  e.respondWith(
    fetch(e.request).then((antwort) => {
      if (antwort.ok) { const kopie = antwort.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); }
      return antwort;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((t) => t || caches.match("app.html")))
  );
});
