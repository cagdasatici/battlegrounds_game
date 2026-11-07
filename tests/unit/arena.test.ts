import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ARENA, buildIslandsMap, collisionHash, mapContentHash, parseArenaMap, validateArenaMap, type ArenaMap,
} from "../../packages/shared/src/config/arena.js";
import { canonicalJson } from "../../packages/shared/src/math.js";
import { World, loadMapFile } from "../../apps/server/src/sim/World.js";

const raw = JSON.parse(readFileSync(new URL("../../assets/maps/islands.v1.json", import.meta.url), "utf8")) as unknown;
const clone = (m: ArenaMap): ArenaMap => JSON.parse(JSON.stringify(m)) as ArenaMap;
const rehash = (m: ArenaMap): ArenaMap => { const { contentHash: _, ...b } = m; return { ...b, contentHash: mapContentHash(b) }; };
const codes = (m: ArenaMap) => validateArenaMap(m).map((i) => i.code);

describe("map artifact", () => {
  test("committed JSON equals the registry and passes strict parse", () => {
    expect(canonicalJson(parseArenaMap(raw))).toBe(canonicalJson(buildIslandsMap()));
  });
  test("build validator passes on the shipped map", () => {
    expect(validateArenaMap(buildIslandsMap())).toEqual([]);
  });
  test("strict schema rejects extra keys, tampered hash and duplicate ids", () => {
    expect(() => parseArenaMap({ ...(raw as object), extra: 1 })).toThrow();
    expect(() => parseArenaMap({ ...(raw as object), contentHash: "0000000000000000" })).toThrow(/hash/);
    const m = clone(buildIslandsMap());
    m.colliders[1]!.id = m.colliders[0]!.id;
    expect(() => parseArenaMap(rehash(m))).toThrow(/duplicate/);
  });
  test("spec geometry: 8 spawns, 8 urns, 4 bridges, 4 pillars, 2 walls", () => {
    const m = buildIslandsMap();
    expect(m.spawnAnchors).toHaveLength(8);
    expect(m.urnAnchors).toHaveLength(8);
    expect(m.colliders.filter((c) => c.role === "bridge")).toHaveLength(4);
    expect(m.colliders.filter((c) => c.id.startsWith("pillar"))).toHaveLength(4);
    expect(m.colliders.filter((c) => c.id.startsWith("wall"))).toHaveLength(2);
    for (const b of m.colliders.filter((c) => c.role === "bridge")) {
      if (b.shape !== "cuboid") throw new Error("bridge must be cuboid");
      const [hx, , hz] = b.halfExtents;
      expect([Math.min(hx, hz) * 2, Math.max(hx, hz) * 2]).toEqual([ARENA.bridge.width, 6]);
    }
  });
  test("collision hash is order independent but sensitive to 1 mm changes", () => {
    const m = buildIslandsMap();
    expect(collisionHash([...m.colliders].reverse())).toBe(collisionHash(m.colliders));
    const moved = clone(m);
    moved.colliders[0]!.centre[0] += 0.001;
    expect(collisionHash(moved.colliders)).not.toBe(collisionHash(m.colliders));
  });
});

describe("build validator negatives", () => {
  test("removed bridge disconnects a satellite", () => {
    const m = clone(buildIslandsMap());
    m.colliders = m.colliders.filter((c) => c.id !== "bridge.east");
    expect(codes(rehash(m))).toContain("BRIDGE");
  });
  test("bridge narrower than the capsule does not connect", () => {
    const m = clone(buildIslandsMap());
    const b = m.colliders.find((c) => c.id === "bridge.north")!;
    if (b.shape === "cuboid") b.halfExtents[0] = 0.3;
    expect(codes(rehash(m))).toContain("BRIDGE");
  });
  test("obstacle over a spawn breaks headroom", () => {
    const m = clone(buildIslandsMap());
    m.colliders.push({ id: "beam", role: "obstacle", shape: "cuboid", centre: [18, 1.7, 14], halfExtents: [1, 0.1, 1] });
    expect(codes(rehash(m))).toContain("HEADROOM");
  });
  test("spawn off the edge or over the void fails containment and void checks", () => {
    const m = clone(buildIslandsMap());
    m.spawnAnchors[0]!.position = [23.8, 0, 0];
    m.spawnAnchors[1]!.position = [60, -30, 0];
    m.urnAnchors[0]!.position = [95, 0.25, 0];
    const c = codes(rehash(m));
    expect(c).toContain("CONTAINMENT");
    expect(c).toContain("VOID");
  });
  test("obstacle in the clear centre is flagged", () => {
    const m = clone(buildIslandsMap());
    m.colliders.push({ id: "rock", role: "obstacle", shape: "cuboid", centre: [2, 1, 0], halfExtents: [1, 1, 1] });
    expect(codes(rehash(m))).toContain("CENTRE");
  });
  test("stale stored hash is reported", () => {
    const m = clone(buildIslandsMap());
    m.voidY = -20;
    expect(codes(m)).toContain("HASH");
  });
});

describe("server Rapier world", () => {
  let w: World;
  beforeAll(async () => { w = await World.create(loadMapFile()); });
  afterAll(() => w.dispose());

  test("collision hash read back from Rapier matches the artifact", () => {
    expect(w.collisionHash()).toBe(collisionHash(buildIslandsMap().colliders));
    expect(w.realizedColliders()).toHaveLength(buildIslandsMap().colliders.length);
  });
  test("every spawn capsule is free and stands on ground at y=0", () => {
    const { radius, halfHeight, centreAboveSurface } = ARENA.capsule;
    for (const a of w.map.spawnAnchors) {
      const [x, y, z] = a.position;
      expect(w.capsuleOverlaps([x, y + centreAboveSurface + 0.01, z], radius, halfHeight)).toEqual([]);
      expect(w.groundHeight(x, z)).toBeCloseTo(0, 4);
    }
  });
  test("bridges are walkable mid span and the gap beside them is void", () => {
    expect(w.groundHeight(39, 0)).toBeCloseTo(0, 4);
    expect(w.groundHeight(0, -33)).toBeCloseTo(0, 4);
    expect(w.groundHeight(39, 3)).toBeNull();
  });
  test("pillar blocks a capsule; step is fixed 1/60 s; dispose is idempotent", async () => {
    expect(w.capsuleOverlaps([12, 0.9, 10], 0.35, 0.55)).toContain("pillar.3");
    expect(w.rapier.timestep).toBeCloseTo(1 / 60, 6);
    w.step();
    const w2 = await World.create();
    w2.dispose();
    w2.dispose();
    expect(() => w2.step()).toThrow(/disposed/);
  });
});
