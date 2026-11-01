import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult } from "../../packages/shared/src/protocol.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25677); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T09 combat states over a real Colyseus connection", () => {
  test("dash edge: accepted once, repeat rejected, server moves the fighter; guard hold replicates; leave cleans up", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const results: ActionResult[] = [];
    ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const meFromB = () => [...players(rb).values()].find((p) => p.displayName === "Arel");
    await waitFor(() => meFromB()?.ready === true && meFromB()!.action === "Idle" && Math.abs(meFromB()!.y - 92) <= 3, 3000, "settled");
    const epoch = a.welcome!.epoch;
    const z0 = meFromB()!.z, x0 = meFromB()!.x;
    const dirZ = z0 > 0 ? -1 : 1; // toward the arena centre
    let seq = 0;
    // Two dash edges in consecutive packets (arrive within a tick or two of each other).
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 1, kind: "dash" }] }));
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 2, kind: "dash" }] }));
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 2, kind: "dash" }] })); // duplicate id: ignored
    await waitFor(() => results.length >= 2, 2000, "two action results");
    await waitFor(() => String(meFromB()!.moveId).startsWith("dash."), 1000, "B sees dash");
    expect(meFromB()!.action).toBe("Dash");
    expect(results[0]).toMatchObject({ edgeId: 1, accepted: true, epoch });
    expect(results[1]).toMatchObject({ edgeId: 2, accepted: false });
    expect(["STATE", "COOLDOWN"]).toContain(results[1]!.reason);
    await waitFor(() => meFromB()!.action === "Idle", 1500, "dash ends");
    await sleep(200);
    expect(results.length).toBe(2);
    const moved = Math.abs(meFromB()!.z - z0) / 100;
    // Forward 22 m/s x 18 ticks = 6.6 m or back 18 m/s x 18 = 5.4 m, plus coasting deceleration.
    expect(moved).toBeGreaterThan(4.5);
    expect(moved).toBeLessThan(12);
    expect(Math.abs(meFromB()!.x - x0)).toBeLessThan(30);

    // A third dash right after: same direction bucket is cooling down.
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 3, kind: "dash" }] }));
    await waitFor(() => results.length === 3, 2000, "third result");
    expect(results[2]).toMatchObject({ edgeId: 3, accepted: false, reason: "COOLDOWN" });

    // Guard hold: replicated as Guard while held, then recovery and Idle on release.
    const t0 = Date.now();
    while (Date.now() - t0 < 300) { a.send("input", pkt(epoch, ++seq, { blockHeld: true })); await sleep(33); }
    expect(meFromB()!.action).toBe("Guard");
    a.send("input", pkt(epoch, ++seq, { blockHeld: false }));
    await waitFor(() => meFromB()!.action === "Idle", 1000, "guard released");

    // Departure removes the fighter (captures, if any, are released by CombatSystem.remove).
    await a.leave();
    await waitFor(() => players(rb).size === 1, 2000, "A removed");
    await b.leave();
  });
});
