import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mesh } from "three";
import { checkManifest, checkProvenance, ManifestSchema, P0_ASSET_BYTES_MAX, PROVENANCE_COLUMNS, type AssetManifest } from "../../packages/shared/src/art.js";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { FIGHTER_DESIGNS } from "../../packages/shared/src/fighterDesign.js";
import { BASE_CLIP_IDS, BONES, BONE_NAMES, abilityClipIds, buildKitClips, clipMotionAmount, requiredClipIds, RIG_VERSION } from "../../packages/shared/src/rig.js";
import type { KitId } from "../../packages/shared/src/protocol.js";
import { buildFighterGltf } from "../../ops/scripts/art-gltf.js";
import { chooseClip, retimeScale } from "../../apps/client/src/scene/FighterAnim.js";
import { buildFighterGeometry, makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { GameScene, isSoftwareRenderer, pixelRatioFor, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";

const KITS: KitId[] = ["sv", "td", "ea"];
const root = new URL("../../", import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), "utf8");

describe("T25 required animation ids", () => {
  it("lists the 14 base clips of spec section 23", () => {
    expect([...BASE_CLIP_IDS]).toEqual(["idle", "walk", "run", "jump", "fall", "land", "guard", "dashFront", "dashSide", "dashBack", "hitLight", "ragdollPose", "getup", "death"]);
  });
  it("covers every shipped ability id and the awakening activation for each kit", () => {
    for (const def of ALL_ABILITY_DEFS) expect(requiredClipIds(def.id.split(".")[0] as KitId), def.id).toContain(def.id);
    for (const k of KITS) for (const s of ["b1", "b2", "b3", "b4", "a1", "a2", "a3", "a4", "activate"]) expect(abilityClipIds(k)).toContain(`${k}.${s}`);
    expect(abilityClipIds("sv")).toEqual(expect.arrayContaining(["sv.x1", "sv.x2", "sv.x3"]));
  });
  it("each kit's generated clip set equals its required ids exactly", () => {
    for (const k of KITS) {
      const ids = buildKitClips(k).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual([...requiredClipIds(k)].sort());
    }
  });
  it("clips are well formed: increasing times, unit quaternions, real motion, bones exist", () => {
    for (const k of KITS) for (const c of buildKitClips(k)) {
      expect(c.duration, c.id).toBeGreaterThan(0.2);
      expect(c.tracks.length, c.id).toBe(BONE_NAMES.length + 1);
      for (const t of c.tracks) {
        expect(BONE_NAMES).toContain(t.bone);
        for (let i = 1; i < t.times.length; i++) expect(t.times[i]!, `${c.id} ${t.bone}`).toBeGreaterThan(t.times[i - 1]!);
        if (t.path === "rotation") for (let i = 0; i < t.times.length; i++) {
          const n = Math.hypot(t.values[i * 4]!, t.values[i * 4 + 1]!, t.values[i * 4 + 2]!, t.values[i * 4 + 3]!);
          expect(n).toBeCloseTo(1, 5);
        }
      }
      if (!["idle", "guard", "fall", "ragdollPose"].includes(c.id)) expect(clipMotionAmount(c), c.id).toBeGreaterThan(0.25); // held poses only breathe
    }
  });
  it("kits move differently: the same slot id has distinct idle and ability poses per kit", () => {
    const a = buildKitClips("sv").find((c) => c.id === "idle")!, b = buildKitClips("td").find((c) => c.id === "idle")!;
    expect(JSON.stringify(a.tracks)).not.toEqual(JSON.stringify(b.tracks));
  });
});

describe("T25 manifest and provenance rules", () => {
  const prov = checkProvenance(read("assets/provenance.csv"));
  const manifest = JSON.parse(read("assets/manifest.json")) as AssetManifest;
  it("the committed manifest and provenance pass every pure check", () => {
    expect(prov.issues).toEqual([]);
    expect(checkManifest(manifest, prov.ids)).toEqual([]);
    expect(manifest.assets.filter((a) => a.kind === "fighter").map((a) => a.kit).sort()).toEqual(["ea", "sv", "td"]);
  });
  it("every entry carries the spec's required fields", () => {
    for (const a of manifest.assets) {
      for (const f of ["id", "path", "sha256", "byteSize", "license", "author", "source", "creationMethod"] as const) expect(String(a[f]).length, `${a.id}.${f}`).toBeGreaterThan(0);
    }
    for (const a of manifest.assets.filter((x) => x.kind === "fighter")) { expect(a.rigVersion).toBe(RIG_VERSION); expect(a.bounds).toBeDefined(); }
  });
  it("rejects empty provenance, a missing clip, a wrong rig, a forbidden source and an over budget total", () => {
    const base = structuredClone(manifest);
    const ids = new Set(base.assets.map((a) => a.id));
    const codes = (m: unknown, p: ReadonlySet<string> = ids): string[] => checkManifest(m, p).map((i) => i.code);

    const noAuthor = structuredClone(base); noAuthor.assets[0]!.author = "  ";
    expect(codes(noAuthor)).toContain("SCHEMA");
    const noRow = new Set(ids); noRow.delete("fighter.sv");
    expect(codes(base, noRow)).toContain("NO_PROVENANCE_ROW");
    const noClip = structuredClone(base); noClip.assets[0]!.clips = noClip.assets[0]!.clips!.filter((c) => c !== "sv.a2");
    expect(checkManifest(noClip, ids).some((i) => i.code === "MISSING_ANIMATION" && i.detail.includes("sv.a2"))).toBe(true);
    const wrongRig = structuredClone(base); wrongRig.assets[0]!.rigVersion = "other";
    expect(codes(wrongRig)).toContain("RIG_VERSION");
    const ripped = structuredClone(base); ripped.assets[0]!.source = "https://roblox.example/model";
    expect(codes(ripped)).toContain("FORBIDDEN_SOURCE");
    const big = structuredClone(base); big.assets[0]!.byteSize = P0_ASSET_BYTES_MAX + 1;
    expect(codes(big)).toContain("OVER_BUDGET");
    const dup = structuredClone(base); dup.assets.push({ ...dup.assets[0]! });
    expect(codes(dup)).toEqual(expect.arrayContaining(["DUP_ID", "DUP_PATH"]));
    const noFighter = structuredClone(base); noFighter.assets = noFighter.assets.filter((a) => a.id !== "fighter.ea");
    expect(codes(noFighter)).toContain("MISSING_FIGHTER");
    expect(ManifestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
  it("provenance csv needs the exact header and no empty required cell", () => {
    expect(checkProvenance("id,path\nx,y\n").issues[0]?.code).toBe("CSV_HEADER");
    const row = (a: string): string => `${PROVENANCE_COLUMNS.join(",")}\n${a}\n`;
    expect(checkProvenance(row("a,p,,l,m,s,d,")).issues.map((i) => i.code)).toContain("EMPTY_PROVENANCE");
    expect(checkProvenance(row("a,p,au,l,m,s,d,")).issues).toEqual([]);
  });
  it("committed glTF files equal the regenerated rig output, carry all clips and a skin", () => {
    for (const k of KITS) {
      const text = read(`assets/fighters/${k}.gltf`);
      const built = buildFighterGltf(k);
      expect(text).toBe(built.json);
      const g = JSON.parse(text) as { animations: { name: string }[]; skins: { joints: number[] }[]; asset: { version: string }; images?: unknown[] };
      expect(g.asset.version).toBe("2.0");
      expect(g.animations.map((a) => a.name).sort()).toEqual([...requiredClipIds(k)].sort());
      expect(g.skins[0]!.joints.length).toBe(BONES.length);
      expect(g.images).toBeUndefined();
    }
  });
});

describe("T25 fighter models", () => {
  it("keep the capsule scale: 1.8 m tall, soles at -0.9 m, within the 0.35 m radius plus limbs", () => {
    for (const k of KITS) {
      const g = buildFighterGeometry(k, "body");
      const bb = g.boundingBox!;
      expect(bb.min.y, k).toBeGreaterThan(-0.97);
      expect(bb.min.y, k).toBeLessThan(-0.85);
      expect(bb.max.y, k).toBeGreaterThan(0.75);
      expect(bb.max.y, k).toBeLessThan(1.02);
      expect(Math.max(Math.abs(bb.min.x), bb.max.x), k).toBeLessThan(0.65);
      g.dispose();
    }
  });
  it("fit the triangle budget and use three silhouettes of different shape", () => {
    const sizes = KITS.map((k) => {
      const tris = (["body", "glow", "outline"] as const).map((p) => { const g = buildFighterGeometry(k, p); const n = g.getIndex()!.count / 3; g.dispose(); return n; });
      expect(tris.reduce((a, b) => a + b, 0), k).toBeLessThan(9000);
      return FIGHTER_DESIGNS[k].parts.map((p) => p.name).join();
    });
    expect(new Set(sizes).size).toBe(3);
  });
  it("create and dispose repeatedly releases every geometry and material exactly once", () => {
    const ramp = makeToonRamp();
    for (let i = 0; i < 10; i++) {
      const v = new FighterView(KITS[i % 3]!, ramp);
      let g = 0, m = 0, meshes = 0;
      v.group.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        meshes++;
        mesh.geometry.addEventListener("dispose", () => g++);
        (mesh.material as { addEventListener(t: string, f: () => void): void }).addEventListener("dispose", () => m++);
      });
      expect(meshes).toBe(3);
      v.dispose(); v.dispose();
      expect(g).toBe(3); expect(m).toBe(3);
      expect(v.group.children.length).toBe(0);
      v.update(0.016); // no throw after dispose
    }
    ramp.dispose();
  });
});

describe("T25 animation selection", () => {
  const base = { moveId: "", kit: "sv", speed: 0, vy: 0, forward: 0, right: 0, hasClip: (id: string) => requiredClipIds("sv").includes(id) };
  it("maps replicated actions to clips, including death, ragdoll, guard and awakening", () => {
    expect(chooseClip({ ...base, action: "Dead" }).clip).toBe("death");
    expect(chooseClip({ ...base, action: "Ragdolled" }).clip).toBe("ragdollPose");
    expect(chooseClip({ ...base, action: "Captured" }).clip).toBe("ragdollPose");
    expect(chooseClip({ ...base, action: "Stunned" }).clip).toBe("hitLight");
    expect(chooseClip({ ...base, action: "Guard" }).clip).toBe("guard");
    expect(chooseClip({ ...base, action: "Awakening" }).clip).toBe("sv.activate");
  });
  it("picks a move clip from the replicated move id and falls back for an unknown id", () => {
    expect(chooseClip({ ...base, action: "Windup", moveId: "sv.b4" }).clip).toBe("sv.b4");
    expect(chooseClip({ ...base, action: "Active", moveId: "m1.3" }).clip).toBe("m1.3");
    expect(chooseClip({ ...base, action: "Active", moveId: "m1.4.finisher" }).clip).toBe("m1.4");
    expect(chooseClip({ ...base, action: "Windup", moveId: "sv.b2.late" }).clip).toBe("sv.b2");
    expect(chooseClip({ ...base, action: "Recovery", moveId: "zz.unknown" }).clip).toBe("m1.1");
    expect(chooseClip({ ...base, action: "Windup", moveId: "td.b1" }).clip).toBe("m1.1"); // another kit's move is never played
  });
  it("picks dash direction, locomotion and air clips from presented motion", () => {
    expect(chooseClip({ ...base, action: "Dash", forward: 20 }).clip).toBe("dashFront");
    expect(chooseClip({ ...base, action: "Dash", forward: -20 }).clip).toBe("dashBack");
    expect(chooseClip({ ...base, action: "Dash", right: 20, forward: 3 }).clip).toBe("dashSide");
    expect(chooseClip({ ...base, action: "Idle", speed: 3 }).clip).toBe("walk");
    expect(chooseClip({ ...base, action: "Idle", speed: COMBAT.movement.run }).clip).toBe("run");
    expect(chooseClip({ ...base, action: "Idle", vy: 5 }).clip).toBe("jump");
    expect(chooseClip({ ...base, action: "Idle", vy: -5 }).clip).toBe("fall");
    expect(chooseClip({ ...base, action: "Idle" }).clip).toBe("idle");
  });
  it("retimes a clip to the server phase within sane bounds and ignores a zero phase", () => {
    expect(retimeScale(0.9, 54, 60)).toBeCloseTo(1);
    expect(retimeScale(0.9, 27, 60)).toBeCloseTo(2);
    expect(retimeScale(0.9, 0, 60)).toBe(1);
    expect(retimeScale(0.9, 1, 60)).toBe(4);
  });
  it("a view plays death once for a dead fighter, getup after ragdoll, land after a fall, and retimes ability clips", () => {
    const ramp = makeToonRamp();
    const v = new FighterView("sv", ramp);
    v.setPose(0, 0, 0, 0);
    v.update(0.016);
    expect(v.currentClip).toBe("idle");
    v.setAction("Ragdolled"); v.update(0.016);
    expect(v.currentClip).toBe("ragdollPose");
    v.setAction("Idle"); v.update(0.016);
    expect(v.currentClip).toBe("getup");
    for (let i = 0; i < 10; i++) v.update(0.016); // getup is not cut short by locomotion
    expect(v.currentClip).toBe("getup");
    for (let i = 0; i < 80; i++) v.update(0.016);
    expect(v.currentClip).toBe("idle");
    // fall then land
    let y = 5;
    v.setAction("Idle");
    for (let i = 0; i < 12; i++) { y -= 0.2; v.setPose(0, y, 0, 0); v.update(0.016); }
    expect(v.currentClip).toBe("fall");
    v.setPose(0, y, 0, 0);
    for (let i = 0; i < 30 && v.currentClip === "fall"; i++) v.update(0.016);
    expect(v.currentClip).toBe("land");
    for (let i = 0; i < 40; i++) v.update(0.016);
    expect(v.currentClip).toBe("idle");
    // ability phase of 30 ticks stretches the 1.xs clip
    v.setAction("Windup", "sv.b1", 30); v.update(0.016);
    expect(v.currentClip).toBe("sv.b1");
    v.setAction("Dead"); v.update(0.016);
    expect(v.currentClip).toBe("death");
    for (let i = 0; i < 200; i++) v.update(0.016);
    expect(v.currentClip).toBe("death");
    v.dispose();
    ramp.dispose();
  });
});

describe("T25 scene quality", () => {
  it("detects CPU rasterisers by renderer string only", () => {
    const gl = (name: string) => ({ getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }), getParameter: () => name });
    expect(isSoftwareRenderer(gl("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)"))).toBe(true);
    expect(isSoftwareRenderer(gl("llvmpipe (LLVM 15)"))).toBe(true);
    expect(isSoftwareRenderer(gl("Apple GPU"))).toBe(false);
    expect(isSoftwareRenderer({ getExtension: () => null, getParameter: () => "" })).toBe(false);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
  const win = (dpr: number): WindowLike => ({ innerWidth: 1180, innerHeight: 820, devicePixelRatio: dpr, addEventListener() {}, removeEventListener() {} });
  it("caps rendered pixels by quality and keeps the ratio between 0.6 and 1.5", () => {
    for (const q of ["low", "medium", "high"] as const) {
      const r = pixelRatioFor(q, 1180, 820, 2);
      expect(r).toBeGreaterThanOrEqual(0.6); expect(r).toBeLessThanOrEqual(1.5);
      expect(1180 * 820 * r * r).toBeLessThanOrEqual({ low: 750_000, medium: 1_500_000, high: 2_500_000 }[q] * 1.001);
    }
    expect(pixelRatioFor("high", 400, 300, 3)).toBe(1.5);
    expect(pixelRatioFor("low", 4000, 3000, 1)).toBe(0.6);
  });
  it("turns shadows off on low and on for medium and high, and applies the pixel ratio to the renderer", () => {
    const calls: number[] = [];
    const r: RendererLike = { setSize() {}, setPixelRatio: (x) => calls.push(x), shadowMap: { enabled: false, type: 0 }, render() {}, dispose() {} };
    const gs = new GameScene(r, buildIslandsMap().colliders, win(2));
    expect(gs.shadowsEnabled).toBe(true); expect(r.shadowMap!.enabled).toBe(true);
    gs.setQuality("low");
    expect(gs.shadowsEnabled).toBe(false); expect(r.shadowMap!.enabled).toBe(false);
    gs.setQuality("high");
    expect(gs.shadowsEnabled).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    gs.dispose();
  });
  it("the arena stays within the mesh budget (draw calls come from meshes)", () => {
    const gs = new GameScene({ setSize() {}, render() {}, dispose() {} }, buildIslandsMap().colliders, win(1));
    for (let i = 0; i < 4; i++) gs.addFighter(`f${i}`, KITS[i % 3]!);
    let meshes = 0, tris = 0;
    gs.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh) { meshes++; tris += (m.geometry.getIndex()?.count ?? 0) / 3; } });
    expect(meshes).toBeLessThanOrEqual(100); // spec section 24: at most 120 draw calls on medium
    expect(tris).toBeLessThanOrEqual(150_000);
    gs.dispose();
  });
});

it("UX06 attack poses follow authoritative phase windows; a long windup never reaches contact", () => {
  const ramp = makeToonRamp(), v = new FighterView("sv", ramp);
  const data = buildKitClips("sv").find(c => c.id === "sv.b1")!;
  v.setAction("Windup", "sv.b1", 120);
  for (let i = 0; i < 180; i++) v.update(1 / 60);
  expect(v.clipTime).toBeCloseTo(data.phases!.windupEnd);
  expect(v.clipTime).toBeLessThan(data.phases!.activeStart);
  v.setAction("Active", "sv.b1", 6); v.update(.01);
  expect(v.clipTime).toBeGreaterThanOrEqual(data.phases!.activeStart);
  expect(v.clipTime).toBeLessThanOrEqual(data.phases!.recoveryStart);
  v.setAction("Recovery", "sv.b1", 10);
  for (let i = 0; i < 20; i++) v.update(1 / 60);
  expect(v.clipTime).toBeCloseTo(data.duration);
  v.setAction("Dead"); v.update(.02); expect(v.currentClip).toBe("death");
  v.dispose(); ramp.dispose();
});
