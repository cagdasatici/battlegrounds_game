/**
 * Floating island arena registry and collision description (spec section 10).
 * Pure module: no DOM, Three.js, Rapier or Node APIs. The committed map artifact
 * assets/maps/islands.v1.json must equal buildIslandsMap(); content:validate checks it.
 *
 * Numbers marked D are local design choices where the spec is silent.
 */
import { z } from "zod";
import { contentHashOf } from "../math.js";

export const MAP_ID = "islands.v1";
export const MAP_SCHEMA_VERSION = 1;

/** Spec section 10 and capsule row of section 12. */
export const ARENA = {
  voidY: -25,
  boundaryRadius: 90,
  islandThickness: 5,
  /** D: BEAST01 enlarged the main island 1.5x (was 48 x 40) so a 5.5x beast has room to move. */
  main: { width: 72, depth: 60, cornerRadius: 4 /* D */ },
  satellite: { size: 12, centres: [[-48, 0], [48, 0], [0, -42], [0, 42]] as const },
  bridge: { width: 4, thickness: 0.5 /* D */ },
  pillar: { size: [3, 2, 2] as const, centres: [[-12, 1, -10], [12, 1, -10], [-12, 1, 10], [12, 1, 10]] as const },
  wall: { size: [4, 1.2, 0.6] as const, centres: [[-10, 0.6, 0], [10, 0.6, 0]] as const },
  clearCentreDiameter: 12,
  /** D: guardrails only on the outer edge of the east and west spawn decks. */
  guardrail: { height: 1, thickness: 0.2 },
  spawnAnchors: [[-18, 0, -14], [18, 0, -14], [-18, 0, 14], [18, 0, 14], [-46, 0, -3], [46, 0, -3], [-46, 0, 3], [46, 0, 3]] as const,
  urnAnchors: [[-9, 0.25, -10], [9, 0.25, -10], [-9, 0.25, 10], [9, 0.25, 10], [-15, 0.25, -10], [15, 0.25, -10], [-15, 0.25, 10], [15, 0.25, 10]] as const,
  urnRadius: 0.25,
  capsule: { radius: 0.35, halfHeight: 0.55, centreAboveSurface: 0.9 },
  /** D: max top height difference treated as a seamless walkable join. */
  joinTolerance: 0.01,
} as const;

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export type MapVec3 = [number, number, number];

const role = z.enum(["ground", "bridge", "obstacle", "guardrail"]);
export const ColliderSchema = z.discriminatedUnion("shape", [
  z.strictObject({ id: z.string().min(1), role, shape: z.literal("cuboid"), centre: vec3, halfExtents: vec3 }),
  z.strictObject({ id: z.string().min(1), role, shape: z.literal("cylinder"), centre: vec3, radius: z.number().positive(), halfHeight: z.number().positive() }),
]);
export type Collider = z.infer<typeof ColliderSchema>;

export const AnchorSchema = z.strictObject({ id: z.number().int().nonnegative(), position: vec3 });
export type Anchor = z.infer<typeof AnchorSchema>;

export const ArenaMapSchema = z.strictObject({
  schemaVersion: z.literal(MAP_SCHEMA_VERSION),
  mapId: z.literal(MAP_ID),
  voidY: z.number(),
  boundaryRadius: z.number().positive(),
  colliders: z.array(ColliderSchema).min(1),
  spawnAnchors: z.array(AnchorSchema).min(1),
  urnAnchors: z.array(AnchorSchema),
  contentHash: z.string().regex(/^[0-9a-f]{16}$/),
});
export type ArenaMap = z.infer<typeof ArenaMapSchema>;

/** Quantize to millimetres so hashes are stable across float readback (e.g. Rapier f32). */
const q = (n: number): number => Math.round(n * 1000);
const qv = (v: readonly number[]): number[] => v.map(q);

/** Canonical collision fingerprint: order independent (sorted by id), mm quantized. */
export function collisionHash(colliders: readonly Collider[]): string {
  const rows = [...colliders]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) =>
      c.shape === "cuboid"
        ? [c.id, c.role, "cuboid", qv(c.centre), qv(c.halfExtents)]
        : [c.id, c.role, "cylinder", qv(c.centre), q(c.radius), q(c.halfHeight)],
    );
  return contentHashOf("collision", rows);
}

/** Hash stored in the artifact: collision plus anchors and kill planes. */
export function mapContentHash(m: Omit<ArenaMap, "contentHash">): string {
  return contentHashOf(m.schemaVersion, m.mapId, q(m.voidY), q(m.boundaryRadius), collisionHash(m.colliders),
    m.spawnAnchors.map((a) => [a.id, qv(a.position)]), m.urnAnchors.map((a) => [a.id, qv(a.position)]));
}

const box = (id: string, r: Collider["role"], centre: MapVec3, half: MapVec3): Collider =>
  ({ id, role: r, shape: "cuboid", centre, halfExtents: half });

/** Generates the canonical collision description from the registry. */
export function buildIslandsMap(): ArenaMap {
  const A = ARENA;
  const t = A.islandThickness;
  const cy = -t / 2;
  const hw = A.main.width / 2, hd = A.main.depth / 2, r = A.main.cornerRadius;
  const cols: Collider[] = [
    // Rounded rectangle main island: cross of two cuboids plus four corner cylinders.
    box("main.x", "ground", [0, cy, 0], [hw, t / 2, hd - r]),
    box("main.z", "ground", [0, cy, 0], [hw - r, t / 2, hd]),
  ];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    cols.push({ id: `main.corner.${sx < 0 ? "w" : "e"}${sz < 0 ? "n" : "s"}`, role: "ground", shape: "cylinder", centre: [sx * (hw - r), cy, sz * (hd - r)], radius: r, halfHeight: t / 2 });
  }
  const names = ["west", "east", "north", "south"] as const;
  const hs = A.satellite.size / 2;
  A.satellite.centres.forEach(([x, z], i) => {
    const n = names[i]!;
    cols.push(box(`sat.${n}`, "ground", [x, cy, z], [hs, t / 2, hs]));
    // Bridge spans the gap between main edge and satellite edge, top flush at y=0.
    const bt = A.bridge.thickness, bw = A.bridge.width / 2;
    if (z === 0) {
      const a = hw, b = Math.abs(x) - hs, s = Math.sign(x);
      cols.push(box(`bridge.${n}`, "bridge", [s * (a + b) / 2, -bt / 2, 0], [(b - a) / 2, bt / 2, bw]));
      const g = A.guardrail;
      cols.push(box(`rail.${n}`, "guardrail", [s * (Math.abs(x) + hs - g.thickness / 2), g.height / 2, 0], [g.thickness / 2, g.height / 2, hs]));
    } else {
      const a = hd, b = Math.abs(z) - hs, s = Math.sign(z);
      cols.push(box(`bridge.${n}`, "bridge", [0, -bt / 2, s * (a + b) / 2], [bw, bt / 2, (b - a) / 2]));
    }
  });
  A.pillar.centres.forEach((c, i) => cols.push(box(`pillar.${i}`, "obstacle", [...c], [A.pillar.size[0] / 2, A.pillar.size[1] / 2, A.pillar.size[2] / 2])));
  A.wall.centres.forEach((c, i) => cols.push(box(`wall.${i}`, "obstacle", [...c], [A.wall.size[0] / 2, A.wall.size[1] / 2, A.wall.size[2] / 2])));
  const body = {
    schemaVersion: MAP_SCHEMA_VERSION, mapId: MAP_ID, voidY: A.voidY, boundaryRadius: A.boundaryRadius,
    colliders: cols,
    spawnAnchors: A.spawnAnchors.map((p, id) => ({ id, position: [...p] as MapVec3 })),
    urnAnchors: A.urnAnchors.map((p, id) => ({ id, position: [...p] as MapVec3 })),
  } as const;
  return { ...body, contentHash: mapContentHash(body) };
}

/** Strict parse of an untrusted map JSON value, including stored hash check. */
export function parseArenaMap(raw: unknown): ArenaMap {
  const m = ArenaMapSchema.parse(raw);
  const ids = new Set<string>();
  for (const c of m.colliders) {
    if (ids.has(c.id)) throw new Error(`duplicate collider id ${c.id}`);
    ids.add(c.id);
    if (c.shape === "cuboid" && c.halfExtents.some((h) => h <= 0)) throw new Error(`non-positive extent ${c.id}`);
  }
  const { contentHash, ...body } = m;
  if (mapContentHash(body) !== contentHash) throw new Error("map content hash mismatch");
  return m;
}

// ---------------- Build validator (pure geometry, no Rapier) ----------------

interface Aabb { min: MapVec3; max: MapVec3 }
export function colliderAabb(c: Collider): Aabb {
  const [x, y, z] = c.centre;
  const [hx, hy, hz] = c.shape === "cuboid" ? c.halfExtents : [c.radius, c.halfHeight, c.radius];
  return { min: [x - hx, y - hy, z - hz], max: [x + hx, y + hy, z + hz] };
}
const top = (c: Collider): number => colliderAabb(c).max[1];

/** True when the horizontal point lies on the collider's top footprint with `margin` inset. */
function footprintContains(c: Collider, x: number, z: number, margin: number): boolean {
  if (c.shape === "cylinder") return Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius - margin;
  return Math.abs(x - c.centre[0]) <= c.halfExtents[0] - margin && Math.abs(z - c.centre[2]) <= c.halfExtents[2] - margin;
}

/** Highest map surface at a sample beneath the cast origin. A missing surface is open air. */
export function surfaceBelow(colliders: readonly Collider[], x: number, z: number, fromY: number): number | null {
  let height: number | null = null;
  for (const c of colliders) {
    if (!footprintContains(c, x, z, 0)) continue;
    const y = top(c);
    if (y <= fromY && (height === null || y > height)) height = y;
  }
  return height;
}

/** Shortest horizontal distance from point to collider footprint (0 inside). */
function footprintDistance(c: Collider, x: number, z: number): number {
  if (c.shape === "cylinder") return Math.max(0, Math.hypot(x - c.centre[0], z - c.centre[2]) - c.radius);
  const dx = Math.max(0, Math.abs(x - c.centre[0]) - c.halfExtents[0]);
  const dz = Math.max(0, Math.abs(z - c.centre[2]) - c.halfExtents[2]);
  return Math.hypot(dx, dz);
}

/** Two walkable tops touch or overlap horizontally with a shared edge at least `minWidth` wide. */
function joined(a: Collider, b: Collider, minWidth: number, tol: number): boolean {
  if (Math.abs(top(a) - top(b)) > tol) return false;
  const A = colliderAabb(a), B = colliderAabb(b);
  const ox = Math.min(A.max[0], B.max[0]) - Math.max(A.min[0], B.min[0]);
  const oz = Math.min(A.max[2], B.max[2]) - Math.max(A.min[2], B.min[2]);
  if (ox < -tol || oz < -tol) return false;
  return Math.max(ox, oz) >= minWidth - tol;
}

export interface ValidationIssue { code: "BRIDGE" | "HEADROOM" | "CONTAINMENT" | "VOID" | "CENTRE" | "HASH"; detail: string }

/**
 * Spec section 10 build check: bridge connectivity, capsule headroom,
 * spawn containment, every anchor above the void and inside the boundary,
 * and the clear central area.
 */
export function validateArenaMap(m: ArenaMap): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const cap = ARENA.capsule;
  const tol = ARENA.joinTolerance;
  const walk = m.colliders.filter((c) => c.role === "ground" || c.role === "bridge");
  const solids = m.colliders.filter((c) => c.role === "obstacle" || c.role === "guardrail");
  const { contentHash, ...body } = m;
  if (mapContentHash(body) !== contentHash) out.push({ code: "HASH", detail: "stored contentHash does not match" });

  // Connectivity over walkable tops; every bridge must join two distinct grounds.
  const parent = walk.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < walk.length; i++)
    for (let j = i + 1; j < walk.length; j++)
      if (joined(walk[i]!, walk[j]!, 2 * cap.radius, tol)) parent[find(i)] = find(j);
  const roots = new Set(walk.map((_, i) => find(i)));
  if (roots.size !== 1) out.push({ code: "BRIDGE", detail: `walkable surfaces form ${roots.size} disconnected groups` });
  for (const b of walk.filter((c) => c.role === "bridge")) {
    const grounds = walk.filter((g) => g.role === "ground" && joined(b, g, 2 * cap.radius, tol));
    if (grounds.length < 2) out.push({ code: "BRIDGE", detail: `${b.id} joins ${grounds.length} ground surfaces` });
  }

  const anchors = [...m.spawnAnchors.map((a) => ({ kind: "spawn", ...a })), ...m.urnAnchors.map((a) => ({ kind: "urn", ...a }))];
  for (const a of anchors) {
    const [x, y, z] = a.position;
    if (!(y > m.voidY)) out.push({ code: "VOID", detail: `${a.kind} ${a.id} at y=${y} not above void ${m.voidY}` });
    if (Math.hypot(x, z) >= m.boundaryRadius) out.push({ code: "VOID", detail: `${a.kind} ${a.id} outside boundary radius` });
    const surfaceY = a.kind === "spawn" ? y : y - ARENA.urnRadius;
    const support = walk.filter((c) => Math.abs(top(c) - surfaceY) <= tol && footprintContains(c, x, z, 0));
    if (support.length === 0) out.push({ code: "CONTAINMENT", detail: `${a.kind} ${a.id} has no supporting surface` });
  }

  for (const a of m.spawnAnchors) {
    const [x, y, z] = a.position;
    // Capsule must be fully over walkable ground: every point of its horizontal disc has support.
    const ok = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]]
      .every(([dx, dz]) => walk.some((c) => Math.abs(top(c) - y) <= tol && footprintContains(c, x + dx! * cap.radius, z + dz! * cap.radius, 0)));
    if (!ok) out.push({ code: "CONTAINMENT", detail: `spawn ${a.id} capsule overhangs an edge` });
    // Headroom: capsule volume (centre surface+0.9, total 1.8 m) intersects no collider.
    const cyc = y + cap.centreAboveSurface;
    const lo = cyc - cap.halfHeight - cap.radius, hi = cyc + cap.halfHeight + cap.radius;
    for (const c of m.colliders) {
      const bb = colliderAabb(c);
      if (bb.max[1] <= lo + tol || bb.min[1] >= hi) continue;
      if (footprintDistance(c, x, z) < cap.radius) out.push({ code: "HEADROOM", detail: `spawn ${a.id} capsule intersects ${c.id}` });
    }
  }

  const rc = ARENA.clearCentreDiameter / 2;
  for (const s of solids) if (footprintDistance(s, 0, 0) < rc) out.push({ code: "CENTRE", detail: `${s.id} inside clear centre` });
  return out;
}
