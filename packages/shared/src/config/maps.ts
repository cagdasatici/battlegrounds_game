/**
 * ARENA01: minimal map definition registry. Pure module: no DOM, Three.js, Rapier or Node APIs.
 * Each entry names a world (id), its horizontal walkable bounds, its spawn points and a visual theme id.
 * The geometry itself stays in config/arena.ts (collision artifact assets/maps/islands.v1.json); later worlds
 * (beach, snow) add an entry here plus their own geometry. Numbers are D (local design choices).
 */
import { z } from "zod";
import { ARENA, MAP_ID, buildIslandsMap, type ArenaMap } from "./arena.js";
import { BEAST } from "./beast.js";
import { COAST, buildLayoutMap } from "./worlds.js";

export type MapSpawnPoint = readonly [number, number, number];

export interface MapDefinition {
  /** Stable lowercase id used by rooms and clients. */
  readonly id: string;
  /** Player-facing name (original shipped names only). */
  readonly name: string;
  /** Collision artifact id (ArenaMap.mapId) that this world loads. */
  readonly collisionMapId: string;
  /** Axis aligned horizontal limits of everything walkable, in metres around the origin. */
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  readonly spawnPoints: readonly MapSpawnPoint[];
  /** Where the sparring beast may appear (it uses the one farthest from the humans). Must be walkable with a wide margin. */
  readonly beastAnchors: readonly MapSpawnPoint[];
  /** Visual theme key; the client maps it to palette and props. */
  readonly themeId: string;
}

const satHalf = ARENA.satellite.size / 2;
const reachX = Math.max(ARENA.main.width / 2, ...ARENA.satellite.centres.map(([x]) => Math.abs(x) + satHalf));
const reachZ = Math.max(ARENA.main.depth / 2, ...ARENA.satellite.centres.map(([, z]) => Math.abs(z) + satHalf));

/** The current world: the floating-island grove. */
export const GROVE_MAP: MapDefinition = {
  id: "grove",
  name: "Floating Grove",
  collisionMapId: MAP_ID,
  bounds: { minX: -reachX, maxX: reachX, minZ: -reachZ, maxZ: reachZ },
  spawnPoints: ARENA.spawnAnchors,
  beastAnchors: BEAST.anchors,
  themeId: "grove",
};

/** WORLD01: a beach with the sea on three sides. Bounds are the walkable slab (the boundary walls stand inside it). */
export const COAST_MAP: MapDefinition = {
  id: "coast",
  name: "Sunreach Coast",
  collisionMapId: COAST.collisionMapId,
  bounds: { minX: -COAST.halfX, maxX: COAST.halfX, minZ: -COAST.halfZ, maxZ: COAST.halfZ },
  spawnPoints: COAST.spawns,
  beastAnchors: COAST.beastAnchors,
  themeId: "coast",
};

export const MAP_REGISTRY: Readonly<Record<string, MapDefinition>> = { [GROVE_MAP.id]: GROVE_MAP, [COAST_MAP.id]: COAST_MAP };
export const DEFAULT_MAP_ID = GROVE_MAP.id;
/** Registry ids in display order. */
export const MAP_IDS: readonly string[] = Object.keys(MAP_REGISTRY);

export function getMapDefinition(id: string): MapDefinition {
  const m = Object.hasOwn(MAP_REGISTRY, id) ? MAP_REGISTRY[id] : undefined;
  if (!m) throw new Error(`unknown map ${id}`);
  return m;
}

/**
 * Strict room option: only ids that exist in the registry pass. `Object.hasOwn` keeps prototype keys such as
 * "constructor" or "__proto__" out. Optional wherever a request may omit it; use `mapIdOrDefault` to resolve.
 */
export const MapIdSchema = z.string().max(32).refine((id) => Object.hasOwn(MAP_REGISTRY, id), { message: "unknown map" });
export const mapIdOrDefault = (id: string | undefined): string => id ?? DEFAULT_MAP_ID;

/** Collision artifact content for a registry map, built from code (the files under assets/maps/ are checked equal by content:validate). */
export function buildMapCollision(m: MapDefinition): ArenaMap {
  if (m.collisionMapId === MAP_ID) return buildIslandsMap();
  if (m.id === COAST_MAP.id) return buildLayoutMap(COAST);
  throw new Error(`no collision builder for ${m.id}`);
}

export function insideMapBounds(m: MapDefinition, x: number, z: number): boolean {
  return x >= m.bounds.minX && x <= m.bounds.maxX && z >= m.bounds.minZ && z <= m.bounds.maxZ;
}

/** Clamp a horizontal position to the map bounds. */
export function clampToMapBounds(m: MapDefinition, x: number, z: number): [number, number] {
  return [Math.min(m.bounds.maxX, Math.max(m.bounds.minX, x)), Math.min(m.bounds.maxZ, Math.max(m.bounds.minZ, z))];
}

/** Registry check: ids match keys, bounds are well formed and every spawn point lies inside them and the void radius. */
export function validateMapRegistry(reg: Readonly<Record<string, MapDefinition>> = MAP_REGISTRY): string[] {
  const issues: string[] = [];
  for (const [key, m] of Object.entries(reg)) {
    if (m.id !== key) issues.push(`${key}: id mismatch ${m.id}`);
    if (!(m.bounds.minX < m.bounds.maxX && m.bounds.minZ < m.bounds.maxZ)) issues.push(`${key}: empty bounds`);
    if (m.spawnPoints.length === 0) issues.push(`${key}: no spawn points`);
    if (m.themeId.length === 0) issues.push(`${key}: no theme`);
    if (m.name.length === 0) issues.push(`${key}: no name`);
    if (m.beastAnchors.length === 0) issues.push(`${key}: no beast anchors`);
    m.beastAnchors.forEach((p, i) => { if (!insideMapBounds(m, p[0], p[2])) issues.push(`${key}: beast anchor ${i} outside bounds`); });
    m.spawnPoints.forEach((p, i) => { if (!insideMapBounds(m, p[0], p[2])) issues.push(`${key}: spawn ${i} outside bounds`); });
  }
  return issues;
}
