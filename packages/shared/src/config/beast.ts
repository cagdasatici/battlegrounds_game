/**
 * BEAST01: the sparring beast, a server controlled boss that wanders into hosted sparring now and then.
 * Pure module: no DOM, Three.js, Rapier or Node APIs. Every number is D (local design choice); none is a verified
 * original-game fact. All timers are integer ticks at 60 Hz. Tuned to be fun rather than hard: slow, telegraphed attacks,
 * long recovery, a stagger window, and (while `lethal` is false) it never takes a human below 1 HP.
 */
import { safeTravelDistance, type GroundProbe } from "../dashSafety.js";

export const BEAST_ENTITY_ID = 254;
export const BEAST_KIT = "sv" as const;

export const BEAST = {
  /** Body scale against a normal fighter (5.5x height and width). Replicated as hundredths. */
  scale: 5.5,
  /** Hurtbox: normal capsule scaled by `scale` (radius 0.35, half height 0.55). */
  hurtRadius: 0.35 * 5.5,
  hurtHalfHeight: 0.55 * 5.5,
  /** HP in hundredths by number of connected humans (a normal fighter is 10000). uint16 on the wire. */
  hp100ByHumans: { 1: 36000, 2: 50000, 3: 60000 } as Readonly<Record<number, number>>,
  /** Walk magnitude (0..1) against the normal 9 m/s walk, so about 3.6 m/s: any human outruns it. */
  moveMagnitude: 0.4,
  /** Radians per tick the beast can turn while Idle or in the first half of a windup (about 1.2 rad/s). */
  turnPerTick: 0.02,
  /** Ticks between the end of one attack and the beginning of the next decision. */
  restTicks: 90,
  /** First spawn 45..90 s after the room starts; later spawns 90..150 s after the previous beast is gone. */
  firstSpawnTicks: [2700, 5400] as const,
  nextSpawnTicks: [5400, 9000] as const,
  /** Warning (ground marker and banner) before it appears. */
  warningTicks: 180,
  /** The beast leaves on its own after this long if nobody beats it (3 minutes). */
  lifetimeTicks: 10800,
  /** Collapse animation window after defeat before the state clears. */
  defeatedTicks: 240,
  spawnProtectionTicks: 60,
  /** Where it can appear (main island, clear of pillars and walls), the farthest from the humans is used. */
  anchors: [[-24, 0, -18], [24, 0, -18], [-24, 0, 18], [24, 0, 18]] as const,
  /** Sample ring (m) that must be walkable around the beast's next position, so its body never overhangs an edge. */
  footprintRadius: 2.4,
  /** Damage accumulated within `staggerWindowTicks` that interrupts it for `staggerTicks`. */
  staggerDamage100: 4000,
  staggerWindowTicks: 180,
  staggerTicks: 120,
  /** Unmoved for this many ticks while chasing: sidestep for `sidestepTicks` (pillars and walls). */
  stallTicks: 60,
  sidestepTicks: 45,
  /** A false value keeps humans at 1 HP at the lowest ("not too hard"). */
  lethal: false,
  /** Reward on defeat: every living human heals this much (hundredths). */
  defeatHeal100: 5000,
} as const;

export type BeastMoveId = "beast.swipe" | "beast.slam";

export interface BeastMove {
  id: BeastMoveId;
  startup: number;
  active: number;
  recovery: number;
  damage100: number;
  chip100: number;
  /** Targets farther than this (m from the beast centre) are missed. */
  reach: number;
  /** Half angle of the swipe cone in degrees; 180 = full circle (slam). */
  halfAngleDeg: number;
  /** Slam only hits targets that are on the ground, so a jump dodges it. */
  groundedOnly: boolean;
  ragdollTicks: number;
  launch: { forward: number; up: number };
  /** Ticks (from windup start) during which the beast still turns to track its target. */
  trackTicks: number;
}

export const BEAST_MOVES: Readonly<Record<BeastMoveId, BeastMove>> = {
  "beast.swipe": {
    id: "beast.swipe", startup: 42, active: 6, recovery: 60, damage100: 1200, chip100: 100,
    reach: 6.5, halfAngleDeg: 70, groundedOnly: false, ragdollTicks: 54, launch: { forward: 15, up: 7 }, trackTicks: 20,
  },
  "beast.slam": {
    id: "beast.slam", startup: 66, active: 4, recovery: 90, damage100: 900, chip100: 100,
    reach: 7.5, halfAngleDeg: 180, groundedOnly: true, ragdollTicks: 36, launch: { forward: 6, up: 9 }, trackTicks: 0,
  },
};

export function beastHp100(humans: number): number {
  const n = Math.max(1, Math.min(3, Math.floor(humans)));
  return BEAST.hp100ByHumans[n]!;
}

/** Ticks until the next spawn from a uniform random `u` in [0,1); `first` selects the early delay range. */
export function beastSpawnDelay(u: number, first: boolean): number {
  const [lo, hi] = first ? BEAST.firstSpawnTicks : BEAST.nextSpawnTicks;
  return lo + Math.floor(Math.max(0, Math.min(0.999999, u)) * (hi - lo + 1));
}

/** Attack choice: every third attack is the slam, the rest swipes; a slam also fires first when 2+ humans crowd it. */
export function pickBeastMove(attackIndex: number, humansInSlamRange: number): BeastMoveId {
  if (humansInSlamRange >= 2 && attackIndex % 2 === 1) return "beast.slam";
  return attackIndex % 3 === 2 ? "beast.slam" : "beast.swipe";
}

/** True when (tx,tz) lies inside the move's zone for a beast at (bx,bz) facing `yaw` (yaw 0 faces -Z). */
export function inBeastZone(move: BeastMove, bx: number, bz: number, yaw: number, tx: number, tz: number, targetRadius = 0.35): boolean {
  const dx = tx - bx, dz = tz - bz;
  const d = Math.hypot(dx, dz);
  if (d > move.reach + targetRadius) return false;
  if (move.halfAngleDeg >= 180 || d < 1e-6) return true;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  return (fx * dx + fz * dz) / d >= Math.cos((move.halfAngleDeg * Math.PI) / 180);
}

export interface BeastLaunch { vx: number; vy: number; vz: number }

/**
 * The throw. Horizontal direction is away from the beast; if that lands off the island the throw turns toward the arena
 * centre instead, and its horizontal speed is always reduced until the whole flight plus a landing slide stays on
 * walkable ground (`safeTravelDistance` reserves a coast and margin). So no throw can carry a human over an edge.
 */
export function beastLaunch(probe: GroundProbe, move: BeastMove, bx: number, bz: number, tx: number, tz: number): BeastLaunch {
  const g = 24; // COMBAT.movement.gravity magnitude
  const airTime = (2 * move.launch.up) / g;
  const full = move.launch.forward * airTime;
  const away = norm(tx - bx, tz - bz) ?? [0, -1];
  const toCentre = norm(-tx, -tz) ?? away;
  const safeAway = safeTravelDistance(probe, tx, tz, away[0], away[1], full);
  let dir = away, safe = safeAway;
  if (safeAway < full * 0.6) {
    const safeIn = safeTravelDistance(probe, tx, tz, toCentre[0], toCentre[1], full);
    if (safeIn > safeAway) { dir = toCentre; safe = safeIn; }
  }
  // Open ground keeps the full speed; a clamped throw keeps 15% of the safe distance in hand for the landing slide.
  const v = safe >= full ? move.launch.forward : (safe * 0.85) / airTime;
  return { vx: dir[0] * v, vy: move.launch.up, vz: dir[1] * v };
}

function norm(x: number, z: number): [number, number] | null {
  const l = Math.hypot(x, z);
  return l > 1e-6 ? [x / l, z / l] : null;
}

/**
 * BEAST02: Beast Awaken, the human transformation. All D values. A fighter who saves two full awaken bars and then presses
 * Awaken becomes a 5.5x brute for exactly `ticks` ticks. Underneath it is the ordinary Awakened form (so the four awakened
 * specials, their cooldowns and the once-per-form rule are unchanged); `beast` is an extra flag on the fighter.
 */
export const BEAST_FORM = {
  /** 10 s at 60 Hz. */
  ticks: 600,
  scale: 5.5,
  /** Full bars needed to transform (a normal awaken still needs one). */
  stacks: 2,
  /** Walk intent is scaled by this and running is off: slow. */
  moveScale: 0.5,
  /** Damage taken is multiplied by num/den: sturdy. */
  takenNum: 1,
  takenDen: 2,
  /** M1 and dash damage num/den, and reach multiplier of the M1 box. */
  basicNum: 3,
  basicDen: 2,
  reachScale: 2.5,
  /** Damage multiplier for the four awakened specials ("double damage"). */
  specialMultiplier: 2,
  /** Hurtbox is the wild beast's. */
  hurtRadius: BEAST.hurtRadius,
  hurtHalfHeight: BEAST.hurtHalfHeight,
} as const;

const AWAKENED_SPECIAL = /^(sv|td|ea)\.a[1-4]$/;

/** Damage (hundredths) a beast-form attacker deals with `moveId`. Pure; non-beast attackers use the raw value. */
export function beastFormDamage100(moveId: string, damage100: number): number {
  if (AWAKENED_SPECIAL.test(moveId)) return damage100 * BEAST_FORM.specialMultiplier;
  if (moveId.startsWith("m1.") || moveId === "dash.forward") return Math.floor((damage100 * BEAST_FORM.basicNum) / BEAST_FORM.basicDen);
  return damage100;
}

/** Damage a beast-form target actually takes. */
export const beastFormTaken100 = (damage100: number): number => Math.floor((damage100 * BEAST_FORM.takenNum) / BEAST_FORM.takenDen);

/**
 * BEAST02 craters (sparring only). D values. A crater is a replicated, server timed scar: it is placed when a beast-form
 * fighter casts an awakened special (and when it transforms) and heals away by itself. It is presentation plus timing; it
 * does not change collision, so prediction, bots and edge safety are unaffected.
 */
export const CRATER = {
  /** 20 s to heal completely. */
  healTicks: 1200,
  maxLive: 12,
  /** Radius for awakened slot n is base + perSlot * n (m); the transformation stomp uses `stompRadius`. */
  baseRadius: 3,
  perSlot: 0.75,
  stompRadius: 6,
  /** The special's crater lands this far in front of the caster (m). */
  forward: 3.5,
} as const;

/** Crater radius (m) for an awakened special id ("sv.a3" -> slot 3), or 0 when the move is not an awakened special. */
export function craterRadius(moveId: string): number {
  const m = /^(?:sv|td|ea)\.a([1-4])$/.exec(moveId);
  return m ? CRATER.baseRadius + CRATER.perSlot * Number(m[1]) : 0;
}

/** 1 = fresh scar, 0 = healed. Pure; the client fades with it and the server prunes at 0. */
export function craterDepth(tick: number, startTick: number): number {
  return Math.max(0, Math.min(1, 1 - (tick - startTick) / CRATER.healTicks));
}
