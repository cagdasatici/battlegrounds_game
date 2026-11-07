import { describe, expect, it } from "vitest";
import type { BufferGeometry, Mesh } from "three";
import { DataTexture } from "three";
import { MAP_REGISTRY, buildMapCollision, GROVE_MAP, COAST_MAP, FROST_MAP } from "../../packages/shared/src/config/maps.js";
import { GameScene, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";
import { buildWorldView } from "../../apps/client/src/render/worlds/index.js";
import { COAST_WATER_Y, coastHeight, underWater } from "../../apps/client/src/render/worlds/coastShape.js";
import { sandHex } from "../../apps/client/src/render/worlds/coastWorld.js";
import { FROST_PLAIN_R, FROST_RING_R, frostHeight, snowLine } from "../../apps/client/src/render/worlds/frostShape.js";
import { snowHex } from "../../apps/client/src/render/worlds/frostWorld.js";
import { QUALITY_PROFILES } from "../../apps/client/src/render/environment/quality.js";
import { THEMES, getEnvTheme } from "../../apps/client/src/render/environment/theme.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";

const win = (): WindowLike => ({ innerWidth: 1180, innerHeight: 820, devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} });
const fakeRenderer = (): RendererLike => ({ setSize() {}, setPixelRatio() {}, shadowMap: { enabled: false, type: 0 }, render() {}, dispose() {} });
const dims = { halfX: COAST_MAP.bounds.maxX, halfZ: COAST_MAP.bounds.maxZ };
const triangles = (root: { traverse(fn: (o: unknown) => void): void }): number => {
  let n = 0;
  root.traverse((o) => { const g = (o as Mesh).geometry as BufferGeometry | undefined; if (g) n += (g.index ? g.index.count : g.getAttribute("position").count) / 3 * ((o as { count?: number }).count ?? 1); });
  return n;
};

describe("WORLD01 coast shape (pure)", () => {
  it("is exactly flat inside the collision slab, so craters, Rapier and prediction stay valid", () => {
    for (let i = 0; i < 400; i++) {
      const x = (((i * 37) % 200) / 100 - 1) * dims.halfX, z = (((i * 91) % 200) / 100 - 1) * dims.halfZ;
      expect(coastHeight(x, z, dims)).toBe(0);
    }
  });
  it("slopes into the sea on the south, east and west and rises into dunes behind the north edge", () => {
    expect(underWater(0, dims.halfZ + 6, dims)).toBe(true);
    expect(underWater(dims.halfX + 6, 0, dims)).toBe(true);
    expect(underWater(-dims.halfX - 6, 0, dims)).toBe(true);
    expect(coastHeight(0, dims.halfZ + 1, dims)).toBeGreaterThan(COAST_WATER_Y); // wet sand beyond the wall, above the waterline
    expect(coastHeight(0, -dims.halfZ - 30, dims)).toBeGreaterThan(2);
    expect(coastHeight(0, -dims.halfZ - 400, dims)).toBeLessThan(COAST_WATER_Y); // the far land ends in the sea
    for (const [x, z] of [[0, 0], [-60, -70], [90, 20], [0, 90]] as const) expect(Number.isFinite(sandHex(x, z, coastHeight(x, z, dims)))).toBe(true);
  });
});

describe("WORLD01 world views", () => {
  const ramp: DataTexture = makeToonRamp();
  it("every registry map has a theme and a view builder that returns the full ArenaBuild contract", () => {
    for (const def of Object.values(MAP_REGISTRY)) {
      expect(THEMES[def.themeId], def.id).toBeDefined();
      expect(getEnvTheme(def.themeId).id).toBe(def.themeId);
      const colliders = buildMapCollision(def).colliders;
      const view = buildWorldView(def, colliders, ramp);
      expect(view.sky.name).toBe("deco.sky");
      expect(view.motes.count).toBeGreaterThanOrEqual(3);
      expect(view.geometries.length).toBeGreaterThan(0);
      expect(view.terrain).toBeDefined();
      expect(triangles(view.group)).toBeLessThan(260_000);
      view.setMotes(1.5);
      view.animate?.(0.016);
      for (const g of view.geometries) g.dispose();
      for (const m of view.materials) m.dispose();
      for (const t of view.textures) t.dispose();
    }
  });
  it("the coast has water with foam uniforms, palms, boulders, driftwood and dune grass", () => {
    const view = buildWorldView(COAST_MAP, buildMapCollision(COAST_MAP).colliders, ramp);
    for (const name of ["deco.terrain", "deco.water", "deco.palms", "deco.fronds", "deco.props", "deco.cover", "deco.horizon"]) {
      expect(view.group.getObjectByName(name) ?? view.sky.getObjectByName(name), name).toBeDefined();
    }
    const water = view.group.getObjectByName("deco.water") as Mesh;
    const u = (water.material as unknown as { uniforms: Record<string, { value: unknown }> }).uniforms;
    expect(u["uTime"]!.value).toBe(0);
    view.animate!(0.5);
    expect(u["uTime"]!.value).toBe(0.5);
    expect(water.renderOrder).toBeGreaterThan(0);
  });
});

describe("WORLD01 GameScene.setWorld", () => {
  const coastColliders = buildMapCollision(COAST_MAP).colliders;
  const groveColliders = buildMapCollision(GROVE_MAP).colliders;
  it("swaps worlds without leaking resources, keeps the sun in step with the theme and is a no-op for the same map", () => {
    const gs = new GameScene(fakeRenderer(), groveColliders, win());
    expect(gs.mapId).toBe("grove");
    const base = gs.resourceCount;
    gs.setWorld(COAST_MAP, coastColliders);
    expect(gs.mapId).toBe("coast");
    expect(gs.scene.getObjectByName("deco.water")).toBeDefined();
    const coastCount = gs.resourceCount;
    for (let i = 0; i < 3; i++) { gs.setWorld(GROVE_MAP, groveColliders); gs.setWorld(COAST_MAP, coastColliders); }
    expect(gs.resourceCount).toBe(coastCount);
    gs.setWorld(COAST_MAP, coastColliders);
    expect(gs.resourceCount).toBe(coastCount);
    gs.setWorld(GROVE_MAP, groveColliders);
    expect(gs.resourceCount).toBe(base);
    expect(gs.scene.getObjectByName("deco.water")).toBeUndefined();
    expect((gs.scene.fog as unknown as { color: { getHex(): number } }).color.getHex()).not.toBe(0);
    gs.render(0.016);
    gs.dispose();
  });
  it("the coast fog and lights come from the coast theme, and quality tiers still apply after a swap", () => {
    const gs = new GameScene(fakeRenderer(), groveColliders, win());
    gs.setWorld(COAST_MAP, coastColliders);
    const fog = gs.scene.fog as unknown as { color: { getHexString(): string } };
    expect(fog.color.getHexString()).toBe(getEnvTheme("coast").sky.fog.toString(16).padStart(6, "0"));
    gs.setQuality("low");
    expect(gs.scene.getObjectByName("deco.cover")?.visible).toBe(false);
    expect(gs.shadowsEnabled).toBe(false);
    gs.setQuality("high");
    expect(gs.scene.getObjectByName("deco.cover")?.visible).toBe(true);
    expect(gs.shadowsEnabled).toBe(true);
    // Craters cut the coast ground (the terrain material is patched like the grove's).
    expect(gs.craters).toBeDefined();
    gs.dispose();
  });
});

describe("WORLD02 frost shape and view", () => {
  it("the plain is dead flat over the whole slab and the mountains rise high in a ring around it", () => {
    for (let i = 0; i < 400; i++) {
      const x = (((i * 37) % 200) / 100 - 1) * FROST_MAP.bounds.maxX, z = (((i * 91) % 200) / 100 - 1) * FROST_MAP.bounds.maxZ;
      expect(frostHeight(x, z)).toBe(0);
    }
    expect(Math.hypot(FROST_MAP.bounds.maxX, FROST_MAP.bounds.maxZ)).toBeLessThan(FROST_PLAIN_R);
    let tall = 0, lowSectors = 0;
    for (let k = 0; k < 24; k++) {
      let best = 0;
      for (let r = 100; r <= FROST_RING_R; r += 5) best = Math.max(best, frostHeight(Math.cos((k / 24) * 6.2832) * r, Math.sin((k / 24) * 6.2832) * r));
      if (best > 40) tall++; if (best < 15) lowSectors++;
    }
    expect(tall).toBeGreaterThanOrEqual(20); // a ring, not a few peaks
    expect(lowSectors).toBe(0);
    expect(snowLine(0, 100)).toBeGreaterThan(10);
    for (const [x, z, h, ny] of [[0, 0, 0, 1], [90, 20, 8, 0.9], [150, 40, 60, 0.5], [-120, 90, 30, 0.95]] as const) expect(Number.isFinite(snowHex(x, z, h, ny))).toBe(true);
  });
  it("the frost view has terrain, mountains, pines, ice and ravens, and falling snow scales with the tier", () => {
    const view = buildWorldView(FROST_MAP, buildMapCollision(FROST_MAP).colliders, makeToonRamp());
    for (const name of ["deco.terrain", "deco.mountains", "deco.peaks", "deco.pines", "deco.props", "deco.cover", "deco.ice"]) expect(view.group.getObjectByName(name), name).toBeDefined();
    expect(view.groundMaterials).toHaveLength(1);
    const { low, medium, high } = QUALITY_PROFILES;
    expect(low.snow).toBeGreaterThan(0); expect(low.snow).toBeLessThan(medium.snow); expect(medium.snow).toBeLessThan(high.snow);
    const gs = new GameScene(fakeRenderer(), buildMapCollision(GROVE_MAP).colliders, win());
    gs.setWorld(FROST_MAP, buildMapCollision(FROST_MAP).colliders);
    const stats = (): { particles: number; grass: number; flowers: number } => (gs as unknown as { envLayer: { stats: { particles: number; grass: number; flowers: number } } }).envLayer.stats;
    gs.setQuality("low"); const l = stats().particles;
    gs.setQuality("medium"); const m = stats().particles;
    gs.setQuality("high"); const h = stats();
    expect([l, m, h.particles]).toEqual([low.snow, medium.snow, high.snow]);
    expect(h.flowers).toBe(0); // frost has no flowers
    expect(h.grass).toBeLessThan(high.grass * 0.1);
    const fog = gs.scene.fog as unknown as { color: { getHexString(): string } };
    expect(fog.color.getHexString()).toBe(getEnvTheme("frost").sky.fog.toString(16).padStart(6, "0"));
    gs.setWorld(COAST_MAP, buildMapCollision(COAST_MAP).colliders);
    gs.setQuality("high");
    expect(stats().particles).toBe(high.particles); // the coast uses pollen again
    gs.dispose();
    for (const g of view.geometries) g.dispose();
  });
  it("all three worlds swap in any order without leaking", () => {
    const gs = new GameScene(fakeRenderer(), buildMapCollision(GROVE_MAP).colliders, win());
    const base = gs.resourceCount, counts = new Map<string, number>();
    for (const def of [FROST_MAP, COAST_MAP, FROST_MAP, GROVE_MAP, COAST_MAP, FROST_MAP, GROVE_MAP]) {
      gs.setWorld(def, buildMapCollision(def).colliders);
      const seen = counts.get(def.id);
      if (seen === undefined) counts.set(def.id, gs.resourceCount); else expect(gs.resourceCount, def.id).toBe(seen);
      gs.render(0.016);
    }
    expect(gs.resourceCount).toBe(base);
    gs.dispose();
  });
});
