import { COMBAT } from "@eb/shared/config/combat";
import type { AbilityDef, AbilityRegistry, Shape, TargetState } from "@eb/shared/abilities";
import type { RejectReason } from "@eb/shared/protocol";
import { forwardOf, rotateToward } from "@eb/shared/math";
import { beginCast, isAlive, type Fighter, type Reaction } from "./ActionMachine.js";
import type { CombatSystem } from "./Combat.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";
import { LandingBonusBook } from "./LandingBonus.js";
import { launchVector } from "./Knockback.js";
import { OffensiveBuffer } from "./OffensiveBuffer.js";
import type { ReflectableProjectiles } from "./Reflect.js";
import type { ProjectileSpawn } from "./Projectiles.js";
import type { UrnSystem } from "./Urns.js";

/**
 * Ability framework (spec sections 12, 13, 14). Pure server module: no Rapier, no timers, no DOM.
 *
 * - Definitions come from the validated registry (shared/abilities.ts); behaviour comes from named handlers.
 * - A cast is committed through ActionMachine.beginCast (cooldown starts on the accepted press, miss or not),
 *   then advanced only by the room's fixed tick. All phase boundaries are integer ticks, exclusive ends.
 * - Hit phases are scheduled relative to activeStart and tagged with the fighter's action generation, so any
 *   cancellation (stun, ragdoll, death, capture, replacement) makes every later phase stale. cancel() is
 *   idempotent. No JavaScript timeout ever controls damage.
 * - One offensive edge is buffered for COMBAT.bufferTicks and consumed at the Recovery -> Idle boundary.
 *   Awakening, dash, recast and counter stance are never buffered.
 */
export interface AbilityPose { x: number; y: number; z: number; facingYaw: number; grounded: boolean }

export interface AbilityHost {
  readonly combat: CombatSystem;
  pose(entityId: number): AbilityPose | undefined;
  /** GR02: server-only occupant generation currently bound to an entity id (undefined when unallocated). Optional for fixtures. */
  occupantOf?(entityId: number): number | undefined;
  /** True when static geometry blocks the straight segment a -> b. */
  blocked(a: readonly [number, number, number], b: readonly [number, number, number]): boolean;
  /** Optional (R07): the facing Movement would choose this tick (movement direction), or undefined when none is requested. */
  requestedYaw?(entityId: number): number | undefined;
  /** Optional (T13): sets a body's velocity, used by handler driven releases (launch). */
  launch?(entityId: number, vx: number, vy: number, vz: number): void;
  /**
   * Optional (T13): displaces every listed body by the same horizontal vector with swept static collision.
   * All bodies stop together at the first contact of any of them. Returns the displacement actually applied.
   */
  moveTogether?(entityIds: readonly number[], dx: number, dz: number): { dx: number; dz: number };
  /** Optional (T20): validated camera pitch of the entity's input channel in radians (positive looks down), or undefined. */
  aimPitch?(entityId: number): number | undefined;
  /** Optional (T13): true when the body touched a static wall (not the floor) during `tick`. */
  wallContact?(entityId: number, tick: number): boolean;
  /** Optional (T13): height of the walkable surface below (x, z), or null over the void. */
  surfaceHeight?(x: number, z: number): number | null;
  /** Optional projectile provider for reflect handlers (sv.b3). Implemented by ProjectileSystem (T19). */
  readonly projectiles?: ReflectableProjectiles;
  /** Optional (T19): spawns a detached projectile for charge/projectile handlers. Returns its id, or null at the room cap. */
  readonly projectileSpawner?: { spawn(s: ProjectileSpawn, tick: number): number | null };
  /** Optional (T19): continuous sphere sweep against static geometry; fraction 0..1 of the first contact, or null. */
  sweepSphere?(a: readonly [number, number, number], b: readonly [number, number, number], radius: number): number | null;
  /**
   * Optional (T19): hold state of a charge slot for the entity's input channel. "held" while the slot's hold is
   * refreshed by fresh packets, "released" when the player let go, "stale" when the input lease lapsed (A11).
   */
  hold?(entityId: number, slot: 1 | 2 | 3 | 4, tick: number): "held" | "released" | "stale";
  /**
   * Optional (T13): shared reflection rule used by counter stances (td.b4) for an incoming reflectable projectile.
   * Kept separate from `projectiles` until T19 unifies both into one provider.
   */
  projectileReflector?: ProjectileProvider;
  /** Optional (T23): server owned urns for the pickup and throw handlers. */
  readonly urns?: UrnSystem;
  /** Optional (T23): true when a vertical static face lies within the wall opportunity gap of the capsule centre. */
  nearWall?(x: number, y: number, z: number): boolean;
}

/** Minimal projectile interface needed by counter stances; the projectile system arrives with T19. */
export interface ReflectRequest { projectileId: number; reflectorId: number; tick: number }
export interface ProjectileProvider {
  /** Applies the shared reflection rule (spec 13). Returns false when the projectile was absorbed instead. */
  reflect(req: ReflectRequest): boolean;
}

export interface ActiveCast {
  readonly def: AbilityDef;
  readonly entityId: number;
  readonly castCounter: number;
  readonly generation: number;
  readonly startTick: number;
  /** Mutable only through AbilityRunner.rescheduleCast (charge release moves the windup end). */
  activeStart: number;
  /** Mutable so a handler can extend the active window (capture sequences); use extendCast(). */
  activeEnd: number;
  endTick: number;
  /** Aim at commit, then turned toward the requested facing by at most def.turnRate (spec 14, R07). */
  aimYaw: number;
  /** Armor granted by the handler until this tick (exclusive), in addition to def.armor. */
  armorUntil: number;
  /** Handler private state. Never shared between casts. */
  data: Record<string, unknown>;
}

export interface CastContext {
  tick: number;
  fighter: Fighter;
  cast: ActiveCast;
  host: AbilityHost;
  runner: AbilityRunner;
}

export type EndReason = "completed" | "cancelled" | "died";

export interface AbilityHandler {
  readonly name: string;
  /** Spec 14: attacks may activate in air unless a card says grounded. */
  readonly requiresGrounded?: boolean;
  /** False for counter stances: a press while busy is rejected instead of buffered (spec 12). */
  readonly bufferable?: boolean;
  /** Extra start condition (handler specific). Return a reject reason, or null to allow. */
  canStart?(c: { tick: number; fighter: Fighter; def: AbilityDef; pose: AbilityPose; host: AbilityHost }): RejectReason | null;
  onCommit?(c: CastContext): void;
  /** Hit candidates for this tick. Default: the scheduled hit groups on def.shape (meleeCandidates). */
  candidates?(c: CastContext): HitCandidate[];
  /** Runs once per tick for each live cast, before candidates() (timed releases, scripted motion). */
  onTick?(c: CastContext): void;
  /** Called with this cast's own results after serial resolution (also when blocked/countered). */
  onResults?(c: CastContext, results: readonly HitResult[]): void;
  /** Called with results whose TARGET is this cast's caster (counter stances read "countered" here). */
  onIncoming?(c: CastContext, results: readonly HitResult[]): void;
  /** Once per tick regardless of live casts: detached effects (e.g. thrown bodies). State lives in runner.scratch. */
  globalCollect?(c: { tick: number; host: AbilityHost; runner: AbilityRunner }): HitCandidate[];
  /** All results of the tick, for handlers with detached effects. */
  globalResults?(c: { tick: number; host: AbilityHost; runner: AbilityRunner }, results: readonly HitResult[]): void;
  /**
   * T19: vertical velocity is held at zero while this returns true and the caster is airborne (charge, Cinder Array).
   */
  freezeVertical?(c: CastContext): boolean;
  /**
   * T19: a second press of the same slot while the cast runs (input "recast"). Return true when the press is accepted,
   * false when it is ignored (for example before the minimum active ticks).
   */
  onRecast?(c: CastContext): boolean;
  /** Called exactly once per cast when it ends, whatever the reason. */
  onEnd?(c: CastContext, why: EndReason): void;
}

export type SkillOutcome =
  | { kind: "started"; castCounter: number; moveId: string }
  | { kind: "rejected"; reason: RejectReason }
  | { kind: "buffered" };

export interface BufferedOutcome { edgeId: number; outcome: SkillOutcome }


export interface Launch { targetId: number; vx: number; vy: number; vz: number }

const CAP_R = COMBAT.capsule.radius;
const CAP_HALF = COMBAT.capsule.halfHeight;

export const reactionOfDef = (d: AbilityDef): Reaction =>
  d.ragdollTicks > 0 ? { kind: "ragdoll", ticks: d.ragdollTicks }
    : d.stunTicks > 0 ? { kind: "stun", ticks: d.stunTicks } : { kind: "none" };

/** Facing vector for yaw 0 = -Z (shared convention with M1 and dashes). */
export { forwardOf } from "@eb/shared/math";

/**
 * Exact overlap of an attack shape with a target's vertical capsule. Attacker local frame: forward along
 * aimYaw, box lateral +-w/2, box forward span [0, d] (equals the spec default "centred range/2" when d = range),
 * vertical centre 0.2 m above the attacker centre. Spheres are centred `range` ahead (range 0 = around the
 * caster). Beams run horizontally from the attacker centre for `length`, truncated at `maxLength` if given.
 */
export interface BeamOrigin { forward: number; up: number }
/** Spec 16: beams begin 0.6 m forward of capsule centre and 0.4 m up. */
export const DEFAULT_BEAM_ORIGIN: BeamOrigin = { forward: 0.6, up: 0.4 };
export const DEFAULT_BOX_CENTRE_Y = 0.2;

export function shapeOverlaps(
  shape: Shape, range: number, a: AbilityPose, aimYaw: number, t: AbilityPose, maxLength?: number,
  boxCentreY: number = DEFAULT_BOX_CENTRE_Y, beamOrigin: BeamOrigin = DEFAULT_BEAM_ORIGIN,
): boolean {
  const [fx, fz] = forwardOf(aimYaw);
  const rx = -fz, rz = fx; // right-hand vector
  const dx = t.x - a.x, dz = t.z - a.z;
  const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
  const segLo = t.y - CAP_HALF, segHi = t.y + CAP_HALF;
  const gap = (lo: number, hi: number): number => Math.max(0, lo - segHi, segLo - hi);
  if (shape.kind === "box") {
    const cy = a.y + boxCentreY;
    const dv = gap(cy - shape.h / 2, cy + shape.h / 2);
    const cr = Math.max(-shape.w / 2, Math.min(shape.w / 2, right));
    const cf = Math.max(0, Math.min(shape.d, fwd));
    return Math.hypot(Math.hypot(right - cr, fwd - cf), dv) <= CAP_R;
  }
  if (shape.kind === "sphere") {
    const dyc = Math.max(0, Math.abs(t.y - a.y) - CAP_HALF); // vertical gap to a feature at attacker height
    return Math.hypot(Math.hypot(right, fwd - range), dyc) <= shape.r + CAP_R;
  }
  // Beam: measured from its origin (beamOrigin.forward ahead of the capsule centre, beamOrigin.up above it).
  const fwdO = fwd - beamOrigin.forward;
  const dyb = Math.max(0, Math.abs(t.y - (a.y + beamOrigin.up)) - CAP_HALF);
  const len = Math.min(shape.length, maxLength ?? shape.length);
  const cf = Math.max(0, Math.min(len, fwdO));
  return Math.hypot(Math.hypot(right, fwdO - cf), dyb) <= shape.radius + CAP_R;
}

function targetStateOf(t: Fighter, p: AbilityPose): "standing" | "air" | "ragdoll" {
  if (t.action === "Ragdolled") return "ragdoll";
  return p.grounded ? "standing" : "air";
}

/** Builds a candidate for one scheduled hit from the cast definition. Handlers may adjust the result. */
export function buildCandidate(c: CastContext, targetId: number, hitIndex: number, originX: number, originZ: number): HitCandidate {
  const d = c.cast.def;
  return {
    attackerId: c.cast.entityId, attackerGeneration: c.cast.generation, castCounter: c.cast.castCounter, hitIndex, toi: 0,
    targetId, moveId: d.id, originX, originZ, block: d.block, counterable: d.counterable, armorBreak: d.armorBreak,
    damage100: d.damage100[Math.min(hitIndex, d.damage100.length - 1)]!, reaction: reactionOfDef(d),
    maxHitsPerTarget: d.maxHitsPerTarget,
  };
}

/** Optional per-query overrides (T12): a second shape for secondary hit groups such as the Fault Strike wave. */
export interface QueryOptions {
  /** Extra eligibility test applied before ordering and the maxTargets cap. */
  filter?: (target: Fighter, pose: AbilityPose) => boolean;
  maxLength?: number;
  /** Skip fighters held by any capture (capture probes, sv.b4). Default: captured fighters stay eligible (spec 13). */
  excludeCaptured?: boolean;
  shape?: Shape;
  range?: number;
  /** Box vertical centre above the caster centre (R05, spec 16). Default 0.2. */
  boxCentreY?: number;
  /** Beam origin relative to the caster centre (R05, spec 16). Default 0.6 forward, 0.4 up. */
  beamOrigin?: BeamOrigin;
  targetStates?: readonly TargetState[];
}

/**
 * Eligible targets of one query in stable order (distance, then entity id). Excludes self, the dead, captured
 * fighters (only when excludeCaptured), states the move does not support, static occlusion, targets already at the per target hit cap and
 * new targets beyond maxTargets for the whole cast.
 */
export function queryTargets(c: CastContext, opts: QueryOptions = {}): number[] {
  const { cast, host, fighter } = c;
  const d = cast.def;
  const shape = opts.shape ?? d.shape;
  const range = opts.range ?? d.range;
  const states = opts.targetStates ?? d.targetStates;
  const ap = host.pose(fighter.entityId);
  if (!ap) return [];
  const ledger = host.combat.ledger;
  const found: { id: number; dist: number }[] = [];
  for (const t of host.combat.all()) {
    if (t.entityId === fighter.entityId || !isAlive(t)) continue;
    if (opts.excludeCaptured && host.combat.captures.isCaptured(t.entityId)) continue;
    const tp = host.pose(t.entityId);
    if (!tp) continue;
    if (!states.includes(targetStateOf(t, tp))) continue;
    if (opts.filter && !opts.filter(t, tp)) continue;
    if (ledger.count(fighter.entityId, cast.castCounter, t.entityId, t.lifeId) >= d.maxHitsPerTarget) continue;
    if (!shapeOverlaps(shape, range, ap, cast.aimYaw, tp, opts.maxLength, opts.boxCentreY, opts.beamOrigin)) continue;
    if (host.blocked([ap.x, ap.y, ap.z], [tp.x, tp.y, tp.z])) continue;
    found.push({ id: t.entityId, dist: Math.hypot(tp.x - ap.x, tp.z - ap.z) });
  }
  found.sort((a, b) => a.dist - b.dist || a.id - b.id);
  const out: number[] = [];
  let distinct = ledger.targetsHit(fighter.entityId, cast.castCounter);
  for (const f of found) {
    const t = host.combat.get(f.id)!;
    const already = ledger.count(fighter.entityId, cast.castCounter, f.id, t.lifeId) > 0;
    if (!already) { if (distinct >= d.maxTargets) continue; distinct += 1; }
    out.push(f.id);
  }
  return out;
}

/** Which scheduled hit indices are due this tick (spec 14). */
export function dueHitIndices(cast: ActiveCast, tick: number): number[] {
  const d = cast.def;
  if (tick < cast.activeStart) return [];
  if (d.hitOffsets.length === 1) {
    // Single hit: active is a query window; dedupe across the window.
    return tick >= cast.activeStart + d.hitOffsets[0]! && tick < cast.activeEnd ? [0] : [];
  }
  const out: number[] = [];
  d.hitOffsets.forEach((off, i) => { if (tick === cast.activeStart + off) out.push(i); });
  return out;
}

/** Default scheduled-hit query used by the "melee" handler and reusable by custom handlers. */
export function meleeCandidates(c: CastContext): HitCandidate[] {
  const ap = c.host.pose(c.fighter.entityId);
  if (!ap) return [];
  const out: HitCandidate[] = [];
  for (const i of dueHitIndices(c.cast, c.tick)) {
    for (const id of queryTargets(c)) out.push(buildCandidate(c, id, i, ap.x, ap.z));
  }
  return out;
}

export const MELEE_HANDLER: AbilityHandler = { name: "melee", candidates: meleeCandidates };

export class AbilityRunner {
  private readonly casts = new Map<number, ActiveCast>();
  private readonly handlers = new Map<string, AbilityHandler>();
  /** Delayed landing damage that outlives the casting action (Fault Strike). Cleaned on reset/remove/dispose. */
  readonly landing = new LandingBonusBook();
  private readonly scratchStore = new Map<string, unknown>();
  /** Most recent tick seen by the runner; gives onEnd a usable tick even for out-of-band cancels. */
  private nowTick = 0;

  constructor(readonly registry: AbilityRegistry, handlers: Iterable<AbilityHandler>, private readonly host: AbilityHost,
    /** Shared with M1System: one offensive buffer per room (spec 12, R03). */ readonly buffer: OffensiveBuffer = new OffensiveBuffer()) {
    for (const h of handlers) {
      if (this.handlers.has(h.name)) throw new Error(`duplicate handler ${h.name}`);
      this.handlers.set(h.name, h);
    }
    for (const d of registry.defs) if (!this.handlers.has(d.handler)) throw new Error(`ability ${d.id}: unknown handler ${d.handler}`);
  }

  /** Per runner (so per room) state for handlers with detached effects. Cleared on dispose. */
  scratch<T>(key: string, init: () => T): T {
    if (!this.scratchStore.has(key)) this.scratchStore.set(key, init());
    return this.scratchStore.get(key) as T;
  }

  kitOf(entityId: number): string | undefined { return this.host.combat.get(entityId)?.kitId; }
  castOf(entityId: number): ActiveCast | undefined { return this.casts.get(entityId); }
  get activeCount(): number { return this.casts.size; }
  get bufferedCount(): number { return this.buffer.size; }

  /**
   * Skill press edge (priority: after evasive and awakening, lowest slot first - the caller orders edges).
   * Idle: try to commit now. Busy (cast, recovery, guard, dash, stun): buffer one offensive edge for 6 ticks.
   */
  skillDown(f: Fighter, tick: number, slot: 1 | 2 | 3 | 4, edgeId: number): SkillOutcome {
    this.nowTick = Math.max(this.nowTick, tick);
    if (!isAlive(f) || f.action === "Captured") return { kind: "rejected", reason: "STATE" };
    const def = this.defFor(f, slot);
    if (!def) return { kind: "rejected", reason: "INVALID" };
    if (def.input === "context") return { kind: "rejected", reason: "INVALID" }; // context moves arrive with T23
    if (f.action !== "Idle") {
      const running = this.casts.get(f.entityId);
      if (running && running.def.input === "recast" && running.def.slot === slot && running.generation === f.generation
        && running.def.form === f.form) {
        const ok = this.handlers.get(running.def.handler)?.onRecast?.({ tick, fighter: f, cast: running, host: this.host, runner: this });
        return ok ? { kind: "started", castCounter: running.castCounter, moveId: running.def.id } : { kind: "rejected", reason: "STATE" };
      }
    }
    if (f.action === "Idle") {
      return this.commit(f, tick, def);
    }
    if (f.action === "Stunned" || f.action === "Ragdolled" || f.action === "Awakening") return { kind: "rejected", reason: "STATE" };
    if (this.handlers.get(def.handler)?.bufferable === false) return { kind: "rejected", reason: "STATE" };
    // One shared offensive buffer: the most recent edge replaces any older one (tie: lower action number).
    const lost = this.buffer.set(f.entityId, { kind: "skill", slot, edgeId, tick });
    return lost && lost.kind === "skill" && lost.edgeId === edgeId ? { kind: "rejected", reason: "STATE" } : { kind: "buffered" };
  }

  /**
   * Skill release edge (T19). Only a running holdRelease cast of that slot reacts: it records the release tick so the
   * handler fires on the next collect. Press moves ignore the edge; a stale or duplicate edge changes nothing.
   */
  skillUp(f: Fighter, tick: number, slot: 1 | 2 | 3 | 4): void {
    this.nowTick = Math.max(this.nowTick, tick);
    const cast = this.casts.get(f.entityId);
    if (!cast || cast.def.input !== "holdRelease" || cast.def.slot !== slot) return;
    if (cast.generation !== f.generation || cast.castCounter !== f.castCounter) return;
    cast.data.upTick ??= tick;
  }

  /** T19: moves a running cast's windup end (charge release). Never earlier than tick + 1; keeps the fighter consistent. */
  rescheduleCast(f: Fighter, cast: ActiveCast, tick: number, activeStart: number): void {
    if (f.generation !== cast.generation || !f.cast || f.cast.castCounter !== cast.castCounter) return;
    const start = Math.max(tick + 1, activeStart);
    cast.activeStart = start;
    cast.activeEnd = start + cast.def.active;
    cast.endTick = cast.activeEnd + cast.def.recovery;
    f.cast.activeStart = cast.activeStart;
    f.cast.activeEnd = cast.activeEnd;
    f.cast.endTick = cast.endTick;
    if (f.action === "Windup") f.actionEndTick = start;
  }

  /** Owner-only chargeStartTick: the commit tick while a charge is being held, else 0. */
  chargeStartOf(entityId: number): number {
    const c = this.casts.get(entityId);
    return c && c.data.charging === true ? (c.data.chargeStart as number) : 0;
  }

  /** True when the running cast's handler holds the caster's vertical velocity at zero this tick (airborne only). */
  freezesVertical(entityId: number, tick: number): boolean {
    const cast = this.casts.get(entityId);
    const f = this.host.combat.get(entityId);
    if (!cast || !f || !isAlive(f)) return false;
    return this.handlers.get(cast.def.handler)?.freezeVertical?.({ tick, fighter: f, cast, host: this.host, runner: this }) ?? false;
  }

  /**
   * T23: starts a context move (input "context") for an Idle fighter. The three Vanguard moves (sv.x1 to sv.x3) need the
   * awakened Vanguard with contextSpent false and set contextSpent at commit, miss or not; they never touch the slotted
   * awakening bits or the form. Shared moves (<kit>.wall, .pickup, .throw) have no form rule. No buffering: the caller retries next tick.
   */
  startContext(f: Fighter, tick: number, def: AbilityDef): SkillOutcome {
    this.nowTick = Math.max(this.nowTick, tick);
    if (def.input !== "context") return { kind: "rejected", reason: "INVALID" };
    if (!isAlive(f) || f.action !== "Idle") return { kind: "rejected", reason: "STATE" };
    const vanguard = def.id.startsWith("sv.x");
    if (vanguard && (f.kitId !== "sv" || f.form !== "Awakened" || f.contextSpent)) return { kind: "rejected", reason: "FORM" };
    const o = this.commit(f, tick, def);
    if (vanguard && o.kind === "started") f.contextSpent = true;
    return o;
  }

  /** Recovery -> Idle boundary: consume one still valid buffered edge; drop expired ones. */
  consumeBuffer(f: Fighter, tick: number): BufferedOutcome | null {
    this.nowTick = Math.max(this.nowTick, tick);
    const b = this.buffer.peek(f.entityId);
    if (!b || b.kind !== "skill") return null; // an M1 entry is consumed by M1System.update
    if (!isAlive(f)) { this.buffer.drop(f.entityId); return null; }
    if (tick - b.tick > COMBAT.bufferTicks) {
      this.buffer.drop(f.entityId);
      return { edgeId: b.edgeId, outcome: { kind: "rejected", reason: "STATE" } };
    }
    if (f.action !== "Idle") {
      if (f.action === "Stunned" || f.action === "Ragdolled" || f.action === "Captured") { this.buffer.drop(f.entityId); return { edgeId: b.edgeId, outcome: { kind: "rejected", reason: "STATE" } }; }
      return null; // still busy: keep waiting inside the 6 tick window
    }
    this.buffer.drop(f.entityId);
    const def = this.defFor(f, b.slot);
    if (!def) return { edgeId: b.edgeId, outcome: { kind: "rejected", reason: "INVALID" } };
    return { edgeId: b.edgeId, outcome: this.commit(f, tick, def) };
  }

  private defFor(f: Fighter, slot: 1 | 2 | 3 | 4): AbilityDef | undefined {
    return this.registry.slotted(f.kitId, f.form, slot);
  }

  /** Validates form, once-per-form, grounded and cooldown, then commits through beginCast. */
  private commit(f: Fighter, tick: number, def: AbilityDef): SkillOutcome {
    const handler = this.handlers.get(def.handler)!;
    const pose = this.host.pose(f.entityId);
    if (!pose) return { kind: "rejected", reason: "STATE" };
    if (def.input !== "context" && def.form !== f.form) return { kind: "rejected", reason: "FORM" };
    const bit = def.slot ? 1 << (def.slot - 1) : 0;
    if (def.oncePerForm && (f.awakenedUsedMask & bit) !== 0) return { kind: "rejected", reason: "FORM" };
    if (handler.requiresGrounded && !pose.grounded) return { kind: "rejected", reason: "STATE" };
    const extra = handler.canStart?.({ tick, fighter: f, def, pose, host: this.host });
    if (extra) return { kind: "rejected", reason: extra };
    const r = beginCast(f, tick, def.id, def.startup, def.active, def.recovery, def.cooldown);
    if (!r.ok) return { kind: "rejected", reason: r.reason };
    const cc = f.cast!;
    const cast: ActiveCast = {
      def, entityId: f.entityId, castCounter: f.castCounter, generation: f.generation, startTick: tick,
      activeStart: cc.activeStart, activeEnd: cc.activeEnd, endTick: cc.endTick, aimYaw: pose.facingYaw,
      armorUntil: 0, data: {},
    };
    this.endCast(f.entityId, "cancelled"); // defensive: a stale cast can never survive a new commit
    this.casts.set(f.entityId, cast);
    if (def.oncePerForm) f.awakenedUsedMask |= bit;
    // consumesForm: the awakening is spent at commit; the current ability still resolves from `cast`.
    if (def.consumesForm) { f.form = "Base"; f.formEndTick = 0; }
    handler.onCommit?.({ tick, fighter: f, cast, host: this.host, runner: this });
    this.syncArmor(f, cast, tick);
    return { kind: "started", castCounter: f.castCounter, moveId: def.id };
  }

  /**
   * T15: starts a cast for a handler driven response (sv.a1 after its trigger) without form, once per form or cooldown
   * checks and without calling onCommit. The fighter must be Idle. The cast is Active for `active` ticks (no startup),
   * then Recovery for `recovery` ticks. Returns null when the fighter cannot start it.
   */
  beginDetachedCast(f: Fighter, tick: number, def: AbilityDef, active: number, recovery: number, data: Record<string, unknown>): ActiveCast | null {
    const pose = this.host.pose(f.entityId);
    if (!pose || !isAlive(f) || f.action !== "Idle") return null;
    const r = beginCast(f, tick, def.id, 0, active, recovery, 0);
    if (!r.ok) return null;
    const cc = f.cast!;
    this.endCast(f.entityId, "cancelled");
    const cast: ActiveCast = {
      def, entityId: f.entityId, castCounter: f.castCounter, generation: f.generation, startTick: tick,
      activeStart: cc.activeStart, activeEnd: cc.activeEnd, endTick: cc.endTick, aimYaw: pose.facingYaw, armorUntil: 0, data,
    };
    this.casts.set(f.entityId, cast);
    return cast;
  }

  /** Extends the active window and/or the end of a running cast (capture sequences). Keeps the fighter consistent. */
  extendCast(f: Fighter, cast: ActiveCast, activeEnd: number, endTick: number): void {
    if (f.generation !== cast.generation || !f.cast || f.cast.castCounter !== cast.castCounter) return;
    cast.activeEnd = Math.max(cast.activeEnd, activeEnd);
    cast.endTick = Math.max(cast.endTick, endTick, cast.activeEnd);
    f.cast.activeEnd = cast.activeEnd;
    f.cast.endTick = cast.endTick;
    if (f.action === "Active") f.actionEndTick = cast.activeEnd;
    else if (f.action === "Recovery") f.actionEndTick = cast.endTick;
  }

  /**
   * Sets the exact active end and cast end (unlike extendCast it may also shorten). Used by counter stances that
   * end early. Never moves the ends before `tick + 1`.
   */
  retimeCast(f: Fighter, cast: ActiveCast, tick: number, activeEnd: number, endTick: number): void {
    if (f.generation !== cast.generation || !f.cast || f.cast.castCounter !== cast.castCounter) return;
    cast.activeEnd = Math.max(tick + 1, activeEnd);
    cast.endTick = Math.max(cast.activeEnd, endTick);
    f.cast.activeEnd = cast.activeEnd;
    f.cast.endTick = cast.endTick;
    if (f.action === "Active" || f.action === "Windup") {
      f.action = "Active";
      f.actionEndTick = cast.activeEnd;
    } else if (f.action === "Recovery") f.actionEndTick = cast.endTick;
  }

  private armorOf(cast: ActiveCast, tick: number): boolean {
    if (tick < cast.armorUntil) return true;
    switch (cast.def.armor) {
      case "startup": return tick < cast.activeStart;
      // onHit: armor begins the tick after the first confirmed damage or capture (R04) and lasts to activeEnd.
      case "onHit": return cast.data.firstHitTick !== undefined && tick < cast.activeEnd;
      default: return false;
    }
  }

  private syncArmor(f: Fighter, cast: ActiveCast | undefined, tick: number): void {
    f.armored = !!cast && this.armorOf(cast, tick);
  }

  /**
   * Collision query step. Retires finished or cancelled casts (calling onEnd once), refreshes armor and returns
   * every handler's candidates for this tick. The room sorts and resolves them together with other sources.
   */
  collect(tick: number): HitCandidate[] {
    this.nowTick = Math.max(this.nowTick, tick);
    const out: HitCandidate[] = [];
    for (const id of [...this.casts.keys()].sort((a, b) => a - b)) {
      const cast = this.casts.get(id)!;
      const f = this.host.combat.get(id);
      if (!f || !isAlive(f)) { this.endCast(id, "died"); continue; }
      if (f.generation !== cast.generation || f.castCounter !== cast.castCounter) { this.endCast(id, "cancelled"); this.syncArmor(f, undefined, tick); continue; }
      if (tick >= cast.endTick) { this.endCast(id, "completed"); this.syncArmor(f, undefined, tick); continue; }
      this.syncArmor(f, cast, tick);
      const want = cast.def.turnRate > 0 ? this.host.requestedYaw?.(id) : undefined;
      if (want !== undefined && Number.isFinite(want)) cast.aimYaw = rotateToward(cast.aimYaw, want, (cast.def.turnRate * Math.PI / 180) / 60);
      const ctx: CastContext = { tick, fighter: f, cast, host: this.host, runner: this };
      const handler = this.handlers.get(cast.def.handler)!;
      handler.onTick?.(ctx);
      this.syncArmor(f, cast, tick);
      if (this.casts.get(id) !== cast) continue; // the handler ended its own cast
      for (const c of (handler.candidates ?? meleeCandidates)(ctx)) out.push(c);
    }
    for (const c of this.landing.collect(tick, this.host)) out.push(c);
    for (const h of this.handlers.values()) {
      if (h.globalCollect) for (const c of h.globalCollect({ tick, host: this.host, runner: this })) out.push(c);
    }
    return out;
  }

  /** Delivers resolved results to the owning cast's handler. */
  afterResolve(tick: number, results: readonly HitResult[]): void {
    const byAttacker = new Map<number, HitResult[]>();
    for (const r of results) {
      const c = r.candidate;
      const cast = this.casts.get(c.attackerId);
      if (!cast || cast.castCounter !== c.castCounter) continue;
      let l = byAttacker.get(c.attackerId);
      if (!l) { l = []; byAttacker.set(c.attackerId, l); }
      l.push(r);
    }
    for (const [id, list] of [...byAttacker.entries()].sort((a, b) => a[0] - b[0])) {
      const cast = this.casts.get(id)!;
      const f = this.host.combat.get(id);
      if (!f) continue;
      for (const r of list) {
        if ((r.outcome === "hit" && r.damage100 > 0) || r.outcome === "captured") cast.data.firstHitTick ??= tick;
      }
      this.handlers.get(cast.def.handler)!.onResults?.({ tick, fighter: f, cast, host: this.host, runner: this }, list);
    }
    // Results seen from the target side (counter stances), then detached-effect handlers.
    const byTarget = new Map<number, HitResult[]>();
    for (const r of results) {
      const cast = this.casts.get(r.candidate.targetId);
      if (!cast || !this.handlers.get(cast.def.handler)!.onIncoming) continue;
      let l = byTarget.get(r.candidate.targetId);
      if (!l) { l = []; byTarget.set(r.candidate.targetId, l); }
      l.push(r);
    }
    for (const [id, list] of [...byTarget.entries()].sort((a, b) => a[0] - b[0])) {
      const cast = this.casts.get(id);
      const f = this.host.combat.get(id);
      if (!cast || !f) continue;
      this.handlers.get(cast.def.handler)!.onIncoming!({ tick, fighter: f, cast, host: this.host, runner: this }, list);
    }
    for (const h of this.handlers.values()) h.globalResults?.({ tick, host: this.host, runner: this }, results);
  }

  /**
   * Launch velocities for victims of ability hits that landed this tick. The launch comes from the candidate
   * (per-hit override) or the definition. Ragdoll hits need a victim that ragdolled this tick; stun hits need a
   * victim stunned this tick (armor therefore suppresses the launch with the reaction).
   */
  launches(tick: number, results: readonly HitResult[]): Launch[] {
    const out: Launch[] = [];
    for (const r of results) {
      const c = r.candidate;
      if (r.outcome !== "hit" || r.killed || c.reaction.kind === "none") continue;
      const launch = c.launch ?? this.registry.byId(c.moveId)?.launch;
      const v = this.host.combat.get(c.targetId);
      const ap = this.host.pose(c.attackerId);
      if (!launch || !v || !ap) continue;
      if (v.action !== (c.reaction.kind === "ragdoll" ? "Ragdolled" : "Stunned") || v.actionStartTick !== tick) continue;
      if (launch.forward === 0 && launch.up === 0) continue;
      const cast = this.casts.get(c.attackerId);
      const yaw = cast && cast.castCounter === c.castCounter ? cast.aimYaw : ap.facingYaw;
      const vp = this.host.pose(c.targetId) ?? ap;
      out.push({ targetId: c.targetId, ...launchVector(c.originX, c.originZ, vp.x, vp.z, yaw, launch.forward, launch.up) });
    }
    return out;
  }

  /** Movement scale for the running ability cast, or null when no ability cast is running (spec 14). */
  /** Body facing while a cast is live (R07): the body never turns faster than the hitbox. Null without a cast. */
  facingOverrideOf(entityId: number): number | null {
    const c = this.casts.get(entityId);
    return c ? c.aimYaw : null;
  }

  moveScaleOf(entityId: number): number | null {
    const c = this.casts.get(entityId);
    return c ? c.def.moveScale : null;
  }

  private endCast(entityId: number, why: EndReason): void {
    const cast = this.casts.get(entityId);
    if (!cast) return;
    this.casts.delete(entityId); // delete first: onEnd can never run twice
    const f = this.host.combat.get(entityId);
    if (f) {
      f.armored = false;
      this.handlers.get(cast.def.handler)!.onEnd?.({ tick: this.nowTick, fighter: f, cast, host: this.host, runner: this }, why);
    }
  }

  /** Idempotent cancel: stale scheduled effects die with the generation; the handler is told once. */
  cancel(entityId: number): void { this.endCast(entityId, "cancelled"); }

  /** Death, respawn or kit change: drops cast, buffered edge and armor. */
  reset(entityId: number): void {
    this.endCast(entityId, "died");
    this.buffer.drop(entityId);
    this.landing.dropEntity(entityId);
  }

  remove(entityId: number): void {
    this.reset(entityId);
  }

  dispose(): void {
    for (const id of [...this.casts.keys()]) this.endCast(id, "cancelled");
    this.casts.clear();
    this.buffer.clear();
    this.landing.clear();
    this.scratchStore.clear();
  }
}
