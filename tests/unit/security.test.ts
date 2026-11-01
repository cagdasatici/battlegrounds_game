import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { InvalidMessageGuard, INVALID_LIMIT, INVALID_WINDOW_MS } from "../../apps/server/src/net/InvalidMessageGuard.js";
import { contentSecurityPolicy, originOk, securityHeaders } from "../../apps/server/src/http/securityHeaders.js";
import { SessionStore } from "../../apps/server/src/auth/SessionStore.js";
import { RateLimiter } from "../../apps/server/src/auth/RateLimiter.js";
import { redact } from "../../apps/server/src/ops/StructuredLog.js";
import { scanText } from "../../ops/scripts/secrets-scan.js";

describe("InvalidMessageGuard", () => {
  test("disconnects on the 10th invalid message inside 10 s, not on 9", () => {
    const g = new InvalidMessageGuard();
    for (let i = 0; i < INVALID_LIMIT - 1; i++) expect(g.record(1000 + i)).toBe(false);
    expect(g.record(2000)).toBe(true);
  });
  test("spread out beyond the window never trips", () => {
    const g = new InvalidMessageGuard();
    for (let i = 0; i < 50; i++) expect(g.record(i * (INVALID_WINDOW_MS / 5))).toBe(false);
  });
});

describe("headers and origin", () => {
  test("CSP matches the spec directives and has no unsafe-eval or unsafe-inline", () => {
    const csp = contentSecurityPolicy("https://studio.local:2567");
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "connect-src 'self' data: wss://studio.local:2567"]) expect(csp).toContain(d);
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval|unsafe-inline/);
    expect(securityHeaders("https://a.b")["Referrer-Policy"]).toBe("no-referrer");
    expect(securityHeaders("https://a.b")["X-Content-Type-Options"]).toBe("nosniff");
  });
  test("origin check is exact", () => {
    const allowed = ["https://a.b"];
    expect(originOk("https://a.b", allowed)).toBe("ok");
    expect(originOk("https://a.b.evil.com", allowed)).toBe("foreign");
    expect(originOk("http://a.b", allowed)).toBe("foreign");
    expect(originOk(undefined, allowed)).toBe("missing");
  });
});

describe("rate limits and sessions", () => {
  test("5 per source per minute plus 30 global", () => {
    let t = 0;
    const per = new RateLimiter(5, 60_000, () => t), glob = new RateLimiter(30, 60_000, () => t);
    const ok = (ip: string): boolean => per.allow(ip) && glob.allow("*");
    expect([1, 2, 3, 4, 5].every(() => ok("a"))).toBe(true);
    expect(ok("a")).toBe(false);
    let granted = 5;
    for (let i = 0; i < 40; i++) if (ok(`ip${i}`)) granted++;
    expect(granted).toBe(30);
    t = 61_000;
    expect(ok("a")).toBe(true);
  });
  test("purgeExpired removes only expired sessions; revokeById needs a unique 8+ char prefix", () => {
    let t = 0;
    const store = new SessionStore(join(mkdtempSync(join(tmpdir(), "eb-")), "s.json"), () => t);
    const a = store.create("a"), b = store.create("b");
    expect(store.revokeById(a.session.id.slice(0, 4))).toBe(false);
    expect(store.revokeById(a.session.id.slice(0, 12))).toBe(true);
    expect(store.getById(a.session.id)).toBeNull();
    expect(store.purgeExpired()).toBe(0);
    t = 25 * 3600_000;
    expect(store.purgeExpired()).toBe(1);
    expect(store.getById(b.session.id)).toBeNull();
  });
});

describe("redaction and secrets scan", () => {
  test("log fields with secret-like names are redacted, nested too", () => {
    expect(redact({ invite: "x", n: { ticket: "y", ok: 1 } })).toEqual({ invite: "[redacted]", n: { ticket: "[redacted]", ok: 1 } });
  });
  test("scanner flags secrets and ignores plain code", () => {
    expect(scanText("const apiKey = \"" + "a".repeat(40) + "\"")).toContain("secret assignment");
    expect(scanText("-----BEGIN PRIVATE KEY-----")).toContain("private key");
    expect(scanText("const token = newToken(32);")).toEqual([]);
  });
});
