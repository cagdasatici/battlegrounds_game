import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { meterFraction } from "../../packages/shared/src/awakening.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * T21 wire rows: the Ember Artificer is picked through the normal lobby handshake (it is selectable since T21, so no
 * server kit fixture), then activates Stellar Furnace and casts an awakened move (ea.a3 Furnace Ray) through the touch
 * input stack (PointerRouter + IntentSampler) against a second real client, over real Colyseus connections. Every
 * expectation reads what BOTH clients replicated (players, form, hp) and the combat events each received. Server objects
 * only place fighters and pre-fill the meter (the meter itself is covered by tests/integration/awakening.test.ts).
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25780); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });
const HP = 10000;

async function open() {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const ra = await a.join(code);
  const rb = await b.join(code);
  const events = { A: [] as CombatEvent[], B: [] as CombatEvent[] };
  const results: ActionResult[] = [];
  ra.onMessage("combatEvent", (e: CombatEvent) => { events.A.push(e); });
  rb.onMessage("combatEvent", (e: CombatEvent) => { events.B.push(e); });
  ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
  await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
  a.send("ready", { kitId: "ea", contentHash: a.localContentHash });
  b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
  const by = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => by(ra, "Arel")?.ready && by(rb, "Nora")?.ready && by(ra, "Arel").action === "Idle" && by(rb, "Nora").action === "Idle", 3000, "ready");
  expect(by(rb, "Arel").kitId).toBe("ea"); // picked through the lobby, replicated to the other client
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const aId = by(ra, "Arel").entityId as number, bId = by(ra, "Nora").entityId as number;
  await waitFor(() => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
    && room.movement!.get(aId)!.state.grounded && room.movement!.get(bId)!.state.grounded, 4000, "settled");
  const place = (id: number, x: number, z: number, yaw: number): void => {
    const y = (room.world!.groundHeight(x, z) ?? 0) + 0.9;
    const body = room.movement!.get(id)!;
    body.rb.setTranslation({ x, y, z }, true);
    body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.facingYaw = yaw; body.state.vx = 0; body.state.vy = 0; body.state.vz = 0;
  };
  const router = new PointerRouter(L, { awakeningReady: () => meterFraction("ea", by(ra, "Arel").meter100) >= 1 });
  const sampler = new IntentSampler(router, a.welcome!.epoch);
  let seq = 0, pid = 100;
  const sendInput = () => a.send("input", sampler.sample(++seq)!);
  const tapControl = async (id: "skill1" | "skill2" | "skill3" | "skill4" | "awaken"): Promise<ActionResult> => {
    const before = results.length;
    const c = L.controls[id];
    const p = ++pid;
    router.down({ pointerId: p, x: c.cx, y: c.cy });
    sendInput();
    router.up(p);
    sendInput();
    await waitFor(() => results.length > before, 2000, `action result ${id}`);
    return results[before]!;
  };
  const hpSeenByBoth = (name: string, hp: number) => by(ra, name).hp100 === hp && by(rb, name).hp100 === hp;
  const evs = (k: "A" | "B", moveId: string, kind: CombatEvent["kind"]) => events[k].filter((e) => e.moveId === moveId && e.kind === kind);
  return { a, b, ra, rb, room, aId, bId, by, place, router, sendInput, tapControl, results, events, evs, hpSeenByBoth };
}
type Ctx = Awaited<ReturnType<typeof open>>;
async function close(x: Ctx): Promise<void> {
  await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 12000, "caster recovered");
  expect(x.room.combat.invariantViolations()).toEqual([]);
  expect(x.room.combat.captures.size).toBe(0);
  await x.a.leave(); await x.b.leave();
}

describe("T21 Ember Artificer awakening over a real Colyseus connection", () => {
  test("Stellar Furnace: early awaken is METER-rejected; a full meter activates, pulses at +0 and +72 hit B for 16 HP each, the form replicates with its 2820 tick end", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 6, Math.PI); // 3 m ahead, inside the 5 m pulse radius
    await sleep(80);
    x.room.combat.get(x.aId)!.meter100 = 34000;
    await waitFor(() => x.by(x.ra, "Arel").meter100 === 34000, 2000, "meter replicated");
    // The real client gates the tap on the replicated meter: below full nothing is sent.
    const c = L.controls.awaken;
    x.router.down({ pointerId: 7, x: c.cx, y: c.cy });
    x.sendInput();
    x.router.up(7);
    x.sendInput();
    await sleep(100);
    expect(x.results.length).toBe(0);
    x.room.combat.get(x.aId)!.meter100 = 35000;
    await waitFor(() => x.by(x.ra, "Arel").meter100 === 35000, 2000, "full meter replicated");
    const res = await x.tapControl("awaken");
    expect(res.accepted).toBe(true);
    expect(res.castId).toBe(`${x.aId}.${x.room.combat.get(x.aId)!.castCounter}`);
    expect(x.evs("A", "ea.activate", "cast")[0]!.tick).toBe(res.tick);
    await waitFor(() => x.by(x.ra, "Arel").action === "Awakening" && x.by(x.rb, "Arel").action === "Awakening", 1000, "Awakening replicated");
    await waitFor(() => x.hpSeenByBoth("Nora", HP - 1600), 2000, "first pulse");
    await waitFor(() => x.by(x.ra, "Arel").form === "Awakened" && x.by(x.rb, "Arel").form === "Awakened", 6000, "form replicated");
    expect(x.by(x.rb, "Nora").hp100).toBe(HP - 3200); // second pulse at +72
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.activate", "hit");
      expect(hits.map((e) => e.damage100), `pulses seen by ${k}`).toEqual([1600, 1600]);
      expect(hits[1]!.tick - hits[0]!.tick).toBe(72);
      expect(hits[0]!.tick).toBe(res.tick);
    }
    const f = x.room.combat.get(x.aId)!;
    expect(f.formEndTick).toBe(res.tick + 90 + 2820);
    expect(x.by(x.rb, "Arel").meter100).toBe(0);
    await close(x);
  }, 40000);

  test("ea.a3 Furnace Ray: a replicated awakened cast, seven pulses of 5 HP at +[0,15,30,45,60,75,89], 35 HP on both clients, armor after the first hit", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 4, Math.PI);
    await sleep(80);
    const f = x.room.combat.get(x.aId)!;
    f.form = "Awakened"; f.awakenedUsedMask = 0; // fixture: the activation itself is the previous test
    await waitFor(() => x.by(x.ra, "Arel").form === "Awakened" && x.by(x.rb, "Arel").form === "Awakened", 2000, "form replicated");
    const res = await x.tapControl("skill3");
    expect(res.accepted).toBe(true);
    expect(x.evs("A", "ea.a3", "cast")[0]!.tick).toBe(res.tick);
    await waitFor(() => x.hpSeenByBoth("Nora", HP - 3500), 6000, "35 HP on both clients");
    for (const k of ["A", "B"] as const) {
      const hits = x.evs(k, "ea.a3", "hit");
      expect(hits.map((e) => e.damage100), `pulses seen by ${k}`).toEqual([500, 500, 500, 500, 500, 500, 500]);
      expect(hits.map((e) => e.tick - hits[0]!.tick)).toEqual([0, 15, 30, 45, 60, 75, 89]);
      expect(hits[0]!.tick - res.tick).toBe(30);
    }
    expect(x.by(x.rb, "Arel").cooldownEndTicks[2]).toBeGreaterThan(x.room.sim.tick + 1000);
    expect(x.by(x.ra, "Arel").form).toBe("Awakened"); // a3 does not consume the form
    await close(x);
  }, 40000);

  test("ea.a3 interruption over the wire: a stun in startup cancels the beam; nothing lands and the cooldown is spent", async () => {
    const x = await open();
    x.place(x.aId, -4, 9, 0);
    x.place(x.bId, -4, 4, Math.PI);
    await sleep(80);
    const f = x.room.combat.get(x.aId)!;
    f.form = "Awakened"; f.awakenedUsedMask = 0;
    await waitFor(() => x.by(x.rb, "Arel").form === "Awakened", 2000, "form replicated");
    expect((await x.tapControl("skill3")).accepted).toBe(true);
    await sleep(100);
    const { applyReaction } = await import("../../apps/server/src/sim/ActionMachine.js");
    applyReaction(f, x.room.sim.tick, { kind: "stun", ticks: 30 }, false); // fixture: an enemy hit stand-in
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 6000, "caster idle again");
    expect(x.by(x.ra, "Nora").hp100).toBe(HP);
    expect(x.by(x.rb, "Nora").hp100).toBe(HP);
    expect(x.evs("B", "ea.a3", "hit")).toHaveLength(0);
    await close(x);
  }, 30000);
});
