import { readFileSync } from "node:fs";
import RAPIER from "@dimforge/rapier3d-compat";
import { TICK_RATE } from "@eb/shared/protocol";
import { collisionHash, parseArenaMap, type ArenaMap, type Collider, type MapVec3 } from "@eb/shared/config/arena";

export const DEFAULT_MAP_URL = new URL("../../../../assets/maps/islands.v1.json", import.meta.url);

let ready: Promise<void> | null = null;
/** Rapier WASM init, once per process. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init();
  return ready;
}

/** WORLD01: artifact path of a collision map id (assets/maps/<id>.json). */
export function mapFileUrl(collisionMapId: string): URL { return new URL(`../../../../assets/maps/${collisionMapId}.json`, import.meta.url); }

export function loadMapFile(url: URL = DEFAULT_MAP_URL): ArenaMap {
  return parseArenaMap(JSON.parse(readFileSync(url, "utf8")) as unknown);
}

/**
 * Authoritative static collision world (spec sections 10 and 21).
 * Stepping is driven only by the FixedClock caller; timestep is fixed to 1/60 s.
 */
export class World {
  readonly rapier: RAPIER.World;
  private readonly ids = new Map<number, Collider>();
  private disposed = false;

  private constructor(readonly map: ArenaMap) {
    this.rapier = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gameplay applies gravity (spec 21)
    this.rapier.timestep = 1 / TICK_RATE;
    const body = this.rapier.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const c of map.colliders) {
      const desc = c.shape === "cuboid"
        ? RAPIER.ColliderDesc.cuboid(c.halfExtents[0], c.halfExtents[1], c.halfExtents[2])
        : RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
      desc.setTranslation(c.centre[0], c.centre[1], c.centre[2]);
      const col = this.rapier.createCollider(desc, body);
      this.ids.set(col.handle, c);
    }
    // Rapier 0.21 rebuilds its query BVH inside step(); prime it once so queries see static colliders.
    // Static-only world: this advances no gameplay state and is not a logical tick.
    this.rapier.step();
  }

  static async create(map: ArenaMap = loadMapFile()): Promise<World> {
    await initPhysics();
    return new World(map);
  }

  /** One physics step; call exactly once per logical tick. */
  step(): void {
    if (this.disposed) throw new Error("world disposed");
    this.rapier.step();
  }

  /** Reads shapes back from Rapier into map primitives; proves the loaded world equals the artifact. */
  realizedColliders(): Collider[] {
    const out: Collider[] = [];
    this.rapier.forEachCollider((col) => {
      const src = this.ids.get(col.handle);
      if (!src) throw new Error(`unknown collider handle ${col.handle}`);
      const t = col.translation();
      const centre: MapVec3 = [t.x, t.y, t.z];
      const s = col.shape;
      if (s instanceof RAPIER.Cuboid) {
        out.push({ id: src.id, role: src.role, shape: "cuboid", centre, halfExtents: [s.halfExtents.x, s.halfExtents.y, s.halfExtents.z] });
      } else if (s instanceof RAPIER.Cylinder) {
        out.push({ id: src.id, role: src.role, shape: "cylinder", centre, radius: s.radius, halfHeight: s.halfHeight });
      } else throw new Error(`unsupported shape on ${src.id}`);
    });
    return out;
  }

  collisionHash(): string {
    return collisionHash(this.realizedColliders());
  }

  /** Static collider ids intersecting a vertical capsule centred at `centre`. */
  capsuleOverlaps(centre: MapVec3, radius: number, halfHeight: number): string[] {
    const hits: string[] = [];
    this.rapier.intersectionsWithShape({ x: centre[0], y: centre[1], z: centre[2] }, { x: 0, y: 0, z: 0, w: 1 },
      new RAPIER.Capsule(halfHeight, radius), (col) => {
        const c = this.ids.get(col.handle);
        if (c) hits.push(c.id);
        return true;
      });
    return hits.sort();
  }

  /** Downward ray from `origin`; returns ground height or null over the void. */
  groundHeight(x: number, z: number, fromY = 50, maxDist = 100): number | null {
    const hit = this.rapier.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), maxDist, true);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  /** GR13: highest ground/bridge top whose footprint contains (x, z), or null over the void. Reads the loaded map only. */
  walkableTop(x: number, z: number): number | null {
    let best: number | null = null;
    for (const c of this.map.colliders) {
      if (c.role !== "ground" && c.role !== "bridge") continue;
      let inside: boolean, top: number;
      if (c.shape === "cuboid") {
        inside = Math.abs(x - c.centre[0]) <= c.halfExtents[0] && Math.abs(z - c.centre[2]) <= c.halfExtents[2];
        top = c.centre[1] + c.halfExtents[1];
      } else {
        inside = Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius;
        top = c.centre[1] + c.halfHeight;
      }
      if (inside && (best === null || top > best)) best = top;
    }
    return best;
  }

  /** True when static geometry blocks the straight segment a->b (player capsules are ignored). */
  segmentBlocked(a: MapVec3, b: MapVec3): boolean {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-6)) return false;
    const ray = new RAPIER.Ray({ x: a[0], y: a[1], z: a[2] }, { x: dx / len, y: dy / len, z: dz / len });
    return this.rapier.castRay(ray, len, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC) !== null;
  }

  /**
   * Continuous sphere sweep a -> b against static geometry (T19, A19). Returns the fraction 0..1 of the first contact
   * or null. A cast, not a point sample, so a fast projectile cannot tunnel through thin cover; a sphere that starts
   * overlapping geometry reports 0.
   */
  sweepSphere(a: MapVec3, b: MapVec3, radius: number): number | null {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    if (!(Math.hypot(dx, dy, dz) > 1e-9)) return null;
    const hit = this.rapier.castShape({ x: a[0], y: a[1], z: a[2] }, { x: 0, y: 0, z: 0, w: 1 }, { x: dx, y: dy, z: dz },
      new RAPIER.Ball(radius), 0, 1, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    return hit ? Math.max(0, Math.min(1, hit.time_of_impact)) : null;
  }

  /**
   * T23 wall opportunity (spec 13): true when a vertical static face (obstacle or guardrail) is within `gap` metres of
   * the capsule surface at `centre` and the capsule's vertical span overlaps it. Colliders are axis aligned boxes and
   * upright cylinders, so every side face normal is exactly horizontal (inside the 15 degree limit); the top face and a
   * capsule standing on top never count. Reads the loaded map only.
   */
  nearVerticalCollider(centre: MapVec3, capsuleRadius: number, halfHeight: number, gap: number): boolean {
    return this.verticalFaceNear(centre, capsuleRadius, halfHeight, gap) !== null;
  }

  /** Horizontal unit normal pointing from the nearest qualifying face toward `centre`, or null (see nearVerticalCollider). */
  verticalFaceNear(centre: MapVec3, capsuleRadius: number, halfHeight: number, gap: number): [number, number] | null {
    let best: { d: number; nx: number; nz: number } | null = null;
    for (const c of this.map.colliders) {
      if (c.role !== "obstacle" && c.role !== "guardrail") continue;
      const hy = c.shape === "cuboid" ? c.halfExtents[1] : c.halfHeight;
      if (Math.abs(centre[1] - c.centre[1]) > hy + halfHeight) continue; // no vertical overlap
      let nx: number, nz: number, d: number;
      if (c.shape === "cuboid") {
        const ox = centre[0] - c.centre[0], oz = centre[2] - c.centre[2];
        const ex = Math.max(Math.abs(ox) - c.halfExtents[0], 0), ez = Math.max(Math.abs(oz) - c.halfExtents[2], 0);
        d = Math.hypot(ex, ez);
        if (d <= 1e-9) continue; // inside the footprint (on top): not a side face
        nx = Math.sign(ox) * ex / d; nz = Math.sign(oz) * ez / d;
      } else {
        const ox = centre[0] - c.centre[0], oz = centre[2] - c.centre[2];
        const r = Math.hypot(ox, oz);
        d = r - c.radius;
        if (d <= 1e-9 || r <= 1e-9) continue;
        nx = ox / r; nz = oz / r;
      }
      if (d - capsuleRadius > gap) continue;
      if (!best || d < best.d) best = { d, nx, nz };
    }
    return best ? [best.nx, best.nz] : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ids.clear();
    this.rapier.free();
  }
}
