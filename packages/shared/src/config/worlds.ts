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
  /** Id prefix of the four boundary walls ("shore" at the sea, "tree" at the tree line): `<prefix>.n|s|w|e`. */
  readonly wall: string;
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
  wall: "shore",
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

/**
 * Frostpeak: a snowy clearing ringed by a tree line, with a mountain ring beyond (visual backdrop, see render/worlds/frostWorld.ts).
 * Pines are collided trunks (the crowns are drawn), boulders and snow drifts give cover. Ice patches are decoration only: footing is
 * unchanged on them (a slippery surface would need a movement rule and its own test).
 */
export const FROST: WorldLayout = {
  collisionMapId: "frost.v1",
  wall: "tree",
  halfX: 50,
  halfZ: 46,
  voidY: -25,
  boundaryRadius: 85,
  obstacles: [
    pole("pine.0", -38, -28, 0.55, 8), pole("pine.1", -18, -36, 0.55, 8), pole("pine.2", 20, -34, 0.55, 8), pole("pine.3", 38, -26, 0.55, 8),
    pole("pine.4", -40, 16, 0.55, 8), pole("pine.5", 40, 18, 0.55, 8), pole("pine.6", -20, 30, 0.55, 8), pole("pine.7", 24, 32, 0.55, 8),
    block("rock.0", -14, -8, 1.8, 2.2, 1.5), block("rock.1", 15, -10, 1.6, 2, 1.8), block("rock.2", 0, 18, 2.2, 1.8, 1.4),
    block("rock.3", -26, 6, 1.5, 2, 1.5), block("rock.4", 28, 8, 1.7, 2.2, 1.4), block("rock.5", 0, -24, 2, 2.4, 1.5),
    // Snow drifts: knee high (0.7 m) cover.
    block("drift.0", -6, 10, 2.2, 0.7, 1), block("drift.1", 8, 12, 1, 0.7, 2.2), block("drift.2", -30, -10, 2, 0.7, 1), block("drift.3", 36, -2, 1, 0.7, 2),
  ],
  spawns: [[-32, 0, -14], [32, 0, -14], [-32, 0, 14], [32, 0, 14], [-12, 0, -30], [12, 0, -30], [-12, 0, 26], [12, 0, 26]],
  urns: [[-22, 0.25, -6], [22, 0.25, -6], [-22, 0.25, 10], [22, 0.25, 10], [-4, 0.25, -30], [4, 0.25, -30], [-4, 0.25, 12], [4, 0.25, 26]],
  beastAnchors: [[-28, 0, -20], [28, 0, -20], [-28, 0, 20], [28, 0, 20]],
};

/** Decorative ice patches [x, z, half width, half depth] (flat, flush with the snow). Always inside the slab; they change nothing in the simulation. */
export const FROST_ICE_PATCHES: ReadonlyArray<readonly [number, number, number, number]> = [
  [-6, -4, 5, 3.5], [10, 6, 4.5, 6], [-20, 16, 6, 4], [22, -18, 5, 4], [0, 28, 7, 3.5], [-30, -20, 4, 5], [34, 22, 4, 3],
];

/** Walkable slab plus four inner boundary walls plus the layout's obstacles. */
export function layoutColliders(l: WorldLayout): Collider[] {
  const { halfX: hx, halfZ: hz } = l;
  const wy = (WALL_Y0 + WALL_Y1) / 2, wh = (WALL_Y1 - WALL_Y0) / 2;
  return [
    box("ground.main", "ground", [0, -SLAB_T / 2, 0], [hx, SLAB_T / 2, hz]),
    box(`${l.wall}.n`, "guardrail", [0, wy, -hz + WALL_T], [hx, wh, WALL_T]),
    box(`${l.wall}.s`, "guardrail", [0, wy, hz - WALL_T], [hx, wh, WALL_T]),
    box(`${l.wall}.w`, "guardrail", [-hx + WALL_T, wy, 0], [WALL_T, wh, hz - 2 * WALL_T]),
    box(`${l.wall}.e`, "guardrail", [hx - WALL_T, wy, 0], [WALL_T, wh, hz - 2 * WALL_T]),
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
export const buildFrostMap = (): ArenaMap => buildLayoutMap(FROST);

/** The non-grove layouts by collision id (the grove builds from config/arena.ts). */
export const WORLD_LAYOUTS: Readonly<Record<string, WorldLayout>> = { [COAST.collisionMapId]: COAST, [FROST.collisionMapId]: FROST };
