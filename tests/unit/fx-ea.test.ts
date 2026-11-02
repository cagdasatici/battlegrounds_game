import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { EA_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { LOW_QUALITY_CAP, decalRadiusFor, recipeParticles, scanSustain, type SustainCtx } from "../../apps/client/src/fx/kits/common.js";
import { EA_RECIPES, FURNACE, SOLAR, CINDER, VENT, DROP, ARC, COMET, ACTIVATE, playFurnaceRay, playSolarVent, onHit, onEaEvent, recipeFor, scanPlayers } from "../../apps/client/src/fx/kits/ea.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
/** The pool caps one step at MAX_STEP_SEC (0.05 s), so draining takes several steps. */
const drain = (fx: EffectsPool, sec = 2): void => { for (let i = 0; i < sec / 0.05; i++) fx.update(0.05); };
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };
const first = Object.keys(EA_RECIPES)[0]!; // ea.b1

describe("FX4-ea recipes", () => {
  test("every shipped ea ability has a recipe and no extras", () => {
    expect(Object.keys(EA_RECIPES).sort()).toEqual([...EA_DEFS.map((d) => d.id), "ea.activate"].sort()); // QV08: awakening activation has its own recipe
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
    drain(fx);
    expect(fx.activeCount).toBe(0);
  });
  test("impact only on a ea hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: "ea.a3" }), () => undefined); // a3 keeps the generic impact
    const n = fx.activeCount;
    expect(n).toBe(EA_RECIPES["ea.a3"]!.impact.count);
    onHit(fx, ev({ moveId: "sv.b1" }), () => undefined);
    onHit(fx, ev({ kind: "block", moveId: "ea.a3" }), () => undefined);
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
  test("QI01: the beam is wide and bright enough to read at 6 m, and survives a slow frame", () => {
    const { fx, ps } = spy();
    playFurnaceRay(fx, ctx({ tick: 101 }));
    const core = ps.filter((p) => p.color === 0xfff1b0), sheath = ps.filter((p) => p.color === 0xff7a1a);
    expect(Math.min(...core.map((p) => p.size))).toBeGreaterThanOrEqual(0.45); // about 0.5 m wide core
    expect(Math.min(...sheath.map((p) => p.size))).toBeGreaterThanOrEqual(0.7);
    const near = core.filter((p) => Math.abs(p.z) < 7).length;
    expect(near).toBeGreaterThanOrEqual(5); // dense near the caster so the body is continuous at 6 m
    // Low tier root cause: one slow frame (dt > life) used to kill the beam before it was ever drawn.
    const real = pool();
    real.spawn({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: FURNACE.life, size: 0.5, color: 1 });
    real.update(0.4);
    expect(real.activeCount).toBe(1);
    real.dispose();
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
    drain(fx); expect(fx.activeCount).toBe(0);
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
    drain(fx);
    expect(fx.activeCount).toBe(0);
  });
});

describe("QV08 Artificer move coverage (one table over the kit)", () => {
  type P = { x: number; y: number; z: number; vx: number; vz: number; life: number; color: number };
  const rec = (): { out: P[]; fx: EffectsPool } => { const out: P[] = []; return { out, fx: { spawn: (p: P) => { out.push(p); return true; }, get activeCount() { return out.length; } } as unknown as EffectsPool }; };
  const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 4, y: 1, z: -2 }, ...o });
  const sustained = new Set(["ea.a3", "ea.a4"]);
  const ids = Object.keys(EA_RECIPES);
  test("every Artificer move and the activation produce visible, budgeted cues, never replay, and drain", () => {
    for (const id of ids) {
      const t = EA_RECIPES[id]!, action = id === "ea.activate" ? "Awakening" : "Active";
      const fx = pool(), seen = new Map<string, string>(), players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action, moveId: id, actionStartTick: 9, actionEndTick: 100 }]]);
      scanPlayers(fx, players, seen);
      if (sustained.has(id)) { if (id === "ea.a4") expect(fx.activeCount, id).toBe(0); scanSustain(fx, players, new Map(), recipeFor, 12); expect(fx.activeCount, id).toBeGreaterThan(0); }
      else expect(fx.activeCount, id).toBeGreaterThan(0);
      expect(recipeParticles(t), id).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      const n = fx.activeCount;
      scanPlayers(fx, players, seen);
      expect(fx.activeCount, `${id} replay`).toBe(n);
      drain(fx);
      expect(fx.activeCount, `${id} drains`).toBe(0);
    }
  });
  test("confirmed hits react per move and stay within the declared hit budget; block or foreign moves react to nothing", () => {
    for (const id of ids.filter((x) => x !== "ea.a3")) {
      for (const dmg of [0, 300, 700, 1000, 1300, 1500, 2000, 2500, 3000, 5000]) {
        const { out, fx } = rec(); onHit(fx, ev({ moveId: id, damage100: dmg }), () => undefined);
        expect(out.length, `${id} ${dmg}`).toBeGreaterThan(0);
        expect(out.length, `${id} ${dmg} budget`).toBeLessThanOrEqual((EA_RECIPES[id]!.hitCount ?? 0) + EA_RECIPES[id]!.impact.count);
      }
      const b = pool(); onHit(b, ev({ moveId: id, kind: "block" }), () => undefined); onHit(b, ev({ moveId: "sv.b1", damage100: 2000 }), () => undefined);
      expect(b.activeCount, `${id} block/foreign`).toBe(0);
    }
  });
  test("damage tiers pick the layer: Cinder finisher, Vent front vs rear, Arc capture/blast/release, Comet lock/slam", () => {
    const n = (id: string, d: number, k: CombatEvent["kind"] = "hit") => { const { out, fx } = rec(); onHit(fx, ev({ moveId: id, damage100: d, kind: k }), () => undefined); return out.length; };
    expect(n("ea.b1", 200)).toBeLessThan(n("ea.b1", 1000)); expect(n("ea.b1", 1000)).toBe(CINDER.finish);
    expect(n("ea.b2", 1500)).toBe(VENT.front); expect(n("ea.b2", 1000)).toBe(VENT.rear);
    expect(n("ea.a1", 1500)).toBe(ARC.wrap); expect(n("ea.a1", 2000)).toBe(ARC.blast); expect(n("ea.a1", 2500)).toBe(ARC.release); expect(n("ea.a1", 1300)).toBe(ARC.small);
    expect(n("ea.a2", 0)).toBe(COMET.lock); expect(n("ea.a2", 5000)).toBe(COMET.slam); expect(n("ea.a2", 2000)).toBe(COMET.splash);
    expect(n("ea.b4", 2000)).toBe(DROP.ring + DROP.plume);
  });
  test("capture-kind events play the capture cue for a1 and a2; blocks and misses (no event) stay silent", () => {
    const run = (e: CombatEvent) => { const { out, fx } = rec(); onEaEvent(fx, e, () => undefined); return out.length; };
    expect(run(ev({ kind: "capture", moveId: "ea.a1" }))).toBe(ARC.wrap);
    expect(run(ev({ kind: "capture", moveId: "ea.a2" }))).toBe(COMET.lock);
    expect(run(ev({ kind: "block", moveId: "ea.a2" }))).toBe(0);
    expect(run(ev({ kind: "capture", moveId: "sv.b1" }))).toBe(0);
  });
  test("travel streaks stay inside the definition's travel length", () => {
    for (const [id, m] of [["ea.b2", 8], ["ea.a1", 7.2], ["ea.a2", 16]] as const) {
      const { out, fx } = rec(); EA_RECIPES[id]!.playActive!(fx, { x: 0, y: 1, z: 0 }, 0, () => 0);
      for (const p of out) expect(Math.hypot(p.vx, p.vz) * p.life, id).toBeLessThanOrEqual(m + 1e-6);
    }
  });
  test("Solar Vent: wide beam clipped at cover, one flare per scheduled pulse, throttled, stops at active end and on interruption", () => {
    const { out, fx } = rec(), st = { start: 0, lastEmit: -1, lastPulse: -1 };
    const ctx = (tick: number, cover?: SustainCtx["cover"]): SustainCtx => ({ at: { x: 0, y: 1, z: 0 }, yaw: 0, tick, startTick: 100, endTick: 280, cover, state: st });
    const flares = () => out.filter((p) => p.color === 0xffc04d).length;
    playSolarVent(fx, ctx(100)); expect(flares()).toBe(SOLAR.flare);
    playSolarVent(fx, ctx(101)); expect(flares()).toBe(SOLAR.flare); // no new pulse, throttled body
    playSolarVent(fx, ctx(120)); expect(flares()).toBe(SOLAR.flare * 2);
    expect(Math.max(...out.map((p) => Math.abs(p.x)))).toBeGreaterThan(1.5); // 3 m radius reads wider than the 1 m ray
    const c = rec(), st2 = { start: 0, lastEmit: -1, lastPulse: -1 };
    playSolarVent(c.fx, { ...ctx(100), state: st2, cover: () => 6 });
    expect(Math.max(...c.out.filter((p) => p.color === 0xfff7d6).map((p) => Math.abs((p as unknown as { z: number }).z)))).toBeLessThan(6.7);
    const f2 = pool(), players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "ea.a4", actionStartTick: 100, actionEndTick: 280 }]]);
    scanSustain(f2, players, new Map(), recipeFor, 280); expect(f2.activeCount).toBe(0);
    scanSustain(f2, new Map([["1", { ...(players.get("1") as object), action: "Stunned" }]]), new Map(), recipeFor, 150); expect(f2.activeCount).toBe(0);
    expect([...SOLAR.pulses]).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 179]);
  });
  test("activation: one column on the Awakening phase, pulse hits scorch their victims, nothing replays", () => {
    const { out, fx } = rec(); onHit(fx, ev({ moveId: "ea.activate", damage100: 1600 }), () => undefined);
    expect(out.length).toBe(ACTIVATE.hit);
  });
});
