import { describe, expect, test } from "vitest";
import type { BotDecision, BotObservation, BotTacticsObservation, Difficulty } from "../../packages/shared/src/sparring.js";
import { decideBot as decideShaped } from "../../apps/server/src/sim/SparringBrain.js";

/** FB03: these tests pin the raw GR14 rules; the medium shaping layer is covered by fb03-medium-bot.test.ts. */
const decideBot = (...a: [Parameters<typeof decideShaped>[0], Parameters<typeof decideShaped>[1], Parameters<typeof decideShaped>[2]]) => decideShaped(...a, false);
import { ROLE_TABLE, facesWithin60 } from "../../apps/server/src/sim/BotTactics.js";

const neutral: BotDecision = { targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false,
  awaken: false, retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0 };
const KIT_OF = (id: string) => id.slice(0, 2);
const SLOT_OF: Record<string, number> = {};
for (const id of Object.keys(ROLE_TABLE)) SLOT_OF[id] = Number(id[4]);

const tactics = (id: string, over: Partial<BotTacticsObservation> = {}): BotTacticsObservation => {
  const ready: [string, string, string, string] = ["", "", "", ""];
  ready[SLOT_OF[id]! - 1] = id;
  return { kitId: KIT_OF(id), form: id[3] === "a" ? "Awakened" : "Base", grounded: true, readyMoves: ready, chargeSlot: 0, chargeStartTick: 0,
    dashReady: true, routeSafe: () => true, supported: () => true, ...over };
};
// Hard so awakened moves are usable; age is chosen so the first scan slot is the move's own slot (k % 4 = slot - 1).
const tickFor = (slot: number, interval: number) => interval * (4 * 5 + slot - 1);
const observe = (id: string, distance: number, over: { enemy?: Partial<BotObservation["enemies"][number]>; t?: Partial<BotTacticsObservation>; tier?: Difficulty } & Partial<BotObservation> = {}): BotObservation => {
  const { enemy, t, tier, ...rest } = over;
  const interval = tier === "medium" ? 15 : 6;
  return { tick: tickFor(SLOT_OF[id]!, interval), spawnTick: 0, selfId: 1, self: { x: 0, z: 0 }, slotsReady: [true, true, true, true], meterFull: false,
    enemies: [{ id: 2, x: 0, z: -distance, alive: true, connected: true, ready: true, attacking: false, los: true, facingSelf: false, ...enemy }],
    tactics: tactics(id, t), ...rest };
};

const EXTRA_OK: Record<string, Parameters<typeof observe>[2]> = {
  // The hard defensive dash outranks counters on odd samples, so take it out of the picture here.
  "td.b4": { enemy: { attacking: true, facingSelf: true }, t: { dashReady: false } },
  "sv.a1": { enemy: { attacking: true, facingSelf: true }, t: { dashReady: false } },
};

describe("GR14 role table", () => {
  test("covers exactly the 24 base and awakened moves of the three kits", () => {
    expect(Object.keys(ROLE_TABLE).sort()).toEqual([
      "ea.a1", "ea.a2", "ea.a3", "ea.a4", "ea.b1", "ea.b2", "ea.b3", "ea.b4",
      "sv.a1", "sv.a2", "sv.a3", "sv.a4", "sv.b1", "sv.b2", "sv.b3", "sv.b4",
      "td.a1", "td.a2", "td.a3", "td.a4", "td.b1", "td.b2", "td.b3", "td.b4"].sort());
  });

  test.each(Object.entries(ROLE_TABLE))("%s casts on both band edges and not outside, needs LOS", (id, role) => {
    const over = EXTRA_OK[id] ?? {};
    const cast = (d: number, o = over) => decideBot("hard", observe(id, d, o), neutral).castSlot;
    expect(cast(role.min + (role.min === 0 ? 0.5 : 0)), `${id} min`).toBe(SLOT_OF[id]);
    expect(cast(role.max), `${id} max`).toBe(SLOT_OF[id]);
    expect(cast(role.max + 0.001), `${id} above`).toBe(0);
    if (role.min > 0) expect(cast(role.min - 0.001), `${id} below`).toBe(0);
    // No line of sight: no cast, even in band.
    expect(cast(role.max, { ...over, enemy: { ...over.enemy, los: false } }), `${id} LOS`).toBe(0);
  });

  test("counter moves need an attacking target facing the bot; routed and supported moves need their condition", () => {
    for (const id of ["td.b4", "sv.a1"]) {
      expect(decideBot("hard", observe(id, 2, { enemy: { attacking: false, facingSelf: true }, t: { dashReady: false } }), neutral).castSlot).toBe(0);
      expect(decideBot("hard", observe(id, 2, { enemy: { attacking: true, facingSelf: false }, t: { dashReady: false } }), neutral).castSlot).toBe(0);
      expect(decideBot("hard", observe(id, 2, { enemy: { attacking: true, facingSelf: true }, t: { dashReady: false } }), neutral).castSlot).toBe(SLOT_OF[id]);
    }
    for (const id of ["td.a4", "ea.b2", "ea.a1", "ea.a2"]) {
      const d = ROLE_TABLE[id]!.min + 0.5;
      expect(decideBot("hard", observe(id, d), neutral).castSlot).toBe(SLOT_OF[id]);
      expect(decideBot("hard", observe(id, d, { t: { routeSafe: () => false } }), neutral).castSlot, `${id} route`).toBe(0);
    }
    expect(decideBot("hard", observe("ea.b4", 4, { t: { grounded: false } }), neutral).castSlot).toBe(0);
    expect(decideBot("hard", observe("ea.b4", 4, { t: { supported: () => false } }), neutral).castSlot).toBe(0);
  });

  test("facing cone is 60 degrees inclusive", () => {
    const bot = { x: 0, z: 0 }, enemy = { x: 0, z: -4 }; // enemy faces -Z (yaw 0) toward the bot at +Z? bot is behind it
    expect(facesWithin60(Math.PI, enemy, bot)).toBe(true); // yaw pi faces +Z, toward the bot
    expect(facesWithin60(0, enemy, bot)).toBe(false);
    expect(facesWithin60(Math.PI + Math.PI / 3 - 1e-6, enemy, bot)).toBe(true);
    expect(facesWithin60(Math.PI + Math.PI / 3 + 1e-3, enemy, bot)).toBe(false);
  });
});

describe("GR14 difficulty rules", () => {
  test("medium never uses awakened moves; hard does; easy never awakens, dashes or holds", () => {
    const id = "sv.a2", d = 8;
    expect(decideBot("medium", observe(id, d, { tier: "medium", tick: 15 * 20 }), neutral).castSlot).toBe(0);
    expect(decideBot("hard", observe(id, d), neutral).castSlot).toBe(2);
    for (const tick of [30, 60, 90, 120]) {
      expect(decideBot("easy", { ...observe("sv.b1", 1), tick, spawnTick: 0 }, neutral)).toMatchObject({ dash: false, awaken: false, holdSlot: 0 });
    }
  });

  test("medium uses base slot 3 and 4 moves now", () => {
    expect(decideBot("medium", observe("sv.b4", 1, { tier: "medium" }), neutral).castSlot).toBe(4);
    expect(decideBot("medium", observe("td.b3", 1, { tier: "medium" }), neutral).castSlot).toBe(3);
  });

  test("once-used and cooling moves are excluded because they are not in readyMoves", () => {
    const o = observe("sv.b1", 1, { t: { readyMoves: ["", "", "", ""] } });
    const r = decideBot("hard", o, neutral);
    expect(r.castSlot).toBe(0);
    expect(r.attackHeld).toBe(true); // M1 fallback within 2 m
  });

  test("deterministic scan: cyclic from 1 + k % 4", () => {
    const both = { ...tactics("sv.b1"), readyMoves: ["sv.b1", "sv.b2", "", ""] as [string, string, string, string] };
    const at = (k: number) => decideBot("hard", { ...observe("sv.b1", 1), tick: 6 * k, tactics: both }, neutral).castSlot;
    expect([at(4), at(5), at(6), at(7)]).toEqual([1, 2, 1, 1]);
  });

  test("hard dash only when available; awakening needs full meter, grounded, Base and enemy within 6 m", () => {
    const attacker = { enemy: { attacking: true, facingSelf: false } };
    expect(decideBot("hard", observe("sv.b1", 2, { ...attacker, tick: 30 }), neutral)).toMatchObject({ dash: true, retreat: true });
    expect(decideBot("hard", observe("sv.b1", 2, { ...attacker, tick: 30, t: { dashReady: false } }), neutral).dash).toBe(false);
    const full = { meterFull: true };
    expect(decideBot("medium", observe("sv.b1", 6, { ...full, tier: "medium" }), neutral).awaken).toBe(true);
    expect(decideBot("medium", observe("sv.b1", 6.01, { ...full, tier: "medium" }), neutral).awaken).toBe(false);
    expect(decideBot("medium", observe("sv.b1", 3, { ...full, tier: "medium", t: { grounded: false } }), neutral).awaken).toBe(false);
  });

  test("guard when an incoming attack finds no castable close move; no cast through a wall", () => {
    const o = observe("sv.b1", 1, { tier: "medium", enemy: { attacking: true, los: false }, t: { readyMoves: ["", "", "", ""] } });
    expect(decideBot("medium", o, neutral)).toMatchObject({ blockHeld: true, castSlot: 0, attackHeld: false });
    const wall = observe("sv.b1", 1, { tier: "medium", enemy: { los: false } });
    expect(decideBot("medium", wall, neutral)).toMatchObject({ castSlot: 0, attackHeld: false });
  });

  test("preferred distances: Ember keeps 8 m with the orb ready, closes to 2 m otherwise", () => {
    const orb = (d: number, ready = true) => decideBot("hard", observe("ea.b3", d, { t: ready ? {} : { readyMoves: ["", "", "", ""] } }), neutral);
    expect(orb(12).castSlot).toBe(3); // 5-16 m band
    const noCast = (d: number) => decideBot("hard", observe("ea.b3", d, { t: { readyMoves: ["", "", "", ""] }, tick: 6 * 20 }), neutral);
    expect(noCast(8).approach).toBe(true);
    expect(noCast(3).approach).toBe(true);
    // Orb ready but target outside its band (>16 m): approach to 8 m.
    expect(decideBot("hard", observe("ea.b3", 20, { tick: 6 * 22 }), neutral).approach).toBe(true);
    expect(decideBot("hard", observe("ea.b3", 4.9, { tick: 6 * 22, t: {} }), neutral)).toMatchObject({ retreat: true, castSlot: 0 });
    expect(orb(10, false).approach).toBe(true);
  });

  test("deterministic: same observations, same decisions", () => {
    const run = () => JSON.stringify(Array.from({ length: 120 }, (_, i) => decideBot("hard", observe("ea.a3", 3 + (i % 20), { tick: 6 * (i + 1) }), neutral)));
    expect(run()).toBe(run());
  });
});

describe("GR14 Ember Orb charge", () => {
  const start = 600;
  // A bot that committed the orb at `start` and has held ever since.
  const holding = (tier: Difficulty, over: Partial<BotObservation["enemies"][number]> = {}, t: Partial<BotTacticsObservation> = {}) => {
    const interval = tier === "medium" ? 15 : 6;
    const tick0 = start - (start % interval);
    const first = decideBot(tier, { ...observe("ea.b3", 10, { tier }), tick: tick0 || interval, ...{} }, neutral);
    return { first, over, t, interval };
  };

  test("starts with one skillDown and holds slot 3 on the same decision", () => {
    const { first } = holding("hard");
    expect(first).toMatchObject({ castSlot: 3, holdSlot: 3 });
  });

  test.each<[Difficulty, number]>([["medium", 60], ["hard", 180]])("%s releases after %i ticks and no earlier", (tier, hold) => {
    let prev = decideBot(tier, observe("ea.b3", 10, { tier, tick: start }), neutral);
    expect(prev.holdSlot).toBe(3);
    let releasedAt = -1;
    for (let tick = start + 1; tick <= start + 200 && releasedAt < 0; tick++) {
      prev = decideBot(tier, { ...observe("ea.b3", 10, { tier, tick, t: { chargeSlot: 3, chargeStartTick: start } }) }, prev);
      expect(prev.castSlot).toBe(0);
      if (prev.releaseSlot === 3) { releasedAt = tick; expect(prev.holdSlot).toBe(0); } else expect(prev.holdSlot).toBe(3);
    }
    expect(releasedAt).toBe(start + hold);
    expect(releasedAt - start).toBeLessThanOrEqual(186);
  });

  test("target lost, 30 ticks without line of sight, and interruption clear the hold", () => {
    const hold = () => decideBot("hard", observe("ea.b3", 10, { tick: start }), neutral);
    const at = (prev: BotDecision, tick: number, enemy: Partial<BotObservation["enemies"][number]>, t: Partial<BotTacticsObservation> = {}) =>
      decideBot("hard", observe("ea.b3", 10, { tick, enemy, t: { chargeSlot: 3, chargeStartTick: start, ...t } }), prev);
    // LOS lost for 29 ticks keeps charging, the 30th releases (partial shot).
    let prev = hold();
    for (let i = 1; i <= 29; i++) { prev = at(prev, start + i, { los: false }); expect(prev).toMatchObject({ holdSlot: 3, releaseSlot: 0 }); }
    prev = at(prev, start + 30, { los: false });
    expect(prev).toMatchObject({ holdSlot: 0, releaseSlot: 3 });
    // LOS regained resets the counter.
    prev = hold();
    for (let i = 1; i <= 20; i++) prev = at(prev, start + i, { los: false });
    prev = at(prev, start + 21, { los: true });
    expect(prev).toMatchObject({ holdSlot: 3, losLost: 0 });
    // Target dies: release.
    expect(at(hold(), start + 1, { alive: false })).toMatchObject({ holdSlot: 0, releaseSlot: 3, targetId: null });
    // Interrupted (server cast gone): clear hold, no release edge for a cast that no longer exists.
    const cleared = decideBot("hard", observe("ea.b3", 10, { tick: start + 1, t: { chargeSlot: 0 } }), hold());
    expect(cleared.holdSlot).toBe(0);
    expect(cleared.releaseSlot).toBe(0);
    expect(cleared.castSlot).toBe(0);
  });

  test("a rejected press (cooldown) leaves no stale hold on the next tick", () => {
    const prev = decideBot("hard", observe("ea.b3", 10, { tick: start }), neutral);
    const next = decideBot("hard", observe("ea.b3", 10, { tick: start + 1, t: { chargeSlot: 0, readyMoves: ["", "", "", ""] } }), prev);
    expect(next.holdSlot).toBe(0);
  });
});
