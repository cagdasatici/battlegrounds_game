import { COMBAT } from "@eb/shared/config/combat";
import type { Action, Form } from "@eb/shared/schema";
import type { RejectReason } from "@eb/shared/protocol";

/**
 * Authoritative per-fighter action state machine (spec section 12). Pure: no Rapier, no timers, no DOM.
 * Every deadline is an integer tick and exclusive (a state is active while tick < endTick).
 * Locomotion (grounded/airborne) is an orthogonal input supplied by the caller each tick.
 * Cast phases (Windup/Active/Recovery) are generic here; ability handlers arrive in T10/T11.
 */
export type DashKind = "forward" | "side" | "back" | "evasive";
export type CooldownKey = "dash.forward" | "dash.side" | "dash.back" | "evasive" | (string & {});

export interface DashState { kind: DashKind; dirX: number; dirZ: number; speed: number; invulnerableUntil: number }
export interface CastState {
  moveId: string; castCounter: number; activeStart: number; activeEnd: number; endTick: number;
}

export interface Fighter {
  entityId: number;
  lifeId: number;
  hp100: number;
  action: Action;
  actionStartTick: number;
  actionEndTick: number; // exclusive; Number.MAX_SAFE_INTEGER for open-ended (Idle, Guard, Captured, Dead)
  moveId: string;
  /** Incremented whenever the current action is cancelled or replaced. Scheduled effects carry it. */
  generation: number;
  castCounter: number;
  cast: CastState | null;
  dash: DashState | null;
  /** Tick at which the current ragdoll began (ragdoll age = tick - ragdollStartTick). */
  ragdollStartTick: number;
  /** Pending landing bonus from an airborne hit; cleared by evasive, death or protection (spec 14). */
  landingBonus: boolean;
  /** Ticks at which each cooldown bucket is ready again. */
  cooldowns: Map<CooldownKey, number>;
  blockstunUntil: number;
  protectedUntilTick: number;
  invulnerableUntil: number;
  /** Counter interval [counterOpenFrom, counterOpenUntil), set by counter handlers (T13). */
  counterOpenUntil: number;
  /**
   * T15: private lethal counter status end tick (exclusive; 0 = none). Unlike counterOpenUntil it is NOT cleared by a
   * new action, because base actions are allowed while sv.a1 Stillpoint Reversal is open. Death and respawn clear it.
   */
  lethalCounterUntil: number;
  armored: boolean;
  koCount: number; // KOs suffered this life; must stay <= 1
  /** Form state (spec 14/15). Awakened bits and contextSpent reset on a new awakening (T14). */
  form: Form;
  formEndTick: number; // exclusive; 0 when not timed
  awakenedUsedMask: number; // bit (slot-1) set once an oncePerForm move was committed
  contextSpent: boolean;
  /** Awakening meter in hundredths of damage points (spec 15/26); threshold 20000 (sv) or 35000. */
  meter100: number;
}

const OPEN = Number.MAX_SAFE_INTEGER;
export const ACTION_OPEN_END = OPEN;
/** D: recovery after a ragdoll times out on the ground (spec 12). */
export const RAGDOLL_GET_UP_TICKS = 12;
/** D: captor recovery after its victim dies or departs (spec 12). */
export const CAPTOR_RELEASE_RECOVERY = 18;

export function createFighter(entityId: number, lifeId: number, tick: number): Fighter {
  return {
    entityId, lifeId, hp100: COMBAT.hp100Max, action: "Idle", actionStartTick: tick, actionEndTick: OPEN, moveId: "",
    generation: 0, castCounter: 0, cast: null, dash: null, ragdollStartTick: -1, landingBonus: false,
    cooldowns: new Map(), blockstunUntil: 0, protectedUntilTick: tick + COMBAT.spawnProtectionTicks,
    invulnerableUntil: 0, counterOpenUntil: 0, lethalCounterUntil: 0, armored: false, koCount: 0,
    form: "Base", formEndTick: 0, awakenedUsedMask: 0, contextSpent: false, meter100: 0,
  };
}

export type Accept = { ok: true; castCounter?: number } | { ok: false; reason: RejectReason };
const reject = (reason: RejectReason): Accept => ({ ok: false, reason });

function setAction(f: Fighter, action: Action, tick: number, endTick: number, moveId = ""): void {
  f.action = action;
  f.actionStartTick = tick;
  f.actionEndTick = endTick;
  f.moveId = moveId;
}

/** Cancels the current cast/dash: bumps generation so every scheduled effect of it becomes stale. */
export function cancelCurrent(f: Fighter): void {
  f.generation += 1;
  f.cast = null;
  f.dash = null;
  f.counterOpenUntil = 0; // a counter stance never outlives the action that opened it
}

export const isAlive = (f: Fighter): boolean => f.action !== "Dead";
export const cooldownReady = (f: Fighter, key: CooldownKey, tick: number): boolean => (f.cooldowns.get(key) ?? 0) <= tick;
export const isGuarding = (f: Fighter, tick: number): boolean =>
  f.action === "Guard" && tick >= f.actionStartTick + COMBAT.guard.startup;
export const isInvulnerable = (f: Fighter, tick: number): boolean => tick < f.invulnerableUntil;
export const isProtected = (f: Fighter, tick: number): boolean => tick < f.protectedUntilTick;
/** Actions in which a fighter may be hit and reacts (not Dead). Captured victims react only via captor. */
export const isVulnerable = (f: Fighter): boolean => f.action !== "Dead";

/**
 * Classifies a dash by the larger absolute forward/right component relative to facing; ties choose
 * forward/back; zero input means forward (spec section 11). facingYaw 0 faces -Z.
 */
export function classifyDash(facingYaw: number, moveX: number, moveZ: number): { kind: Exclude<DashKind, "evasive">; dirX: number; dirZ: number } {
  const fx = -Math.sin(facingYaw), fz = -Math.cos(facingYaw); // forward
  const rx = Math.cos(facingYaw), rz = -Math.sin(facingYaw); // right
  const len = Math.hypot(moveX, moveZ);
  if (!(len > 1e-6) || !Number.isFinite(len)) return { kind: "forward", dirX: fx, dirZ: fz };
  const mx = moveX / len, mz = moveZ / len;
  const f = mx * fx + mz * fz, r = mx * rx + mz * rz;
  const kind = Math.abs(f) >= Math.abs(r) ? (f >= 0 ? "forward" : "back") : "side";
  return { kind, dirX: mx, dirZ: mz }; // keep normalized diagonal direction
}

/** Dash or evasive request (one edge). While ragdolled it requests evasive (spec section 7). */
export function requestDash(f: Fighter, tick: number, facingYaw: number, moveX: number, moveZ: number): Accept {
  if (f.action === "Ragdolled") {
    if (tick - f.ragdollStartTick < COMBAT.evasive.minRagdollAge) return reject("STATE");
    if (!cooldownReady(f, "evasive", tick)) return reject("COOLDOWN");
    const c = classifyDash(facingYaw, moveX, moveZ);
    const len = Math.hypot(moveX, moveZ);
    // Stationary evasive uses facing right (spec section 11).
    const dir = len > 1e-6 && Number.isFinite(len) ? { x: c.dirX, z: c.dirZ } : { x: Math.cos(facingYaw), z: -Math.sin(facingYaw) };
    const e = COMBAT.evasive;
    cancelCurrent(f);
    f.landingBonus = false;
    f.cooldowns.set("evasive", tick + e.cooldown);
    f.invulnerableUntil = Math.max(f.invulnerableUntil, tick + e.invulnerableTicks);
    f.dash = { kind: "evasive", dirX: dir.x, dirZ: dir.z, speed: e.speed, invulnerableUntil: tick + e.invulnerableTicks };
    setAction(f, "Dash", tick, tick + e.ticks, "evasive");
    return { ok: true };
  }
  if (f.action !== "Idle") return reject("STATE");
  const c = classifyDash(facingYaw, moveX, moveZ);
  const def = COMBAT.dash[c.kind];
  const key: CooldownKey = `dash.${c.kind}`;
  if (!cooldownReady(f, key, tick)) return reject("COOLDOWN");
  cancelCurrent(f);
  f.cooldowns.set(key, tick + def.cooldown);
  f.dash = { kind: c.kind, dirX: c.dirX, dirZ: c.dirZ, speed: def.speed, invulnerableUntil: 0 };
  f.castCounter += 1;
  if (c.kind === "forward") f.protectedUntilTick = Math.min(f.protectedUntilTick, tick); // offensive request
  setAction(f, "Dash", tick, tick + def.ticks, `dash.${c.kind}`);
  return { ok: true, castCounter: f.castCounter };
}

/** Generic cast commit used by ability handlers (T10/T11). Cooldown starts on the accepted press. */
export function beginCast(f: Fighter, tick: number, moveId: string, startup: number, active: number, recovery: number, cooldown: number): Accept {
  if (f.action !== "Idle") return reject("STATE");
  if (!cooldownReady(f, moveId, tick)) return reject("COOLDOWN");
  cancelCurrent(f);
  f.castCounter += 1;
  f.cooldowns.set(moveId, tick + cooldown);
  f.protectedUntilTick = Math.min(f.protectedUntilTick, tick);
  const activeStart = tick + startup;
  const activeEnd = activeStart + active;
  f.cast = { moveId, castCounter: f.castCounter, activeStart, activeEnd, endTick: activeEnd + recovery };
  setAction(f, startup > 0 ? "Windup" : "Active", tick, startup > 0 ? activeStart : activeEnd, moveId);
  return { ok: true, castCounter: f.castCounter };
}

/** Awakening activation (spec 12 Idle -> Awakening). The caller validates meter, form, grounded and protection. */
export function beginAwakening(f: Fighter, tick: number, ticks: number, moveId: string): Accept {
  if (f.action !== "Idle") return reject("STATE");
  cancelCurrent(f);
  f.castCounter += 1;
  f.protectedUntilTick = Math.min(f.protectedUntilTick, tick); // an accepted offensive request ends protection
  setAction(f, "Awakening", tick, tick + ticks, moveId);
  return { ok: true, castCounter: f.castCounter };
}

/** Guard hold handling: Idle + blockHeld + grounded enters Guard; release enters 3 tick recovery. */
export function updateGuard(f: Fighter, tick: number, blockHeld: boolean, grounded: boolean): void {
  if (f.action === "Idle" && blockHeld && grounded) {
    setAction(f, "Guard", tick, OPEN, "guard");
  } else if (f.action === "Guard" && (!blockHeld || !grounded) && tick >= f.blockstunUntil) {
    setAction(f, "Recovery", tick, tick + COMBAT.guard.recovery, "guard");
  }
}

export type Reaction = { kind: "stun"; ticks: number } | { kind: "ragdoll"; ticks: number } | { kind: "none" };

/** Applies a hit reaction (stun or ragdoll); cancels the current cast (spec 12). */
export function applyReaction(f: Fighter, tick: number, r: Reaction, airborne: boolean): void {
  if (r.kind === "none" || !isAlive(f) || f.action === "Captured") return;
  cancelCurrent(f);
  if (r.kind === "stun") setAction(f, "Stunned", tick, tick + r.ticks);
  else {
    setAction(f, "Ragdolled", tick, tick + r.ticks);
    f.ragdollStartTick = tick;
    if (airborne) f.landingBonus = true;
  }
}

export function applyBlockstun(f: Fighter, tick: number): void {
  f.blockstunUntil = Math.max(f.blockstunUntil, tick + COMBAT.guard.blockstun);
}

export function enterCaptured(f: Fighter, tick: number, captorMoveId: string): void {
  cancelCurrent(f);
  setAction(f, "Captured", tick, OPEN, captorMoveId);
}

/** Ends a capture on the victim. The final-hit reaction (if any) is applied by the handler afterwards. */
export function leaveCaptured(f: Fighter, tick: number): void {
  if (f.action === "Captured") setAction(f, "Idle", tick, OPEN);
}

/** Ends the current action at once and returns to Idle (T15: sv.a1 frees the caster while its counter status stays open). */
export function releaseToIdle(f: Fighter, tick: number): void {
  if (!isAlive(f)) return;
  cancelCurrent(f);
  setAction(f, "Idle", tick, OPEN);
}

export function enterRecovery(f: Fighter, tick: number, ticks: number): void {
  if (!isAlive(f)) return;
  cancelCurrent(f);
  setAction(f, "Recovery", tick, tick + ticks);
}

/** HP reached zero or void rule. Returns false if this life already had its KO. */
export function kill(f: Fighter, tick: number): boolean {
  if (!isAlive(f)) return false;
  cancelCurrent(f);
  f.hp100 = 0;
  f.koCount += 1;
  f.landingBonus = false;
  f.counterOpenUntil = 0;
  f.lethalCounterUntil = 0;
  // Death resets meter and consumes any awakening (spec 11, 15).
  f.meter100 = 0; f.form = "Base"; f.formEndTick = 0; f.awakenedUsedMask = 0; f.contextSpent = false;
  f.armored = false;
  setAction(f, "Dead", tick, OPEN);
  return true;
}

/** Respawn: Idle, new life, full HP, all cooldowns reset, protection applied. */
export function respawn(f: Fighter, tick: number, lifeId: number): void {
  cancelCurrent(f);
  f.lifeId = lifeId;
  f.hp100 = COMBAT.hp100Max;
  f.cooldowns.clear();
  f.koCount = 0;
  f.blockstunUntil = 0;
  f.invulnerableUntil = 0;
  f.landingBonus = false;
  f.ragdollStartTick = -1;
  f.armored = false;
  f.counterOpenUntil = 0;
  f.lethalCounterUntil = 0;
  f.form = "Base"; f.formEndTick = 0; f.awakenedUsedMask = 0; f.contextSpent = false; f.meter100 = 0;
  f.protectedUntilTick = tick + COMBAT.spawnProtectionTicks;
  setAction(f, "Idle", tick, OPEN);
}

/**
 * Expiry step (spec 12 interrupt ordering: expiries before input intents). Advances timed phases
 * whose exclusive deadline has been reached.
 */
export function expire(f: Fighter, tick: number, grounded: boolean): void {
  if (tick < f.actionEndTick) return;
  switch (f.action) {
    case "Windup":
      if (f.cast) { setAction(f, "Active", tick, f.cast.activeEnd, f.cast.moveId); return; }
      break;
    case "Active":
      if (f.cast) { setAction(f, "Recovery", tick, f.cast.endTick, f.cast.moveId); return; }
      break;
    case "Ragdolled":
      if (!grounded) return; // airborne remains ragdolled
      f.dash = null;
      setAction(f, "Recovery", tick, tick + RAGDOLL_GET_UP_TICKS);
      return;
    case "Awakening":
    case "Dash":
    case "Stunned":
    case "Recovery":
      break;
    default:
      return; // open-ended states
  }
  f.cast = null;
  f.dash = null;
  setAction(f, "Idle", tick, OPEN);
}

/** True when intents other than disconnect are suppressed (spec 12 Captured; also Dead). */
export const intentsSuppressed = (f: Fighter): boolean => f.action === "Captured" || f.action === "Dead";
/** Locomotion lock: no player-driven movement in these actions. */
export const locomotionLocked = (f: Fighter): boolean =>
  f.action === "Captured" || f.action === "Dead" || f.action === "Stunned" || f.action === "Ragdolled";
