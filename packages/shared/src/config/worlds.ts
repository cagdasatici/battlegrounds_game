/**
 * WORLD01/WORLD02: collision layouts of the non floating-island maps (Sunreach Coast, Frostpeak). Pure module: no DOM,
 * Three.js, Rapier or Node APIs. Like `buildIslandsMap`, each builder is the single source of an artifact under
 * assets/maps/ that content:validate keeps equal. Every number is D (local design choice).
 *
 * Shape shared by both worlds: one flat walkable slab whose top is y = 0 (so CRATER01 craters, Rapier and client
 * prediction behave exactly as on the grove), four boundary walls (role "guardrail") standing just INSIDE the slab edge
 * (they are the sea shore line / the tree line; the server and the client prediction both collide with them, so the
 * authoritative clamp needs no second code path), and obstacle colliders for cover. Everything stays inside the grove
 * bounds, so the bot navigation grid (sized from the grove) covers every map.
 */
import { mapContentHash, MAP_SCHEMA_VERSION, type ArenaMap, type Collider, type CollisionMapId, type MapVec3 } from "./arena.js";

/** Walkable slab thickness below y = 0 and boundary wall dimensions (D). */
const SLAB_T = 5;
const WALL_T = 0.5, WALL_Y0 = -2, WALL_Y1 = 6;

const box = (id: string, role: Collider["role"], centre: MapVec3, half: MapVec3): Collider => ({ id, role, shape: "cuboid", centre, halfExtents: half });
const pole = (id: string, x: number, z: number, r: number, h: number): Collider => ({ id, role: "obstacle", shape: "cylinder", centre: [x, h / 2, z], radius: r, halfHeight: h / 2 });
/** Low or tall block standing on the slab at (x, z). */
const block = (id: string, x: number, z: number, hx: number, h: number, hz: number): Collider => box(id, "obstacle", [x, h / 2, z], [hx, h / 2, hz]);

export interface WorldLayout {
  readonly collisionMapId: CollisionMapId;
  /** Half extents of the walkable slab, metres. The bounds of the registry entry are exactly the slab. */
  readonly halfX: number;
  readonly halfZ: number;
  readonly voidY: number;
  readonly boundaryRadius: number;
  readonly obstacles: readonly Collider[];
  readonly spawns: ReadonlyArray<readonly [number, number, number]>;
  readonly urns: ReadonlyArray<readonly [number, number, number]>;
  readonly beastAnchors: ReadonlyArray<readonly [number, number, number]>;
}

/** Sunreach Coast: a sand beach with the sea on the south, east and west; palms and dunes at its back. */
export const COAST: WorldLayout = {
  collisionMapId: "coast.v1",
  halfX: 54,
  halfZ: 44,
  voidY: -25,
  boundaryRadius: 85,
  obstacles: [
    // Palm trunks (the fronds are drawn, not collided): a loose arc along the back of the beach plus two mid-beach palms.
    pole("palm.0", -44, -30, 0.42, 6), pole("palm.1", -30, -37, 0.42, 6), pole("palm.2", -12, -39, 0.42, 6), pole("palm.3", 14, -38, 0.42, 6),
    pole("palm.4", 32, -34, 0.42, 6), pole("palm.5", 46, -24, 0.42, 6), pole("palm.6", -30, -8, 0.42, 6), pole("palm.7", 28, -8, 0.42, 6),
    // Boulders: tall enough to block shots and the walk, too tall to step on.
    block("rock.0", -16, 6, 1.8, 2, 1.4), block("rock.1", 17, 5, 1.5, 2, 1.8), block("rock.2", 0, 20, 2.2, 1.8, 1.2),
    block("rock.3", -8, -16, 1.2, 2.2, 1.6), block("rock.4", 10, -18, 1.6, 2, 1.2), block("rock.5", 42, 16, 2, 2.4, 2), block("rock.6", -42, 20, 2, 2.4, 2),
    // Driftwood: knee high cover (0.7 m).
    block("log.0", -8, 10, 2, 0.7, 0.4), block("log.1", 8, 12, 0.4, 0.7, 2), block("log.2", -26, -20, 2, 0.7, 0.4), block("log.3", 24, -22, 0.4, 0.7, 2),
  ],
  spawns: [[-34, 0, -16], [34, 0, -16], [-34, 0, 16], [34, 0, 16], [-14, 0, -30], [14, 0, -30], [-14, 0, 26], [14, 0, 26]],
  urns: [[-22, 0.25, -8], [22, 0.25, -8], [-22, 0.25, 10], [22, 0.25, 10], [-4, 0.25, -28], [4, 0.25, -28], [-4, 0.25, 14], [4, 0.25, 30]],
  beastAnchors: [[-30, 0, -20], [30, 0, -20], [-30, 0, 20], [30, 0, 20]],
};

/** Walkable slab plus four inner boundary walls plus the layout's obstacles. */
export function layoutColliders(l: WorldLayout): Collider[] {
  const { halfX: hx, halfZ: hz } = l;
  const wy = (WALL_Y0 + WALL_Y1) / 2, wh = (WALL_Y1 - WALL_Y0) / 2;
  return [
    box("ground.main", "ground", [0, -SLAB_T / 2, 0], [hx, SLAB_T / 2, hz]),
    box("shore.n", "guardrail", [0, wy, -hz + WALL_T], [hx, wh, WALL_T]),
    box("shore.s", "guardrail", [0, wy, hz - WALL_T], [hx, wh, WALL_T]),
    box("shore.w", "guardrail", [-hx + WALL_T, wy, 0], [WALL_T, wh, hz - 2 * WALL_T]),
    box("shore.e", "guardrail", [hx - WALL_T, wy, 0], [WALL_T, wh, hz - 2 * WALL_T]),
    ...l.obstacles,
  ];
}

export function buildLayoutMap(l: WorldLayout): ArenaMap {
  const body = {
    schemaVersion: MAP_SCHEMA_VERSION, mapId: l.collisionMapId, voidY: l.voidY, boundaryRadius: l.boundaryRadius,
    colliders: layoutColliders(l),
    spawnAnchors: l.spawns.map((p, id) => ({ id, position: [...p] as MapVec3 })),
    urnAnchors: l.urns.map((p, id) => ({ id, position: [...p] as MapVec3 })),
  } as const;
  return { ...body, contentHash: mapContentHash(body) };
}

export const buildCoastMap = (): ArenaMap => buildLayoutMap(COAST);

/** The non-grove layouts by collision id (the grove builds from config/arena.ts). */
export const WORLD_LAYOUTS: Readonly<Record<string, WorldLayout>> = { [COAST.collisionMapId]: COAST };
