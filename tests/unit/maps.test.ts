import { describe, expect, test } from "vitest";
import { ARENA, ARENA_SCALE, buildIslandsMap, colliderAabb } from "../../packages/shared/src/config/arena.js";
import {
  DEFAULT_MAP_ID, GROVE_MAP, MAP_REGISTRY, clampToMapBounds, getMapDefinition, insideMapBounds, validateMapRegistry, type MapDefinition,
} from "../../packages/shared/src/config/maps.js";

describe("ARENA01 map definitions", () => {
  test("registry is valid and the default map is the grove", () => {
    expect(validateMapRegistry()).toEqual([]);
    expect(DEFAULT_MAP_ID).toBe("grove");
    expect(getMapDefinition("grove")).toBe(GROVE_MAP);
    expect(GROVE_MAP.collisionMapId).toBe(buildIslandsMap().mapId);
    expect(() => getMapDefinition("nope")).toThrow(/unknown map/);
    expect(Object.keys(MAP_REGISTRY)).toEqual(["grove"]);
  });
  test("validator reports a broken definition", () => {
    const bad: MapDefinition = { ...GROVE_MAP, id: "x", themeId: "", bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 1 }, spawnPoints: [[5, 0, 0]] };
    expect(validateMapRegistry({ grove: bad }).length).toBeGreaterThanOrEqual(4);
  });
  test("world is 1.5x the BEAST01 layout in each horizontal dimension", () => {
    expect(ARENA_SCALE).toBe(1.5);
    expect(ARENA.main.width).toBe(72 * 1.5);
    expect(ARENA.main.depth).toBe(60 * 1.5);
    expect(ARENA.boundaryRadius).toBe(135);
  });
  test("bounds contain every collider and clamp at the new edges", () => {
    for (const c of buildIslandsMap().colliders) {
      const bb = colliderAabb(c);
      expect(bb.min[0]).toBeGreaterThanOrEqual(GROVE_MAP.bounds.minX - 1e-9);
      expect(bb.max[0]).toBeLessThanOrEqual(GROVE_MAP.bounds.maxX + 1e-9);
      expect(bb.min[2]).toBeGreaterThanOrEqual(GROVE_MAP.bounds.minZ - 1e-9);
      expect(bb.max[2]).toBeLessThanOrEqual(GROVE_MAP.bounds.maxZ + 1e-9);
    }
    const { maxX, minX, maxZ, minZ } = GROVE_MAP.bounds;
    expect([maxX, maxZ]).toEqual([72, 63]);
    expect(clampToMapBounds(GROVE_MAP, 500, -500)).toEqual([maxX, minZ]);
    expect(clampToMapBounds(GROVE_MAP, -500, 500)).toEqual([minX, maxZ]);
    expect(clampToMapBounds(GROVE_MAP, 10, 5)).toEqual([10, 5]);
    expect(insideMapBounds(GROVE_MAP, maxX + 0.01, 0)).toBe(false);
    expect(Math.hypot(maxX, maxZ)).toBeLessThan(ARENA.boundaryRadius);
  });
  test("spawn points are inside bounds and the void radius, spread proportionally", () => {
    for (const p of GROVE_MAP.spawnPoints) {
      expect(insideMapBounds(GROVE_MAP, p[0], p[2])).toBe(true);
      expect(Math.hypot(p[0], p[2])).toBeLessThan(ARENA.boundaryRadius);
    }
    expect(GROVE_MAP.spawnPoints).toHaveLength(8);
    expect(GROVE_MAP.spawnPoints[1]).toEqual([27, 0, -21]);
  });
});
