// Exports the code-authored fighter rig, geometry and clips as one self-contained glTF 2.0 file per kit (task T25).
// The client builds the same rig at runtime from the same shared data; assets:audit regenerates these files and fails if
// the committed bytes differ, so the shipped glTF can never drift from what the game renders.
import { buildFighterGeometry } from "../../apps/client/src/scene/FighterModel.js";
import { BONES, BONE_NAMES, boneRestWorld, buildKitClips, RIG_VERSION } from "../../packages/shared/src/rig.js";
import { FIGHTER_DESIGNS } from "../../packages/shared/src/fighterDesign.js";
import type { KitId } from "../../packages/shared/src/protocol.js";

interface Chunk { bytes: Uint8Array; view: object }
const align4 = (n: number): number => (n + 3) & ~3;

export interface GltfBuild { json: string; bounds: { min: [number, number, number]; max: [number, number, number] }; clips: string[]; rigVersion: string }

export function buildFighterGltf(kit: KitId): GltfBuild {
  const chunks: Chunk[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const pushView = (data: ArrayBufferView, target?: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const padded = new Uint8Array(align4(bytes.length));
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push({ bytes: padded, view: {} });
    offset += padded.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (data: ArrayBufferView, componentType: number, count: number, type: string, opts: { target?: number; min?: number[]; max?: number[] } = {}): number => {
    const bv = pushView(data, opts.target);
    accessors.push({ bufferView: bv, componentType, count, type, ...(opts.min ? { min: opts.min } : {}), ...(opts.max ? { max: opts.max } : {}) });
    return accessors.length - 1;
  };
  const FLOAT = 5126, USHORT = 5123, UINT = 5125, ARRAY = 34962, ELEMENT = 34963;

  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const primitives: object[] = [];
  for (const [pass, material] of [["body", 0], ["glow", 1]] as const) {
    const g = buildFighterGeometry(kit, pass);
    const posAttr = g.getAttribute("position");
    if (posAttr.count === 0) { g.dispose(); continue; }
    const pos = new Float32Array(posAttr.array as ArrayLike<number>);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a]!, pos[i]!); hi[a] = Math.max(hi[a]!, pos[i]!); }
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, lo[a]!); max[a] = Math.max(max[a]!, hi[a]!); }
    const n = posAttr.count;
    const idx = new Uint32Array(g.getIndex()!.array as ArrayLike<number>);
    primitives.push({
      attributes: {
        POSITION: addAccessor(pos, FLOAT, n, "VEC3", { target: ARRAY, min: lo, max: hi }),
        NORMAL: addAccessor(new Float32Array(g.getAttribute("normal").array as ArrayLike<number>), FLOAT, n, "VEC3", { target: ARRAY }),
        COLOR_0: addAccessor(new Float32Array(g.getAttribute("color").array as ArrayLike<number>), FLOAT, n, "VEC3", { target: ARRAY }),
        JOINTS_0: addAccessor(new Uint16Array(g.getAttribute("skinIndex").array as ArrayLike<number>), USHORT, n, "VEC4", { target: ARRAY }),
        WEIGHTS_0: addAccessor(new Float32Array(g.getAttribute("skinWeight").array as ArrayLike<number>), FLOAT, n, "VEC4", { target: ARRAY }),
      },
      indices: addAccessor(idx, UINT, idx.length, "SCALAR", { target: ELEMENT }),
      material,
    });
    g.dispose();
  }

  // Inverse bind matrices: pure translations by the negative rest-world bone position (column major).
  const ibm = new Float32Array(BONE_NAMES.length * 16);
  BONE_NAMES.forEach((name, i) => {
    const w = boneRestWorld(name);
    ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -w[0], -w[1], -w[2], 1], i * 16);
  });
  const ibmAccessor = addAccessor(ibm, FLOAT, BONE_NAMES.length, "MAT4");

  const nodeIndex = new Map(BONE_NAMES.map((n, i) => [n, i]));
  const nodes: object[] = BONES.map((b) => ({
    name: b.name,
    translation: [...b.rest],
    ...(BONES.some((c) => c.parent === b.name) ? { children: BONES.filter((c) => c.parent === b.name).map((c) => nodeIndex.get(c.name)!) } : {}),
  }));
  const meshNode = nodes.length;
  nodes.push({ name: `${kit}.model`, mesh: 0, skin: 0 });

  const clips = buildKitClips(kit);
  const animations = clips.map((c) => {
    const samplers: object[] = [], channels: object[] = [];
    for (const t of c.tracks) {
      const input = addAccessor(new Float32Array(t.times), FLOAT, t.times.length, "SCALAR", { min: [t.times[0]!], max: [t.times[t.times.length - 1]!] });
      const output = addAccessor(new Float32Array(t.values), FLOAT, t.times.length, t.path === "rotation" ? "VEC4" : "VEC3");
      samplers.push({ input, output, interpolation: "LINEAR" });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeIndex.get(t.bone)!, path: t.path } });
    }
    return { name: c.id, samplers, channels };
  });

  const total = chunks.reduce((n, c) => n + c.bytes.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c.bytes, at); at += c.bytes.length; }

  const doc = {
    asset: { version: "2.0", generator: "elemental-battlegrounds ops/scripts/build-art.ts", copyright: "Elemental Battlegrounds project, original work" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ name: `${kit}.scene`, nodes: [nodeIndex.get("hips")!, meshNode] }],
    nodes,
    skins: [{ name: `${kit}.skin`, joints: BONE_NAMES.map((n) => nodeIndex.get(n)!), skeleton: nodeIndex.get("hips")!, inverseBindMatrices: ibmAccessor }],
    meshes: [{ name: `${kit}.mesh`, primitives }],
    materials: [
      { name: "toonVertexColour", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } },
      { name: "glowUnlit", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] }, extensions: { KHR_materials_unlit: {} } },
    ],
    animations,
    accessors,
    bufferViews,
    buffers: [{ byteLength: total, uri: `data:application/octet-stream;base64,${Buffer.from(all).toString("base64")}` }],
    extras: { kit, label: FIGHTER_DESIGNS[kit].label, rigVersion: RIG_VERSION },
  };
  const r = (v: number): number => Math.round(v * 1e5) / 1e5;
  return { json: JSON.stringify(doc) + "\n", bounds: { min: min.map(r) as [number, number, number], max: max.map(r) as [number, number, number] }, clips: clips.map((c) => c.id), rigVersion: RIG_VERSION };
}
