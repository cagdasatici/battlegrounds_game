import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { ClientMessage, type ActionResult, type CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25680); });
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

describe("T12 Stone Vanguard base moves over a real Colyseus connection", () => {
  test("touch skill edges for sv.b3 then sv.b4: server confirmed castId, cast event, hit event, replicated HP; no client damage path", async () => {
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

    const router = new PointerRouter(L);
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const pump = async (ms: number) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { a.send("input", sampler.sample(++tick)!); await sleep(33); }
    };
    /** A touch tap on a skill button: the client emits skillDown (and skillUp) edges only, never damage or targets. */
    const tap = async (slot: 1 | 2 | 3 | 4, pointerId: number) => {
      const c = L.controls[`skill${slot}` as "skill1"];
      router.down({ pointerId, x: c.cx, y: c.cy });
      a.send("input", sampler.sample(++tick)!);
      router.up(pointerId);
      a.send("input", sampler.sample(++tick)!);
    };

    // No client path for damage: the message vocabulary has no hit/damage type, and forged messages are ignored.
    expect(Object.keys(ClientMessage).sort()).toEqual(["changeKit", "input", "leave", "ping", "ready"]);
    ra.send("hit", { targetId: bId, damage100: 9999 });
    ra.send("input", { ...sampler.sample(++tick)!, damage100: 9999, targetId: bId });
    await sleep(120);
    expect(room.combat.get(bId)!.hp100).toBe(10000);

    // sv.b3 Rift Palm (startup 8): cast event, then hit at cast tick + 8 for 7 HP.
    await tap(3, 21);
    await waitFor(() => results.some((r) => r.accepted && r.castId !== undefined), 2000, "b3 action result");
    const r3 = results.find((r) => r.accepted && r.castId !== undefined)!;
    expect(r3.castId).toBe(`${aId}.${room.combat.get(aId)!.castCounter}`);
    await waitFor(() => events.some((e) => e.kind === "hit" && e.moveId === "sv.b3"), 2000, "b3 hit");
    const c3 = events.find((e) => e.kind === "cast" && e.moveId === "sv.b3" && e.actorId === String(aId))!;
    const h3 = events.find((e) => e.kind === "hit" && e.moveId === "sv.b3")!;
    expect(c3).toBeDefined();
    expect(r3.tick).toBe(c3.tick);
    expect([h3.tick - c3.tick, h3.damage100, h3.targetId, h3.actorId]).toEqual([8, 700, String(bId), String(aId)]);
    await waitFor(() => byName("Nora").hp100 === 9300, 1000, "hp replicated after b3");
    await pump(100);

    // The tap during cooldown is rejected by the server with COOLDOWN once the first cast is over.
    await waitFor(() => room.combat.get(aId)!.action === "Idle" && room.combat.get(bId)!.action === "Idle"
      && room.movement!.get(bId)!.state.grounded, 4000, "both idle");
    await tap(3, 22);
    await waitFor(() => results.some((r) => !r.accepted), 2000, "cooldown rejection");
    expect(results.find((r) => !r.accepted)!.reason).toBe("COOLDOWN");
    expect(room.combat.get(bId)!.hp100).toBe(9300);

    // sv.b4 Rising Pillar (startup 16): hit at cast tick + 16 for 15 HP, victim ragdolled.
    placeNextTo(room, aId, bId);
    await sleep(60);
    const before = events.length;
    await tap(4, 23);
    await waitFor(() => events.slice(before).some((e) => e.kind === "hit" && e.moveId === "sv.b4"), 2000, "b4 hit");
    const c4 = events.slice(before).find((e) => e.kind === "cast" && e.moveId === "sv.b4")!;
    const h4 = events.slice(before).find((e) => e.kind === "hit" && e.moveId === "sv.b4")!;
    expect([h4.tick - c4.tick, h4.damage100]).toEqual([16, 1500]);
    const r4 = results.filter((r) => r.accepted && r.castId !== undefined).at(-1)!;
    expect(r4.castId).toBe(`${aId}.${room.combat.get(aId)!.castCounter}`);
    await waitFor(() => byName("Nora").hp100 === 7800, 1000, "hp replicated after b4");
    expect(byName("Nora").action).toBe("Ragdolled");
    expect(room.combat.get(bId)!.hp100).toBe(7800);
    expect(room.combat.invariantViolations()).toEqual([]);
    await a.leave();
    await b.leave();
  }, 30000);
});
