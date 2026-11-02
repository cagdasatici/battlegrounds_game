import { describe, expect, test } from "vitest";
import type { Scene } from "three";
import { TD_DEFS } from "../../packages/shared/src/config/kits/td.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { BIND, CAST, CHAIN, DEEPFALL, LOW_QUALITY_CAP, MIRROR, RIPTIDE, SPLIT, TD_RECIPES, UNDERTOW, onHit, onTdEvent, recipeFor, recipeParticles, scanPlayers } from "../../apps/client/src/fx/kits/td.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import { scanSustain, type SustainCtx } from "../../apps/client/src/fx/kits/common.js";

const Scene = function (): Scene { const g = new FighterView("td", makeToonRamp()).group; g.clear(); return g as unknown as Scene; } as unknown as new () => Scene;
/** The pool caps one step at MAX_STEP_SEC (0.05 s), so draining takes several steps. */
const drain = (fx: EffectsPool, sec = 2): void => { for (let i = 0; i < sec / 0.05; i++) fx.update(0.05); };
const pool = (): EffectsPool => { const p = new EffectsPool(); p.configure(new Scene(), "low"); return p; };

describe("FX4-td recipes", () => {
  test("every shipped td ability has a recipe and no extras", () => {
    expect(Object.keys(TD_RECIPES).sort()).toEqual([...TD_DEFS.map((d) => d.id), "td.activate"].sort()); // QV07: awakening activation has its own recipe
    for (const d of TD_DEFS) expect(recipeFor(d.id)).toBeDefined();
    expect(recipeFor("sv.b1")).toBeUndefined();
  });
  test("each recipe fits the low-quality cap and the low pool", () => {
    for (const t of Object.values(TD_RECIPES)) {
      expect(recipeParticles(t)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      expect(LOW_QUALITY_CAP).toBeLessThanOrEqual(POOL_CAPACITY.low);
    }
  });
  test("windup fires once per action start, active once more, and everything expires", () => {
    const fx = pool(), seen = new Map<string, string>();
    const players = new Map<string, unknown>([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: "td.b1", actionStartTick: 5 }]]);
    scanPlayers(fx, players, seen);
    const afterWindup = fx.activeCount;
    expect(afterWindup).toBeGreaterThan(0);
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBe(afterWindup);
    players.set("1", { x: 0, y: 0, z: 0, action: "Active", moveId: "td.b1", actionStartTick: 15 });
    scanPlayers(fx, players, seen);
    expect(fx.activeCount).toBeGreaterThan(afterWindup);
    drain(fx);
    expect(fx.activeCount).toBe(0);
  });
  test("impact only on a td hit and ignores other kinds", () => {
    const fx = pool();
    const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 1, y: 1, z: 1 }, ...o });
    onHit(fx, ev({ moveId: "td.a2", damage100: 2000 }), () => undefined);
    const n = fx.activeCount;
    expect(n).toBe(DEEPFALL.area);
    onHit(fx, ev({ moveId: "sv.b1" }), () => undefined);
    onHit(fx, ev({ kind: "block", moveId: "td.a2" }), () => undefined);
    expect(fx.activeCount).toBe(n);
  });
  test("a vanished player drops its trigger state", () => {
    const fx = pool(), seen = new Map<string, string>();
    scanPlayers(fx, new Map([["1", { x: 0, y: 0, z: 0, action: "Windup", moveId: "td.b2" }]]), seen);
    expect(seen.size).toBe(1);
    scanPlayers(fx, new Map(), seen);
    expect(seen.size).toBe(0);
  });
});

describe("QV04 Undertow Spiral signature", () => {
  const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 100, kind: "hit", actorId: "A", targetId: "B", lifeId: 1, moveId: "td.b2", position: { x: 2.2, y: 1, z: 0 }, ...o });
  const chest = (id: string) => (id === "B" ? undefined : { x: 0, y: 1, z: 0 });
  type P = { x: number; z: number; vx: number; vz: number; life: number; color: number };
  const spy = (): { fx: EffectsPool; ps: P[] } => { const ps: P[] = []; return { ps, fx: { spawn: (p: P) => { ps.push(p); return true; }, get activeCount() { return ps.length; } } as unknown as EffectsPool }; };
  test("budget fits low cap including the hit ribbon", () => {
    expect(recipeParticles(TD_RECIPES["td.b2"]!)).toBeLessThanOrEqual(LOW_QUALITY_CAP);
  });
  test("confirmed capture draws a cyan edge and darker ribbon travelling the 3 m drag away from the caster", () => {
    const { fx, ps } = spy();
    onHit(fx, ev({}), chest);
    expect(ps.length).toBe(UNDERTOW.edge + UNDERTOW.ribbon);
    expect(new Set(ps.map((p) => p.color)).size).toBe(2);
    for (const p of ps) { expect(p.vx).toBeGreaterThan(0); expect(p.vz).toBeCloseTo(0, 6); expect(p.vx * p.life).toBeCloseTo(UNDERTOW.dragM, 6); }
    expect(ps.some((p) => Math.abs(p.z) > 0.2)).toBe(true); // ribbon is curved, not a straight line
  });
  test("the second hit is the slam splash, not another ribbon, and a miss or block draws nothing", () => {
    const { fx, ps } = spy();
    onHit(fx, ev({ eventId: "m", actorId: "M", kind: "block" }), chest);
    onHit(fx, ev({ eventId: "n", actorId: "N", kind: "miss" as never }), chest);
    expect(ps.length).toBe(0);
    onHit(fx, ev({ actorId: "A" }), chest);
    const n = ps.length;
    onHit(fx, ev({ actorId: "A", tick: 148 }), chest);
    expect(ps.length - n).toBe(TD_RECIPES["td.b2"]!.impact.count);
  });
  test("everything expires", () => {
    const fx = pool();
    onHit(fx, ev({ actorId: "Z" }), chest);
    expect(fx.activeCount).toBe(UNDERTOW.edge + UNDERTOW.ribbon);
    drain(fx);
    expect(fx.activeCount).toBe(0);
  });
});

describe("QV07 Duelist move coverage (one table over the kit)", () => {
  type P = { x: number; y: number; z: number; vx: number; vz: number; life: number; color: number };
  const rec = (): { out: P[]; fx: EffectsPool } => { const out: P[] = []; return { out, fx: { spawn: (p: P) => { out.push(p); return true; }, get activeCount() { return out.length; } } as unknown as EffectsPool }; };
  const ev = (o: Partial<CombatEvent>): CombatEvent => ({ eventId: "e", tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, position: { x: 4, y: 1, z: -2 }, ...o });
  const sustained = new Set(["td.a3", "td.a4"]);
  const ids = Object.keys(TD_RECIPES);
  test("every Duelist move and the activation produce visible, budgeted cues, never replay, and drain", () => {
    for (const id of ids) {
      const t = TD_RECIPES[id]!, action = id === "td.activate" ? "Awakening" : "Active";
      const fx = pool(), seen = new Map<string, string>(), players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action, moveId: id, actionStartTick: 9, actionEndTick: 100 }]]);
      scanPlayers(fx, players, seen);
      if (sustained.has(id)) { expect(fx.activeCount, id).toBe(0); scanSustain(fx, players, new Map(), recipeFor, 9 + 3); expect(fx.activeCount, id).toBeGreaterThan(0); }
      else expect(fx.activeCount, id).toBeGreaterThan(0);
      expect(recipeParticles(t), id).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      const n = fx.activeCount;
      scanPlayers(fx, players, seen); // duplicate event: same action start does not replay
      expect(fx.activeCount, `${id} replay`).toBe(n);
      drain(fx);
      expect(fx.activeCount, `${id} drains`).toBe(0);
    }
  });
  test("confirmed hits react per move, a block or a foreign move reacts to nothing", () => {
    for (const id of ids.filter((x) => x !== "td.b2")) {
      for (const dmg of [0, 400, 900, 1600, 2600, 6900]) {
        const a = pool(); onHit(a, ev({ moveId: id, damage100: dmg }), () => undefined);
        expect(a.activeCount, `${id} ${dmg}`).toBeGreaterThan(0);
        expect(recipeParticles(TD_RECIPES[id]!), id).toBeLessThanOrEqual(LOW_QUALITY_CAP);
      }
      const b = pool(); onHit(b, ev({ moveId: id, kind: "block" }), () => undefined); onHit(b, ev({ moveId: "sv.b1", damage100: 2000 }), () => undefined);
      expect(b.activeCount, `${id} block/foreign`).toBe(0);
    }
  });
  test("a hit never draws more than its declared budget", () => {
    for (const id of ids) for (const dmg of [0, 400, 800, 1000, 1600, 2200, 2400, 2600, 6900]) {
      const { out, fx } = rec(); onHit(fx, ev({ moveId: id, damage100: dmg, actorId: `a${id}${dmg}` }), () => undefined);
      expect(out.length, `${id} ${dmg}`).toBeLessThanOrEqual((TD_RECIPES[id]!.hitCount ?? 0) + TD_RECIPES[id]!.impact.count);
    }
  });
  test("Current Bind: capture wraps, strikes pulse, the 8 HP release is the largest", () => {
    const n = (d: number) => { const fx = pool(); onHit(fx, ev({ moveId: "td.b1", damage100: d }), () => undefined); return fx.activeCount; };
    expect(n(0)).toBe(BIND.wrap); expect(n(400)).toBe(BIND.pulse); expect(n(800)).toBe(BIND.surge);
  });
  test("capture-kind events play the move's capture cue; a miss or block-kind and Undertow's first hit are untouched", () => {
    const run = (e: CombatEvent) => { const fx = pool(); onTdEvent(fx, e, () => undefined, () => undefined); return fx.activeCount; };
    expect(run(ev({ kind: "capture", moveId: "td.b3" }))).toBe(CAST.swirl);
    expect(run(ev({ kind: "capture", moveId: "td.a2" }))).toBe(DEEPFALL.column);
    expect(run(ev({ kind: "capture", moveId: "td.b2" }))).toBe(0);
    expect(run(ev({ kind: "block", moveId: "td.b3" }))).toBe(0);
  });
  test("Mirror Current flares only on a confirmed counter against a fighter in the Active stance", () => {
    const run = (who: { action?: string; moveId?: string } | undefined, kind: CombatEvent["kind"] = "counter") => { const fx = pool(); onTdEvent(fx, ev({ kind, moveId: "sv.b1" }), () => ({ x: 0, y: 1, z: 0 }), () => who); return fx.activeCount; };
    expect(run({ action: "Active", moveId: "td.b4" })).toBe(MIRROR.flare);
    expect(run({ action: "Idle", moveId: "td.b4" })).toBe(0); // stance already ended (absorbed or expired)
    expect(run({ action: "Active", moveId: "sv.a1" })).toBe(0);
    expect(run(undefined)).toBe(0);
    expect(run({ action: "Active", moveId: "td.b4" }, "hit")).toBe(0);
  });
  test("elevated Undertow slam (24 HP) is bigger than the ordinary 14 HP slam", () => {
    const slam = (d: number) => { const { out, fx } = rec(); onHit(fx, ev({ moveId: "td.b2", damage100: 500, actorId: `x${d}`, tick: 100 }), () => ({ x: 0, y: 1, z: 0 })); const n0 = out.length; onHit(fx, ev({ moveId: "td.b2", damage100: d, actorId: `x${d}`, tick: 148 }), () => undefined); return out.length - n0; };
    expect(slam(2400) - slam(1400)).toBe(UNDERTOW.landing);
  });
  test("Split Tide fires one probe per scheduled offset, the second heavier, never twice, and stops at active end", () => {
    const { out, fx } = rec(), state = { start: 0, lastEmit: -1, lastPulse: -1 };
    const ctx = (tick: number): SustainCtx => ({ at: { x: 0, y: 1, z: 0 }, yaw: 0, tick, startTick: 100, endTick: 118, cover: undefined, state });
    const emit = (tick: number) => { const b = out.length; TD_RECIPES["td.a3"]!.sustain!(fx, ctx(tick)); return out.length - b; };
    expect(emit(99)).toBe(0); expect(emit(100)).toBe(SPLIT.first); expect(emit(100)).toBe(0); expect(emit(110)).toBe(0); expect(emit(117)).toBe(SPLIT.second); expect(emit(117)).toBe(0);
    for (const p of out) expect(Math.hypot(p.vx, p.vz) * p.life).toBeLessThanOrEqual(SPLIT.reach + 1e-6);
    const players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "td.a3", actionStartTick: 100, actionEndTick: 118 }]]);
    const f2 = pool(); scanSustain(f2, players, new Map(), recipeFor, 118); expect(f2.activeCount).toBe(0);
    scanSustain(f2, new Map([["1", { ...(players.get("1") as object), action: "Stunned" }]]), new Map(), recipeFor, 105); expect(f2.activeCount).toBe(0);
  });
  test("Riptide trail follows movement only: the close branch (no travel) draws just the lunge, interruption draws nothing", () => {
    const st = { start: 0, lastEmit: -1, lastPulse: -1 } as SustainCtx["state"], { out, fx } = rec();
    const ctx = (tick: number, x: number): SustainCtx => ({ at: { x, y: 1, z: 0 }, yaw: 0, tick, startTick: 50, endTick: 80, cover: undefined, state: st });
    const run = (tick: number, x: number) => { const b = out.length; TD_RECIPES["td.a4"]!.sustain!(fx, ctx(tick, x)); return out.length - b; };
    expect(run(50, 0)).toBe(RIPTIDE.lunge);
    expect(run(52, 0)).toBe(0); expect(run(54, 0.001)).toBe(0); // stationary
    expect(run(56, 0.6)).toBe(RIPTIDE.trailPer); expect(run(57, 0.9)).toBe(0); // rate limited
    expect(run(58, 1.2)).toBe(RIPTIDE.trailPer);
    const players = new Map<string, unknown>([["1", { x: 100, y: 90, z: 0, action: "Stunned", moveId: "td.a4", actionStartTick: 50, actionEndTick: 80 }]]);
    const f2 = pool(); scanSustain(f2, players, new Map(), recipeFor, 60); expect(f2.activeCount).toBe(0);
  });
  test("a vanished or dead Duelist drops sustained and trigger state", () => {
    const fx = pool(), seen = new Map<string, string>(), st = new Map<string, SustainCtx["state"]>();
    const p = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0, action: "Active", moveId: "td.a4", actionStartTick: 9, actionEndTick: 100 }]]);
    scanPlayers(fx, p, seen); scanSustain(fx, p, st, recipeFor, 12);
    expect(st.size).toBe(1); scanSustain(fx, new Map(), st, recipeFor, 13); scanPlayers(fx, new Map(), seen);
    expect(st.size).toBe(0); expect(seen.size).toBe(0);
  });
});

describe("QV09 polish: Duelist cues sized to read at the observer camera", () => {
  type P = { x: number; y: number; z: number; life: number; color: number; size: number };
  const rec = (): { out: P[]; fx: EffectsPool } => { const out: P[] = []; return { out, fx: { spawn: (p: P) => { out.push(p); return true; } } as unknown as EffectsPool }; };
  const at = { x: 0, y: 0, z: 0 };
  test("Current Bind, Cascade Chain: minimum particle size and count", () => {
    const b = rec(); TD_RECIPES["td.b1"]!.playActive!(b.fx, at, 0, () => 0);
    expect(b.out.length).toBe(BIND.loop + BIND.lead); expect(BIND.loop).toBeGreaterThanOrEqual(18);
    expect(Math.min(...b.out.map((p) => p.size))).toBeGreaterThanOrEqual(0.3);
    const c = rec(); TD_RECIPES["td.a1"]!.playActive!(c.fx, at, 0, () => 0);
    expect(c.out.length).toBe(CHAIN.links * CHAIN.per); expect(CHAIN.per).toBeGreaterThanOrEqual(6);
    expect(Math.min(...c.out.map((p) => p.size))).toBeGreaterThanOrEqual(0.35);
  });
  test("Split Tide: both probes at least 0.4 / 0.55 m wide with 18 / 26 particles, within the cap", () => {
    const st = { start: 0, lastEmit: -1, lastPulse: -1 } as SustainCtx["state"], { out, fx } = rec();
    const ctx = (tick: number): SustainCtx => ({ at, yaw: 0, tick, startTick: 100, endTick: 118, cover: undefined, state: st });
    TD_RECIPES["td.a3"]!.sustain!(fx, ctx(100)); const n1 = out.length, s1 = Math.min(...out.map((p) => p.size));
    TD_RECIPES["td.a3"]!.sustain!(fx, ctx(117));
    expect(n1).toBeGreaterThanOrEqual(18); expect(s1).toBeGreaterThanOrEqual(0.4);
    expect(out.length - n1).toBeGreaterThanOrEqual(26); expect(Math.min(...out.slice(n1).map((p) => p.size))).toBeGreaterThanOrEqual(0.55);
  });
  test("Riptide trail: a moving caster leaves a trail of at least 4 particles of 0.45 m each step, a still caster none; recipes fit the cap", () => {
    const st = { start: 0, lastEmit: -1, lastPulse: -1 } as SustainCtx["state"], { out, fx } = rec();
    const ctx = (tick: number, x: number): SustainCtx => ({ at: { x, y: 0, z: 0 }, yaw: 0, tick, startTick: 50, endTick: 80, cover: undefined, state: st });
    TD_RECIPES["td.a4"]!.sustain!(fx, ctx(50, 0));
    const lunge = out.length; TD_RECIPES["td.a4"]!.sustain!(fx, ctx(52, 0)); expect(out.length).toBe(lunge);
    TD_RECIPES["td.a4"]!.sustain!(fx, ctx(54, 0.6));
    const trail = out.slice(lunge);
    expect(trail.length).toBeGreaterThanOrEqual(4); expect(Math.min(...trail.map((p) => p.size))).toBeGreaterThanOrEqual(0.45);
    for (const id of ["td.b1", "td.a1", "td.a3", "td.a4"]) expect(recipeParticles(TD_RECIPES[id]!), id).toBeLessThanOrEqual(LOW_QUALITY_CAP);
  });
});
