const CACHE_NAME = "signage-kiosk-runtime-v1";
const CORE_ASSETS = [
  "/static/kiosk.css",
  "/static/kiosk.js",
  "/assets/branding/aksharderi-small2.png",
  "/assets/audio/alarm.mp3"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "CLEAR_RUNTIME") {
    event.waitUntil(caches.delete(CACHE_NAME).then(() => caches.open(CACHE_NAME)));
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return cache.match(request);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async response => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network;
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate" && url.pathname !== "/admin") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (/^\/api\/rooms\/[^/]+$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (
    url.pathname.startsWith("/static/")
    || url.pathname.startsWith("/assets/")
    || /^\/api\/rooms\/[^/]+\/qr\.svg$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
