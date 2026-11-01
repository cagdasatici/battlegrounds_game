import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25691); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

/** Test fixture only: places A 1.5 m in front of B (facing B) through the server's own body API. */
function placeNextTo(room: ArenaRoom, aId: number, bId: number): void {
  const mv = room.movement!;
  const bp = mv.position(bId)!;
  const a = mv.get(aId)!;
  const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
  a.rb.setTranslation(p, true);
  a.rb.setNextKinematicTranslation(p);
  a.state.facingYaw = 0; // faces -Z, toward B
  a.state.vx = 0; a.state.vz = 0;
}

describe("T13 Tide Duelist over a real Colyseus connection driven by the touch input stack", () => {
  test("td.b1 Current Bind: skillDown edge, server confirmed cast, capture and release events, 24 HP, no stale Captured", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const events: CombatEvent[] = [];
    const results: ActionResult[] = [];
    rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
    ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "td", contentHash: a.localContentHash });
    b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded
      && room.movement!.get(aId)!.state.grounded, 4000, "settled");
    placeNextTo(room, aId, bId);
    await sleep(60);

    const router = new PointerRouter(L);
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const pump = async (ms: number) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { a.send("input", sampler.sample(++tick)!); await sleep(16); }
    };
    // One tap on skill slot 1. The client sends only the skillDown/skillUp edges, never damage or targets.
    const s1 = L.controls.skill1;
    router.down({ pointerId: 21, x: s1.cx, y: s1.cy });
    await pump(100);
    router.up(21);
    await waitFor(() => events.some((e) => e.kind === "release" && e.moveId === "td.b1"), 6000, "release event");
    await pump(400);

    // Server confirmed the cast: accepted ActionResult with castId (entity.castCounter).
    const accepted = results.filter((m) => m.accepted && m.castId !== undefined);
    expect(accepted.length).toBe(1);
    expect(accepted[0]!.castId).toBe(`${aId}.1`);
    // Cast event, one capture, four scheduled hits, one release; all from the server.
    const mine = events.filter((e) => e.moveId === "td.b1" && e.actorId === String(aId));
    expect(mine.filter((e) => e.kind === "cast").length).toBe(1);
    const cap = mine.filter((e) => e.kind === "capture");
    expect(cap.length).toBe(1);
    expect(cap[0]!.targetId).toBe(String(bId));
    expect(cap[0]!.damage100).toBe(400);
    const hits = mine.filter((e) => e.kind === "hit");
    expect(hits.map((e) => e.damage100)).toEqual([400, 400, 400, 800]);
    expect(mine.filter((e) => e.kind === "release").length).toBe(1);
    // Tick spacing from the capture event: +10, +20, +30, +42 and release at +43.
    expect(hits.map((e) => e.tick - cap[0]!.tick)).toEqual([10, 20, 30, 42]);
    expect(mine.find((e) => e.kind === "release")!.tick - cap[0]!.tick).toBe(43);
    // Replicated state: 24 HP removed in total, no stale Captured on the victim, no capture left on the server.
    const total = (cap[0]!.damage100 ?? 0) + hits.reduce((s, e) => s + (e.damage100 ?? 0), 0);
    expect(total).toBe(2400);
    await waitFor(() => byName("Nora").hp100 === 10000 - 2400, 2000, "victim hp replicated");
    await waitFor(() => byName("Nora").action !== "Captured", 2000, "victim not captured");
    expect(byName("Nora").hp100).toBe(7600);
    expect(room.combat.captures.size).toBe(0);
    expect(room.combat.invariantViolations()).toEqual([]);
    // Replaying the same skill edge does not start a second cast (cooldown 1020 ticks).
    router.down({ pointerId: 22, x: s1.cx, y: s1.cy });
    await pump(100);
    router.up(22);
    await pump(200);
    expect(results.filter((m) => m.accepted && m.castId !== undefined).length).toBe(1);
    expect(results.some((m) => !m.accepted && m.reason === "COOLDOWN")).toBe(true);
    await a.leave();
    await b.leave();
  }, 30000);
});
