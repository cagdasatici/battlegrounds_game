import { buildAbilityRegistry, defineAbility, type AbilityDef, type AbilitySpec } from "../../packages/shared/src/abilities.js";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import type { ArenaMap } from "../../packages/shared/src/config/arena.js";
import type { KitId } from "../../packages/shared/src/protocol.js";
import { ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import { ProjectileSystem, type ProjectileSpawn } from "../../apps/server/src/sim/Projectiles.js";
import { AwakeningSystem } from "../../apps/server/src/sim/Awakening.js";
import type { HitResult } from "../../apps/server/src/sim/HitResolver.js";
import { World } from "../../apps/server/src/sim/World.js";

/**
 * T19 test rig. Since T20 the Ember Orb is the SHIPPED ea.b3 definition (packages/shared/src/config/kits/ea.ts); this
 * file no longer carries a test-only copy. ORB_SPEC is the shipped definition and orbDef() derives variants from it.
 */
const SHIPPED_ORB = ALL_ABILITY_DEFS.find((d) => d.id === "ea.b3");
if (!SHIPPED_ORB) throw new Error("ea.b3 must be shipped by T20");
export const ORB_SPEC: AbilitySpec = SHIPPED_ORB;
export const orbDef = (over: Partial<AbilitySpec> = {}): AbilityDef => (Object.keys(over).length === 0 ? SHIPPED_ORB : defineAbility({ ...ORB_SPEC, ...over }));

/** Flat 100 m floor with an optional thin cover plate (0.1 m thick) across the -Z lane at z = -5. */
export function flatMap(thinCover: boolean, extra: ArenaMap["colliders"] = []): ArenaMap {
  const colliders: ArenaMap["colliders"] = [
    { id: "floor", role: "ground", shape: "cuboid", centre: [0, -0.5, 0], halfExtents: [60, 0.5, 60] },
    ...(thinCover ? [{ id: "cover", role: "obstacle" as const, shape: "cuboid" as const, centre: [0, 1.5, -5] as [number, number, number], halfExtents: [4, 1.5, 0.05] as [number, number, number] }] : []),
    ...extra,
  ];
  return { schemaVersion: 1, mapId: "islands.v1", voidY: -25, boundaryRadius: 90, colliders,
    spawnAnchors: [{ id: 0, position: [0, 0, 0] }], urnAnchors: [], contentHash: "0000000000000000" };
}

export interface RigOptions { kits?: Record<number, KitId>; thinCover?: boolean; defs?: AbilityDef[] }
export interface Press { id: number; slot: 1 | 2 | 3 | 4 }

/**
 * One logical tick in the spec 21 order for the pieces T19 touches: expiry, skill edges, cast queries, projectile
 * advance, serial resolution, afterResolve (counters), settle, meter. Fighter 1 sits at the origin facing -Z (kit ea),
 * fighter 2 is 10 m ahead on the -Z lane facing the caster. All are unprotected.
 */
export async function makeRig(opts: RigOptions = {}) {
  const world = await World.create(flatMap(opts.thinCover ?? false));
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  const kits = { 1: "ea", 2: "td", 3: "td", 4: "td", 5: "td", 6: "td", ...(opts.kits ?? {}) } as Record<number, KitId>;
  const override = opts.defs ?? [];
  const registry = buildAbilityRegistry([...ALL_ABILITY_DEFS.filter((d) => !override.some((o) => o.id === d.id)), ...override], new Set(ALL_HANDLERS.map((h) => h.name)));
  const input = { heldSlot: 0 as 0 | 1 | 2 | 3 | 4, lastInput: 0 };
  const GROUND_Y = 0.9;
  for (const id of [1, 2, 3, 4, 5, 6]) { cs.add(id, id, 0, kits[id]!).protectedUntilTick = 0; }
  poses.set(1, { x: 0, y: GROUND_Y, z: 0, facingYaw: 0, grounded: true });
  poses.set(2, { x: 0, y: GROUND_Y, z: -10, facingYaw: Math.PI, grounded: true });
  for (const id of [3, 4, 5, 6]) poses.set(id, { x: 30 + id, y: GROUND_Y, z: 30, facingYaw: Math.PI, grounded: true });
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id),
    blocked: (a, b) => world.segmentBlocked([a[0], a[1], a[2]], [b[0], b[1], b[2]]),
    sweepSphere: (a, b, r) => world.sweepSphere([a[0], a[1], a[2]], [b[0], b[1], b[2]], r),
    get projectiles() { return ps; },
    get projectileSpawner() { return ps; },
    get projectileReflector() { return { reflect: (req) => ps.reflectWith(req) }; },
    hold: (id, slot, tick) => (id !== 1 ? "released" : tick - input.lastInput >= COMBAT.inputLeaseTicks ? "stale" : input.heldSlot === slot ? "held" : "released"),
  };
  const ps: ProjectileSystem = new ProjectileSystem(host);
  const runner = new AbilityRunner(registry, ALL_HANDLERS, host);
  const awakening = new AwakeningSystem(host);
  const results: { tick: number; r: HitResult }[] = [];
  const spawnedAt: number[] = [];
  const origSpawn = ps.spawn.bind(ps);
  ps.spawn = (s: ProjectileSpawn, tick: number) => { const id = origSpawn(s, tick); if (id !== null) spawnedAt.push(tick); return id; };
  let edge = 0;

  interface StepOpts { press?: Press[]; up?: 1 | 2 | 3 | 4; guard?: readonly number[]; packet?: boolean }
  const step = (tick: number, o: StepOpts = {}): HitResult[] => {
    cs.expire(tick, (id) => poses.get(id)!.grounded);
    if (o.packet !== false) input.lastInput = tick; // a fresh packet each tick unless the test withholds it
    for (const p of o.press ?? []) { const f = cs.get(p.id)!; runner.skillDown(f, tick, p.slot, ++edge); }
    if (o.up) runner.skillUp(cs.get(1)!, tick, o.up);
    for (const id of [1, 2, 3, 4, 5, 6]) if (cs.get(id)) cs.updateGuard(id, tick, (o.guard ?? []).includes(id), true);
    const cands = [...runner.collect(tick), ...ps.collect(tick)];
    const res = cs.resolve(tick, cands, (id) => poses.get(id));
    runner.afterResolve(tick, res);
    ps.settle(tick, res);
    awakening.gain(res);
    for (const r of res) results.push({ tick, r });
    return res;
  };
  const run = (from: number, to: number, o: StepOpts = {}) => { for (let t = from; t <= to; t++) step(t, o); };
  const hp = (id: number) => cs.get(id)!.hp100;
  const hitsOn = (id: number) => results.filter((x) => x.r.candidate.targetId === id && x.r.outcome === "hit");
  const spawn = (over: Partial<ProjectileSpawn> = {}, tick = 0) => ps.spawn({
    ownerId: 1, ownerLifeId: 1, castCounter: 1, moveId: "ea.b3", x: 0, y: GROUND_Y, z: -0.8, dirX: 0, dirY: 0, dirZ: -1,
    speed: 24, lifeTicks: 120, maxRange: 40, radius: 0.35, splashRadius: 2, splashMax: 4, reflectable: true,
    arcAmplitude: 0, arcSpan: 0, chargeClass: "partial", damage100: 1500, chip100: 500, block: "B",
    reaction: { kind: "ragdoll", ticks: 60 }, ...over,
  }, tick);
  const dispose = () => { ps.clear(); runner.dispose(); cs.dispose(); world.dispose(); };
  return { world, cs, poses, runner, ps, awakening, results, spawnedAt, input, step, run, hp, hitsOn, spawn, dispose, GROUND_Y, host };
}
export type Rig = Awaited<ReturnType<typeof makeRig>>;
