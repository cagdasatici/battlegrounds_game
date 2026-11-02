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

// QF01: Stone Vanguard planted silhouette.
describe("QF01 Stone Vanguard silhouette", () => {
  const sv = FIGHTER_DESIGNS.sv, td = FIGHTER_DESIGNS.td;
  const named = (d: typeof sv, n: string) => d.parts.find((p) => p.name === n)!;
  it("has asymmetric heavy forearms and bracers (left larger than right)", () => {
    expect(named(sv, "foreArmL").size[0]).toBeGreaterThan(named(sv, "foreArmR").size[0]! + 0.01);
    expect(named(sv, "bracerSlabL").size[1]).toBeGreaterThan(named(sv, "bracerSlabR").size[1]!);
    // Heavier than the Duelist's cloth forearms.
    expect(named(sv, "foreArmL").size[0]).toBeGreaterThan(named(td, "foreArmL").size[0]!);
  });
  it("is broader across the shoulders than the Duelist (rear silhouette width at shoulder height)", () => {
    const width = (k: (typeof KITS)[number]): number => {
      const g = buildFighterGeometry(k, "body", "medium"), pos = g.getAttribute("position");
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0.35 && pos.getY(i) < 0.65) { lo = Math.min(lo, pos.getX(i)); hi = Math.max(hi, pos.getX(i)); }
      g.dispose();
      return hi - lo;
    };
    expect(width("sv")).toBeGreaterThan(width("td") + 0.1);
  });
  it("layers at least three offset stone slabs on the back", () => {
    const slabs = sv.parts.filter((p) => /^backSlab|^skirtSlab/.test(p.name));
    expect(slabs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(slabs.map((s) => s.pos[0])).size).toBeGreaterThanOrEqual(3);
    expect(slabs.every((s) => s.pos[2] > 0.1 && s.color === "stone")).toBe(true);
  });
  it("shows amber seams only while Awakened, in the glow pass, within budgets and the capsule extent", () => {
    const quads = (awakened: boolean): number => { const g = buildFighterGeometry("sv", "glow", "medium", awakened); const n = partsOf(g).length; g.dispose(); return n; };
    expect(quads(true)).toBeGreaterThan(quads(false));
    expect(sv.parts.filter((p) => p.awakened).every((p) => p.glow && p.color === "accent")).toBe(true);
    for (const lod of ["medium", "low"] as const) {
      const total = PASSES.reduce((n, p) => { const g = buildFighterGeometry("sv", p, lod, true); const t = g.getIndex()!.count / 3; const bb = g.boundingBox!; expect(Math.max(-bb.min.x, bb.max.x)).toBeLessThanOrEqual(CAPSULE_R + SLACK); expect(Math.max(-bb.min.z, bb.max.z)).toBeLessThanOrEqual(CAPSULE_R + SLACK); g.dispose(); return n + t; }, 0);
      expect(total, `sv ${lod} awakened`).toBeLessThanOrEqual(lod === "medium" ? 8000 : 3000);
    }
    // Awakened-only parts exist on all three kits now (QF02 crest, QF03 vent fins); each kit has its own test below.
  });
  it("toggles seams in place through the rig and keeps three mesh passes", () => {
    const ramp = makeToonRamp();
    const rig = buildFighterRig("sv", ramp, { outline: true });
    const glow = rig.meshes.find((m) => m.name === "sv.glow")!;
    const before = glow.geometry.getIndex()!.count;
    rig.setAwakened(true);
    expect(glow.geometry.getIndex()!.count).toBeGreaterThan(before);
    expect(rig.meshes.length).toBe(3);
    rig.setAwakened(false);
    expect(glow.geometry.getIndex()!.count).toBe(before);
    rig.dispose(); ramp.dispose();
  });
});

// QF02: Tide Duelist sweeping silhouette. Budgets recorded before QF02: medium 3884, low 1976 triangles (all three passes).
describe("QF02 Tide Duelist silhouette", () => {
  const td = FIGHTER_DESIGNS.td;
  const named = (n: string) => td.parts.find((p) => p.name === n)!;
  const tris = (lod: Lod, awakened: boolean): number =>
    PASSES.reduce((n, p) => { const g = buildFighterGeometry("td", p, lod, awakened); const t = g.getIndex()!.count / 3; g.dispose(); return n + t; }, 0);
  it("has a narrow chest and an asymmetric multi-piece scarf on the back", () => {
    expect(named("chest").size[0]).toBeLessThan(FIGHTER_DESIGNS.sv.parts.find((p) => p.name === "chest")!.size[0]!);
    const tails = td.parts.filter((p) => /^scarfTail/.test(p.name));
    expect(tails.length).toBeGreaterThanOrEqual(2);
    expect(tails.every((t) => t.pos[0] < 0 && t.pos[2] > 0.1)).toBe(true);
    expect(Math.max(...tails.map((t) => t.size[1]!))).toBeGreaterThanOrEqual(0.45);
  });
  it("splits the hip panels unequally", () => {
    const l = named("panelL"), r = named("panelR");
    expect(l.size[1]).toBeGreaterThan(r.size[1]! + 0.05);
    expect(l.pos[0]).toBeLessThan(0);
    expect(r.pos[0]).toBeGreaterThan(0);
  });
  it("shows a forked crest only while Awakened, in the glow pass", () => {
    const crest = td.parts.filter((p) => /^crest/.test(p.name));
    expect(crest.length).toBeGreaterThanOrEqual(2);
    expect(crest.every((p) => p.awakened && p.glow && p.bone === "head")).toBe(true);
    expect(Math.sign(crest[0]!.pos[0])).not.toBe(Math.sign(crest[1]!.pos[0]));
    expect(partsOf(buildFighterGeometry("td", "glow", "medium", true)).length).toBeGreaterThan(partsOf(buildFighterGeometry("td", "glow", "medium", false)).length);
  });
  it("does not exceed the pre-QF02 triangle count, awakened or not", () => {
    for (const aw of [false, true]) {
      expect(tris("medium", aw), `medium awakened=${aw}`).toBeLessThanOrEqual(3884);
      expect(tris("low", aw), `low awakened=${aw}`).toBeLessThanOrEqual(1976);
    }
  });
});

// QF03: Ember Artificer furnace silhouette. Budgets recorded before QF03: medium 4312, low 2024 triangles (all three passes).
describe("QF03 Ember Artificer silhouette", () => {
  const ea = FIGHTER_DESIGNS.ea;
  const named = (n: string) => ea.parts.find((p) => p.name === n)!;
  const tris = (lod: Lod, awakened: boolean): number =>
    PASSES.reduce((n, p) => { const g = buildFighterGeometry("ea", p, lod, awakened); const t = g.getIndex()!.count / 3; g.dispose(); return n + t; }, 0);
  it("has a compact torso and a backpack that tapers from a wide base to a narrow top", () => {
    expect(named("chest").size[0]).toBeLessThan(FIGHTER_DESIGNS.sv.parts.find((p) => p.name === "chest")!.size[0]!);
    expect(named("packC").size[0]!).toBeGreaterThan(named("packB").size[0]!);
    expect(named("packB").size[0]!).toBeGreaterThan(named("packA").size[0]!);
    expect(named("stack").pos[1]).toBeGreaterThan(named("packA").pos[1]);
  });
  it("has side vents on both flanks and an insulated left forearm guard bigger than the right", () => {
    expect(named("ventL").pos[0]).toBeLessThan(0);
    expect(named("ventR").pos[0]).toBeGreaterThan(0);
    expect(named("gauntletL").size[1]!).toBeGreaterThan(named("gauntletR").size[1]! + 0.07);
  });
  it("shows two clear vent fins only while Awakened, in the glow pass", () => {
    const fins = ea.parts.filter((p) => /^fin/.test(p.name));
    expect(fins.length).toBe(2);
    expect(fins.every((p) => p.awakened && p.glow)).toBe(true);
    expect(Math.sign(fins[0]!.pos[0])).not.toBe(Math.sign(fins[1]!.pos[0]));
    expect(partsOf(buildFighterGeometry("ea", "glow", "medium", true)).length).toBe(partsOf(buildFighterGeometry("ea", "glow", "medium", false)).length + 2);
  });
  it("does not exceed the pre-QF03 triangle count, awakened or not", () => {
    for (const aw of [false, true]) {
      expect(tris("medium", aw), `medium awakened=${aw}`).toBeLessThanOrEqual(4312);
      expect(tris("low", aw), `low awakened=${aw}`).toBeLessThanOrEqual(2024);
    }
  });
});
