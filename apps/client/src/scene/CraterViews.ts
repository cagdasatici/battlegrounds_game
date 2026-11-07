import { BufferGeometry, CircleGeometry, DodecahedronGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, Vector4, type Material, type Scene } from "three";
import { CRATER, craterDepth } from "@eb/shared/config/beast";
import { craterPitDepth } from "@eb/shared/craterGround";
import { fromCm } from "@eb/shared/schema";

/** Public replicated crater record (CraterSchema). Centimetres; startTick is an absolute server tick. */
export interface LoopCrater { id: number; x: number; z: number; radius100: number; startTick: number }

interface View { group: Group; bowl: Mesh; rim: Mesh; slot: number; pit: number; ember: Mesh; rocks: Mesh[]; radius: number; start: number }

const ROCKS = 9;
const RING = 14, SEG = 48;

/**
 * Unit bowl: radius 1, y = -(1 - u^2)^2 (depth 1), the same profile as `craterOffset` in the shared craterGround module,
 * so the mesh scaled by (R, pit * heal, R) matches the server's ground exactly. Vertex colours run from scorched to dusty.
 */
function bowlGeometry(): BufferGeometry {
  const pos: number[] = [0, -1, 0], col: number[] = [0.07, 0.05, 0.04], idx: number[] = [];
  for (let r = 1; r <= RING; r++) {
    const u = r / RING, w = 1 - u * u, y = -w * w, t = Math.min(1, u * 1.1);
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * u, y, Math.sin(a) * u);
      col.push(0.07 + 0.28 * t, 0.05 + 0.2 * t, 0.04 + 0.15 * t);
    }
  }
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let r = 1; r < RING; r++) for (let s = 0; s < SEG; s++) {
    const a = 1 + (r - 1) * SEG + s, b = 1 + (r - 1) * SEG + ((s + 1) % SEG), c = a + SEG, d = b + SEG;
    idx.push(a, b, c, b, d, c);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Presentation of the sparring craters: a real sunken bowl (scorched interior; the ground material is cut open above it), a raised broken rim with rubble, and an ember core that cools.
 * All of it follows `craterDepth(tick, start)` (1 = fresh, 0 = healed): the rubble sinks back, the bowl fills in. The server
 * owns the list, the timing and the height fighters stand at (`groundHeightAt`); fighters are drawn from server state.
 */
export class CraterViews {
  private readonly views = new Map<number, View>();
  private readonly geos: BufferGeometry[] = [];
  private readonly scarGeo = this.keep(new CircleGeometry(1, 40));
  private readonly bowlGeo = this.keep(bowlGeometry());
  /** x, z, radius, active for each live crater; read by the patched ground shader. */
  private readonly cut: { value: Vector4[] } = { value: Array.from({ length: CRATER.maxLive }, () => new Vector4(0, 0, 0, 0)) };
  private readonly patched = new Set<Material>();
  private readonly bowlMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide });
  private readonly rimGeo = this.keep(new TorusGeometry(1, 0.07, 6, 40));
  private readonly rockGeo = this.keep(new DodecahedronGeometry(1, 0));
  private readonly emberMat = new MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly rimMat = new MeshStandardMaterial({ color: 0x5a4636, roughness: 1, flatShading: true });
  private readonly rockMat = new MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95, flatShading: true });
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  private keep<G extends BufferGeometry>(g: G): G { this.geos.push(g); return g; }

  /**
   * Makes the ground material discard fragments inside live craters so the bowl shows instead of the flat floor.
   * Call before the material first renders. Safe to call once per material; `dispose` leaves the material to its owner.
   */
  cutGround(mat: Material): void {
    if (this.patched.has(mat)) return;
    this.patched.add(mat);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      prev?.call(mat, shader, renderer);
      shader.uniforms.uCraters = this.cut;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCraterWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCraterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\nvarying vec3 vCraterWorld;\nuniform vec4 uCraters[${CRATER.maxLive}];`)
        .replace("void main() {", `void main() {\n  for (int i = 0; i < ${CRATER.maxLive}; i++) { vec4 c = uCraters[i]; if (c.w > 0.5 && distance(vCraterWorld.xz, c.xy) < c.z && abs(vCraterWorld.y) < 0.3) discard; }`);
    };
    mat.customProgramCacheKey = () => "craterCut";
    mat.needsUpdate = true;
  }

  private writeCut(): void {
    let i = 0;
    for (const v of this.views.values()) {
      if (i >= this.cut.value.length) break;
      const on = v.group.visible;
      this.cut.value[i]!.set(v.group.position.x, v.group.position.z, v.radius - 0.02, on ? 1 : 0);
      v.slot = i++;
    }
    for (; i < this.cut.value.length; i++) this.cut.value[i]!.set(0, 0, 0, 0);
  }

  sync(records: Iterable<LoopCrater>, tick: number): void {
    if (this.disposed) return;
    const seen = new Set<number>();
    for (const c of records) {
      seen.add(c.id);
      let v = this.views.get(c.id);
      if (!v) { v = this.create(c); this.views.set(c.id, v); }
      this.shape(v, tick);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { v.group.removeFromParent(); this.views.delete(id); }
    this.writeCut();
  }

  private create(c: LoopCrater): View {
    const radius = fromCm(c.radius100);
    const group = new Group(); group.name = "beast.crater";
    const pit = craterPitDepth(radius);
    group.position.set(fromCm(c.x), 0, fromCm(c.z));
    const bowl = new Mesh(this.bowlGeo, this.bowlMat); bowl.scale.set(radius, pit, radius); bowl.position.y = 0.01; bowl.name = "beast.crater";
    const ember = new Mesh(this.scarGeo, this.emberMat); ember.rotation.x = -Math.PI / 2; ember.scale.setScalar(radius * 0.25); ember.position.y = -pit * 0.84; ember.name = "beast.crater";
    const rim = new Mesh(this.rimGeo, this.rimMat); rim.rotation.x = -Math.PI / 2; rim.scale.setScalar(radius); rim.position.y = 0.04; rim.name = "beast.crater";
    const rocks: Mesh[] = [];
    for (let i = 0; i < ROCKS; i++) {
      const a = ((i + 0.4 * Math.sin(c.id * 3 + i * 7)) / ROCKS) * Math.PI * 2, rr = radius * (0.95 + 0.12 * Math.sin(i * 5 + c.id));
      const m = new Mesh(this.rockGeo, this.rockMat);
      m.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr); m.rotation.set(i, i * 2.1, i * 0.7); m.name = "beast.crater";
      (m.userData as { base: number }).base = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(i * 12.9 + c.id));
      rocks.push(m); group.add(m);
    }
    group.add(bowl, ember, rim);
    this.scene.add(group);
    return { group, bowl, rim, ember, rocks, radius, start: c.startTick, slot: 0, pit };
  }

  private shape(v: View, tick: number): void {
    const d = craterDepth(tick, v.start);
    v.bowl.scale.set(v.radius, Math.max(0.001, v.pit * d), v.radius); // same heal factor as groundHeightAt(tick)
    v.ember.scale.setScalar(v.radius * 0.25 * d);
    v.ember.position.y = -v.pit * d * 0.84 + 0.01;
    v.ember.visible = d > 0.35;
    v.rim.scale.set(v.radius, v.radius, Math.max(0.05, d));
    v.rim.position.y = 0.04 * d;
    for (const r of v.rocks) { const b = (r.userData as { base: number }).base; r.scale.setScalar(Math.max(0.001, b * d)); r.position.y = 0.1 * d; }
    v.group.visible = d > 0.01;
  }

  snapshot(): { id: number; x: number; z: number; radius: number; visible: boolean }[] {
    return [...this.views].map(([id, v]) => ({ id, x: v.group.position.x, z: v.group.position.z, radius: v.radius, visible: v.group.visible }));
  }

  clear(): void { for (const v of this.views.values()) v.group.removeFromParent(); this.views.clear(); this.writeCut(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const g of this.geos) g.dispose();
    this.bowlMat.dispose(); this.emberMat.dispose(); this.rimMat.dispose(); this.rockMat.dispose();
  }
}
