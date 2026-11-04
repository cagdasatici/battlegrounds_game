import { describe, expect, test } from "vitest";
import type { BotDecision, BotObservation, Difficulty } from "../../packages/shared/src/sparring.js";
import { decideBot } from "../../apps/server/src/sim/SparringBrain.js";

const neutral: BotDecision = {
  targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false, awaken: false, retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0,
};
const enemy = (id = 2, x = 0, z = -2): BotObservation["enemies"][number] => ({
  id, x, z, alive: true, connected: true, ready: true, attacking: false,
});
const observe = (overrides: Partial<BotObservation> = {}): BotObservation => ({
  tick: 30, spawnTick: 0, selfId: 1, self: { x: 0, z: 0 }, slotsReady: [true, true, true, true], meterFull: false,
  enemies: [enemy()], ...overrides,
});

describe("BOT1 deterministic sparring brain", () => {
  test.each<[Difficulty, number]>([["easy", 30], ["medium", 15], ["hard", 6]])(
    "%s waits a full interval on each life and samples relative to spawn", (tier, interval) => {
      const stale = { ...neutral, targetId: 2, approach: true, attackHeld: true, castSlot: 1 as const, dash: true, awaken: true, retreat: true, yaw: 1, holdSlot: 0, releaseSlot: 0, losLost: 0 };
      for (const spawnTick of [0, 101]) {
        for (let age = 0; age < interval; age++) {
          expect(decideBot(tier, observe({ spawnTick, tick: spawnTick + age }), stale)).toEqual(neutral);
        }
        expect(decideBot(tier, observe({ spawnTick, tick: spawnTick + interval }), neutral).targetId).toBe(2);
      }
    },
  );

  test("nearest eligible target uses numeric ID ties regardless of roster order", () => {
    const enemies = [enemy(10, 1, 0), enemy(2, -1, 0), enemy(3, 8, 0), enemy(1, 0, 0),
      { ...enemy(4, 0, 0), alive: false }, { ...enemy(5, 0, 0), connected: false },
      { ...enemy(6, 0, 0), ready: false }];
    for (const ordered of [enemies, [...enemies].reverse()]) {
      expect(decideBot("easy", observe({ enemies: ordered }), neutral).targetId).toBe(2);
    }
    expect(decideBot("easy", observe({ enemies: [enemy(8, 1, 0), enemy(2, 2, 0)] }), neutral).targetId).toBe(8);
  });

  test.each([1.999, 2, 2.001])("attack/approach boundary at %s metres", distance => {
    const result = decideBot("medium", observe({ slotsReady: [false, false, false, false], enemies: [enemy(2, 0, -distance)] }), neutral);
    expect(result.attackHeld).toBe(distance <= 2);
    expect(result.approach).toBe(distance > 2);
    expect(result.blockHeld).toBe(false);
  });

  test.each(["medium", "hard"] as const)("%s guard and cast priority", tier => {
    for (const distance of [2, 2.001, 3, 3.001]) {
      const tick = tier === "hard" ? 36 : 30; // hard: even decision index guards, odd dashes
      const result = decideBot(tier, observe({ tick, enemies: [{ ...enemy(2, 0, -distance), attacking: true }] }), neutral);
      const guards = distance <= 3;
      expect(result.blockHeld).toBe(guards);
      expect(result.attackHeld).toBe(!guards && distance <= 2);
      expect(result.approach).toBe(!guards && distance > 2);
      expect(result.castSlot).toBe(0);
    }
  });

  test("casts only when ready and in range", () => {
    for (const tier of ["medium", "hard"] as const) {
      for (const ready of [false, true]) {
        for (const distance of [0, 2, 2.001]) {
          const slotsReady = [ready, ready, ready, ready] as const;
          const tick = 30;
          const result = decideBot(tier, observe({ tick, slotsReady, enemies: [enemy(2, 0, -distance)] }), neutral);
          const casts = ready && distance <= 2;
          expect(result.castSlot > 0).toBe(casts);
          expect(result.attackHeld).toBe(distance <= 2 && !casts);
        }
      }
    }
  });

  test("hard attacked at distance 2: odd k dashes and retreats, even k blocks", () => {
    const attacker = [{ ...enemy(2, 0, -2), attacking: true }];
    const odd = decideBot("hard", observe({ tick: 30, enemies: attacker }), neutral); // k = 5
    expect(odd).toMatchObject({ dash: true, retreat: true, blockHeld: false, approach: false });
    const even = decideBot("hard", observe({ tick: 36, enemies: attacker }), neutral); // k = 6
    expect(even).toMatchObject({ blockHeld: true, dash: false, retreat: false });
  });

  test("hard rotates the first ready slot by decision index", () => {
    const slotsReady = [false, true, true, false] as const;
    expect(decideBot("hard", observe({ tick: 24, slotsReady }), neutral).castSlot).toBe(2); // k = 4 -> start slot 1
    expect(decideBot("hard", observe({ tick: 12, slotsReady }), neutral).castSlot).toBe(3); // k = 2 -> start slot 3
  });

  test("medium never casts slot 3 or 4; easy never dashes or awakens", () => {
    for (let tick = 15; tick <= 300; tick += 15) {
      const m = decideBot("medium", observe({ tick, slotsReady: [false, false, true, true] }), neutral);
      expect(m.castSlot).toBe(0);
      const m2 = decideBot("medium", observe({ tick, slotsReady: [true, true, true, true] }), neutral);
      expect([1, 2]).toContain(m2.castSlot);
    }
    for (let tick = 30; tick <= 600; tick += 30) {
      const e = decideBot("easy", observe({ tick, meterFull: true, enemies: [{ ...enemy(2, 0, -1), attacking: true }] }), neutral);
      expect(e).toMatchObject({ dash: false, awaken: false });
    }
  });

  test("awaken needs a full meter within 6 metres on medium and hard", () => {
    for (const tier of ["medium", "hard"] as const) {
      expect(decideBot(tier, observe({ meterFull: true, enemies: [enemy(2, 0, -5)] }), neutral).awaken).toBe(true);
      expect(decideBot(tier, observe({ meterFull: true, enemies: [enemy(2, 0, -7)] }), neutral).awaken).toBe(false);
      expect(decideBot(tier, observe({ meterFull: false, enemies: [enemy(2, 0, -5)] }), neutral).awaken).toBe(false);
    }
  });

  test("same observation sequence yields byte-identical decisions", () => {
    const run = () => {
      let previous = neutral;
      return JSON.stringify(Array.from({ length: 200 }, (_, tick) => {
        previous = decideBot("hard", observe({ tick, meterFull: tick % 7 === 0,
          enemies: [{ ...enemy(2, 0, -(tick % 5)), attacking: tick % 3 === 0 }] }), previous);
        return previous;
      }));
    };
    expect(run()).toBe(run());
  });

  test("between samples holds pose/flags and clears the skill edge", () => {
    const previous = decideBot("hard", observe(), neutral);
    expect(previous.castSlot).toBeGreaterThan(0);
    const changed = observe({ tick: 31, enemies: [{ ...enemy(2, 9, 9), attacking: true }, enemy(3, 0, 0)] });
    const held = decideBot("hard", changed, previous);
    expect(held).toEqual({ ...previous, castSlot: 0, dash: false, awaken: false });
    expect(decideBot("hard", { ...changed, tick: 32 }, held)).toEqual(held);
    expect(previous.castSlot).toBeGreaterThan(0);
  });

  test.each(["attack", "guard", "approach"] as const)("holds %s until the next sample", mode => {
    const previous = decideBot("medium", observe({
      slotsReady: [false, false, false, false],
      enemies: [{ ...enemy(2, 0, mode === "approach" ? -4 : -2), attacking: mode === "guard" }],
    }), neutral);
    expect(previous.attackHeld).toBe(mode === "attack");
    expect(previous.blockHeld).toBe(mode === "guard");
    expect(previous.approach).toBe(mode === "approach");
    for (let tick = 31; tick < 45; tick++) {
      expect(decideBot("medium", observe({ tick, enemies: [enemy(2, 4, 4)] }), previous)).toEqual(previous);
    }
    expect(decideBot("medium", observe({ tick: 45, enemies: [enemy(2, 4, 4)] }), previous))
      .toMatchObject({ approach: true, attackHeld: false, blockHeld: false });
  });

  test.each(["alive", "connected", "ready"] as const)("lost target %s resets immediately and waits to retarget", flag => {
    const previous = decideBot("easy", observe(), neutral);
    const enemies = [{ ...enemy(), [flag]: false }, enemy(3, 0, -1)];
    expect(decideBot("easy", observe({ tick: 31, enemies }), previous)).toEqual(neutral);
    expect(decideBot("easy", observe({ tick: 32, enemies }), neutral)).toEqual(neutral);
    expect(decideBot("easy", observe({ tick: 60, enemies }), neutral).targetId).toBe(3);
  });

  test("missing target and empty roster are neutral", () => {
    const previous = decideBot("easy", observe(), neutral);
    for (const tick of [31, 60]) {
      expect(decideBot("easy", observe({ tick, enemies: [] }), previous)).toEqual(neutral);
    }
  });

  test.each([[0, -4, 0], [4, 0, -Math.PI / 2], [-4, 0, Math.PI / 2], [0, 0, 0]])(
    "yaw follows movement convention toward (%s, %s)", (x, z, yaw) => {
      expect(decideBot("easy", observe({ self: { x: 10, z: 20 }, enemies: [enemy(2, x + 10, z + 20)] }), neutral).yaw).toBeCloseTo(yaw);
    },
  );

  test("ordered traces are reproducible with held inputs and single-tick cast edges", () => {
    function trace(tier: Difficulty) {
      let previous = neutral;
      return Array.from({ length: 61 }, (_, tick) => {
        previous = decideBot(tier, observe({ tick }), previous);
        return previous;
      });
    }
    for (const [tier, interval] of [["easy", 30], ["medium", 15], ["hard", 6]] as const) {
      const decisions = trace(tier);
      expect(trace(tier)).toEqual(decisions);
      expect(decisions.map((d, tick) => d.castSlot > 0 ? tick : -1).filter(tick => tick >= 0))
        .toEqual(tier === "hard" ? [6, 12, 18, 24, 30, 36, 42, 48, 54, 60] : tier === "medium" ? [15, 30, 45, 60] : []);
      expect(decisions.slice(0, interval)).toEqual(Array.from({ length: interval }, () => neutral));
      expect(decisions.slice(interval).every(d => d.targetId === 2)).toBe(true);
    }
  });
});
