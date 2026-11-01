// ART1: visual meshes stay aligned with their colliders, dressing never covers walkable ground, assets stay in budget.
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mesh } from "three";
import { buildIslandsMap, type Collider } from "../../packages/shared/src/config/arena.js";
import { buildArena, planDressing } from "../../apps/client/src/scene/ArenaView.js";
import { ENV_MODELS } from "../../apps/client/src/scene/EnvAssets.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { P0_ASSET_BYTES_MAX, ManifestSchema } from "../../packages/shared/src/art.js";

const colliders = buildIslandsMap().colliders;
const aabb = (c: Collider): { min: number[]; max: number[] } => {
  const [x, y, z] = c.centre;
  const h = c.shape === "cuboid" ? c.halfExtents : [c.radius, c.halfHeight, c.radius];
  return { min: [x - h[0]!, y - h[1]!, z - h[2]!], max: [x + h[0]!, y + h[1]!, z + h[2]!] };
};
const TOL = 0.05;

describe("ART1 collider alignment", () => {
  const arena = buildArena(colliders, makeToonRamp());
  it("has exactly one mesh per collider id", () => {
    for (const c of colliders) expect(arena.group.children.filter((o) => o.name === c.id), c.id).toHaveLength(1);
  });
  it("each collider mesh AABB matches its collider within 0.05 m", () => {
    for (const c of colliders) {
      const mesh = arena.group.getObjectByName(c.id) as Mesh;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!, want = aabb(c);
      const got = [box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z];
      const exp = [...want.min, ...want.max];
      got.forEach((v, i) => expect(Math.abs(v - exp[i]!), `${c.id}[${i}] ${v} vs ${exp[i]}`).toBeLessThanOrEqual(TOL + 1e-6));
    }
  });
});

describe("ART1 dressing placement", () => {
  const plan = planDressing(colliders);
  const ground = colliders.filter((c) => c.role === "ground");
  const inFootprint = (x: number, z: number): boolean => ground.some((c) => (c.shape === "cuboid" ? Math.abs(x - c.centre[0]) <= c.halfExtents[0] && Math.abs(z - c.centre[2]) <= c.halfExtents[2] : Math.hypot(x - c.centre[0], z - c.centre[2]) <= c.radius));
  it("is deterministic and non-trivial", () => {
    expect(planDressing(colliders)).toEqual(plan);
    expect(plan.length).toBeGreaterThan(30);
    for (const p of plan) expect(ENV_MODELS).toContain(p.model);
  });
  it("never sits on walkable ground: outside every footprint or on top of a non-walkable obstacle", () => {
    const obstacles = colliders.filter((c) => c.role === "obstacle" && c.shape === "cuboid");
    for (const p of plan) {
      if (!inFootprint(p.x, p.z)) continue;
      const on = obstacles.some((o) => o.shape === "cuboid" && Math.abs(p.x - o.centre[0]) <= o.halfExtents[0] && Math.abs(p.z - o.centre[2]) <= o.halfExtents[2] && Math.abs(p.y - (o.centre[1] + o.halfExtents[1])) < 1e-6);
      expect(on, `${p.model} at ${p.x},${p.z}`).toBe(true);
    }
  });
});

describe("ART1 asset budget", () => {
  const root = new URL("../../", import.meta.url);
  it("vendored environment files are CC0, attributed, complete and within the P0 budget", () => {
    const m = ManifestSchema.parse(JSON.parse(readFileSync(new URL("assets/manifest.json", root), "utf8")));
    const env = m.assets.filter((a) => a.kind === "environment");
    expect(env.length).toBeGreaterThan(0);
    for (const a of env) {
      expect(a.license).toBe("CC0-1.0");
      expect(a.author).toBe("Quaternius");
      expect(a.creationMethod).toBe("third-party CC0 pack");
      expect(a.source).toMatch(/^https:\/\//);
    }
    for (const id of ENV_MODELS) expect(env.some((a) => a.path.endsWith(`/${id}.gltf`)), id).toBe(true);
    expect(env.some((a) => a.path.endsWith("/License.txt"))).toBe(true);
    const total = m.assets.reduce((n, a) => n + statSync(new URL(a.path, root)).size, 0);
    expect(total).toBeLessThanOrEqual(P0_ASSET_BYTES_MAX);
  });
});
