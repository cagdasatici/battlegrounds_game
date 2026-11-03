import { afterAll, beforeAll, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import type { ProjectileSpawn } from "../../apps/server/src/sim/Projectiles.js";

/**
 * GR02: a detached projectile stays bound to the occupant that fired it. Real clients over real sockets; the
 * scheduler is frozen (setSimulationInterval no-op) and the room is stepped manually for determinism.
 */
let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

const orb = (live: ArenaRoom, ownerId: number, over: Partial<ProjectileSpawn> = {}): ProjectileSpawn => ({
  ownerId, ownerOccupant: live.occupantOf(ownerId) ?? 0, ownerLifeId: live.combat.get(ownerId)?.lifeId ?? 0,
  castCounter: 1, moveId: "ea.b3", x: 0, y: 0.9, z: 0, dirX: 0, dirY: 0, dirZ: -1, speed: 24, lifeTicks: 120, maxRange: 40,
  radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true, arcAmplitude: 0, arcSpan: 20, chargeClass: "full",
  damage100: 2500, chip100: 0, block: "U", reaction: { kind: "stun", ticks: 18 }, ...over,
});

async function setup() {
  const code = freshCode();
  const a = await loginClient(h, "A"), b = await loginClient(h, "B"), c = await loginClient(h, "C");
  const ra = await a.join(code), rb = await b.join(code);
  a.send("ready", { kitId: "ea", contentHash: a.localContentHash });
  b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
  const live = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  await waitFor(() => live.combat.all().length === 2);
  live.setSimulationInterval(() => undefined, 1000);
  return { a, b, c, ra, rb, live, code };
}
const place = (live: ArenaRoom, id: number, p: [number, number, number]): void => { live.movement!.add(id, p, 0); };
const clock = new WeakMap<ArenaRoom, number>();
const run = (live: ArenaRoom, n: number): void => {
  let t = clock.get(live) ?? live.sim.tick;
  for (let i = 0; i < n; i++) live.stepTick(++t);
  clock.set(live, t);
};

test("a replacement occupant of the departed owner id takes splash, earns no kill or assist, and both clients agree on B", async () => {
  const { a, b, c, rb, live, code } = await setup();
  try {
    const tick = live.sim.tick;
    const oldLife = live.combat.get(1)!.lifeId;
    const oldOccupant = live.occupantOf(1)!;
    live.projectiles.spawn(orb(live, 1, { damage100: 2500, castCounter: 1 }), tick);
    live.projectiles.spawn(orb(live, 1, { damage100: 2500, castCounter: 2, z: 0 }), tick + 1);
    await a.leave(); await waitFor(() => !live.state.players.has("1"));
    const rc = await c.join(code);
    c.send("ready", { kitId: "td", contentHash: c.localContentHash });
    await waitFor(() => !!live.combat.get(1));
    expect(live.combat.get(1)!.lifeId).not.toBe(oldLife);
    expect(live.occupantOf(1)).not.toBe(oldOccupant);
    const victim = live.combat.get(2)!; victim.hp100 = 3000; victim.protectedUntilTick = 0;
    const newcomer = live.combat.get(1)!; newcomer.protectedUntilTick = 0;
    place(live, 2, [0, 0.9, -1]); place(live, 1, [1.2, 0.9, -1]); // C stands inside the splash radius
    run(live, 12);
    const pc = live.state.players.get("1")!;
    expect(newcomer.hp100).toBeLessThan(10000); // a valid enemy of the old shot
    expect(pc.kills).toBe(0);
    expect(pc.assists).toBe(0);
    expect(live.combat.get(2)!.hp100).toBe(0); // both departed-owner shots land on B (detached damage unchanged)
    expect(live.state.players.get("2")!.deaths).toBe(1);
    await waitFor(() => players(rb).get("2")?.hp100 === live.combat.get(2)!.hp100 && players(rc).get("2")?.hp100 === live.combat.get(2)!.hp100);
    expect(players(rb).get("2").hp100).toBe(players(rc).get("2").hp100);
  } finally { await a.leave(); await b.leave(); await c.leave(); }
});

test("the kill probe: a departed owner's lethal shot gives the replacement C zero kills", async () => {
  const { a, b, c, live, code } = await setup();
  try {
    const tick = live.sim.tick;
    live.projectiles.spawn(orb(live, 1), tick);
    await a.leave(); await waitFor(() => !live.state.players.has("1"));
    await c.join(code); c.send("ready", { kitId: "td", contentHash: c.localContentHash });
    await waitFor(() => !!live.combat.get(1));
    const victim = live.combat.get(2)!; victim.hp100 = 100; victim.protectedUntilTick = 0;
    place(live, 2, [0, 0.9, -1]); place(live, 1, [10, 0.9, 10]);
    run(live, 10);
    expect(live.combat.get(2)!.hp100).toBe(0); // detached damage is unchanged
    expect(live.state.players.get("1")!.kills).toBe(0);
    expect(live.state.players.get("2")!.deaths).toBe(1);
  } finally { await a.leave(); await b.leave(); await c.leave(); }
});

test("the same occupant who died and respawned still gets the KO, with no heal or meter", async () => {
  const { a, b, c, live } = await setup();
  try {
    const tick = live.sim.tick;
    live.projectiles.spawn(orb(live, 1), tick);
    live.combat.kill(1, tick); live.abilities.reset(1);
    live.combat.respawn(1, tick, 4000); live.combat.get(1)!.protectedUntilTick = 0;
    const hpBefore = live.combat.get(1)!.hp100;
    const victim = live.combat.get(2)!; victim.hp100 = 100; victim.protectedUntilTick = 0;
    place(live, 2, [0, 0.9, -1]);
    run(live, 10);
    expect(live.state.players.get("1")!.kills).toBe(1);
    expect(live.combat.get(1)!.hp100).toBe(hpBefore);
    expect(live.combat.get(1)!.meter100).toBe(0);
  } finally { await a.leave(); await b.leave(); await c.leave(); }
});

test("fire, normal death, no replacement: the projectile still lands", async () => {
  const { a, b, c, live } = await setup();
  try {
    const tick = live.sim.tick;
    live.projectiles.spawn(orb(live, 1), tick);
    await a.leave(); await waitFor(() => !live.state.players.has("1"));
    const victim = live.combat.get(2)!; victim.hp100 = 10000; victim.protectedUntilTick = 0;
    place(live, 2, [0, 0.9, -1]);
    run(live, 10);
    expect(live.combat.get(2)!.hp100).toBe(7500);
    expect(live.projectiles.size).toBe(0);
  } finally { await a.leave(); await b.leave(); await c.leave(); }
});
