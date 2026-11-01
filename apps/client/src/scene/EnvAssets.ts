/**
 * Third party CC0 environment models (task ART1, decision 0023). Loads the Quaternius Stylized Nature MegaKit subset
 * copied under assets/vendor/, bakes each node transform into plain geometry and swaps the PBR materials for toon
 * materials that share the scene ramp. Static meshes only: no rigging, no animation, presentation only.
 */
import {
  InstancedMesh, LoadingManager, Matrix4, MeshToonMaterial, DoubleSide,
  type BufferGeometry, type DataTexture, type Material, type Mesh, type MeshStandardMaterial, type Texture,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const ENV_MODELS = ["CommonTree_1", "Pine_1", "TwistedTree_2", "Bush_Common", "Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"] as const;
export type EnvModelId = (typeof ENV_MODELS)[number];

export interface EnvPart { readonly geometry: BufferGeometry; readonly material: Material }
export interface EnvKit {
  readonly parts: Readonly<Record<EnvModelId, readonly EnvPart[]>>;
  /** Everything the kit allocated; the owner disposes these exactly once. */
  readonly geometries: readonly BufferGeometry[];
  readonly materials: readonly Material[];
  readonly textures: readonly Texture[];
}

/** One placed model: position, yaw and uniform scale. */
export interface EnvPlacement { readonly model: EnvModelId; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly scale: number }

// Vite turns each vendored file into a hashed URL; the glTF loader asks for sibling files by name, so map by basename.
const FILE_URLS = import.meta.glob("../../../../assets/vendor/quaternius-stylized-nature/*.{gltf,bin,png}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const urlByName = new Map<string, string>(Object.entries(FILE_URLS).map(([k, v]) => [k.slice(k.lastIndexOf("/") + 1), v]));

export async function loadEnvKit(ramp: DataTexture, fileUrl: (name: string) => string | undefined = (n) => urlByName.get(n)): Promise<EnvKit> {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => fileUrl(url.slice(url.lastIndexOf("/") + 1)) ?? url);
  const loader = new GLTFLoader(manager);
  const geometries: BufferGeometry[] = [], materials: MeshToonMaterial[] = [], textures = new Set<Texture>();
  const toon = new Map<Material, MeshToonMaterial>();
  const parts = {} as Record<EnvModelId, EnvPart[]>;
  for (const id of ENV_MODELS) {
    const url = fileUrl(`${id}.gltf`);
    if (!url) throw new Error(`missing env model ${id}`);
    const gltf = await loader.loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const list: EnvPart[] = [];
    gltf.scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh) return;
      const src = m.material as MeshStandardMaterial;
      let mat = toon.get(src);
      if (!mat) {
        mat = new MeshToonMaterial({ map: src.map, vertexColors: !!m.geometry.getAttribute("color"), gradientMap: ramp, side: DoubleSide, alphaTest: src.alphaTest || (src.transparent ? 0.5 : 0) });
        toon.set(src, mat); materials.push(mat);
        if (src.map) textures.add(src.map);
      }
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== "position" && name !== "normal" && name !== "uv" && name !== "color") g.deleteAttribute(name);
      g.computeBoundingSphere();
      geometries.push(g);
      list.push({ geometry: g, material: mat });
    });
    parts[id] = list;
    gltf.scene.traverse((o) => { (o as Mesh).geometry?.dispose(); });
  }
  return { parts, geometries, materials, textures: [...textures] };
}

/** Builds one InstancedMesh per kit part for the placements of each model. Returned meshes share the kit's geometry. */
export function instancePlacements(kit: EnvKit, placements: readonly EnvPlacement[], shadows: { cast: boolean; receive: boolean }): InstancedMesh[] {
  const out: InstancedMesh[] = [];
  const m = new Matrix4();
  for (const id of ENV_MODELS) {
    const mine = placements.filter((p) => p.model === id);
    if (mine.length === 0) continue;
    for (const [i, part] of kit.parts[id].entries()) {
      const im = new InstancedMesh(part.geometry, part.material, mine.length);
      im.name = `env.${id}.${i}`;
      im.castShadow = shadows.cast; im.receiveShadow = shadows.receive;
      mine.forEach((p, k) => {
        m.makeRotationY(p.yaw).multiplyScalar(p.scale).setPosition(p.x, p.y, p.z);m.elements[15] = 1;
        im.setMatrixAt(k, m);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      out.push(im);
    }
  }
  return out;
}
