import { COMBAT } from "../../packages/shared/src/config/combat.js";
import type { ArenaMap } from "../../packages/shared/src/config/arena.js";
import type { KitId } from "../../packages/shared/src/protocol.js";
import { NEUTRAL_MOVE } from "../../packages/shared/src/movement.js";
import { buildKitRegistry, ALL_HANDLERS } from "../../apps/server/src/kits/index.js";
import { CombatSystem } from "../../apps/server/src/sim/Combat.js";
import { AbilityRunner, type AbilityHost, type AbilityPose, type SkillOutcome } from "../../apps/server/src/sim/AbilityRunner.js";
import type { HitCandidate, HitResult } from "../../apps/server/src/sim/HitResolver.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { World } from "../../apps/server/src/sim/World.js";
import { flatMap } from "./projectileRig.js";

/**
 * T20 rig with the REAL Rapier world and MovementSystem: bodies are kinematic capsules, so Vent Rush travel, Furnace Drop
 * rise and descent, wall stops and ground contact are the same code paths the room uses. One logical tick follows the
 * pipeline order: expiry, skill edges, guard, locomotion (neutral intents; cast aim and vertical hold from the runner),
 * collision queries (runner.collect), serial resolution, handler results, launches.
 * Fighter 1 is the Ember Artificer at the origin facing -Z; the others are Tide Duelists placed by the tests.
 */
export function islandMap(): ArenaMap {
  return { schemaVersion: 1, mapId: "islands.v1", voidY: -25, boundaryRadius: 90,
    colliders: [{ id: "island", role: "ground", shape: "cuboid", centre: [0, -0.5, 0], halfExtents: [3, 0.5, 3] }],
    spawnAnchors: [{ id: 0, position: [0, 0, 0] }], urnAnchors: [], contentHash: "0000000000000000" };
}

export interface EaRigOptions { map?: ArenaMap; extra?: ArenaMap["colliders"]; kits?: Record<number, KitId>; n?: number }
export interface Press { who?: number; slot: 1 | 2 | 3 | 4 }
export interface StepOpts { press?: Press[]; extra?: HitCandidate[]; guard?: readonly number[] }

export const GROUND_Y = 0.9;
export const T0 = 20;

export async function makeEaRig(opts: EaRigOptions = {}) {
  const world = await World.create(opts.map ?? flatMap(false, opts.extra ?? []));
  const mv = new MovementSystem(world);
  const cs = new CombatSystem();
  const n = opts.n ?? 3;
  const kits = { 1: "ea", 2: "td", 3: "td", 4: "td", ...(opts.kits ?? {}) } as Record<number, KitId>;
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  for (const id of ids) cs.add(id, id, 0, kits[id]!).protectedUntilTick = 0;
  mv.add(1, [0, GROUND_Y, 0], 0);
  mv.add(2, [0, GROUND_Y, -1.5], Math.PI);
  if (n >= 3) mv.add(3, [20, GROUND_Y, 20], Math.PI);
  if (n >= 4) mv.add(4, [-20, GROUND_Y, 20], Math.PI);
  for (let i = 5; i <= n; i++) mv.add(i, [-20 + 4 * i, GROUND_Y, 30], Math.PI);
  const pitch = { value: 0 };
  const calls = { launch: [] as { id: number; vy: number; tick: number }[] };
  let curTick = 0;
  const poseOf = (id: number): AbilityPose | undefined => {
    const b = mv.get(id), p = mv.position(id);
    return b && p ? { x: p[0], y: p[1], z: p[2], facingYaw: b.state.facingYaw, grounded: b.state.grounded } : undefined;
  };
  const host: AbilityHost = {
    combat: cs, pose: poseOf,
    blocked: (a, b) => world.segmentBlocked([a[0], a[1], a[2]], [b[0], b[1], b[2]]),
    sweepSphere: (a, b, r) => world.sweepSphere([a[0], a[1], a[2]], [b[0], b[1], b[2]], r),
    launch: (id, vx, vy, vz) => { calls.launch.push({ id, vy, tick: curTick }); mv.setVelocity(id, vx, vy, vz); },
    moveTogether: (ids2, dx, dz) => mv.moveTogether(ids2, dx, dz),
    wallContact: (id, tick) => mv.get(id)?.wallHitTick === tick,
    surfaceHeight: (x, z) => world.groundHeight(x, z),
    aimPitch: (id) => (id === 1 ? pitch.value : 0),
  };
  const runner = new AbilityRunner(buildKitRegistry(), ALL_HANDLERS, host);
  const results: { tick: number; r: HitResult }[] = [];
  const outcomes: { tick: number; who: number; o: SkillOutcome }[] = [];
  let edge = 0, strikeSeq = 500;
  const grounded = (id: number): boolean => mv.get(id)?.state.grounded ?? true;

  const step = (tick: number, o: StepOpts = {}): HitResult[] => {
    curTick = tick;
    cs.expire(tick, grounded);
    for (const p of o.press ?? []) {
      const f = cs.get(p.who ?? 1);
      if (f) outcomes.push({ tick, who: p.who ?? 1, o: runner.skillDown(f, tick, p.slot, ++edge) });
    }
    for (const id of ids) cs.updateGuard(id, tick, (o.guard ?? []).includes(id), grounded(id));
    mv.step(tick, () => NEUTRAL_MOVE, null, (id) => runner.facingOverrideOf(id), (id) => runner.freezesVertical(id, tick));
    const cands = [...runner.collect(tick), ...(o.extra ?? [])];
    const res = cs.resolve(tick, cands, (id) => { const q = poseOf(id); return q && { x: q.x, z: q.z, facingYaw: q.facingYaw, grounded: q.grounded }; });
    runner.afterResolve(tick, res);
    for (const l of runner.launches(tick, res)) mv.setVelocity(l.targetId, l.vx, l.vy, l.vz);
    for (const r of res) results.push({ tick, r });
    return res;
  };
  const run = (from: number, to: number, opts?: (t: number) => StepOpts | undefined): void => { for (let t = from; t <= to; t++) step(t, opts?.(t)); };
  const place = (id: number, x: number, y: number, z: number, yaw?: number): void => {
    const b = mv.get(id)!;
    b.rb.setTranslation({ x, y, z }, true);
    b.rb.setNextKinematicTranslation({ x, y, z });
    b.state.vx = 0; b.state.vy = 0; b.state.vz = 0;
    if (yaw !== undefined) b.state.facingYaw = yaw;
  };
  const pos = (id: number): [number, number, number] => mv.position(id)!;
  const hp = (id: number): number => cs.get(id)!.hp100;
  const dealt = (a: number, t: number) => results.filter((x) => x.r.candidate.attackerId === a && x.r.candidate.targetId === t
    && x.r.damage100 > 0 && (x.r.outcome === "hit" || x.r.outcome === "captured")).map((x) => [x.tick, x.r.damage100] as const);
  const outcomesOf = (t: number) => results.filter((x) => x.r.candidate.targetId === t).map((x) => x.r.outcome);
  /** A third party ordinary hit (stun by default) not tied to any ability cast. */
  const strike = (a: number, t: number, over: Partial<HitCandidate> = {}): HitCandidate => ({
    attackerId: a, attackerGeneration: cs.get(a)!.generation, castCounter: ++strikeSeq, hitIndex: 0, toi: 0, targetId: t,
    moveId: "test.strike", originX: 0, originZ: 0, block: "U", counterable: false, armorBreak: true, damage100: 100,
    reaction: { kind: "stun", ticks: 30 }, maxHitsPerTarget: 1, ...over,
  });
  /** Settles every body on the floor for a few ticks before T0. */
  const warm = (): void => { run(T0 - 6, T0 - 1); };
  const dispose = (): void => { runner.dispose(); cs.dispose(); mv.dispose(); world.dispose(); };
  return { world, mv, cs, runner, host, results, outcomes, calls, pitch, step, run, place, pos, hp, dealt, outcomesOf, strike, warm, dispose, poseOf, HP: COMBAT.hp100Max };
}
export type EaRig = Awaited<ReturnType<typeof makeEaRig>>;
