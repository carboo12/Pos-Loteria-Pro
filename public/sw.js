const CACHE_NAME = "loto-pos-cache-v8";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        "/",
        "/index.html",
        "/manifest.json",
        "/icon-192.png",
        "/icon-512.png"
      ]);
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
    .then(() => {
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "SW_ACTIVATED", version: CACHE_NAME });
        }
      });
    })
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || e.request.url.includes("/api/")) {
    return;
  }

  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  const isImage = e.request.destination === 'image' || e.request.url.match(/\.(png|jpg|jpeg|gif|svg)$/i);
  
  if (isImage) {
    e.respondWith(
      fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return networkResponse;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 &&
          networkResponse.type === "basic") {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
      }
      return networkResponse;
    }).catch(() => caches.match(e.request))
  );
});
