/** Pure service-worker routing (WEB1). No DOM. public/sw.js carries a copy; tests/unit/sw-routing.test.ts keeps them identical. */
export type SwRoute = "bypass" | "cache-first" | "network-first";

export const SHELL_CACHE_PREFIX = "eb-shell-";

export function cacheName(buildId: string): string {
  return SHELL_CACHE_PREFIX + buildId;
}

/** Old caches to delete on activate: ours, but not the current build's. */
export function staleCaches(names: readonly string[], buildId: string): string[] {
  const keep = cacheName(buildId);
  return names.filter((n) => n.startsWith(SHELL_CACHE_PREFIX) && n !== keep);
}

/** Never answer API, health, matchmaking, WebSocket, non-GET or cross-origin requests; hashed assets are cache-first. */
export function routeRequest(rawUrl: string, method: string, selfOrigin: string): SwRoute {
  if (method !== "GET") return "bypass";
  let u: URL;
  try { u = new URL(rawUrl); } catch { return "bypass"; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "bypass";
  if (u.origin !== selfOrigin) return "bypass";
  const p = u.pathname;
  if (p.startsWith("/api/") || p.startsWith("/matchmake") || p === "/healthz" || p === "/admin" || p.startsWith("/admin/") || p === "/admin.html" || p === "/sw.js" || p === "/asset-manifest.json") return "bypass";
  if (p.startsWith("/assets/") || p.startsWith("/icons/")) return "cache-first";
  return "network-first";
}
