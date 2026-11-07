import { describe, expect, test, vi } from "vitest";
import type { Scene } from "three";
import { EffectsPool } from "../../apps/client/src/scene/EffectsPool.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { CombatBus } from "../../apps/client/src/app/CombatBus.js";
import { BEAST_SCALE, BEAST_THEME, FX_TIER, SPECIAL_LAYERS, SPECIAL_RE, selectActionFx, selectHitFx, type HitFxInput } from "../../apps/client/src/fx/Fx01.js";
import { LayeredFx, ScorchDecals, scanActions, scanAura, type ScanEnv } from "../../apps/client/src/fx/LayeredFx.js";
import { SIGNATURES } from "../../apps/client/src/fx/Signatures.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

// `three` resolves only from apps/client, so borrow a Group (an Object3D, which is all the pools need) from a FighterView.
const mkScene = (): Scene => { const g = new FighterView("sv", makeToonRamp()).group; g.clear(); return g as unknown as Scene; };
const TIERS = ["low", "medium", "high"] as const;
const hit = (over: Partial<HitFxInput> = {}): HitFxInput => ({ kind: "hit", moveId: "ea.b2", hitClass: "heavy", damage100: 1800, actorBeast: false, tier: "medium", reducedMotion: false, flashLevel: 0.3, hasGround: true, ...over });

describe("FX01 hit selector", () => {
  test("non-damaging kinds and zero-damage hits select nothing", () => {
    expect(selectHitFx(hit({ kind: "block" }))).toBeNull();
    expect(selectHitFx(hit({ kind: "heal" }))).toBeNull();
    expect(selectHitFx(hit({ damage100: 0 }))).toBeNull();
  });
  test("a light basic strike gets no dust, decal, screen pulse or hit-stop (decision 0049 stays honoured)", () => {
    const s = selectHitFx(hit({ moveId: "m1.1", hitClass: "light", damage100: 400, kitId: "sv" }))!;
    expect(s.dust).toBe(0); expect(s.scorch).toBeNull(); expect(s.pulse).toBeNull(); expect(s.freezeFrames).toBe(0); expect(s.beast).toBe(false);
  });
  test("a special hit gets dust or embers, a decal themed to its element, a screen pulse and 2 to 5 frames of hit-stop", () => {
    const s = selectHitFx(hit({ moveId: "ea.b2" }))!;
    expect(s.special).toBe(true);
    expect(s.embers).toBeGreaterThan(0); expect(s.scorch?.kind).toBe("scorch"); expect(s.pulse?.strength).toBeGreaterThan(0);
    expect(s.freezeFrames).toBeGreaterThanOrEqual(2); expect(s.freezeFrames).toBeLessThanOrEqual(5);
    expect(selectHitFx(hit({ moveId: "td.b2" }))!.scorch?.kind).toBe("puddle");
    expect(selectHitFx(hit({ moveId: "sv.b1" }))!.scorch?.kind).toBe("fracture");
  });
  test("a basic strike never freezes unless it kills", () => {
    expect(selectHitFx(hit({ moveId: "m1.4", hitClass: "heavy", kitId: "ea" }))!.freezeFrames).toBe(0);
    expect(selectHitFx(hit({ moveId: "m1.4", hitClass: "heavy", kitId: "ea", targetHp100: 0 }))!.freezeFrames).toBeGreaterThanOrEqual(2);
  });
  test("beast actor chooses the beast variant: lava palette, bigger, heavier shake, ground cracks, longer decal", () => {
    for (const moveId of ["m1.2", "ea.a3", "sv.a2", "td.a1"]) {
      const base = selectHitFx(hit({ moveId, hitClass: moveId.startsWith("m1") ? "light" : "heavy", kitId: "sv" }))!, beast = selectHitFx(hit({ moveId, hitClass: moveId.startsWith("m1") ? "light" : "heavy", kitId: "sv", actorBeast: true }))!;
      expect(beast.beast).toBe(true); expect(base.beast).toBe(false);
      expect(beast.palette).toBe(BEAST_THEME); expect(base.palette).not.toBe(BEAST_THEME);
      expect(beast.scale).toBe(BEAST_SCALE); expect(base.scale).toBe(1);
      expect(beast.shake.amplitude).toBeGreaterThan(base.shake.amplitude); expect(beast.shake.ms).toBeGreaterThan(base.shake.ms);
      expect(beast.cracks).not.toBeNull(); expect(base.cracks).toBeNull();
      expect(beast.shockRings).toBeGreaterThan(base.shockRings);
      expect(beast.dust).toBeGreaterThan(base.dust);
      expect(beast.scorch!.lifeSec).toBeGreaterThan(base.scorch?.lifeSec ?? 0);
      expect(beast.freezeFrames).toBeGreaterThanOrEqual(2); expect(beast.freezeFrames).toBeLessThanOrEqual(5);
    }
  });
  test("counts scale with the quality tier and stay inside the tier caps", () => {
    const by = TIERS.map((tier) => selectHitFx(hit({ tier, moveId: "ea.a4", actorBeast: true }))!);
    expect(by[0]!.dust).toBeLessThan(by[1]!.dust); expect(by[1]!.dust).toBeLessThan(by[2]!.dust);
    expect(by[0]!.embers).toBeLessThan(by[2]!.embers);
    expect(by[0]!.cracks!.count).toBeLessThan(by[2]!.cracks!.count);
    expect(by[0]!.halo).toBeNull(); expect(by[1]!.halo).not.toBeNull();
    expect(by[0]!.pulse!.chroma).toBe(false); expect(by[1]!.pulse!.chroma).toBe(true);
    TIERS.forEach((t, i) => { expect(by[i]!.linger!.count).toBeLessThanOrEqual(FX_TIER[t].lingerMax); expect(by[i]!.dust).toBeGreaterThanOrEqual(3); });
  });
  test("reduced motion removes the pulse, freeze, dust and halo; flash level 0 removes the pulse only", () => {
    const r = selectHitFx(hit({ reducedMotion: true, actorBeast: true }))!;
    expect(r.pulse).toBeNull(); expect(r.freezeFrames).toBe(0); expect(r.dust).toBe(0); expect(r.halo).toBeNull(); expect(r.linger).toBeNull();
    const f = selectHitFx(hit({ flashLevel: 0 }))!;
    expect(f.pulse).toBeNull(); expect(f.dust).toBeGreaterThan(0);
  });
  test("no ground height means no decal", () => {
    expect(selectHitFx(hit({ hasGround: false }))!.scorch).toBeNull();
  });
});

describe("FX01 special recipes", () => {
  test("every special 1-4 of every fighter, base and awakened, has its own layer entry and signature", () => {
    const ids = ["sv", "td", "ea"].flatMap((k) => ["b", "a"].flatMap((f) => [1, 2, 3, 4].map((n) => `${k}.${f}${n}`)));
    expect(ids).toHaveLength(24);
    for (const id of ids) { expect(SPECIAL_RE.test(id)).toBe(true); expect(SPECIAL_LAYERS[id], id).toBeDefined(); expect(SIGNATURES[id], id).toBeDefined(); }
    expect(Object.keys(SPECIAL_LAYERS).sort()).toEqual([...ids].sort());
  });
  test("each fighter keeps its element language: stone fractures, water puddles, ember scorch", () => {
    for (const [id, l] of Object.entries(SPECIAL_LAYERS)) {
      if (id.startsWith("sv.")) { expect(l.scorch).toBe("fracture"); expect(["dust", "smoke"]).toContain(l.linger); }
      if (id.startsWith("td.")) { expect(l.scorch).toBe("puddle"); expect(l.linger).toBe("mist"); }
      if (id.startsWith("ea.")) { expect(l.scorch).toBe("scorch"); expect(["embers", "smoke"]).toContain(l.linger); }
    }
    expect(SPECIAL_LAYERS["ea.a4"]!.radius).toBeGreaterThan(SPECIAL_LAYERS["ea.b1"]!.radius); // awakened is larger
  });
});

describe("FX01 action selector", () => {
  const act = (o: Partial<Parameters<typeof selectActionFx>[0]> = {}): ReturnType<typeof selectActionFx> => selectActionFx({ action: "Windup", moveId: "sv.b1", beast: false, tier: "medium", reducedMotion: false, ...o });
  test("only specials (and beast basics) have charge and release layers", () => {
    expect(act({ moveId: "m1.1" })).toBeNull();
    expect(act({ moveId: "sv.wall" })).toBeNull();
    expect(act({ action: "Idle" })).toBeNull();
    expect(act()!.phase).toBe("charge");
    expect(act({ action: "Active" })!.phase).toBe("release");
    expect(act({ moveId: "m1.2", beast: true, kitId: "ea" })).not.toBeNull();
  });
  test("beast release gets the roar pulse, cracks, heavier shake and the lava palette; base release does not", () => {
    const b = act({ action: "Active", moveId: "sv.a2", beast: true })!, n = act({ action: "Active", moveId: "sv.a2" })!;
    expect(b.roar).not.toBeNull(); expect(n.roar).toBeNull();
    expect(b.palette).toBe(BEAST_THEME); expect(b.scale).toBe(BEAST_SCALE); expect(b.shake).not.toBeNull(); expect(n.shake).toBeNull();
    expect(b.scorch!.lifeSec).toBeGreaterThan(n.scorch!.lifeSec);
    expect(act({ action: "Active", moveId: "ea.b1" })!.scorch).toBeNull(); // a projectile-like move leaves no area mark
  });
  test("motes scale with the tier", () => {
    const m = TIERS.map((tier) => act({ tier, beast: true })!.motes);
    expect(m[0]).toBeLessThan(m[2]!);
  });
});

describe("FX01 pooling and cleanup", () => {
  test("ScorchDecals reuses its slots, expires, and dispose removes every mesh", () => {
    const scene = mkScene(), before = scene.children.length, d = new ScorchDecals(scene, 4);
    expect(scene.children.length).toBe(before + 8);
    for (let i = 0; i < 10; i++) d.add("scorch", i, 0, 0, 2, 3, true);
    expect(d.activeCount).toBe(4); expect(scene.children.length).toBe(before + 8); // no growth past capacity
    d.update(1.5); expect(d.activeCount).toBe(4);
    d.update(2); expect(d.activeCount).toBe(0);
    expect(d.add("puddle", 0, 0, 0, 1, 1, false)).toBe(true);
    d.dispose();
    expect(scene.children.length).toBe(before);
    expect(d.add("scorch", 0, 0, 0, 1, 1, true)).toBe(false);
  });
  test("tier decal capacities", () => { expect(TIERS.map((t) => FX_TIER[t].decals)).toEqual([3, 8, 14]); });

  const setup = (tier: "low" | "medium" | "high", players: Map<string, unknown>) => {
    const scene = mkScene(), effects = new EffectsPool();
    effects.configure(scene, tier);
    let emit: (e: CombatEvent) => void = () => {};
    const bus = new CombatBus((h) => { emit = h; return () => {}; }, () => undefined);
    const fighter = { flash: vi.fn(), freeze: vi.fn() };
    const shake = vi.fn();
    const off = LayeredFx.attach(bus, { scene, camera: undefined as never, players: () => players, settings: { get: () => ({ reducedMotion: false, flashLevel: 0.3 }) }, localId: () => "1", effects,
      fighters: () => fighter as never, shake, surfaceHeight: (_x, _z, y) => y - 0.9 });
    let n = 0;
    return { scene, effects, bus, fighter, shake, off, emit: (e: Partial<CombatEvent>) => emit({ eventId: `e${n++}`, tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, ...e }) };
  };
  const P = (o: Record<string, unknown> = {}) => ({ x: 0, y: 90, z: 0, facingYaw: 0, action: "Idle", moveId: "", actionStartTick: 0, kitId: "ea", ...o });

  test("a beast special hit through the real attach path spawns layers, a decal, freezes both fighters and shakes; dispose cleans up", () => {
    const players = new Map<string, unknown>([["1", P({ beast: true })], ["2", P({ x: 300 })]]);
    const t = setup("medium", players);
    t.emit({ moveId: "ea.a3", damage100: 3600, hitClass: "heavy", position: { x: 3, y: 1.2, z: 0 } });
    expect(t.effects.activeCount).toBeGreaterThan(0);
    expect(t.effects.glow.activeCount).toBeGreaterThan(0);
    expect(t.scene.children.filter((c) => c.name === "fx.decal").length).toBe(FX_TIER.medium.decals * 2);
    expect(t.fighter.freeze).toHaveBeenCalledTimes(2);
    expect(t.shake).toHaveBeenCalledTimes(1);
    expect(t.shake.mock.calls[0]![0]).toBeGreaterThan(0.3);
    const during = t.scene.children.length;
    t.off(); t.bus.dispose();
    expect(t.scene.children.some((c) => c.name === "fx.decal")).toBe(false);
    expect(t.scene.children.length).toBeLessThan(during);
    t.effects.dispose();
  });
  test("a light basic hit by a non-beast neither freezes nor makes a decal", () => {
    const t = setup("medium", new Map<string, unknown>([["1", P()], ["2", P({ x: 300 })]]));
    t.emit({ moveId: "m1.1", damage100: 400, hitClass: "light", position: { x: 3, y: 1.2, z: 0 } });
    expect(t.fighter.freeze).not.toHaveBeenCalled();
    expect(t.scene.children.some((c) => c.name === "fx.decal" && c.visible)).toBe(false);
    t.off(); t.effects.dispose();
  });
  test("scanActions fires once per action start, scanAura emits only for beast fighters and cleans its state", () => {
    const scene = mkScene(), effects = new EffectsPool();
    effects.configure(scene, "medium");
    const decals = new ScorchDecals(scene, 4);
    const env: ScanEnv = { fx: effects, tier: () => "medium", reducedMotion: () => false, decals: () => decals, pulse: null, surface: (_x, _z, y) => y - 0.9 };
    const players = new Map<string, unknown>([["1", P({ action: "Active", moveId: "ea.a4", beast: true, actionStartTick: 5 })], ["2", P({ action: "Idle" })]]);
    const seen = new Map<string, string>();
    scanActions(env, players, seen);
    const afterFirst = effects.glow.activeCount + effects.activeCount;
    expect(afterFirst).toBeGreaterThan(0); expect(decals.activeCount).toBe(1);
    scanActions(env, players, seen);
    expect(effects.glow.activeCount + effects.activeCount).toBe(afterFirst); // same start tick: nothing new
    players.get("1") && ((players.get("1") as { actionStartTick: number }).actionStartTick = 40);
    scanActions(env, players, seen);
    expect(effects.glow.activeCount + effects.activeCount).toBeGreaterThan(afterFirst);
    effects.update(3);
    const acc = new Map<string, number>(), before = effects.activeCount;
    scanAura(env, players, 0.5, acc);
    expect(effects.activeCount).toBeGreaterThan(before); expect(acc.has("1")).toBe(true); expect(acc.has("2")).toBe(false);
    (players.get("1") as { beast: boolean }).beast = false;
    scanAura(env, players, 0.5, acc);
    expect(acc.size).toBe(0);
    // reduced motion: no aura
    (players.get("1") as { beast: boolean }).beast = true;
    const quiet = effects.activeCount; scanAura({ ...env, reducedMotion: () => true }, players, 1, acc);
    expect(effects.activeCount).toBe(quiet);
    seen.clear(); decals.dispose(); effects.dispose();
  });
});
