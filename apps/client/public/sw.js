/* Elemental Battlegrounds offline shell (WEB1). __BUILD_ID__ is replaced by the Vite build (apps/client/vite.config.ts).
   Never touches /api/*, /matchmake, /healthz or WebSocket upgrades. Routing below mirrors src/app/swRouting.ts. */
const BUILD_ID = "__BUILD_ID__";
const SHELL_CACHE_PREFIX = "eb-shell-";
const cacheName = (id) => SHELL_CACHE_PREFIX + id;
const staleCaches = (names, id) => names.filter((n) => n.startsWith(SHELL_CACHE_PREFIX) && n !== cacheName(id));
function routeRequest(rawUrl, method, selfOrigin) {
  if (method !== "GET") return "bypass";
  let u;
  try { u = new URL(rawUrl); } catch { return "bypass"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "bypass";
  if (u.origin !== selfOrigin) return "bypass";
  const p = u.pathname;
  if (p.startsWith("/api/") || p.startsWith("/matchmake") || p === "/healthz" || p === "/admin" || p.startsWith("/admin/") || p === "/admin.html" || p === "/sw.js" || p === "/asset-manifest.json") return "bypass";
  if (p.startsWith("/assets/") || p.startsWith("/icons/")) return "cache-first";
  return "network-first";
}
self.__swRouting = { cacheName, staleCaches, routeRequest };

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const res = await fetch("/asset-manifest.json", { cache: "no-store" });
    const manifest = await res.json();
    const urls = ["/", "/manifest.webmanifest", "/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png", ...manifest.assets];
    const cache = await caches.open(cacheName(BUILD_ID));
    await Promise.all(urls.map((u) => cache.add(new Request(u, { cache: "reload" }))));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const n of staleCaches(await caches.keys(), BUILD_ID)) await caches.delete(n);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const route = routeRequest(req.url, req.method, self.location.origin);
  if (route === "bypass") return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName(BUILD_ID));
    if (route === "cache-first") {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) await cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req);
      if (res.ok && !req.headers.has("range")) await cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === "navigate" ? await cache.match("/") : undefined);
      if (hit) return hit;
      throw err;
    }
  })());
});
