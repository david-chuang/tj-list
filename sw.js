// Offline support. Bump VERSION whenever you deploy changes so phones pick them up.
const VERSION = "v7";
const CACHE = `tj-list-${VERSION}`;
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "vendor/supabase.js",
  "data/catalog.json",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
const NETWORK_TIMEOUT_MS = 3000;

// Product thumbnails from Trader Joe's (~25 KB each). Kept across app versions, capped in size.
const IMG_CACHE = "tj-img-v1";
const IMG_PREFIX = "https://www.traderjoes.com/content/dam/trjo/products/";
const IMG_MAX_ENTRIES = 600;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tj-list-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin files: try the network (so updates show up), but fall back to the cache
// quickly when the store's signal is bad. Product photos: cache first (they rarely change).
// Supabase requests are left alone.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.url.startsWith(IMG_PREFIX)) event.respondWith(imageCacheFirst(req));
  else if (new URL(req.url).origin === self.location.origin) event.respondWith(networkFirst(req));
});

async function imageCacheFirst(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "cors") {
    await cache.put(req.url, res.clone());
    trimImages(cache);
  }
  return res;
}

let trimming = false;
async function trimImages(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys(); // oldest first
    for (const k of keys.slice(0, Math.max(0, keys.length - IMG_MAX_ENTRIES))) await cache.delete(k);
  } finally {
    trimming = false;
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch { /* offline: fall through to cache */ }
  const cached = await cache.match(req, { ignoreSearch: true }) ||
    (req.mode === "navigate" ? await cache.match("index.html") : undefined);
  return cached || network;
}
