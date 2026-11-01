/**
 * Effects pool (T18a registry, FX1 particles). Two jobs: a disposer registry for scene owned effects, and one
 * pre-allocated InstancedMesh of particles (one draw call). Presentation only; time is render seconds.
 */
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, SphereGeometry, type Scene } from "three";

export type PoolQuality = "low" | "medium" | "high";
/** Particle capacity per quality tier (decision 0024). */
export const POOL_CAPACITY: Readonly<Record<PoolQuality, number>> = { low: 200, medium: 600, high: 1000 };

export interface ParticleSpec {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Lifetime in render seconds. */
  life: number;
  /** Start size in metres (shrinks to zero over the life). */
  size: number;
  color: number;
  /** Optional growth instead of shrink, used by rings and columns. */
  grow?: boolean;
}

export class EffectsPool {
  private disposers: Array<() => void> = [];
  get size(): number { return this.disposers.length; }
  register(dispose: () => void): void { this.disposers.push(dispose); }

  private mesh: InstancedMesh | null = null;
  private cap = 0;
  private active = 0;
  private px = new Float32Array(0); private py = new Float32Array(0); private pz = new Float32Array(0);
  private vx = new Float32Array(0); private vy = new Float32Array(0); private vz = new Float32Array(0);
  private age = new Float32Array(0); private life = new Float32Array(0); private psize = new Float32Array(0);
  private grows = new Uint8Array(0);
  private readonly dummy = new Object3D();
  private readonly tint = new Color();
  private readonly zero = new Matrix4().makeScale(0, 0, 0);

  get capacity(): number { return this.cap; }
  /** Particles currently alive. */
  get activeCount(): number { return this.active; }

  /** Allocates the single InstancedMesh for `quality` and adds it to `scene`. Safe to call once. */
  init(scene: Scene, quality: PoolQuality): void {
    if (this.mesh) return;
    const n = POOL_CAPACITY[quality];
    this.cap = n;
    for (const k of ["px", "py", "pz", "vx", "vy", "vz", "age", "life", "psize"] as const) this[k] = new Float32Array(n);
    this.grows = new Uint8Array(n);
    this.life.fill(0);
    this.age.fill(1);
    const geo = new SphereGeometry(0.5, 6, 4);
    const mat = new MeshBasicMaterial({ color: 0xffffff, fog: false });
    const mesh = new InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = "fx.particles";
    for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, this.zero); mesh.setColorAt(i, this.tint.set(0xffffff)); }
    scene.add(mesh);
    this.mesh = mesh;
    this.register(() => { mesh.removeFromParent(); geo.dispose(); mat.dispose(); mesh.dispose(); this.mesh = null; this.active = 0; });
  }

  private alive(i: number): boolean { return (this.age[i] as number) < (this.life[i] as number); }

  /** Adds a particle. When the pool is full the oldest (largest age fraction) decorative particle is replaced. */
  spawn(p: ParticleSpec): void {
    if (!this.mesh || this.cap === 0) return;
    let slot = -1, oldest = -1;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive(i)) { slot = i; break; }
      const frac = (this.age[i] as number) / (this.life[i] as number);
      if (frac > oldest) { oldest = frac; slot = i; }
    }
    if (!this.alive(slot)) this.active++;
    this.px[slot] = p.x; this.py[slot] = p.y; this.pz[slot] = p.z;
    this.vx[slot] = p.vx; this.vy[slot] = p.vy; this.vz[slot] = p.vz;
    this.age[slot] = 0; this.life[slot] = Math.max(1e-3, p.life); this.psize[slot] = p.size; this.grows[slot] = p.grow ? 1 : 0;
    this.mesh.setColorAt(slot, this.tint.set(p.color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Advances every live particle by dtSec of render time and expires finished ones. */
  update(dtSec: number): void {
    if (!this.mesh || !(dtSec > 0)) return;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive(i)) continue;
      const a = (this.age[i] as number) + dtSec;
      this.age[i] = a;
      if (a >= (this.life[i] as number)) { this.mesh.setMatrixAt(i, this.zero); this.active--; continue; }
      this.px[i] = (this.px[i] as number) + (this.vx[i] as number) * dtSec;
      this.py[i] = (this.py[i] as number) + (this.vy[i] as number) * dtSec;
      this.pz[i] = (this.pz[i] as number) + (this.vz[i] as number) * dtSec;
      const f = a / (this.life[i] as number);
      const s = (this.psize[i] as number) * (this.grows[i] ? 0.4 + 0.6 * f : 1 - f);
      this.dummy.position.set(this.px[i] as number, this.py[i] as number, this.pz[i] as number);
      this.dummy.scale.setScalar(Math.max(1e-4, s));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposers.splice(0)) d();
  }
}
