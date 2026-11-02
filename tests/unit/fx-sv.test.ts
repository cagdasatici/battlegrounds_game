import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { SV_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { LOW_QUALITY_CAP, decalRadiusFor, recipeParticles, scanSustain, type SustainCtx } from "../../apps/client/src/fx/kits/common.js";
import { ACTIVATE, FAULT_FOOTPRINT, FAULT_HIT, FAULT_LAYERS, FLURRY, GALE, HORIZON, ORBIT, REVERSAL, SKYBREAK, SV_RECIPES, URN, duePulse, onHit, playFaultStrike, recipeFor, scanPlayers } from "../../apps/client/src/fx/kits/sv.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
/** The pool caps one step at MAX_STEP_SEC (0.05 s), so draining takes several steps. */
const drain = (fx: EffectsPool, sec = 2): void => { for (let i = 0; i < sec / 0.05; i++) fx.update(0.05); };
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };
const first = "sv.x1"; // a move with the generic impact (no custom hit reaction)

describe("FX4-sv recipes", () => {
  test("every shipped sv ability has a recipe and no extras", () => {
    expect(Object.keys(SV_RECIPES).sort()).toEqual([...SV_DEFS.map((d) => d.id), "sv.activate"].sort()); // QV06: awakening activation has its own recipe
    expect(recipeFor("td.b1")).toBeUndefined();
  });
  test("each recipe fits the low-quality cap and the low pool", () => {
    for (const t of Object.values(SV_RECIPES)) {
      expect(recipeParticles(t)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      expect(LOW_QUALITY_CAP).toBeLessThanOrEqual(POOL_CAPACITY.low);
    }
  });
  test("windup decal is sized from the ability shape", () => {
    for (const d of SV_DEFS) expect(SV_RECIPES[d.id]!.windup.decalRadius).toBe(decalRadiusFor(SV_DEFS, d.id));
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
  test("impact only on a sv hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: first }), () => undefined);
    const n = fx.activeCount;
    expect(n).toBe(SV_RECIPES[first]!.impact.count);
    onHit(fx, ev({ moveId: "td.b1" }), () => undefined);
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

describe("QV03 Fault Strike signature", () => {
  type P = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number; color: number };
  const capture = (yaw: number, surface: (x: number, z: number, y: number) => number | null = (_x, _z, y) => y - 0.9): P[] => {
    const out: P[] = [];
    playFaultStrike({ spawn: (p: P) => { out.push(p); return true; } } as unknown as EffectsPool, { x: 5, y: 0.9, z: -3 }, yaw, surface);
    return out;
  };
  const toLocal = (p: { x: number; z: number }, yaw: number): { f: number; l: number } => {
    const dx = -Math.sin(yaw), dz = -Math.cos(yaw); // forwardOf convention checked below
    return { f: (p.x - 5) * dx + (p.z + 3) * dz, l: (p.x - 5) * -dz + (p.z + 3) * dx };
  };
  test("three distinct layers fit the recipe budget and the low pool", () => {
    const ps = capture(0.7);
    expect(ps.length).toBe(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    expect(ps.length).toBeLessThanOrEqual(SV_RECIPES["sv.b1"]!.active.count);
    expect(recipeParticles(SV_RECIPES["sv.b1"]!)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
    const colors = new Set(ps.map((p) => p.color));
    expect(colors.size).toBe(3);
    const life = (c: number) => ps.filter((p) => p.color === c).map((p) => p.life);
    const [crack, chip, frag] = [...colors].map((c) => Math.max(...life(c)));
    expect(new Set([crack, chip, frag]).size).toBe(3); // three distinct lifetimes
    expect(frag!).toBeGreaterThan(Math.max(crack!, chip!)); // settling outlasts contact and chips
  });
  test("every fragment and chip end point stays inside the wave footprint, on all headings", () => {
    for (const yaw of [0, 0.7, 2, -2.4, Math.PI]) {
      const fwdSign = Math.abs(toLocal({ x: 5 + -Math.sin(yaw), z: -3 + -Math.cos(yaw) }, yaw).f - 1) < 1e-9 ? 1 : -1;
      for (const p of capture(yaw)) {
        const t = p.vx === 0 && p.vz === 0 ? 0 : p.life;
        const end = toLocal({ x: p.x + p.vx * t, z: p.z + p.vz * t }, yaw);
        const f = end.f * fwdSign;
        expect(f).toBeGreaterThanOrEqual(FAULT_FOOTPRINT.impactAt - 1e-6);
        expect(f).toBeLessThanOrEqual(FAULT_FOOTPRINT.forward + 1e-6);
        expect(Math.abs(end.l)).toBeLessThanOrEqual(FAULT_FOOTPRINT.halfWidth);
      }
    }
  });
  test("chips split to both sides of the heading", () => {
    const sides = new Set(capture(0).filter((p) => p.vx !== 0).map((p) => Math.sign(p.vx)));
    expect(sides.size).toBe(2);
  });
  test("nothing spawns when the impact point has no surface (void)", () => {
    expect(capture(0, () => null).length).toBe(0);
    // Void only beyond the impact: chips and crack remain, the unsupported fragments are skipped.
    const partial = capture(0, (_x, z, y) => (z < -3 - 5 ? null : y - 0.9));
    expect(partial.length).toBeLessThan(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    expect(partial.length).toBeGreaterThanOrEqual(FAULT_LAYERS.crack + FAULT_LAYERS.chips);
  });
  test("sv.b1 Active uses it, other moves keep the generic style, and the pool drains", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "sv.b1", actionStartTick: 9 }]]), seen);
    expect(fx.activeCount).toBe(FAULT_LAYERS.crack + FAULT_LAYERS.chips + FAULT_LAYERS.settle);
    drain(fx);
    expect(fx.activeCount).toBe(0);
    expect(SV_RECIPES["sv.b2"]!.playActive).toBeUndefined();
  });
});

describe("QV06 Vanguard move coverage (one table over the kit)", () => {
  type P = { x: number; y: number; z: number; vx: number; vz: number; life: number; color: number };
  const rec = (): { out: P[]; fx: EffectsPool } => { const out: P[] = []; return { out, fx: { spawn: (p: P) => { out.push(p); return true; } } as unknown as EffectsPool }; };
  const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 4, y: 1, z: -2 }, ...o });
  const sustained = new Set(["sv.b2", "sv.a3"]);
  // Moves that play something at the replicated start of their phase (Active, or Awakening for the activation).
  const ids = Object.keys(SV_RECIPES);
  test("every Vanguard move and the activation produce visible, budgeted cues", () => {
    for (const id of ids) {
      const t = SV_RECIPES[id]!, action = id === "sv.activate" ? "Awakening" : "Active";
      const fx = pool(), seen = new Map<string, string>(), players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action, moveId: id, actionStartTick: 9, actionEndTick: 100 }]]);
      scanPlayers(fx, players, seen);
      if (sustained.has(id)) { expect(fx.activeCount, id).toBe(0); const st = new Map<string, SustainCtx["state"]>(); scanSustain(fx, players, st, recipeFor, 9 + 3); expect(fx.activeCount, id).toBeGreaterThan(0); }
      else expect(fx.activeCount, id).toBeGreaterThan(0);
      expect(recipeParticles(t), id).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      scanPlayers(fx, players, seen); // duplicate event: the same action start does not replay
      drain(fx);
      expect(fx.activeCount, `${id} drains`).toBe(0);
    }
  });
  test("moves with a hit reaction react only to a confirmed hit with their own id", () => {
    for (const id of ["sv.b1", "sv.a1", "sv.a4", "sv.x2", "sv.x3"]) {
      const a = pool(); onHit(a, ev({ moveId: id, damage100: 2000 }), () => undefined);
      expect(a.activeCount, id).toBeGreaterThan(0);
      const b = pool(); onHit(b, ev({ moveId: id, kind: "block" }), () => undefined); onHit(b, ev({ moveId: "td.b1" }), () => undefined);
      expect(b.activeCount, `${id} block/foreign`).toBe(0);
    }
  });
  test("capture hits (0 damage) differ from release hits for a4 and x2", () => {
    const n = (id: string, dmg: number) => { const fx = pool(); onHit(fx, ev({ moveId: id, damage100: dmg }), () => undefined); return fx.activeCount; };
    expect(n("sv.a4", 0)).toBe(ORBIT.capture); expect(n("sv.a4", 10000)).toBe(ORBIT.release);
    expect(n("sv.x2", 0)).toBe(GALE.pin); expect(n("sv.x2", 4000)).toBe(GALE.release);
  });
  test("Fault Strike hit flash is drawn at the victim (carried QI01 item), big and bright", () => {
    const { out, fx } = rec();
    onHit(fx, ev({ moveId: "sv.b1", position: { x: 4, y: 1, z: -2 } }), () => undefined);
    expect(out.length).toBe(FAULT_HIT.flash + FAULT_HIT.sparks);
    expect(out.slice(0, FAULT_HIT.flash).every((p) => p.x === 4 && p.z === -2 && p.life >= 0.45)).toBe(true);
  });
  test("Skybreak chips end inside the 20 x 24 box on any heading", () => {
    for (const yaw of [0, 1.1, -2.2]) {
      const { out, fx } = rec(); SV_RECIPES["sv.a2"]!.playActive!(fx, { x: 0, y: 1, z: 0 }, yaw, (_x, _z, y) => y);
      expect(out.length).toBe(SKYBREAK.lanes * SKYBREAK.ranks);
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      for (const p of out) { const ex = p.vx * p.life, ez = p.vz * p.life, f = ex * dx + ez * dz, l = ex * -dz + ez * dx; expect(f).toBeLessThanOrEqual(SKYBREAK.length); expect(f).toBeGreaterThan(0); expect(Math.abs(l)).toBeLessThanOrEqual(SKYBREAK.width / 2); }
    }
  });
  test("Gravel Flurry fires one volley per scheduled hit tick, never twice, and stays in reach", () => {
    const { out, fx } = rec(), state = { start: 0, lastEmit: -1, lastPulse: -1 };
    const ctx = (tick: number): SustainCtx => ({ at: { x: 0, y: 1, z: 0 }, yaw: 0, tick, startTick: 100, endTick: 140, cover: undefined, state });
    const emit = (tick: number) => { const before = out.length; SV_RECIPES["sv.b2"]!.sustain!(fx, ctx(tick)); return out.length - before; };
    expect(emit(99)).toBe(0);
    expect(emit(100)).toBe(5); expect(emit(100)).toBe(0); expect(emit(107)).toBe(0); expect(emit(108)).toBe(5);
    expect(emit(139)).toBeGreaterThan(5); // the finisher volley is heavier (skips ahead to the last due pulse)
    expect(FLURRY.offsets.length).toBe(6);
    for (const p of out) expect(Math.hypot(p.vx, p.vz) * p.life).toBeLessThanOrEqual(FLURRY.reach + 1e-6);
    expect(duePulse({ ...ctx(139), state: { start: 0, lastEmit: -1, lastPulse: 5 } }, FLURRY.offsets)).toBe(-1);
  });
  test("Horizon Break is clipped at cover, re-emits every 3 ticks and stops at active end", () => {
    const { out, fx } = rec(), state = { start: 9, lastEmit: -1, lastPulse: -1 };
    const ctx = (tick: number, cover?: SustainCtx["cover"]): SustainCtx => ({ at: { x: 0, y: 1, z: 0 }, yaw: 0, tick, startTick: 9, endTick: 15, cover, state });
    const run = (tick: number, cover?: SustainCtx["cover"]) => SV_RECIPES["sv.a3"]!.sustain!(fx, ctx(tick, cover));
    run(9, () => 10);
    const reach = Math.max(...out.map((p) => Math.hypot(p.x, p.z)));
    expect(reach).toBeLessThan(10 + 3 + 0.7); // clipped near the 10 m cover (sheath is sideways)
    const n1 = out.length; run(10, () => 10); expect(out.length).toBe(n1); // within the 3 tick gap
    run(12, () => 10); expect(out.length).toBe(n1 * 2);
    const before = out.length; run(15, () => 0); run(18, () => 0); expect(out.length).toBe(before); // blocked at the muzzle: nothing
    expect(HORIZON.length).toBe(32);
    // The sustain driver drops state once the replicated phase ends.
    const players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "sv.a3", actionStartTick: 9, actionEndTick: 15 }]]);
    const st = new Map<string, SustainCtx["state"]>(); const p = pool();
    scanSustain(p, players, st, recipeFor, 14); expect(st.size).toBe(1);
    scanSustain(p, players, st, recipeFor, 15); expect(st.size).toBe(0);
    players.set("1", { x: 0, y: 90, z: 0, action: "Stunned", moveId: "sv.a3", actionStartTick: 9, actionEndTick: 99 });
    scanSustain(p, players, st, recipeFor, 10); expect(st.size).toBe(0);
  });
  test("activation and urn budgets match their constants", () => {
    const fx = pool(); scanPlayers(fx, new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Awakening", moveId: "sv.activate", actionStartTick: 1 }]]), new Map());
    expect(fx.activeCount).toBe(ACTIVATE.column + ACTIVATE.ring + ACTIVATE.glow);
    expect(URN.shards).toBe(16); expect(REVERSAL.hit).toBeGreaterThan(0);
    // Other kits' awakening is ignored by the Vanguard table.
    const f2 = pool(); scanPlayers(f2, new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Awakening", moveId: "td.activate", actionStartTick: 1 }]]), new Map());
    expect(f2.activeCount).toBe(0);
  });
});
