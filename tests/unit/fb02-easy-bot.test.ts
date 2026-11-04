import { describe, expect, test } from "vitest";
import type { BotDecision, BotObservation } from "../../packages/shared/src/sparring.js";
import { BOT_PARAMS, decideBot } from "../../apps/server/src/sim/SparringBrain.js";

const neutral: BotDecision = {
  targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false, awaken: false,
  retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0,
};
const obs = (selfId: number, spawnTick: number, tick: number, z = -1.5, attacking = false): BotObservation => ({
  tick, spawnTick, selfId, self: { x: 0, z: 0 }, slotsReady: [true, true, true, true], meterFull: true,
  enemies: [{ id: 99, x: 0, z, alive: true, connected: true, ready: true, attacking }],
});
const yawTo = (z: number) => Math.atan2(0, -z);
/** Run a life from spawn, feeding each decision back as previous, as the room does. */
function life(selfId: number, spawnTick: number, ticks: number, z: number, attacking = false): BotDecision[] {
  let prev = neutral; const out: BotDecision[] = [];
  for (let t = 0; t < ticks; t++) { prev = decideBot("easy", obs(selfId, spawnTick, spawnTick + t, z, attacking), prev); out.push(prev); }
  return out;
}

describe("FB02 easy bot parameters", () => {
  test("easy values and unchanged medium/hard", () => {
    expect(BOT_PARAMS.easy).toMatchObject({
      moveScale: 0.55, reactionTicks: 30, interval: 30, swingCooldownTicks: 90, whiffRate: 0.4, aimErrorDeg: 25, pursuitGiveUpTicks: 180,
    });
    expect(BOT_PARAMS.easy.reactionTicks).toBeGreaterThanOrEqual(30);
    expect(BOT_PARAMS.easy.skillRate).toBeLessThanOrEqual(0.1);
    expect(BOT_PARAMS.medium.interval).toBe(15); // FB03 retuned the rest of medium
    expect(BOT_PARAMS.hard).toEqual({ interval: 6, moveScale: 1 });
  });

  test("easy moves at 0.55 intent and reacts to a new target only one interval later", () => {
    const first = decideBot("easy", obs(1, 0, 30, -5), neutral);
    expect(first.targetId).toBe(99);
    expect(first).toMatchObject({ approach: false, attackHeld: false, blockHeld: false, castSlot: 0 });
    expect(first.moveScale).toBe(0.55);
    const medium = decideBot("medium", obs(1, 0, 30, -5), neutral);
    expect(medium.moveScale).toBe(0.8); // FB03
  });

  test("swings are >= 90 ticks apart and never held across ticks (no combo)", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ticks = life(seed, 7, 1200, -1.5);
      const swings = ticks.map((d, i) => (d.attackHeld || d.castSlot > 0 ? i : -1)).filter(i => i >= 0);
      for (let i = 1; i < swings.length; i++) expect(swings[i]! - swings[i - 1]!).toBeGreaterThanOrEqual(90);
    }
  });

  test("whiff rate ~40% and aim error within 25 degrees over 1000 swings", () => {
    let swings = 0, whiffs = 0;
    for (let seed = 1; swings < 1000; seed++) {
      const spawn = seed * 13;
      for (let k = 3; k < 60 && swings < 1000; k += 3) {
        const d = decideBot("easy", obs(seed, spawn, spawn + k * 30), { ...neutral, targetId: 99 });
        if (!d.attackHeld) continue;
        swings++;
        const err = Math.abs(Math.atan2(Math.sin(d.yaw - yawTo(-1.5)), Math.cos(d.yaw - yawTo(-1.5)))) * 180 / Math.PI;
        if (err > 25 + 1e-9) whiffs++;
      }
    }
    expect(whiffs / swings).toBeGreaterThan(0.33);
    expect(whiffs / swings).toBeLessThan(0.47);
  });

  test("blocks at most 35% of incoming attacks; skill use <= 10%", () => {
    let attacks = 0, blocks = 0, decisions = 0, skills = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const d = decideBot("easy", obs(seed, 0, 30 * 5, -2, true), { ...neutral, targetId: 99 });
      attacks++; if (d.blockHeld) blocks++;
      const c = decideBot("easy", obs(seed, 0, 30 * 6, -1.5), { ...neutral, targetId: 99 });
      decisions++; if (c.castSlot > 0) skills++;
      expect(c.dash || c.awaken).toBe(false);
    }
    expect(blocks / attacks).toBeLessThanOrEqual(0.35);
    expect(skills / decisions).toBeLessThanOrEqual(0.1);
  });

  test("gives up a chase within 180 ticks plus one wander segment, then wanders; deterministic", () => {
    const a = life(3, 0, 900, -12), b = life(3, 0, 900, -12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    let run = 0, maxRun = 0;
    for (const d of a) { run = d.approach ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
    expect(maxRun).toBeLessThanOrEqual(240);
    expect(a.some(d => d.targetId === null || d.retreat)).toBe(true);
  });
});
