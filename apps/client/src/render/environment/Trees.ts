/**
 * GFX01: procedural tree variety. Four original low-poly species (round oak, layered pine, slim birch, bush) are built once as vertex
 * coloured geometry, then drawn as one InstancedMesh each, with per-instance size, turn and colour tint so no two read alike. Rim trees stand
 * on small rock ledges (one merged mesh). Canopies sway a little in the vertex shader. A share of the instances is drawn per tier.
 */
import {
  BufferGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh,
  Matrix4, Mesh, MeshToonMaterial, Quaternion, Vector3, type DataTexture, type Material,
} from "three";
import { mulberry32 } from "../../scene/EnvPalette.js";
import type { TreePlacement, TreeSpecies } from "./treePlan.js";
import type { EnvTheme } from "./theme.js";

class Parts {
  pos: number[] = []; nor: number[] = []; col: number[] = [];
  /** Adds `g` transformed by `m`; vertex colour = lerp(lo, hi) by height between y0 and y1 (world of the part), jittered per face. */
  add(g: BufferGeometry, m: Matrix4, lo: Color, hi: Color, y0: number, y1: number, rnd: () => number): void {
    const n = g.index ? g.toNonIndexed() : g;
    n.applyMatrix4(m); n.computeVertexNormals();
    const p = n.getAttribute("position"), nm = n.getAttribute("normal"), c = new Color();
    for (let i = 0; i < p.count; i += 3) {
      const jitter = 0.9 + rnd() * 0.2;
      for (let k = 0; k < 3; k++) {
        const t = Math.min(1, Math.max(0, (p.getY(i + k) - y0) / Math.max(0.001, y1 - y0)));
        c.copy(lo).lerp(hi, t).multiplyScalar(jitter);
        this.pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); this.nor.push(nm.getX(i + k), nm.getY(i + k), nm.getZ(i + k)); this.col.push(c.r, c.g, c.b);
      }
    }
    if (n !== g) n.dispose();
    g.dispose();
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const T = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Matrix4 => new Matrix4().compose(new Vector3(x, y, z), new Quaternion(), new Vector3(sx, sy, sz));

/** Blobby canopy: an icosahedron with a seeded wobble so silhouettes are not perfect spheres. */
function blob(r: number, rnd: () => number): BufferGeometry {
  const g = new IcosahedronGeometry(r, 1), p = g.getAttribute("position");
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let k = seen.get(key);
    if (k === undefined) { k = 0.88 + rnd() * 0.24; seen.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k);
  }
  return g;
}

export function buildSpecies(theme: EnvTheme, species: TreeSpecies): BufferGeometry {
  const rnd = mulberry32(0x7a55 + species.length * 131 + species.charCodeAt(0)), P = new Parts(), t = theme.trees;
  const trunk = new Color(t.trunk), birchT = new Color(t.birchTrunk);
  if (species === "oak") {
    const [lo, hi] = [new Color(t.oak[0]), new Color(t.oak[1])];
    P.add(new CylinderGeometry(0.2, 0.34, 2.6, 6, 1), T(0, 1.3, 0), trunk.clone().multiplyScalar(0.7), trunk, 0, 2.6, rnd);
    P.add(new CylinderGeometry(0.1, 0.16, 1.4, 5, 1).rotateZ(0.7), T(0.55, 2.6, 0), trunk, trunk, 0, 3, rnd);
    for (const [x, y, z, r] of [[0, 3.7, 0, 1.55], [0.95, 3.2, 0.3, 1.05], [-0.9, 3.35, -0.4, 1.15], [0.1, 4.55, 0.15, 0.95]] as const)
      P.add(blob(r, rnd), T(x, y, z), lo, hi, 2.4, 5.5, rnd);
  } else if (species === "pine") {
    const [lo, hi] = [new Color(t.pine[0]), new Color(t.pine[1])];
    P.add(new CylinderGeometry(0.16, 0.26, 1.6, 6, 1), T(0, 0.8, 0), trunk.clone().multiplyScalar(0.7), trunk, 0, 1.6, rnd);
    [[1.45, 1.9, 2.1], [2.6, 1.6, 1.75], [3.6, 1.35, 1.4], [4.5, 1.1, 1.05]].forEach(([y, r, h]) =>
      P.add(new ConeGeometry(r!, h!, 7, 1), T(0, y!, 0), lo, hi, 1, 5.6, rnd));
  } else if (species === "birch") {
    const [lo, hi] = [new Color(t.birch[0]), new Color(t.birch[1])];
    P.add(new CylinderGeometry(0.1, 0.17, 3.6, 6, 1), T(0, 1.8, 0), birchT.clone().multiplyScalar(0.85), birchT, 0, 3.6, rnd);
    for (const [x, y, z, r] of [[0, 3.9, 0, 1.0], [0.45, 3.1, 0.2, 0.75], [-0.4, 4.6, -0.1, 0.7]] as const)
      P.add(blob(r, rnd), T(x, y, z, 1, 1.35, 1), lo, hi, 2.7, 5.5, rnd);
  } else {
    const [lo, hi] = [new Color(t.oak[0]).multiplyScalar(0.9), new Color(t.oak[1])];
    for (const [x, y, z, r] of [[0, 0.5, 0, 0.9], [0.7, 0.35, 0.3, 0.6], [-0.6, 0.4, -0.3, 0.65]] as const)
      P.add(blob(r, rnd), T(x, y, z, 1, 0.8, 1), lo, hi, 0, 1.5, rnd);
  }
  return P.build();
}

export interface TreeLayerOptions { theme: EnvTheme; ramp: DataTexture; placements: readonly TreePlacement[] }

export class TreeLayer {
  readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly meshes: InstancedMesh[] = [];
  private readonly sway = { value: 0 };
  private readonly time = { value: 0 };
  private readonly planted = new Map<InstancedMesh, number>();
  private animate = true;
  private swayOn = true;

  constructor(o: TreeLayerOptions) {
    this.group.name = "deco.trees";
    const species: TreeSpecies[] = ["oak", "pine", "birch", "bush"];
    const m = new Matrix4(), q = new Quaternion(), p = new Vector3(), s = new Vector3(), up = new Vector3(0, 1, 0), c = new Color();
    for (const sp of species) {
      const list = o.placements.filter((pl) => pl.species === sp);
      if (list.length === 0) continue;
      const g = buildSpecies(o.theme, sp);
      const mat = new MeshToonMaterial({ vertexColors: true, gradientMap: o.ramp });
      mat.onBeforeCompile = (shader) => {
        shader.uniforms["uSway"] = this.sway; shader.uniforms["uTime"] = this.time;
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nuniform float uSway; uniform float uTime;")
          .replace("#include <begin_vertex>", `#include <begin_vertex>
          float treeBend = pow(max(position.y, 0.0) / 5.0, 2.0) * uSway;
          transformed.x += sin(uTime * 1.2 + instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.3) * treeBend;
          transformed.z += cos(uTime * 0.9 + instanceMatrix[3].z * 0.4) * treeBend * 0.7;`);
      };
      mat.customProgramCacheKey = () => "eb-tree-sway";
      const mesh = new InstancedMesh(g, mat, list.length);
      mesh.name = `deco.trees.${sp}`; mesh.castShadow = false; mesh.receiveShadow = false;
      list.forEach((pl, i) => {
        q.setFromAxisAngle(up, pl.yaw);
        mesh.setMatrixAt(i, m.compose(p.set(pl.x, pl.y, pl.z), q, s.setScalar(pl.scale)));
        const tint = o.theme.trees.tints[pl.tint % o.theme.trees.tints.length] ?? [1, 1, 1];
        mesh.setColorAt(i, c.setRGB(tint[0], tint[1], tint[2]));
      });
      mesh.computeBoundingSphere();
      this.planted.set(mesh, list.length);
      this.group.add(mesh); this.meshes.push(mesh); this.geometries.push(g); this.materials.push(mat);
    }
    // Ledges: one merged rock mesh under every rim tree.
    const rnd = mulberry32(0x1ed6e), parts = new Parts(), lo = new Color(0x4e4a52), hi = new Color(0x8a8278);
    for (const pl of o.placements) {
      if (!pl.ledge) continue;
      parts.add(new DodecahedronGeometry(1, 0), T(pl.x, pl.y - pl.ledge.r * 0.42, pl.z, pl.ledge.r, pl.ledge.r * 0.45, pl.ledge.r), lo, hi, pl.y - 2.6, pl.y, rnd);
    }
    if (parts.pos.length > 0) {
      const g = parts.build(), mat = new MeshToonMaterial({ vertexColors: true, gradientMap: o.ramp });
      const ledges = new Mesh(g, mat);
      ledges.name = "deco.trees.ledges";
      this.group.add(ledges); this.geometries.push(g); this.materials.push(mat);
    }
  }

  /** Share of the planted trees drawn (0..1) and whether canopies sway. */
  setProfile(share: number, sway: boolean): void {
    for (const mesh of this.meshes) mesh.count = Math.floor((this.planted.get(mesh) ?? 0) * share);
    this.swayOn = sway; this.apply();
  }
  setAnimated(on: boolean): void { this.animate = on; this.apply(); }
  private apply(): void { this.sway.value = this.animate && this.swayOn ? 0.12 : 0; }
  get drawn(): number { return this.meshes.reduce((a, m) => a + m.count, 0); }

  update(dtSec: number): void { if (this.animate) this.time.value += dtSec; }

  dispose(): void {
    for (const m of this.meshes) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.group.removeFromParent();
    this.meshes.length = 0; this.geometries.length = 0; this.materials.length = 0;
  }
}
