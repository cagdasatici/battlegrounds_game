import { describe, expect, it } from "vitest";
import { buildIslandsMap, ARENA } from "../../packages/shared/src/config/arena.js";
import { GameScene, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";
import { ISLETS } from "../../apps/client/src/scene/ArenaView.js";
import { QUALITY_PROFILES, pixelRatioForProfile } from "../../apps/client/src/render/environment/quality.js";
import { GROVE_THEME, getEnvTheme, THEMES } from "../../apps/client/src/render/environment/theme.js";
import { buildCoverMask, coverDensity, sampleMask } from "../../apps/client/src/render/environment/coverMask.js";
import { dirtAmount, groundHex, wearPointsFor } from "../../apps/client/src/render/environment/groundShading.js";
import { CROWN_RADIUS, groundGap, planTrees, sceneryIslets } from "../../apps/client/src/render/environment/treePlan.js";
import { buildSpecies } from "../../apps/client/src/render/environment/Trees.js";
import { GroundCover, clumpGeometry } from "../../apps/client/src/render/environment/GroundCover.js";

const map = buildIslandsMap(), colliders = map.colliders;
const wear = wearPointsFor(colliders, ARENA.spawnAnchors);
const win = (): WindowLike => ({ innerWidth: 1180, innerHeight: 820, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} });

describe("GFX01 quality tiers are visibly different", () => {
  const { low, medium, high } = QUALITY_PROFILES;
  it("every tier row differs in several independent settings (medium and high no longer share a shadow map or a pixel window)", () => {
    expect(low.shadowMapSize).toBe(0);
    expect(medium.shadowMapSize).toBeLessThan(high.shadowMapSize);
    expect(medium.shadowRadius).toBeLessThan(high.shadowRadius);
    expect(medium.pixelRatioMax).toBeLessThan(high.pixelRatioMax);
    expect(medium.pixelBudget).toBeLessThan(high.pixelBudget);
    for (const k of ["grass", "flowers", "pebbles", "particles", "coverWindow", "treeShare", "fogNear"] as const) {
      expect(low[k], k).toBeLessThan(medium[k]); expect(medium[k], k).toBeLessThan(high[k]);
    }
    expect(low.toneMapping).toBe(false); expect(medium.toneMapping && high.toneMapping).toBe(true);
    expect(low.sway).toBe(false); expect(medium.sway).toBe(true);
  });
  it("a normal 1180x820 retina window now renders high at a higher resolution than medium", () => {
    const m = pixelRatioForProfile(medium, 1180, 820, 2), h = pixelRatioForProfile(high, 1180, 820, 2), l = pixelRatioForProfile(low, 1180, 820, 2);
    expect(l).toBeLessThan(m); expect(m).toBeLessThan(h);
    expect(h - m).toBeGreaterThan(0.5);
  });
  it("the scene applies the tier: shadow map size, pools, tone mapping and fog distance change with setQuality", () => {
    const r: RendererLike = { setSize() {}, setPixelRatio() {}, shadowMap: { enabled: false, type: 0 }, render() {}, dispose() {} };
    const gs = new GameScene(r, colliders, win());
    const sun = (gs as unknown as { sun: { shadow: { mapSize: { x: number } } } }).sun;
    const fog = (): number => (gs.scene.fog as unknown as { near: number }).near;
    const seen: Record<string, { map: number; fog: number; tone: number | undefined; stats: ReturnType<typeof stats> }> = {};
    const stats = (): unknown => (gs as unknown as { envLayer: { stats: unknown } }).envLayer.stats;
    for (const q of ["low", "medium", "high"] as const) { gs.setQuality(q); seen[q] = { map: sun.shadow.mapSize.x, fog: fog(), tone: r.toneMapping, stats: stats() as ReturnType<typeof stats> }; }
    expect(seen["medium"]!.map).toBe(1024); expect(seen["high"]!.map).toBe(2048);
    expect(seen["low"]!.fog).toBeLessThan(seen["medium"]!.fog); expect(seen["medium"]!.fog).toBeLessThan(seen["high"]!.fog);
    expect(seen["low"]!.tone).not.toBe(seen["high"]!.tone);
    expect(seen["high"]!.tone).toBe(seen["medium"]!.tone);
    expect((seen["high"]!.stats as { grass: number }).grass).toBe(high.grass);
    expect((seen["low"]!.stats as { particles: number }).particles).toBe(0);
    gs.dispose();
  });
});

describe("GFX01 themes", () => {
  it("unknown theme ids fall back to the grove and the grove is registered", () => {
    expect(getEnvTheme("grove")).toBe(GROVE_THEME);
    expect(getEnvTheme("beach")).toBe(GROVE_THEME);
    expect(THEMES["grove"]).toBe(GROVE_THEME);
    expect(GROVE_THEME.trees.mix.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});

describe("GFX01 ground cover mask", () => {
  const mask = buildCoverMask(colliders, 80, 160, wear);
  it("is deterministic and grows nothing over void, bridges, cover blocks, the stone court or dirt paths", () => {
    expect(buildCoverMask(colliders, 80, 160, wear).data).toEqual(mask.data);
    expect(coverDensity(colliders, 0, 80, wear)).toBe(0); // void south of the south satellite
    expect(coverDensity(colliders, 57, 0, wear)).toBe(0); // east bridge
    for (const c of colliders.filter((k) => k.role === "obstacle" && k.shape === "cuboid")) expect(coverDensity(colliders, c.centre[0], c.centre[2], wear), c.id).toBe(0);
    expect(coverDensity(colliders, 3, 2, wear)).toBe(0); // court
    const avg = (xo: number): number => { let t = 0; for (let z = 14; z < 40; z += 2) t += coverDensity(colliders, xo + 0.9 * Math.sin(z * 0.1 + 0.4), z, wear); return t / 13; };
    expect(avg(0)).toBeLessThan(avg(9) * 0.6); // the north-south path is thinner than the meadow beside it
  });
  it("has open meadow where fighters stand and samples consistently", () => {
    expect(coverDensity(colliders, 30, 30, wear)).toBeGreaterThan(0.2);
    expect(sampleMask(mask, 30, 30)).toBeGreaterThan(0.2);
    expect(sampleMask(mask, 500, 0)).toBe(0);
    let nonzero = 0; for (const v of mask.data) if (v > 0) nonzero++;
    expect(nonzero).toBeGreaterThan(mask.data.length * 0.2);
  });
});

describe("GFX01 ground colour", () => {
  it("varies across the meadow, is stable, and turns to dirt on the paths", () => {
    const a = groundHex(GROVE_THEME, 25, 25, wear), b = groundHex(GROVE_THEME, -31, 12, wear), c = groundHex(GROVE_THEME, 47, -28, wear);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(groundHex(GROVE_THEME, 25, 25, wear)).toBe(a);
    expect(dirtAmount(0.3, 30, wear)).toBeGreaterThan(0.4);
    expect(dirtAmount(30, 30, wear)).toBeLessThan(0.1);
  });
});

describe("GFX01 trees and scenery", () => {
  const scenery = sceneryIslets(1.5, ISLETS), plan = planTrees(GROVE_THEME, colliders, scenery);
  it("scenery islets are deterministic, numerous and do not overlap each other or the original islets", () => {
    expect(sceneryIslets(1.5, ISLETS)).toEqual(scenery);
    expect(scenery.length).toBeGreaterThanOrEqual(8);
    const all = [...ISLETS, ...scenery];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i]![0] - all[j]![0], all[i]![2] - all[j]![2])).toBeGreaterThan(all[i]![3] + all[j]![3]);
  });
  it("plans a varied, deterministic forest whose crowns stay clear of walkable ground and bridge mouths", () => {
    expect(planTrees(GROVE_THEME, colliders, scenery)).toEqual(plan);
    expect(new Set(plan.map((p) => p.species)).size).toBe(4);
    expect(plan.length).toBeGreaterThan(60);
    const bridges = colliders.filter((c) => c.role === "bridge" && c.shape === "cuboid");
    for (const p of plan.filter((t) => t.ledge)) {
      expect(groundGap(colliders, p.x, p.z) - CROWN_RADIUS[p.species] * p.scale, `${p.species} ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeGreaterThan(0);
      for (const b of bridges) if (b.shape === "cuboid") expect(Math.abs(p.x - b.centre[0]) < b.halfExtents[0] + 8 && Math.abs(p.z - b.centre[2]) < b.halfExtents[2] + 8).toBe(false);
    }
    expect(new Set(plan.map((p) => p.tint)).size).toBeGreaterThan(2);
  });
  it("builds distinct vertex-coloured species geometry", () => {
    const sizes = (["oak", "pine", "birch", "bush"] as const).map((s) => { const g = buildSpecies(GROVE_THEME, s); const n = g.getAttribute("position").count; expect(g.getAttribute("color").count).toBe(n); g.dispose(); return n; });
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(3);
  });
});

describe("GFX01 teardown", () => {
  it("disposes every geometry, material and the mask texture of the ground cover", () => {
    const cover = new GroundCover(colliders, GROVE_THEME, wear, QUALITY_PROFILES.high);
    cover.setProfile(QUALITY_PROFILES.medium);
    expect(cover.counts.grass).toBe(QUALITY_PROFILES.medium.grass);
    cover.setProfile(QUALITY_PROFILES.low);
    expect(cover.counts.flowers).toBe(0);
    let disposed = 0;
    cover.group.traverse((o) => { const m = o as { geometry?: { addEventListener(t: string, f: () => void): void }; material?: { addEventListener(t: string, f: () => void): void } }; m.geometry?.addEventListener("dispose", () => disposed++); m.material?.addEventListener("dispose", () => disposed++); });
    cover.dispose();
    expect(disposed).toBeGreaterThanOrEqual(6);
    expect(clumpGeometry(GROVE_THEME, 1).getAttribute("position").count).toBe(36);
  });
  it("scene creation and disposal leaves no environment object behind", () => {
    const r: RendererLike = { setSize() {}, render() {}, dispose() {} };
    const gs = new GameScene(r, colliders, win());
    gs.setCamera({ position: { x: 0, y: 3, z: 8 }, pivot: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, distance: 6 });
    gs.render(1 / 60);
    expect(gs.scene.getObjectByName("deco.env")).toBeDefined();
    gs.dispose();
    expect(gs.scene.children.length).toBe(0);
  });
});
