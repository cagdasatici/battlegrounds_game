import { COMBAT, HIT_STUN } from "@eb/shared/config/combat";
import { beginCast, type Accept, type Fighter, type Reaction } from "./ActionMachine.js";
import { launchVector } from "./Knockback.js";
import { OffensiveBuffer } from "./OffensiveBuffer.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";

/**
 * Universal basic attack chain (spec sections 7, 11 and 12). Pure server module: no Rapier, no timers.
 *
 * The protocol carries no M1 edge (T07). The server derives M1 requests from the held attack state:
 * - a false->true transition of attackHeld observed by the server is a press, buffered for 6 ticks;
 * - while attackHeld stays true the server repeats the next chain hit as soon as the fighter is Idle,
 *   which is the legal combo cadence (startup 8, active 3, recovery 10; fourth recovery 30).
 * Held M1 is therefore never an unbounded queue: at most one pending request exists per fighter.
 * Hits come only from server spatial queries against server poses at the current tick.
 */
export type FourthVariant = "finisher" | "uppercut" | "downslam";

/** `hurtRadius` / `hurtHalfHeight` override the normal capsule for a target (BEAST01: the 5.5x beast). */
export interface M1Pose { x: number; y: number; z: number; facingYaw: number; grounded: boolean; hurtRadius?: number; hurtHalfHeight?: number; /** BEAST02: multiplies the attacker's M1 box. */ reachScale?: number }
export interface M1Held { attackHeld: boolean; blockHeld: boolean; jumpHeld: boolean; moveX?: number; moveZ?: number }
/** T23: a context move that replaces the M1 about to start. `advance` also resets the chain (fourth hit replacements). */
export interface ContextStart { accept: Accept; advance: boolean }
export interface ContextRequest { index: 0 | 1 | 2 | 3; held: M1Held; pose: M1Pose; /** A fresh press within the buffer window. */ pressed: boolean }
export type ContextHook = (f: Fighter, tick: number, req: ContextRequest) => ContextStart | null;
export interface Launch { targetId: number; vx: number; vy: number; vz: number }

interface ActiveSwing { castCounter: number; index: 0 | 1 | 2 | 3; variant: FourthVariant | null }
interface ChainState {
  lifeId: number;
  /** Next chain index to commit, 0..3. */
  next: 0 | 1 | 2 | 3;
  /** Exclusive end tick of the last committed M1 cast; -1 if none. */
  lastEndTick: number;
  prevHeld: boolean;
  swing: ActiveSwing | null;
}

const M = COMBAT.m1;
export const M1_PREFIX = "m1.";
export const isM1Move = (moveId: string): boolean => moveId.startsWith(M1_PREFIX);
export const m1MoveId = (index: 0 | 1 | 2 | 3, variant: FourthVariant | null): string =>
  index < 3 ? `m1.${index + 1}` : `m1.4.${variant ?? "finisher"}`;

/** Fourth hit selection at commit (spec 8): airborne downslam; else jumpHeld uppercut; else finisher. */
export function selectFourth(grounded: boolean, jumpHeld: boolean): FourthVariant {
  if (!grounded) return "downslam";
  return jumpHeld ? "uppercut" : "finisher";
}

export function damageOf(index: 0 | 1 | 2 | 3, variant: FourthVariant | null): number {
  if (index < 3) return M.damage[index] * 100;
  if (variant === "uppercut") return M.miniUppercut.damage * 100;
  if (variant === "downslam") return M.downslam.damage * 100;
  return M.damage[3] * 100;
}

export function reactionOf(index: 0 | 1 | 2 | 3, variant: FourthVariant | null): Reaction {
  if (index < 3) return HIT_STUN.enabled ? { kind: "stun", ticks: M.stunTicks } : { kind: "none" };
  // Downslam ragdoll duration is not listed in spec 11; D: reuse the fourth hit ragdoll 72.
  return { kind: "ragdoll", ticks: variant === "uppercut" ? M.miniUppercut.ragdollTicks : M.finisherRagdollTicks };
}

/** Velocity added to a ragdolled victim, in world space, from the attacker's facing at impact. */
export function launchOf(variant: FourthVariant | null, facingYaw: number): { vx: number; vy: number; vz: number } {
  const fx = -Math.sin(facingYaw), fz = -Math.cos(facingYaw);
  if (variant === "finisher") return { vx: fx * M.finisherLaunch.forward, vy: M.finisherLaunch.up, vz: fz * M.finisherLaunch.forward };
  if (variant === "uppercut") return { vx: 0, vy: M.miniUppercut.up, vz: 0 };
  if (variant === "downslam") return { vx: 0, vy: -M.downslam.down, vz: 0 };
  return { vx: 0, vy: 0, vz: 0 };
}

const BOX_NEAR = M.box.frontFace - M.box.depth; // 0.3 m in front of the attacker centre
const CAP_R = COMBAT.capsule.radius;
const CAP_HALF = COMBAT.capsule.halfHeight;

/**
 * Exact overlap of the M1 box (attacker local frame: width across, depth forward from BOX_NEAR to
 * frontFace, height centred on the attacker capsule centre) with the target's vertical capsule.
 * Downslam adds a 1.5 m radius cylinder of the same height around the attacker (local reading of
 * "radial landing radius"; one hit per target, so there is no second damage).
 */
export function m1Overlaps(a: M1Pose, t: M1Pose, variant: FourthVariant | null): boolean {
  const rs = a.reachScale ?? 1;
  const dx = t.x - a.x, dz = t.z - a.z;
  const fx = -Math.sin(a.facingYaw), fz = -Math.cos(a.facingYaw);
  const rx = Math.cos(a.facingYaw), rz = -Math.sin(a.facingYaw);
  const fwd = dx * fx + dz * fz, right = dx * rx + dz * rz;
  // Vertical gap between the capsule segment and the box slab.
  const capR = t.hurtRadius ?? CAP_R, capHalf = t.hurtHalfHeight ?? CAP_HALF;
  const segLo = t.y - capHalf, segHi = t.y + capHalf;
  const boxLo = a.y - (M.box.height * rs) / 2, boxHi = a.y + (M.box.height * rs) / 2;
  const dv = Math.max(0, boxLo - segHi, segLo - boxHi);
  const cx = Math.max((-M.box.width * rs) / 2, Math.min((M.box.width * rs) / 2, right));
  const cf = Math.max(BOX_NEAR, Math.min(M.box.frontFace * rs, fwd));
  const dh = Math.hypot(right - cx, fwd - cf);
  if (Math.hypot(dh, dv) <= capR) return true;
  if (variant === "downslam") {
    const radial = Math.max(0, Math.hypot(dx, dz) - M.downslam.landingRadius * rs);
    return Math.hypot(radial, dv) <= capR;
  }
  return false;
}

export class M1System {
  private readonly chains = new Map<number, ChainState>();

  /** `buffer` is the room wide single offensive buffer shared with AbilityRunner (spec 12, R03). */
  constructor(readonly buffer: OffensiveBuffer = new OffensiveBuffer()) {}

  /** T23: set by the room. Asked before every M1 commit; a non-null answer means a context move started instead. */
  contextHook: ContextHook | null = null;

  private chain(f: Fighter): ChainState {
    let s = this.chains.get(f.entityId);
    if (!s || s.lifeId !== f.lifeId) {
      s = { lifeId: f.lifeId, next: 0, lastEndTick: -1, prevHeld: false, swing: null };
      this.chains.set(f.entityId, s);
    }
    return s;
  }

  /**
   * Input step for one fighter (after dash, before jump and guard in spec 12 priority). Returns the
   * accept result when a request was evaluated and committed, or null when nothing was attempted.
   */
  update(f: Fighter, tick: number, held: M1Held, pose: M1Pose | undefined): Accept | null {
    const s = this.chain(f);
    if (f.action === "Dead") { this.reset(f.entityId); return null; }
    const rising = held.attackHeld && !s.prevHeld;
    s.prevHeld = held.attackHeld;
    if (rising) this.buffer.set(f.entityId, { kind: "m1", tick }); // only presses are buffered
    const b = this.buffer.peek(f.entityId);
    if (b?.kind === "m1" && tick - b.tick > COMBAT.bufferTicks) this.buffer.drop(f.entityId);
    const pending = this.buffer.peek(f.entityId)?.kind === "m1";
    const wanted = held.attackHeld || pending;
    // Cannot attack and guard simultaneously: a held guard wins the hold conflict.
    if (!wanted || held.blockHeld || !pose || f.action !== "Idle") return null;
    if (s.lastEndTick >= 0 && tick - s.lastEndTick > M.chainResetGap) s.next = 0;
    const index = s.next;
    const ctx = this.contextHook?.(f, tick, { index, held, pose, pressed: pending });
    if (ctx) {
      if (!ctx.accept.ok) return ctx.accept;
      if (pending) this.buffer.drop(f.entityId);
      if (ctx.advance) { s.next = 0; s.lastEndTick = f.cast?.endTick ?? tick; }
      s.swing = null;
      return ctx.accept;
    }
    const variant = index === 3 ? selectFourth(pose.grounded, held.jumpHeld) : null;
    const r = beginCast(f, tick, m1MoveId(index, variant), M.startup, M.active, index === 3 ? M.finalRecovery : M.recovery, 0);
    if (!r.ok) return r;
    // Chain progress advances at commit; a missed or interrupted swing still advances (D).
    s.next = ((index + 1) % 4) as 0 | 1 | 2 | 3;
    s.lastEndTick = f.cast!.endTick;
    if (pending) this.buffer.drop(f.entityId);
    s.swing = { castCounter: f.castCounter, index, variant };
    return r;
  }

  /** Combo in progress: an M1 cast is running, or the chain can still continue within the gap. */
  comboActive(f: Fighter, tick: number): boolean {
    const s = this.chains.get(f.entityId);
    if (!s || s.lifeId !== f.lifeId) return false;
    if (f.cast && isM1Move(f.cast.moveId)) return true;
    return s.next !== 0 && s.lastEndTick >= 0 && tick - s.lastEndTick <= M.chainResetGap;
  }

  /** Chain index the next request would use (for tests and HUD). */
  nextIndex(f: Fighter, tick: number): number {
    const s = this.chains.get(f.entityId);
    if (!s || s.lifeId !== f.lifeId) return 0;
    return s.lastEndTick >= 0 && tick - s.lastEndTick > M.chainResetGap ? 0 : s.next;
  }

  /**
   * Collision query step: every fighter in the Active phase of its current M1 cast queries the box
   * against every other fighter's server pose this tick. The ledger in HitResolver deduplicates across
   * the 3 active ticks (one hit per target per swing).
   */
  candidates(tick: number, fighters: readonly Fighter[], poseOf: (id: number) => M1Pose | undefined,
    occluded: (a: M1Pose, t: M1Pose) => boolean = () => false): HitCandidate[] {
    const out: HitCandidate[] = [];
    for (const a of fighters) {
      const s = this.chains.get(a.entityId);
      const sw = s?.swing;
      if (a.action !== "Active" || !a.cast || !sw || sw.castCounter !== a.castCounter || !isM1Move(a.cast.moveId)) continue;
      if (tick < a.cast.activeStart || tick >= a.cast.activeEnd) continue;
      const ap = poseOf(a.entityId);
      if (!ap) continue;
      for (const t of fighters) {
        if (t.entityId === a.entityId || t.action === "Dead") continue;
        const tp = poseOf(t.entityId);
        if (!tp || !m1Overlaps(ap, tp, sw.variant) || occluded(ap, tp)) continue;
        out.push({
          attackerId: a.entityId, attackerGeneration: a.generation, castCounter: a.castCounter, hitIndex: 0, toi: 0,
          targetId: t.entityId, moveId: a.cast.moveId, originX: ap.x, originZ: ap.z, block: "B", counterable: true,
          armorBreak: false, damage100: damageOf(sw.index, sw.variant), reaction: reactionOf(sw.index, sw.variant),
          maxHitsPerTarget: 1,
        });
      }
    }
    return out;
  }

  /** Launch velocities for fourth hits that landed and ragdolled their victim this tick. */
  launches(tick: number, results: readonly HitResult[], fighterOf: (id: number) => Fighter | undefined,
    poseOf: (id: number) => M1Pose | undefined): Launch[] {
    const out: Launch[] = [];
    for (const r of results) {
      const c = r.candidate;
      if (r.outcome !== "hit" || r.killed || !isM1Move(c.moveId) || c.reaction.kind !== "ragdoll") continue;
      const v = fighterOf(c.targetId);
      const ap = poseOf(c.attackerId);
      if (!v || !ap || v.action !== "Ragdolled" || v.actionStartTick !== tick) continue; // armor: no launch
      const variant = c.moveId.slice("m1.4.".length) as FourthVariant;
      const vp = poseOf(c.targetId);
      out.push({ targetId: c.targetId, ...(variant === "finisher" && vp
        ? launchVector(c.originX, c.originZ, vp.x, vp.z, ap.facingYaw, M.finisherLaunch.forward, M.finisherLaunch.up)
        : launchOf(variant, ap.facingYaw)) });
    }
    return out;
  }

  /** Death or respawn: combo and buffered press are cleared (spec 11). */
  reset(entityId: number): void {
    const s = this.chains.get(entityId);
    this.buffer.drop(entityId);
    if (s) { s.next = 0; s.lastEndTick = -1; s.prevHeld = false; s.swing = null; }
  }

  remove(entityId: number): void { this.chains.delete(entityId); this.buffer.drop(entityId); }
  get size(): number { return this.chains.size; }
  dispose(): void { this.chains.clear(); }
}
