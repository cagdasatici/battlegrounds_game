import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EA_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { LOW_QUALITY_CAP, decalRadiusFor, recipeParticles, scanSustain, type SustainCtx } from "../../apps/client/src/fx/kits/common.js";
import { EA_RECIPES, FURNACE, playFurnaceRay, onHit, recipeFor, scanPlayers } from "../../apps/client/src/fx/kits/ea.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };
const first = Object.keys(EA_RECIPES)[0]!;

describe("FX4-ea recipes", () => {
  test("every shipped ea ability has a recipe and no extras", () => {
    expect(Object.keys(EA_RECIPES).sort()).toEqual(EA_DEFS.map((d) => d.id).sort());
    expect(recipeFor("sv.b1")).toBeUndefined();
  });
  test("each recipe fits the low-quality cap and the low pool", () => {
    for (const t of Object.values(EA_RECIPES)) {
      expect(recipeParticles(t)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      expect(LOW_QUALITY_CAP).toBeLessThanOrEqual(POOL_CAPACITY.low);
    }
  });
  test("windup decal is sized from the ability shape", () => {
    for (const d of EA_DEFS) expect(EA_RECIPES[d.id]!.windup.decalRadius).toBe(decalRadiusFor(EA_DEFS, d.id));
  });
  test("windup fires once per action start, active once more, and everything expires", () => {
    const fx = pool(), seen = new Map<string, string>();
    const players = new Map<string, unknown>([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: first, actionStartTick: 5 }]]);
    scanPlayers(fx, players, seen);
    const afterWindup = fx.activeCount;
    expect(afterWindup).toBeGreaterThan(0);
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBe(afterWindup);
    players.set("1", { x: 0, y: 0, z: 0, action: "Active", moveId: first, actionStartTick: 15 });
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBeGreaterThan(afterWindup);
    fx.update(2);
    expect(fx.activeCount).toBe(0);
  });
  test("impact only on a ea hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: first }), () => undefined);
    const n = fx.activeCount;
    expect(n).toBe(EA_RECIPES[first]!.impact.count);
    onHit(fx, ev({ moveId: "sv.b1" }), () => undefined);
    onHit(fx, ev({ kind: "block", moveId: first }), () => undefined);
    expect(fx.activeCount).toBe(n);
  });
  test("a vanished player drops its trigger state", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: first }]]), seen);
    expect(seen.size).toBe(1);
    scanPlayers(fx, new Map(), seen);
    expect(seen.size).toBe(0);
  });
});

describe("QV05 Furnace Ray signature", () => {
  type P = { x: number; y: number; z: number; vx: number; life: number; color: number; size: number };
  const spy = (): { fx: EffectsPool; ps: P[] } => { const ps: P[] = []; return { ps, fx: { spawn: (p: P) => { ps.push(p); return true; }, get activeCount() { return ps.length; } } as unknown as EffectsPool }; };
  const ctx = (o: Partial<SustainCtx> = {}): SustainCtx => ({ at: { x: 0, y: 0, z: 0 }, yaw: 0, tick: 100, startTick: 100, endTick: 190, state: { start: 100, lastEmit: -1, lastPulse: -1 }, ...o });
  test("budget fits the low cap", () => { expect(recipeParticles(EA_RECIPES["ea.a3"]!)).toBeLessThanOrEqual(LOW_QUALITY_CAP); });
  test("pulse schedule is the definition's", () => { expect([...FURNACE.pulses]).toEqual([0, 15, 30, 45, 60, 75, 89]); expect(FURNACE.length).toBe(24); });
  test("bright thin core inside a tapering orange sheath along the aim", () => {
    const { fx, ps } = spy();
    playFurnaceRay(fx, ctx({ tick: 101 })); // pulse 0 already flared at tick 100 below; here only the beam body
    const core = ps.filter((p) => p.color === 0xfff1b0), sheath = ps.filter((p) => p.color === 0xff7a1a);
    expect(core.length).toBe(FURNACE.core); expect(sheath.length).toBe(FURNACE.sheath);
    expect(Math.max(...core.map((p) => p.size))).toBeLessThan(Math.min(...sheath.map((p) => p.size)));
    const w = (p: P) => Math.abs(p.x);
    expect(w(sheath[0]!)).toBeGreaterThan(w(sheath[sheath.length - 1]!)); // taper
    expect(core.every((p) => Math.abs(p.x) < 1e-6)).toBe(true);
  });
  test("stops at cover", () => {
    const { fx, ps } = spy();
    playFurnaceRay(fx, ctx({ cover: () => 5 }));
    const zs = ps.filter((p) => p.color === 0xfff1b0).map((p) => Math.abs(p.z));
    expect(Math.max(...zs)).toBeLessThan(5.65);
  });
  test("each pulse tick flares once; emission is throttled", () => {
    const { fx, ps } = spy();
    const c = ctx();
    const flares = () => ps.filter((p) => p.color === 0xffc04d).length;
    playFurnaceRay(fx, c); expect(flares()).toBe(FURNACE.flare);
    c.tick = 101; playFurnaceRay(fx, c); expect(flares()).toBe(FURNACE.flare); // no new pulse; throttled body
    c.tick = 115; playFurnaceRay(fx, c); expect(flares()).toBe(FURNACE.flare * 2);
  });
  test("sustain runs only while Active, ends at active end and on interruption, and drains", () => {
    const fx = pool(), st = new Map<string, SustainCtx["state"]>();
    const p = (o: object) => new Map<string, unknown>([["1", { x: 0, y: 0, z: 0, facingYaw: 0, moveId: "ea.a3", action: "Active", actionStartTick: 100, actionEndTick: 190, ...o }]]);
    scanSustain(fx, p({}), st, recipeFor, 120);
    expect(fx.activeCount).toBeGreaterThan(0); expect(st.size).toBe(1);
    scanSustain(fx, p({ action: "Stunned" }), st, recipeFor, 121); expect(st.size).toBe(0);
    scanSustain(fx, p({}), st, recipeFor, 190); expect(st.size).toBe(0); // active end
    const n = fx.activeCount;
    scanSustain(fx, p({}), st, recipeFor, undefined); expect(fx.activeCount).toBe(n); // no tick, no beam
    fx.update(2); expect(fx.activeCount).toBe(0);
    scanSustain(fx, p({ moveId: "ea.b1" }), st, recipeFor, 120); expect(st.size).toBe(0);
  });
});

describe("EffectsPool live count (found by QV05 browser run)", () => {
  test("many short particles at irregular frame times always drain to zero", () => {
    const fx = pool();
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let f = 0; f < 600; f++) {
      for (let i = 0; i < 16; i++) fx.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0.1, size: 0.1, color: 1 });
      fx.update(0.016 + rnd() * 0.07);
    }
    fx.update(1); fx.update(1);
    expect(fx.activeCount).toBe(0);
  });
});
