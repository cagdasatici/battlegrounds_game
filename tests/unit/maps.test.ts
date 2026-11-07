import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { ARENA, ARENA_SCALE, buildIslandsMap, colliderAabb, parseArenaMap, surfaceBelow, validateArenaMap } from "../../packages/shared/src/config/arena.js";
import {
  DEFAULT_MAP_ID, GROVE_MAP, MAP_IDS, MAP_REGISTRY, MapIdSchema, buildMapCollision, clampToMapBounds, getMapDefinition, insideMapBounds, mapIdOrDefault,
  validateMapRegistry, type MapDefinition,
} from "../../packages/shared/src/config/maps.js";
import { BEAST } from "../../packages/shared/src/config/beast.js";
import { AdminRoomCreateSchema } from "../../packages/shared/src/admin.js";
import { SparringConfigSchema, SparringCreateRequestSchema } from "../../packages/shared/src/sparring.js";
import { canonicalJson } from "../../packages/shared/src/math.js";
import { World, loadMapFile, mapFileUrl } from "../../apps/server/src/sim/World.js";
import { MovementSystem } from "../../apps/server/src/sim/Movement.js";
import { CraterSystem } from "../../apps/server/src/sim/Craters.js";
import { ArenaState } from "../../apps/server/src/state/ArenaSchema.js";
import { NEUTRAL_MOVE } from "../../packages/shared/src/movement.js";
import { groundHeightAt } from "../../packages/shared/src/craterGround.js";

describe("ARENA01 map definitions", () => {
  test("registry is valid and the default map is the grove", () => {
    expect(validateMapRegistry()).toEqual([]);
    expect(DEFAULT_MAP_ID).toBe("grove");
    expect(getMapDefinition("grove")).toBe(GROVE_MAP);
    expect(GROVE_MAP.collisionMapId).toBe(buildIslandsMap().mapId);
    expect(() => getMapDefinition("nope")).toThrow(/unknown map/);
    expect(Object.keys(MAP_REGISTRY)).toEqual([...MAP_IDS]);
    expect(MAP_IDS[0]).toBe("grove");
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

// WORLD01/WORLD02: the same checks run for every registry entry, so a new map is covered the moment it is registered.
describe.each(Object.values(MAP_REGISTRY).map((m) => [m.id, m] as const))("map %s (registry-wide checks)", (_id, def) => {
  const collision = buildMapCollision(def);
  const obstacles = collision.colliders.filter((c) => c.role === "obstacle");
  const footprintGap = (c: (typeof obstacles)[number], x: number, z: number): number =>
    c.shape === "cuboid" ? Math.hypot(Math.max(0, Math.abs(x - c.centre[0]) - c.halfExtents[0]), Math.max(0, Math.abs(z - c.centre[2]) - c.halfExtents[2]))
      : Math.max(0, Math.hypot(x - c.centre[0], z - c.centre[2]) - c.radius);

  test("the committed artifact equals the code definition, parses strictly and passes the build validator", () => {
    const raw = JSON.parse(readFileSync(mapFileUrl(def.collisionMapId), "utf8")) as unknown;
    expect(canonicalJson(parseArenaMap(raw))).toBe(canonicalJson(collision));
    expect(collision.mapId).toBe(def.collisionMapId);
    expect(validateArenaMap(collision)).toEqual([]);
  });
  test("every collider lies inside the map bounds and inside the void radius", () => {
    for (const c of collision.colliders) {
      const bb = colliderAabb(c);
      expect(bb.min[0], c.id).toBeGreaterThanOrEqual(def.bounds.minX - 1e-9);
      expect(bb.max[0], c.id).toBeLessThanOrEqual(def.bounds.maxX + 1e-9);
      expect(bb.min[2], c.id).toBeGreaterThanOrEqual(def.bounds.minZ - 1e-9);
      expect(bb.max[2], c.id).toBeLessThanOrEqual(def.bounds.maxZ + 1e-9);
    }
    expect(Math.hypot(def.bounds.maxX, def.bounds.maxZ)).toBeLessThan(collision.boundaryRadius);
    // The bot navigation grid is sized from the grove, so no map may reach beyond it.
    expect(def.bounds.maxX).toBeLessThanOrEqual(GROVE_MAP.bounds.maxX);
    expect(def.bounds.maxZ).toBeLessThanOrEqual(GROVE_MAP.bounds.maxZ);
  });
  test("spawns match the artifact, sit inside the bounds on solid ground and clear of every obstacle", () => {
    expect(collision.spawnAnchors.map((a) => a.position)).toEqual(def.spawnPoints.map((p) => [...p]));
    expect(def.spawnPoints.length).toBeGreaterThanOrEqual(8);
    for (const p of def.spawnPoints) {
      expect(insideMapBounds(def, p[0], p[2])).toBe(true);
      expect(surfaceBelow(collision.colliders.filter((c) => c.role === "ground" || c.role === "bridge"), p[0], p[2], p[1] + 0.01)).toBeCloseTo(p[1], 6);
      for (const o of obstacles) expect(footprintGap(o, p[0], p[2]), `${o.id} vs spawn`).toBeGreaterThan(1.5);
    }
  });
  test("urns stand inside the bounds and outside every obstacle; the beast anchors keep a walkable footprint", () => {
    for (const u of collision.urnAnchors) {
      expect(insideMapBounds(def, u.position[0], u.position[2])).toBe(true);
      for (const o of obstacles) expect(footprintGap(o, u.position[0], u.position[2]), `${o.id} vs urn ${u.id}`).toBeGreaterThan(0.6);
    }
    const walk = collision.colliders.filter((c) => c.role === "ground" || c.role === "bridge");
    for (const a of def.beastAnchors) {
      expect(insideMapBounds(def, a[0], a[2])).toBe(true);
      for (let k = 0; k < 16; k++) {
        const x = a[0] + Math.cos((k / 16) * Math.PI * 2) * BEAST.footprintRadius, z = a[2] + Math.sin((k / 16) * Math.PI * 2) * BEAST.footprintRadius;
        expect(surfaceBelow(walk, x, z, 1), `beast ring ${k}`).not.toBeNull();
      }
    }
  });
  // The grove ends in a void (falling is a KO); the walled maps clamp the fighter at the shore / tree line.
  const walled = collision.colliders.some((c) => c.id.startsWith("shore."));
  test.runIf(walled)("a fighter pushing against the edge stays on the map (server authoritative collision)", async () => {
    const w = await World.create(loadMapFile(mapFileUrl(def.collisionMapId)));
    const mvs = new MovementSystem(w);
    const start = def.spawnPoints[0]!;
    mvs.add(1, [start[0], start[1] + ARENA.capsule.centreAboveSurface, start[2]]);
    // Walk in each axis direction for 8 s; the body must never leave the bounds or fall.
    for (const [mx, mz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      for (let t = 1; t <= 480; t++) mvs.step(t, () => ({ ...NEUTRAL_MOVE, moveX: mx, moveZ: mz, run: true }));
      const p = mvs.position(1)!;
      expect(insideMapBounds(def, p[0], p[2]), `walked ${mx},${mz}`).toBe(true);
      expect(p[1]).toBeGreaterThan(-1);
    }
    mvs.dispose(); w.dispose();
  });
  test("craters work here: accepted on the ground, refused off it, and a fighter in the bowl stands lower", async () => {
    const w = await World.create(loadMapFile(mapFileUrl(def.collisionMapId)));
    const records = new ArenaState().craters;
    const craters = new CraterSystem(records, (x, z) => w.walkableTop(x, z) != null);
    const at = def.spawnPoints[0]!;
    expect(craters.add(at[0], at[2], 3, 10)).toBe(true);
    expect(craters.add(def.bounds.maxX + 20, def.bounds.maxZ + 20, 3, 10)).toBe(false);
    expect(craters.groundAt(at[0], at[2], 10)).toBeLessThan(-1);
    const mvs = new MovementSystem(w);
    mvs.setGround(craters.groundAt);
    mvs.add(1, [at[0], at[1] + ARENA.capsule.centreAboveSurface, at[2]]);
    const before = mvs.position(1)![1];
    for (let t = 11; t <= 40; t++) mvs.step(t, () => NEUTRAL_MOVE);
    expect(mvs.position(1)![1]).toBeLessThan(before - 0.8);
    expect(groundHeightAt(at[0], at[2], [{ x: at[0], z: at[2], radius: 3 }])).toBeLessThan(-1);
    mvs.dispose(); w.dispose();
  });
});

describe("WORLD01 map option schema (strict, against the registry)", () => {
  test("accepts every registry id and rejects unknown, prototype and non-string values", () => {
    for (const id of MAP_IDS) expect(MapIdSchema.safeParse(id).success).toBe(true);
    for (const bad of ["nope", "", "GROVE", "__proto__", "constructor", "toString", "hasOwnProperty", "coast ", 3, null, {}]) expect(MapIdSchema.safeParse(bad).success, String(bad)).toBe(false);
    expect(mapIdOrDefault(undefined)).toBe("grove");
    expect(mapIdOrDefault("coast")).toBe("coast");
    expect(() => getMapDefinition("__proto__")).toThrow(/unknown map/);
  });
  test("sparring create, sparring config and admin room create reject an unknown mapId and extra keys", () => {
    for (const schema of [SparringCreateRequestSchema, SparringConfigSchema]) {
      expect(schema.safeParse({ bots: [] }).success).toBe(true);
      expect(schema.safeParse({ bots: [], mapId: "coast" }).success).toBe(true);
      expect(schema.safeParse({ bots: [], mapId: "atlantis" }).success).toBe(false);
      expect(schema.safeParse({ bots: [], mapId: "constructor" }).success).toBe(false);
      expect(schema.safeParse({ bots: [], mapId: 1 }).success).toBe(false);
    }
    expect(AdminRoomCreateSchema.safeParse({ name: "x", mapId: "coast" }).success).toBe(true);
    expect(AdminRoomCreateSchema.safeParse({ name: "x", mapId: "atlantis" }).success).toBe(false);
    expect(AdminRoomCreateSchema.safeParse({ name: "x" }).success).toBe(true);
  });
});
