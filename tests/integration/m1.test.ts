import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25679); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

/**
 * Test fixture only: places A 1.5 m in front of B, facing B, through the server's own body API.
 * Everything after this (input, M1 cadence, hit queries, damage) is real client -> server traffic.
 */
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

describe("T10 M1 over a real Colyseus connection driven by the touch input stack", () => {
  test("touch hold on Attack maps to legal server repeats and server-side damage; Jump held gives uppercut without a jump", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const events: CombatEvent[] = [];
    rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    // Wait for spawn protection (120 ticks) to lapse on both, and for both to settle on the ground.
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded, 4000, "settled");
    placeNextTo(room, aId, bId);
    await sleep(60);

    const router = new PointerRouter(L);
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const pump = async (ms: number) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { a.send("input", sampler.sample(++tick)!); await sleep(33); } // ~30 Hz
    };
    const atk = L.controls.attack;
    // The client never sends damage, targets or M1 edges: only attackHeld while the pointer is down.
    router.down({ pointerId: 7, x: atk.cx, y: atk.cy });
    await pump(1900); // ~114 ticks: one full chain (104 ticks) plus the next first hit
    router.up(7);
    await pump(400);
    const casts = events.filter((e) => e.kind === "cast" && e.actorId === String(aId));
    const hits = events.filter((e) => e.kind === "hit" && e.actorId === String(aId));
    expect(casts.slice(0, 4).map((e) => e.moveId)).toEqual(["m1.1", "m1.2", "m1.3", "m1.4.finisher"]);
    const gaps = casts.slice(1).map((e, i) => e.tick - casts[i]!.tick);
    // Legal cadence: 21 between hits 1-3 and 41 after the fourth (no attack during fourth recovery).
    expect(gaps.slice(0, 4)).toEqual([21, 21, 21, 41]);
    for (const g of gaps) expect([21, 41]).toContain(g);
    expect(hits.slice(0, 4).map((e) => e.damage100)).toEqual([300, 300, 400, 400]);
    expect(hits.slice(0, 4).map((e, i) => e.tick - casts[i]!.tick)).toEqual([8, 8, 8, 8]);
    const dealt = hits.reduce((s, e) => s + (e.damage100 ?? 0), 0);
    await waitFor(() => byName("Nora").hp100 === 10000 - dealt, 1000, "hp replicated");
    expect(dealt).toBeGreaterThanOrEqual(1400);
    // Releasing the touch stops repeats.
    const n = casts.length;
    await pump(500);
    expect(events.filter((e) => e.kind === "cast" && e.actorId === String(aId)).length).toBe(n);

    // A03 over the wire: hold Attack, then hold Jump during the combo -> uppercut and no ordinary jump.
    await waitFor(() => room.combat.get(bId)!.action === "Idle" && room.movement!.get(bId)!.state.grounded
      && room.m1.nextIndex(room.combat.get(aId)!, room.sim.tick) === 0, 4000, "B recovered and chain gap expired");
    placeNextTo(room, aId, bId);
    await sleep(60);
    const y0 = room.movement!.position(aId)![1];
    const before = events.length;
    let maxRise = 0;
    router.down({ pointerId: 8, x: atk.cx, y: atk.cy });
    const jmp = L.controls.jump;
    const t0 = Date.now();
    let jumpDown = false;
    while (Date.now() - t0 < 1500) {
      if (!jumpDown && Date.now() - t0 > 300) { router.down({ pointerId: 9, x: jmp.cx, y: jmp.cy }); jumpDown = true; }
      a.send("input", sampler.sample(++tick)!);
      maxRise = Math.max(maxRise, room.movement!.position(aId)![1] - y0);
      await sleep(33);
    }
    router.up(8); router.up(9);
    await pump(200);
    const c2 = events.slice(before).filter((e) => e.kind === "cast" && e.actorId === String(aId)).map((e) => e.moveId);
    expect(c2.slice(0, 4)).toEqual(["m1.1", "m1.2", "m1.3", "m1.4.uppercut"]);
    expect(maxRise).toBeLessThan(0.05); // jump edge and held Jump during the combo did not jump
    expect(room.combat.invariantViolations()).toEqual([]);
    await a.leave();
    await b.leave();
  }, 20000);
});
