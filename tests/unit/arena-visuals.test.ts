// ART1: visual meshes stay aligned with their colliders, dressing never covers walkable ground, assets stay in budget.
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mesh } from "three";
import { CAMERA } from "../../apps/client/src/scene/CameraRig.js";
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
  it("keeps landmark crowns outside walkable ground and gives the opposite deck a pine skyline", () => {
    const landmarks = plan.filter((p) => ["CommonTree_1", "Pine_1"].includes(p.model) && Math.abs(p.x) < 45 && Math.abs(p.z) < 20);
    expect(landmarks.filter((p) => p.x > 0).map((p) => p.model)).toEqual(["CommonTree_1", "CommonTree_1"]);
    expect(landmarks.filter((p) => p.x < 0).map((p) => p.model)).toEqual(["Pine_1", "Pine_1"]);
    for (const p of landmarks) {
      // Conservative radial bounds enclose the source glTF crowns at any yaw.
      const r = (p.model === "Pine_1" ? 3.52 : 3.22) * p.scale;
      for (const c of ground) {
        const gap = c.shape === "cuboid"
          ? Math.hypot(Math.max(0, Math.abs(p.x - c.centre[0]) - c.halfExtents[0]), Math.max(0, Math.abs(p.z - c.centre[2]) - c.halfExtents[2]))
          : Math.hypot(p.x - c.centre[0], p.z - c.centre[2]) - c.radius;
        expect(gap).toBeGreaterThan(r);
      }
    }
  });
  it("QE01: east gate trees are asymmetric and flanked by flowers, grass, fern and flush stone", () => {
    const trees = plan.filter((p) => p.model === "CommonTree_1" && p.x > 0 && Math.abs(p.x) < 45);
    expect(trees).toHaveLength(2);
    const [a, b] = trees as [typeof trees[0], typeof trees[0]];
    expect(Math.abs(a!.z + b!.z)).toBeGreaterThan(0.3); // not mirrored across the lane
    expect(a!.scale).not.toBeCloseTo(b!.scale, 1);
    expect(a!.x).not.toBeCloseTo(b!.x, 1);
    for (const m of ["Bush_Common_Flowers", "Grass_Common_Short", "Fern_1", "RockPath_Round_Thin"] as const)
      expect(plan.filter((p) => p.model === m && p.x > 30 && p.x < 45).length, m).toBeGreaterThanOrEqual(2);
    // Both flanks (north and south of the lane) carry flowering clusters.
    const flowers = plan.filter((p) => p.model === "Bush_Common_Flowers");
    expect(flowers.some((p) => p.z > 0) && flowers.some((p) => p.z < 0)).toBe(true);
  });
  it("QE01: landmark crowns never cover a fighter at either east spawn view", () => {
    const views = [
      { pos: [40, 4, -4], look: [25, 1, 0] }, { pos: [24, 3, 2], look: [34, 1, 0] },
    ] as const;
    const sub = (p: readonly number[], q: readonly number[]): number[] => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!];
    const dot = (p: number[], q: number[]): number => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
    const norm = (p: number[]): number[] => { const l = Math.hypot(...(p as [number, number, number])); return p.map((x) => x / l); };
    const aspect = 1180 / 820, tanH = Math.tan((CAMERA.fovDeg * Math.PI) / 360);
    for (const v of views) {
      const fwd = norm(sub(v.look, v.pos));
      const right = norm([-fwd[2]!, 0, fwd[0]!]); // fwd x up(0,1,0) with y-up
      const up = [right[1]! * fwd[2]! - right[2]! * fwd[1]!, right[2]! * fwd[0]! - right[0]! * fwd[2]!, right[0]! * fwd[1]! - right[1]! * fwd[0]!];
      const ndc = (x: number, y: number, z: number): { x: number; y: number; depth: number } => {
        const d = sub([x, y, z], v.pos), depth = dot(d, fwd);
        return { x: dot(d, right) / (depth * tanH * aspect), y: dot(d, up) / (depth * tanH), depth };
      };
      for (const t of plan.filter((p) => p.model === "CommonTree_1" && Math.abs(p.x) < 45 && p.x > 0)) {
        const c = ndc(t.x, t.y + 3 * t.scale, t.z);
        if (c.depth <= 0) continue; // behind the camera
        const rs = (3.22 * t.scale) / (c.depth * tanH); // crown radius in vertical NDC
        for (const f of [0, 1, 2]) {
          const fp = ndc(32 + f * 1.5, 1.4, -1);
          expect(Math.hypot((fp.x - c.x) * aspect, fp.y - c.y), `tree z=${t.z} fighter ${f} view ${v.pos}`).toBeGreaterThan(rs);
        }
      }
    }
  });
  it("never sits on walkable ground: outside every footprint or on top of a non-walkable obstacle", () => {
    const obstacles = colliders.filter((c) => c.role === "obstacle" && c.shape === "cuboid");
    for (const p of plan) {
      if (!inFootprint(p.x, p.z)) continue;
      if (["Fern_1", "Bush_Common_Flowers", "Grass_Common_Short", "RockPath_Round_Thin"].includes(p.model)) {
        expect(p.x).toBeGreaterThanOrEqual(30.5);
        expect(Math.abs(p.z)).toBeGreaterThanOrEqual(3.8);
        expect(Math.abs(p.z)).toBeLessThan(5.6);
        expect(p.y + p.scale * (p.model === "Fern_1" ? 2.442 : p.model === "Bush_Common_Flowers" ? 1.348 : p.model === "Grass_Common_Short" ? 1.334 : 0.102)).toBeLessThan(0.15);
        continue;
      }
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
