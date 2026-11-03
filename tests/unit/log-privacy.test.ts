import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { log, recentLogLines, redact, setLogSink } from "../../apps/server/src/ops/StructuredLog.js";
import { startHarness, type Harness } from "../fixtures/harness.js";

const IP = "203.0.113.9";
const NAME = "ReviewChild";
let lines: string[];
beforeEach(() => { lines = []; setLogSink((l) => lines.push(l)); });
afterEach(() => { setLogSink((l) => console.log(l)); });

describe("GR10 log privacy", () => {
  test("structured log redacts personal keys but keeps ids and credentials redaction", () => {
    log("info", "x", { displayName: NAME, name: NAME, ip: IP, ipAddress: IP, remoteAddress: IP, session: "ab12cd34", room: "r1", invite: "tok", nested: { ip: IP } });
    const line = lines[0]!;
    expect(line).not.toContain(NAME);
    expect(line).not.toContain(IP);
    expect(line).not.toContain("tok");
    expect(line).toContain("ab12cd34");
    expect(line).toContain("r1");
    expect(JSON.stringify(redact({ roomName: "keep" }))).toContain("keep");
  });

  describe("real session routes", () => {
    let h: Harness;
    beforeEach(async () => { h = await startHarness(undefined, { openJoin: true }); });
    afterEach(async () => { await h.stop(); });
    const post = (path: string, body: unknown) => fetch(`${h.origin}${path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: h.origin, "cf-connecting-ip": IP }, body: JSON.stringify(body),
    });

    test("rejected invite logs sourceHash only; open session creation omits the name", async () => {
      const bad = await post("/api/session", { invite: "nope-nope-nope", displayName: NAME });
      expect(bad.status).toBe(401);
      const open = await post("/api/open-session", { displayName: "Arel" });
      const all = [...lines, ...recentLogLines()].join("\n");
      expect(open.status).toBeLessThan(500);
      expect(all).not.toContain(IP);
      expect(all).not.toContain(NAME);
      expect(all).not.toContain("Arel");
      expect(all).toMatch(/"msg":"invite rejected"[^}]*"sourceHash":"[0-9a-f]{8}"/);
      expect([200, 201]).toContain(open.status);
      expect(all).toContain("open session created");
    });

    test("accepted and rejected categories stay distinguishable", async () => {
      const { token } = h.svc.invites.create({ ttlMs: 60_000, maxUses: 1 });
      expect((await post("/api/session", { invite: token, displayName: NAME })).status).toBe(201);
      expect((await post("/api/session", { invite: token, displayName: NAME })).status).toBe(401);
      const msgs = lines.map((l) => JSON.parse(l).msg);
      expect(msgs).toContain("session created");
      expect(msgs).toContain("invite rejected");
    });
  });
});
