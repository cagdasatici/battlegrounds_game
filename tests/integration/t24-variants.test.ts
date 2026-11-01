import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

/**
 * T24 Duelist P1 variants over real Colyseus connections: three real clients. A (Tide Duelist) drives the touch input
 * stack; B and C (Stone Vanguard) are the victims. Every assertion reads what each of the three clients received
 * (replicated players and combat events). Fixtures only place fighters and start A in the Awakened form (the same
 * server body placement API as tests/integration/kit-matrix.test.ts).
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(25718); });
afterAll(async () => { await h.stop(); });
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

async function setup() {
  const code = freshCode();
  const a = await loginClient(h, "Arel");
  const b = await loginClient(h, "Nora");
  const c = await loginClient(h, "Cato");
  const ra = await a.join(code), rb = await b.join(code), rc = await c.join(code);
  const rooms = { A: ra, B: rb, C: rc };
  const events: Record<"A" | "B" | "C", CombatEvent[]> = { A: [], B: [], C: [] };
  const results: ActionResult[] = [];
  (Object.keys(rooms) as ("A" | "B" | "C")[]).forEach((k) => rooms[k].onMessage("combatEvent", (e: CombatEvent) => { events[k].push(e); }));
  ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
  await waitFor(() => a.welcome !== null && [ra, rb, rc].every((r) => players(r).size === 3), 4000, "joined");
  a.send("ready", { kitId: "td", contentHash: a.localContentHash });
  b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
  c.send("ready", { kitId: "sv", contentHash: c.localContentHash });
  const by = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
  await waitFor(() => ["Arel", "Nora", "Cato"].every((n) => [ra, rb, rc].every((r) => by(r, n)?.ready && by(r, n).action === "Idle")), 4000, "ready");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const id = (n: string) => by(ra, n).entityId as number;
  const aId = id("Arel"), bId = id("Nora"), cId = id("Cato");
  await waitFor(() => [aId, bId, cId].every((i) => room.sim.tick > room.combat.get(i)!.protectedUntilTick + 2 && room.movement!.get(i)!.state.grounded), 5000, "settled");
  const router = new PointerRouter(L);
  const sampler = new IntentSampler(router, a.welcome!.epoch);
  let tick = 0, pid = 100;
  const tapSkill = (slot: 1 | 2 | 3 | 4) => {
    const ctl = L.controls[`skill${slot}` as "skill1"];
    const p = ++pid;
    router.down({ pointerId: p, x: ctl.cx, y: ctl.cy });
    a.send("input", sampler.sample(++tick)!);
    router.up(p);
    a.send("input", sampler.sample(++tick)!);
  };
  const place = (i: number, x: number, y: number, z: number, yaw: number) => {
    const body = room.movement!.get(i)!;
    body.rb.setTranslation({ x, y, z }, true);
    body.rb.setNextKinematicTranslation({ x, y, z });
    body.state.facingYaw = yaw; body.state.vx = 0; body.state.vz = 0;
  };
  const press = async (slot: 1 | 2 | 3 | 4): Promise<ActionResult> => {
    const before = results.length;
    tapSkill(slot);
    await waitFor(() => results.length > before, 2000, "action result");
    return results[before]!;
  };
  const clients = [a, b, c];
  return { a, b, c, clients, rooms, events, by, room, aId, bId, cId, place, press, results };
}
type Ctx = Awaited<ReturnType<typeof setup>>;
const hpOn = (x: Ctx, who: "A" | "B" | "C", name: string): number => x.by(x.rooms[who], name).hp100;
const everywhere = (x: Ctx, name: string, hp: number): boolean => (["A", "B", "C"] as const).every((k) => hpOn(x, k, name) === hp);
async function finish(x: Ctx): Promise<void> {
  await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 8000, "caster recovered");
  expect(x.room.combat.captures.size).toBe(0);
  expect(x.room.combat.invariantViolations()).toEqual([]);
  for (const cl of x.clients) await cl.leave();
}

describe("T24 Duelist P1 variants over a real Colyseus connection (three clients)", () => {
  test("td.a4 chain: second victim captured after the first release, 31 HP at +30, release +31, first victim not recaptured, seen by all three clients", async () => {
    const x = await setup();
    // B on its own spot, A 1.5 m from B on the arena-centre side facing B, C 3 m from A straight behind B.
    const bp = x.room.movement!.position(x.bId)!;
    const north = bp[2] > 0;
    const s = north ? -1 : 1; // direction from B toward A along Z
    const yaw = north ? Math.PI : 0;
    const y = bp[1];
    x.place(x.bId, bp[0], y, bp[2], yaw + Math.PI);
    x.place(x.aId, bp[0], y, bp[2] + s * 1.5, yaw);
    x.place(x.cId, bp[0], y, bp[2] - s * 1.5, yaw + Math.PI); // 3 m ahead of A, beyond B
    const f = x.room.combat.get(x.aId)!; f.form = "Awakened"; f.awakenedUsedMask = 0;
    await new Promise((r) => setTimeout(r, 60));
    const res = await x.press(4);
    expect(res.accepted).toBe(true);
    // First victim: 8 + 22 HP, replicated on every client.
    await waitFor(() => everywhere(x, "Nora", 10000 - 3000), 6000, "first victim hp on all clients");
    // Second victim: 31 HP at capture+30.
    await waitFor(() => everywhere(x, "Cato", 10000 - 3100), 8000, "second victim hp on all clients");
    await waitFor(() => x.events.A.filter((e) => e.moveId === "td.a4" && e.kind === "release").length === 2, 6000, "two releases");
    for (const k of ["A", "B", "C"] as const) {
      const ev = x.events[k].filter((e) => e.moveId === "td.a4" && e.actorId === String(x.aId));
      const caps = ev.filter((e) => e.kind === "capture");
      expect(caps.length, `captures seen by ${k}`).toBe(2);
      expect(new Set(caps.map((e) => e.targetId)).size).toBe(2); // two distinct targets, no recapture
      const second = caps[1]!;
      expect(second.targetId).toBe(String(x.cId));
      const hits2 = ev.filter((e) => e.kind === "hit" && e.targetId === String(x.cId));
      expect(hits2.map((e) => [e.tick - second.tick, e.damage100]), `second victim hits seen by ${k}`).toEqual([[30, 3100]]);
      const rels = ev.filter((e) => e.kind === "release");
      expect(rels[1]!.tick - second.tick).toBe(31);
      expect(ev.filter((e) => e.kind === "hit" && e.targetId === String(x.bId)).map((e) => e.damage100)).toEqual([2200]);
    }
    await finish(x);
  }, 60000);

  test("td.b2 elevated slam: caster started >= 2 m above the surface, lands before +48, final hit 24 HP replicated on every client", async () => {
    const x = await setup();
    const bp = x.room.movement!.position(x.bId)!;
    const north = bp[2] > 0;
    const s = north ? -1 : 1;
    const yaw = north ? Math.PI : 0;
    const y = bp[1] + 4; // 4 m above the settled standing height: well over the 2 m elevation threshold
    x.place(x.cId, 40, bp[1], 0, 0); // bystander far away
    x.place(x.bId, bp[0], y, bp[2], yaw + Math.PI);
    x.place(x.aId, bp[0], y, bp[2] + s * 1.5, yaw);
    const res = await x.press(2);
    expect(res.accepted).toBe(true);
    await waitFor(() => x.events.A.some((e) => e.moveId === "td.b2" && e.kind === "release"), 8000, "release event");
    for (const k of ["A", "B", "C"] as const) {
      const ev = x.events[k].filter((e) => e.moveId === "td.b2" && e.actorId === String(x.aId));
      const cap = ev.find((e) => e.kind === "capture")!;
      expect(cap, `capture seen by ${k}`).toBeTruthy();
      expect(ev.filter((e) => e.kind === "hit").map((e) => [e.tick - cap.tick, e.damage100]), `hits seen by ${k}`).toEqual([[48, 2400]]);
    }
    await waitFor(() => everywhere(x, "Nora", 10000 - 500 - 2400), 3000, "victim hp on all clients");
    await finish(x);
  }, 60000);
});
