import { describe, expect, test } from "vitest";
import type { BotDecision, BotObservation } from "../../packages/shared/src/sparring.js";
import { BOT_PARAMS, decideBot } from "../../apps/server/src/sim/SparringBrain.js";

const neutral: BotDecision = {
  targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false, awaken: false,
  retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0,
};
const obs = (selfId: number, spawnTick: number, tick: number, z = -1.5, attacking = false): BotObservation => ({
  tick, spawnTick, selfId, self: { x: 0, z: 0 }, slotsReady: [true, true, true, true], meterFull: false,
  enemies: [{ id: 99, x: 0, z, alive: true, connected: true, ready: true, attacking }],
});
function life(selfId: number, spawnTick: number, ticks: number, z: number, attacking = false): BotDecision[] {
  let prev = neutral; const out: BotDecision[] = [];
  for (let t = 0; t < ticks; t++) { prev = decideBot("medium", obs(selfId, spawnTick, spawnTick + t, z, attacking), prev); out.push(prev); }
  return out;
}

describe("FB03 medium bot parameters", () => {
  test("medium lies between easy and hard", () => {
    const { easy, medium, hard } = BOT_PARAMS;
    expect(medium).toMatchObject({ moveScale: 0.8, reactionTicks: 12, swingCooldownTicks: 45, maxChain: 2, whiffRate: 0.15, aimErrorDeg: 10, pursuitGiveUpTicks: 360 });
    expect(medium.moveScale).toBeGreaterThan(easy.moveScale); expect(medium.moveScale).toBeLessThan(hard.moveScale);
    expect(medium.interval).toBeLessThan(easy.interval); expect(medium.interval).toBeGreaterThan(hard.interval);
    expect(medium.blockRate).toBeGreaterThan(easy.blockRate); expect(medium.blockRate).toBeLessThan(1);
    expect(medium.skillRate).toBeGreaterThan(easy.skillRate); expect(medium.skillRate).toBeLessThan(1);
    expect(medium.whiffRate).toBeLessThan(easy.whiffRate); expect(medium.aimErrorDeg).toBeLessThan(easy.aimErrorDeg);
    expect(medium.pursuitGiveUpTicks).toBeGreaterThan(easy.pursuitGiveUpTicks);
  });

  test("scales movement, idles one interval on a new target, and is deterministic", () => {
    const first = decideBot("medium", obs(1, 0, 30, -5), neutral);
    expect(first).toMatchObject({ targetId: 99, approach: false, attackHeld: false, moveScale: 0.8 });
    expect(life(3, 5, 600, -1.5)).toEqual(life(3, 5, 600, -1.5));
  });

  test("never holds attack for more than 2 consecutive decisions (30 ticks) and rests the third", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ticks = life(seed, 7, 1200, -1.5);
      let run = 0;
      for (let i = 15; i < ticks.length; i++) {
        run = ticks[i]!.attackHeld ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(30);
      }
    }
  });

  test("pursuit is dropped within the 360 tick give-up window (wander segments occur)", () => {
    let wandered = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const t = life(seed, 3, 900, -1.5);
      if (t.slice(400).some(d => !d.attackHeld && !d.approach && d.targetId === null)) wandered++;
    }
    expect(wandered).toBeGreaterThan(0);
  });
});
