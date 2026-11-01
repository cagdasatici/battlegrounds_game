import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { cacheName, routeRequest, staleCaches } from "../../apps/client/src/app/swRouting.js";

const O = "https://play.example.com";
describe("swRouting", () => {
  it("names caches per build and deletes only stale shell caches", () => {
    expect(cacheName("abc")).toBe("eb-shell-abc");
    expect(staleCaches(["eb-shell-old", "eb-shell-abc", "other"], "abc")).toEqual(["eb-shell-old"]);
  });
  it("never handles api, health, matchmake, websocket, non-GET or cross-origin", () => {
    for (const u of [`${O}/api/version`, `${O}/api/csrf`, `${O}/healthz`, `${O}/matchmake/join/x`, `${O}/sw.js`, `${O}/asset-manifest.json`, "wss://play.example.com/x", "https://evil.example/assets/a.js"]) {
      expect(routeRequest(u, "GET", O), u).toBe("bypass");
    }
    expect(routeRequest(`${O}/assets/a.js`, "POST", O)).toBe("bypass");
    expect(routeRequest("not a url", "GET", O)).toBe("bypass");
  });
  it("routes hashed assets cache-first and the shell network-first", () => {
    expect(routeRequest(`${O}/assets/index-abc.js`, "GET", O)).toBe("cache-first");
    expect(routeRequest(`${O}/icons/icon-192.png`, "GET", O)).toBe("cache-first");
    for (const p of ["/", "/manifest.webmanifest", "/index.html", "/anything"]) expect(routeRequest(O + p, "GET", O)).toBe("network-first");
  });
  it("public/sw.js carries identical routing", () => {
    const self: Record<string, unknown> = { addEventListener() {}, location: { origin: O } };
    runInNewContext(readFileSync("apps/client/public/sw.js", "utf8"), { self, URL, Request });
    const sw = self["__swRouting"] as { routeRequest: typeof routeRequest; cacheName: typeof cacheName; staleCaches: typeof staleCaches };
    for (const [u, m] of [[`${O}/api/x`, "GET"], [`${O}/assets/a.js`, "GET"], [`${O}/`, "GET"], [`${O}/x`, "POST"], ["https://o.example/a", "GET"], ["bad", "GET"], [`${O}/healthz`, "GET"]] as const) {
      expect(sw.routeRequest(u, m, O)).toBe(routeRequest(u, m, O));
    }
    expect(sw.cacheName("z")).toBe(cacheName("z"));
    expect(sw.staleCaches(["eb-shell-a", "eb-shell-b"], "b")).toEqual(staleCaches(["eb-shell-a", "eb-shell-b"], "b"));
  });
});
