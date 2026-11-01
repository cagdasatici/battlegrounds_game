import { describe, expect, it } from "vitest";
import type { BufferGeometry, SkinnedMesh, Vector3 as Vec3 } from "three";
import { KITS } from "../../packages/shared/src/art.js";
import { FIGHTER_DESIGNS } from "../../packages/shared/src/fighterDesign.js";
import { boneRestWorld } from "../../packages/shared/src/rig.js";
import { buildFighterGeometry, buildFighterRig, JOINT_BAND, KIT_ATLAS_SIZE, makeKitAtlas, makeToonRamp, type Lod } from "../../apps/client/src/scene/FighterModel.js";

// "three" is only installed for apps/client, so load the runtime classes from there (the same module the model imports).
const THREE = (await import("../../apps/client/node_modules/three/build/three.module.js")) as unknown as typeof import("three");
const { Group, Quaternion, Vector3 } = THREE;

// ART2: smooth skinned fighter meshes. Capsule: radius 0.35 m, total height 1.8 m, origin at its centre.
const CAPSULE_R = 0.35, CAPSULE_HALF = 0.9, SLACK = 0.25;
const PASSES = ["body", "glow", "outline"] as const;
interface PartRange { name: string; start: number; count: number; radial?: number }
const partsOf = (g: BufferGeometry): PartRange[] => g.userData.parts as PartRange[];
const trisOf = (kit: (typeof KITS)[number], lod: Lod, outline = true): number =>
  PASSES.filter((p) => outline || p !== "outline").reduce((n, p) => { const g = buildFighterGeometry(kit, p, lod); const t = g.getIndex()!.count / 3; g.dispose(); return n + t; }, 0);

describe("ART2 extents", () => {
  for (const lod of ["medium", "low"] as const) {
    it(`every pass at ${lod} detail stays within the capsule plus 0.25 m`, () => {
      for (const k of KITS) for (const pass of PASSES) {
        const g = buildFighterGeometry(k, pass, lod);
        if (g.getAttribute("position").count === 0) continue;
        const bb = g.boundingBox!;
        const lim = CAPSULE_R + SLACK;
        expect(Math.max(-bb.min.x, bb.max.x), `${k}.${pass} x`).toBeLessThanOrEqual(lim);
        expect(Math.max(-bb.min.z, bb.max.z), `${k}.${pass} z`).toBeLessThanOrEqual(lim);
        expect(bb.min.y, `${k}.${pass} minY`).toBeGreaterThanOrEqual(-CAPSULE_HALF - SLACK);
        expect(bb.max.y, `${k}.${pass} maxY`).toBeLessThanOrEqual(CAPSULE_HALF + SLACK);
        g.dispose();
      }
    });
  }
});

describe("ART2 budgets and mesh quality", () => {
  it("fits 8k triangles per fighter on medium and 3k on the low level of detail", () => {
    for (const k of KITS) {
      const med = trisOf(k, "medium"), low = trisOf(k, "low");
      expect(med, `${k} medium`).toBeLessThanOrEqual(8000);
      expect(low, `${k} low`).toBeLessThanOrEqual(3000);
      expect(low, `${k} low < medium`).toBeLessThan(med);
    }
  });
  it("builds limbs as tapered capsules with at least 12 radial segments, and boxes with extra segments", () => {
    for (const k of KITS) {
      const g = buildFighterGeometry(k, "body", "medium");
      const limbs = partsOf(g).filter((p) => p.radial !== undefined);
      expect(limbs.map((l) => l.name).sort(), k).toEqual(["foreArmL", "foreArmR", "shinL", "shinR", "thighL", "thighR", "upperArmL", "upperArmR"]);
      for (const l of limbs) expect(l.radial!, l.name).toBeGreaterThanOrEqual(12);
      // 2 segments per side on a rounded box: 48 triangles instead of the flat box's 12.
      const chest = partsOf(g).find((p) => p.name === "chest")!;
      expect(chest.count, `${k} chest verts`).toBeGreaterThan(24);
      g.dispose();
    }
  });
  it("gives every kit hands with a thumb and a face with brows and a mouth", () => {
    for (const k of KITS) {
      const names = new Set(FIGHTER_DESIGNS[k].parts.map((p) => p.name));
      for (const n of ["handL", "thumbL", "handR", "thumbR", "browL", "browR", "mouth"]) expect(names.has(n), `${k} ${n}`).toBe(true);
    }
  });
  it("winds triangles outward (positive signed volume) and normalises skin weights", () => {
    for (const k of KITS) {
      const g = buildFighterGeometry(k, "body", "medium");
      const pos = g.getAttribute("position"), ix = g.getIndex()!;
      let vol = 0;
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      for (let i = 0; i < ix.count; i += 3) {
        a.fromBufferAttribute(pos, ix.getX(i)); b.fromBufferAttribute(pos, ix.getX(i + 1)); c.fromBufferAttribute(pos, ix.getX(i + 2));
        vol += a.dot(b.cross(c)) / 6;
      }
      expect(vol, `${k} signed volume`).toBeGreaterThan(0);
      const w = g.getAttribute("skinWeight");
      for (let i = 0; i < w.count; i++) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
      g.dispose();
    }
  });
});

describe("ART2 joint blending", () => {
  const flex = (kit: (typeof KITS)[number], side: "L" | "R", joint: "knee" | "elbow", sign: 1 | -1) => {
    const ramp = makeToonRamp();
    const rig = buildFighterRig(kit, ramp, { outline: false });
    const group = new Group();
    group.add(rig.root, ...rig.meshes);
    const bone = rig.bones.find((b) => b.name === `${joint}${side}`)!;
    bone.quaternion.copy(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), sign * Math.PI / 2));
    group.updateMatrixWorld(true);
    rig.skeleton.update();
    const mesh = rig.meshes.find((m) => m.name.endsWith(".body")) as SkinnedMesh;
    const ranges = partsOf(mesh.geometry);
    const at = (i: number): Vec3 => mesh.getVertexPosition(i, new Vector3());
    return { rig, ramp, mesh, ranges, at };
  };
  const seam = (kit: (typeof KITS)[number], side: "L" | "R", joint: "knee" | "elbow", sign: 1 | -1) => {
    const f = flex(kit, side, joint, sign);
    const upper = f.ranges.find((r) => r.name === (joint === "knee" ? `thigh${side}` : `upperArm${side}`))!;
    const lower = f.ranges.find((r) => r.name === (joint === "knee" ? `shin${side}` : `foreArm${side}`))!;
    const jointY = boneRestWorld(`${joint}${side}`)[1];
    const rest = f.mesh.geometry.getAttribute("position");
    const ring = (r: PartRange): number[] => { const o: number[] = []; for (let i = r.start; i < r.start + r.count; i++) if (Math.abs(rest.getY(i) - jointY) < 1e-5) o.push(i); return o; };
    const up = ring(upper), lo = ring(lower);
    let worst = 0;
    for (const i of lo) { const p = f.at(i); let best = Infinity; for (const j of up) best = Math.min(best, p.distanceTo(f.at(j))); worst = Math.max(worst, best); }
    // Radius of the posed lower ring around its own centroid, against the rest radius.
    const centroid = new Vector3(); for (const i of lo) centroid.add(f.at(i)); centroid.divideScalar(lo.length);
    let radius = 0; for (const i of lo) radius += f.at(i).distanceTo(centroid); radius /= lo.length;
    let restRadius = 0; { const cy = new Vector3(); for (const i of lo) cy.add(new Vector3().fromBufferAttribute(rest, i)); cy.divideScalar(lo.length); for (const i of lo) restRadius += new Vector3().fromBufferAttribute(rest, i).distanceTo(cy); restRadius /= lo.length; }
    // Weight mix across the band.
    const w = f.mesh.geometry.getAttribute("skinWeight");
    const mixed = lo.every((i) => Math.abs(w.getX(i) - 0.5) < 1e-5 && Math.abs(w.getY(i) - 0.5) < 1e-5);
    f.rig.dispose(); f.ramp.dispose();
    return { worst, ringCount: lo.length, upCount: up.length, radius, restRadius, mixed };
  };

  it("keeps the knee and elbow rings joined at 90 degrees of flexion, for both sides and bend directions", () => {
    for (const k of KITS) for (const side of ["L", "R"] as const) for (const [joint, sign] of [["knee", -1], ["knee", 1], ["elbow", 1], ["elbow", -1]] as const) {
      const r = seam(k, side, joint, sign);
      expect(r.ringCount, `${k} ${joint}${side} ring`).toBeGreaterThanOrEqual(12);
      expect(r.upCount).toBe(r.ringCount);
      expect(r.worst, `${k} ${joint}${side} ${sign} gap`).toBeLessThan(0.005);
      expect(r.mixed, `${k} ${joint}${side} 50/50 at the joint plane`).toBe(true);
      expect(r.radius / r.restRadius, `${k} ${joint}${side} pinch`).toBeGreaterThan(0.6);
    }
  });
  it("blends over a 0.06 m band and uses at most two influences", () => {
    expect(JOINT_BAND).toBeCloseTo(0.06, 6);
    const g = buildFighterGeometry("sv", "body", "medium");
    const w = g.getAttribute("skinWeight"), si = g.getAttribute("skinIndex");
    let blended = 0;
    for (let i = 0; i < w.count; i++) {
      expect(w.getZ(i) + w.getW(i)).toBe(0);
      if (w.getY(i) > 0 && w.getX(i) > 0) blended++;
    }
    expect(blended).toBeGreaterThan(100);
    expect(si.count).toBe(w.count);
    const knee = boneRestWorld("kneeL")[1], pos = g.getAttribute("position");
    for (let i = 0; i < w.count; i++) if (w.getY(i) > 0 && w.getX(i) > 0 && Math.abs(pos.getY(i) - knee) < 0.2) expect(Math.abs(pos.getY(i) - knee)).toBeLessThanOrEqual(JOINT_BAND / 2 + 1e-5);
    g.dispose();
  });
  it("swaps the level of detail in place without leaking geometry", () => {
    const ramp = makeToonRamp();
    const rig = buildFighterRig("td", ramp, { outline: true });
    const count = (): number => rig.meshes.reduce((n, m) => n + m.geometry.getIndex()!.count / 3, 0);
    const med = count();
    rig.setLod("low");
    expect(count()).toBeLessThanOrEqual(3000);
    rig.setLod("medium");
    expect(count()).toBe(med);
    expect(med).toBeLessThanOrEqual(8000);
    rig.dispose(); ramp.dispose();
  });
});

describe("ART2 textures", () => {
  it("makes one 512 px colour atlas per kit, within the 1024 maximum, distinct per kit", () => {
    expect(KIT_ATLAS_SIZE).toBe(512);
    const sums = KITS.map((k) => {
      const t = makeKitAtlas(k);
      const img = t.image as { width: number; height: number; data: Uint8Array };
      expect(img.width).toBe(512); expect(img.height).toBe(512);
      expect(img.width).toBeLessThanOrEqual(1024);
      expect(img.data.length).toBe(512 * 512 * 4);
      let s = 0; for (let i = 0; i < img.data.length; i += 997) s += img.data[i]!;
      t.dispose();
      return s;
    });
    expect(new Set(sums).size).toBe(3);
  });
  it("gives every vertex a UV inside the atlas", () => {
    for (const k of KITS) {
      const g = buildFighterGeometry(k, "body", "medium");
      const uv = g.getAttribute("uv");
      expect(uv.count).toBe(g.getAttribute("position").count);
      for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeGreaterThanOrEqual(0); expect(uv.getX(i)).toBeLessThanOrEqual(1); expect(uv.getY(i)).toBeGreaterThanOrEqual(0); expect(uv.getY(i)).toBeLessThanOrEqual(1); }
      g.dispose();
    }
  });
});
