import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { ClientMessage, type ActionResult, type CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { meterFraction } from "../../packages/shared/src/awakening.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25697); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

/** Test fixture only: places A 1.5 m in front of B, facing B, through the server's own body API (as in m1.test.ts). */
function placeNextTo(room: ArenaRoom, aId: number, bId: number): void {
  const mv = room.movement!;
  const bp = mv.position(bId)!;
  const a = mv.get(aId)!;
  const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
  a.rb.setTranslation(p, true);
  a.rb.setNextKinematicTranslation(p);
  a.state.facingYaw = 0;
  a.state.vx = 0; a.state.vz = 0;
}

describe("T14 awakening over a real Colyseus connection", () => {
  test("damage builds the meter on the server; early awaken is METER-rejected; full meter activates, completes and replicates", async () => {
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
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded, 4000, "settled");
    placeNextTo(room, aId, bId);
    await sleep(60);

    let forceReady = false;
    const router = new PointerRouter(L, { awakeningReady: () => forceReady || meterFraction("sv", byName("Arel").meter100) >= 1 });
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const tapControl = (id: "skill3" | "awaken", pointerId: number) => {
      const c = L.controls[id];
      router.down({ pointerId, x: c.cx, y: c.cy });
      a.send("input", sampler.sample(++tick)!);
      router.up(pointerId);
      a.send("input", sampler.sample(++tick)!);
    };

    // Test fixture only: pre-fill 19300 of the 20000 needed. The last 700 must come from a server confirmed hit.
    room.combat.get(aId)!.meter100 = 19300;
    // The real client gates the awaken tap on the replicated meter: below full it emits nothing at all.
    tapControl("awaken", 31);
    await sleep(150);
    expect(results.length).toBe(0);
    // A client whose readiness gate is wrong (or tampered with) still gets METER from the server.
    forceReady = true;
    tapControl("awaken", 34);
    forceReady = false;
    await waitFor(() => results.some((r) => !r.accepted), 2000, "early awaken rejected");
    expect(results.find((r) => !r.accepted)!.reason).toBe("METER");
    expect(room.combat.get(aId)!.action).toBe("Idle");

    tapControl("skill3", 32); // sv.b3 Rift Palm: 7 HP = 700
    await waitFor(() => events.some((e) => e.kind === "hit" && e.moveId === "sv.b3"), 2000, "b3 hit");
    await waitFor(() => byName("Arel").meter100 >= 20000, 1000, "meter replicated at or above one bar (BEAST02: it banks up to two)");
    await waitFor(() => room.combat.get(aId)!.action === "Idle", 3000, "recovered");

    const before = results.length;
    tapControl("awaken", 33);
    await waitFor(() => results.slice(before).some((r) => r.accepted), 2000, "awaken accepted");
    const ok = results.slice(before).find((r) => r.accepted)!;
    expect(ok.castId).toBe(`${aId}.${room.combat.get(aId)!.castCounter}`);
    const castEv = events.find((e) => e.kind === "cast" && e.moveId === "sv.activate")!;
    expect(castEv.tick).toBe(ok.tick);
    await waitFor(() => byName("Arel").action === "Awakening", 1000, "Awakening replicated");
    await waitFor(() => byName("Arel").form === "Awakened", 2000, "form replicated");
    const f = room.combat.get(aId)!;
    expect(f.actionStartTick).toBeGreaterThan(0);
    expect(byName("Arel").meter100).toBe(0);
    expect(byName("Arel").formEndTick).toBe(0);
    expect(byName("Arel").awakenedUsedMask).toBe(0);
    expect(room.sim.tick - ok.tick).toBeGreaterThanOrEqual(30); // 30 tick activation
    expect(room.combat.invariantViolations()).toEqual([]);
    await a.leave();
    await b.leave();
  }, 30000);
});
