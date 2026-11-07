import type { BotDecision, BotObservation, Difficulty } from "@eb/shared/sparring";
import { pickMove, preferredDistance, stepCharge } from "./BotTactics.js";

/** FB02/FB03 (D local design choices, docs/decisions/fb-FB02.md, fb-FB03.md). Hard only carries interval and full speed. */
export const BOT_PARAMS = {
  easy: {
    interval: 30, moveScale: 0.55, reactionTicks: 30, swingCooldownTicks: 90, whiffRate: 0.4, blockRate: 0,
    skillRate: 0.08, aimErrorDeg: 25, wanderMinTicks: 60, wanderMaxTicks: 120, wanderChance: 0.25, pursuitGiveUpTicks: 180,
  },
  // FB03 (D): medium sits between easy and hard; applied as a shaping layer over the GR14 policy (decideMedium).
  medium: {
    interval: 15, moveScale: 0.8, reactionTicks: 12, swingCooldownTicks: 45, maxChain: 2, whiffRate: 0.15, blockRate: 0.25,
    skillRate: 0.85, aimErrorDeg: 10, wanderMinTicks: 60, wanderMaxTicks: 120, wanderChance: 0.05, pursuitGiveUpTicks: 360,
  },
  hard: { interval: 6, moveScale: 1 },
} as const;
const INTERVAL: Record<Difficulty, number> = {
  easy: BOT_PARAMS.easy.interval, medium: BOT_PARAMS.medium.interval, hard: BOT_PARAMS.hard.interval,
};

/** Deterministic hash RNG in [0,1): pure function of (self, life spawn tick, index, salt). No Math.random in sim. */
export function botRandom(selfId: number, spawnTick: number, index: number, salt: number): number {
  let h = (Math.imul(selfId | 0, 0x9e3779b1) ^ Math.imul(spawnTick | 0, 0x85ebca6b) ^ Math.imul(index | 0, 0xc2b2ae35) ^ Math.imul(salt | 0, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface WanderParams { wanderMinTicks: number; wanderMaxTicks: number; wanderChance: number; pursuitGiveUpTicks: number }

/** Stateless engage/wander schedule from spawn: segments of 60-120 ticks; a pursuit is dropped after 180 ticks. */
function easyWandering(o: BotObservation, age: number, E: WanderParams = BOT_PARAMS.easy): { wandering: boolean; segment: number } {
  if (o.noWander) return { wandering: false, segment: 0 };
  let t = 0, run = 0;
  for (let segment = 0; ; segment++) {
    const steps = (E.wanderMaxTicks - E.wanderMinTicks) / 30 + 1;
    const len = E.wanderMinTicks + 30 * Math.floor(botRandom(o.selfId, o.spawnTick, segment, 1) * steps);
    const wander = run >= E.pursuitGiveUpTicks || botRandom(o.selfId, o.spawnTick, segment, 2) < E.wanderChance;
    if (age < t + len) return { wandering: wander, segment };
    run = wander ? 0 : run + len;
    t += len;
  }
}

function decideEasy(o: BotObservation, target: BotObservation["enemies"][number], d2: number, k: number, previous: BotDecision): BotDecision {
  const E = BOT_PARAMS.easy;
  const age = o.tick - o.spawnTick;
  const r = (salt: number) => botRandom(o.selfId, o.spawnTick, k, 10 + salt);
  const dx = target.x - o.self.x, dz = target.z - o.self.z;
  const yawTo = dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz);
  const aimed = yawTo + (r(0) * 2 - 1) * E.aimErrorDeg * Math.PI / 180;
  const base: BotDecision = { ...neutral(), targetId: target.id, yaw: aimed, moveScale: E.moveScale };
  // Reaction delay: noticing a new target costs one full interval of doing nothing.
  if (previous.targetId !== target.id) return { ...base, yaw: yawTo };
  const { wandering, segment } = easyWandering(o, age);
  if (wandering) {
    const walk = r(1) < 0.5;
    const heading = botRandom(o.selfId, o.spawnTick, segment, 3) * Math.PI * 2;
    return { ...neutral(), moveScale: E.moveScale, retreat: walk, yaw: walk ? heading : 0 };
  }
  const inReach = d2 <= 4;
  if (target.attacking && d2 <= 9 && r(2) < E.blockRate) return { ...base, blockHeld: true };
  // One decision in three may swing (>= 90 ticks between swings); the decision after a swing backs off (no combo).
  const phase = k % (E.swingCooldownTicks / E.interval);
  if (phase === 1) return { ...base, retreat: inReach || d2 <= 9 };
  if (phase === 0 && inReach) {
    if (r(3) < E.skillRate && o.slotsReady[0]) return { ...base, castSlot: 1 };
    const whiff = r(4) < E.whiffRate;
    // A whiff swings facing 60-180 degrees away from the target.
    const off = (r(5) < 0.5 ? -1 : 1) * (Math.PI / 3 + r(6) * (2 * Math.PI / 3));
    return { ...base, attackHeld: true, yaw: whiff ? yawTo + off : aimed };
  }
  return { ...base, approach: !inReach };
}
/**
 * FB03: shape the GR14 medium decision (D local design choices). Reaction delay on a new target, pursuit give-up and
 * wander, aim error, whiffs, a 45 tick swing rhythm (chains of at most 2 decisions), partial blocking and skill use.
 */
function decideMedium(o: BotObservation, target: BotObservation["enemies"][number], d2: number, k: number, previous: BotDecision, raw: BotDecision): BotDecision {
  const M = BOT_PARAMS.medium;
  const r = (salt: number) => botRandom(o.selfId, o.spawnTick, k, 20 + salt);
  const yawTo = raw.yaw;
  const aimed = yawTo + (r(0) * 2 - 1) * M.aimErrorDeg * Math.PI / 180;
  // Reaction: noticing a new target costs one full decision interval (15 >= reactionTicks) of idling.
  if (previous.targetId !== target.id) return { ...neutral(), targetId: target.id, yaw: yawTo, moveScale: M.moveScale };
  const { wandering, segment } = easyWandering(o, o.tick - o.spawnTick, M);
  if (wandering) {
    const walk = botRandom(o.selfId, o.spawnTick, segment, 4) < 0.5;
    return { ...neutral(), moveScale: M.moveScale, retreat: walk, yaw: walk ? botRandom(o.selfId, o.spawnTick, segment, 3) * Math.PI * 2 : 0 };
  }
  const out: BotDecision = { ...raw, yaw: aimed, moveScale: M.moveScale };
  if (out.blockHeld && r(1) >= M.blockRate) { out.blockHeld = false; out.approach = d2 > 4; }
  if (out.castSlot > 0 && r(2) >= M.skillRate) { out.castSlot = 0; out.holdSlot = 0; out.attackHeld = d2 <= 4; }
  if (out.attackHeld) {
    // 45 tick rhythm: at most `maxChain` consecutive swing decisions, then one decision without a basic swing.
    if (k % (M.swingCooldownTicks / M.interval) >= M.maxChain) { out.attackHeld = false; }
    else if (r(3) < M.whiffRate) out.yaw = yawTo + (r(4) < 0.5 ? -1 : 1) * (Math.PI / 3 + r(5) * (2 * Math.PI / 3));
  }
  return out;
}

const neutral = (): BotDecision => ({
  targetId: null, attackHeld: false, blockHeld: false,
  approach: false, castSlot: 0, dash: false, awaken: false, retreat: false, yaw: 0,
  holdSlot: 0, releaseSlot: 0, losLost: 0,
});

/** Pure, spawn-relative decisions. The room owns movement safety and skill input IDs. */
export function decideBot(
  difficulty: Difficulty, observation: BotObservation, previousDecision: BotDecision,
  /** FB03: false returns the unshaped GR14 medium policy (used by GR14 rule tests only). */
  shapeMedium = true,
): BotDecision {
  const age = observation.tick - observation.spawnTick;
  const interval = INTERVAL[difficulty];
  // Discard held input from the previous life throughout the initial reaction delay.
  if (age < interval) return neutral();
  const eligible = observation.enemies.filter(enemy =>
    enemy.id !== observation.selfId && enemy.alive && enemy.connected && enemy.ready);
  const tactical = observation.tactics !== undefined;
  if (tactical && previousDecision.holdSlot !== 0) {
    const charged = stepCharge(difficulty, observation, previousDecision, eligible);
    if (charged) return charged;
    previousDecision = { ...previousDecision, holdSlot: 0, releaseSlot: 0, losLost: 0 };
  }
  if (age % interval !== 0) {
    if (difficulty === "easy" && previousDecision.targetId === null) return previousDecision;
    return eligible.some(enemy => enemy.id === previousDecision.targetId)
      ? { ...previousDecision, castSlot: 0, releaseSlot: 0, dash: false, awaken: false, ...(difficulty === "easy" ? { attackHeld: false } : {}) }
      : neutral();
  }

  let target: (typeof eligible)[number] | undefined;
  let distanceSquared = Infinity;
  for (const enemy of eligible) {
    const distance = (enemy.x - observation.self.x) ** 2 + (enemy.z - observation.self.z) ** 2;
    if (distance < distanceSquared || (distance === distanceSquared && target && enemy.id < target.id)) {
      target = enemy;
      distanceSquared = distance;
    }
  }
  if (!target) return neutral();
  const k = Math.floor(age / interval);
  if (difficulty === "easy") return decideEasy(observation, target, distanceSquared, k, previousDecision);
  const shape = (raw: BotDecision) => difficulty === "medium" && shapeMedium ? decideMedium(observation, target!, distanceSquared, k, previousDecision, raw) : raw;
  if (tactical) return shape(decideTactical(difficulty, observation, target, Math.sqrt(distanceSquared), k));
  const inReach = distanceSquared <= 4;
  let blockHeld = target.attacking && distanceSquared <= 9;
  const awaken = observation.meterFull && distanceSquared <= 36;
  let dash = false, retreat = false, castSlot: BotDecision["castSlot"] = 0;
  if (difficulty === "hard" && target.attacking && distanceSquared <= 9 && k % 2 === 1) {
    dash = true; retreat = true; blockHeld = false;
  } else if (inReach && !blockHeld) {
    const limit = difficulty === "hard" ? 4 : 2;
    for (let i = 0; i < 4 && castSlot === 0; i++) {
      const slot = ((k + i) % 4) + 1;
      if (slot <= limit && observation.slotsReady[slot - 1]) castSlot = slot as 1 | 2 | 3 | 4;
    }
  }
  const dx = target.x - observation.self.x;
  const dz = target.z - observation.self.z;
  return shape({
    targetId: target.id,
    attackHeld: inReach && !blockHeld && castSlot === 0,
    blockHeld,
    approach: !inReach && !blockHeld && !retreat,
    castSlot, dash, awaken, retreat, holdSlot: 0, releaseSlot: 0, losLost: 0,
    // Existing movement convention: yaw zero faces -Z. Coincident poses face zero.
    yaw: dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz),
  });
}

function decideTactical(difficulty: Difficulty, o: BotObservation, target: BotObservation["enemies"][number], d: number, k: number): BotDecision {
  const t = o.tactics!;
  const dx = target.x - o.self.x, dz = target.z - o.self.z;
  const base: BotDecision = { ...neutral(), targetId: target.id, yaw: dx === 0 && dz === 0 ? 0 : Math.atan2(-dx, -dz) };
  // Legal hard defensive dash (same trigger as before, only while the dash is actually available).
  if (difficulty === "hard" && target.attacking && d <= 3 && k % 2 === 1 && t.dashReady) {
    return { ...base, dash: true, retreat: true };
  }
  if (o.meterFull && t.grounded && t.form === "Base" && d <= 6) return { ...base, awaken: true };
  const counter = pickMove("counter", difficulty, k, d, target, t);
  const rangedSlot = counter === 0 ? pickMove("ranged", difficulty, k, d, target, t) : 0;
  const close = counter === 0 && rangedSlot === 0 ? pickMove("close", difficulty, k, d, target, t) : 0;
  const castSlot = counter || rangedSlot || close;
  if (castSlot > 0) {
    const holds = t.readyMoves[castSlot - 1] === "ea.b3";
    return { ...base, castSlot, holdSlot: holds ? 3 : 0 };
  }
  if (target.attacking && d <= 3) return { ...base, blockHeld: true };
  if (d <= 2 && target.los === true) return { ...base, attackHeld: true };
  const preferred = preferredDistance(t.kitId, t);
  if (preferred > 2 && d < preferred - 3) return { ...base, retreat: true };
  return { ...base, approach: d > preferred };
}
