import { buildAbilityRegistry } from "../../packages/shared/src/abilities.js";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import type { ArenaMap, MapVec3 } from "../../packages/shared/src/config/arena.js";
import type { KitId } from "../../packages/shared/src/protocol.js";
import { ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose } from "../../apps/server/src/sim/AbilityRunner.js";
import { OffensiveBuffer } from "../../apps/server/src/sim/OffensiveBuffer.js";
import { M1System, type M1Held } from "../../apps/server/src/sim/M1.js";
import { ProjectileSystem } from "../../apps/server/src/sim/Projectiles.js";
import { UrnSystem } from "../../apps/server/src/sim/Urns.js";
import { ContextSystem } from "../../apps/server/src/sim/ContextMoves.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import { World } from "../../apps/server/src/sim/World.js";

/**
 * T23 rig: flat 120 m floor, one waist wall like the arena's (centre (-10,0.6,0), 4 x 1.2 x 0.6 m), a 0.1 m thin cover
 * plate across the -Z lane at z = -8 and two urn anchors. Fighter 1 attacks, fighter 2 is the victim, fighter 3 a
 * bystander. All are unprotected. The tick order mirrors TickPipeline for the pieces T23 touches.
 */
export const URN0: MapVec3 = [3, 0.25, 0];
export const URN1: MapVec3 = [20, 0.25, 20];
export const WALL_Z = 0; // wall faces are at z = +-0.3
const Y = 0.9;
const NEUTRAL: M1Held = { attackHeld: false, blockHeld: false, jumpHeld: false, moveX: 0, moveZ: 0 };

export function contextMap(): ArenaMap {
  return {
    schemaVersion: 1, mapId: "islands.v1", voidY: -25, boundaryRadius: 90,
    colliders: [
      { id: "floor", role: "ground", shape: "cuboid", centre: [0, -0.5, 0], halfExtents: [60, 0.5, 60] },
      { id: "wall", role: "obstacle", shape: "cuboid", centre: [-10, 0.6, 0], halfExtents: [2, 0.6, 0.3] },
      { id: "cover", role: "obstacle", shape: "cuboid", centre: [3, 1.5, -8], halfExtents: [4, 1.5, 0.05] },
    ],
    spawnAnchors: [{ id: 0, position: [0, 0, 0] }], urnAnchors: [{ id: 0, position: URN0 }, { id: 1, position: URN1 }], contentHash: "0000000000000000",
  };
}

export interface ContextRigOptions { kit?: KitId; victimKit?: KitId; enabled?: boolean; /** Start beside urn 0 (default: 7 m away so Attack is an ordinary M1). */ nearUrn?: boolean }

export async function makeContextRig(opts: ContextRigOptions = {}) {
  const world = await World.create(contextMap());
  const cs = new CombatSystem();
  const poses = new Map<number, AbilityPose>();
  const urns = new UrnSystem([URN0, URN1]);
  const buffer = new OffensiveBuffer();
  const host: AbilityHost = {
    combat: cs, pose: (id) => poses.get(id),
    blocked: (a, b) => world.segmentBlocked([a[0], a[1], a[2]], [b[0], b[1], b[2]]),
    sweepSphere: (a, b, r) => world.sweepSphere([a[0], a[1], a[2]], [b[0], b[1], b[2]], r),
    get projectiles() { return ps; },
    get projectileSpawner() { return ps; },
    get projectileReflector() { return { reflect: (req) => ps.reflectWith(req) }; },
    urns,
    nearWall: (x, y, z) => world.nearVerticalCollider([x, y, z], COMBAT.capsule.radius, COMBAT.capsule.halfHeight, COMBAT.wall.targetGap),
  };
  const ps: ProjectileSystem = new ProjectileSystem(host);
  const registry = buildAbilityRegistry(ALL_ABILITY_DEFS, new Set(ALL_HANDLERS.map((h) => h.name)));
  const runner = new AbilityRunner(registry, ALL_HANDLERS, host, buffer);
  const m1 = new M1System(buffer);
  const contexts = new ContextSystem(runner, urns, host);
  contexts.enabled = opts.enabled ?? true;
  m1.contextHook = (f, tick, req) => contexts.decide(f, tick, req);
  const kits: Record<number, KitId> = { 1: opts.kit ?? "td", 2: opts.victimKit ?? "sv", 3: "td" };
  for (const id of [1, 2, 3]) cs.add(id, id, 0, kits[id]!).protectedUntilTick = 0;
  const x0 = opts.nearUrn ? 3 : 10;
  poses.set(1, { x: x0, y: Y, z: 0.8, facingYaw: 0, grounded: true });
  poses.set(2, { x: x0, y: Y, z: -1.2, facingYaw: Math.PI, grounded: true });
  poses.set(3, { x: 40, y: Y, z: 40, facingYaw: Math.PI, grounded: true });
  const results: { tick: number; r: HitResult }[] = [];
  const casts: { tick: number; moveId: string }[] = [];
  let lastMove = "";
  const held = new Map<number, M1Held>();
  const guard = new Set<number>();
  const injected: HitCandidate[] = [];
  const grounded = (id: number): boolean => poses.get(id)?.grounded ?? true;

  /** One logical tick: expiry, urn update, M1 request for fighter 1 (and 3), queries, resolve, afterHits. */
  const step = (tick: number, h1: Partial<M1Held> = {}): HitResult[] => {
    cs.expire(tick, grounded);
    urns.update(tick, (id) => cs.get(id));
    const f1 = cs.get(1)!;
    const hh = { ...NEUTRAL, ...h1 };
    held.set(1, hh);
    for (const id of [1, 2, 3]) if (cs.get(id)) cs.updateGuard(id, tick, guard.has(id), true);
    m1.update(f1, tick, hh, poses.get(1));
    if (f1.moveId !== lastMove && f1.action === "Windup") casts.push({ tick, moveId: f1.moveId });
    lastMove = f1.action === "Idle" ? "" : f1.moveId;
    const pose = (id: number) => { const p = poses.get(id); return p && { ...p }; };
    const cands = [
      ...m1.candidates(tick, cs.all(), pose, (a, t) => world.segmentBlocked([a.x, a.y, a.z], [t.x, t.y, t.z])),
      ...runner.collect(tick), ...ps.collect(tick), ...injected.splice(0),
    ];
    const res = cs.resolve(tick, cands, (id) => poses.get(id));
    runner.afterResolve(tick, res);
    ps.settle(tick, res);
    for (const r of res) {
      if ((r.outcome === "hit" && r.damage100 > 0) || r.outcome === "captured") urns.drop(r.candidate.targetId);
      results.push({ tick, r });
    }
    for (const r of res) if (r.killed) { runner.reset(r.candidate.targetId); urns.drop(r.candidate.targetId); }
    return res;
  };
  const run = (from: number, to: number, h1: Partial<M1Held> = {}): void => { for (let t = from; t <= to; t++) step(t, h1); };
  /** Holds Attack from `from` until fighter 1 commits a cast whose moveId matches, or maxTicks pass. Returns the commit tick. */
  const holdUntil = (from: number, match: (id: string) => boolean, h1: Partial<M1Held> = {}, maxTicks = 400): number => {
    for (let t = from; t < from + maxTicks; t++) {
      const n = casts.length;
      step(t, { attackHeld: true, ...h1 });
      if (casts.length > n && match(casts[casts.length - 1]!.moveId)) return t;
    }
    return -1;
  };
  const poke = (attackerId: number, targetId: number, damage100 = 500): void => {
    injected.push({
      attackerId, attackerGeneration: 0, castCounter: -9000, hitIndex: 0, toi: 0, targetId, moveId: "test.poke", originX: 0, originZ: 0,
      block: "U", counterable: false, armorBreak: false, damage100, reaction: { kind: "stun", ticks: 20 }, maxHitsPerTarget: 1,
      projectile: { id: 9000, reflectable: false, ownerLifeId: cs.get(attackerId)!.lifeId },
    });
  };
  const hp = (id: number) => cs.get(id)!.hp100;
  const resultsOf = (moveId: string) => results.filter((x) => x.r.candidate.moveId === moveId);
  const place = (id: number, x: number, z: number, y = Y) => { poses.set(id, { ...poses.get(id)!, x, y, z }); };
  /** Moves fighter 1 and the victim beside the wall: victim 0.5 m off the south face, attacker 1.2 m behind it. */
  const atWall = () => { place(2, -10, 0.8); place(1, -10, 2.0); poses.set(1, { ...poses.get(1)!, facingYaw: 0 }); poses.set(2, { ...poses.get(2)!, facingYaw: Math.PI }); };
  const dispose = () => { ps.clear(); urns.clear(); runner.dispose(); cs.dispose(); world.dispose(); };
  return { world, cs, poses, urns, runner, m1, contexts, ps, results, casts, guard, step, run, holdUntil, poke, hp, resultsOf, place, atWall, dispose };
}
export type ContextRig = Awaited<ReturnType<typeof makeContextRig>>;
