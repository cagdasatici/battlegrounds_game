/**
 * Pooled particles (FX1, decision 0024). One InstancedMesh per scene sized by quality tier, so every impact effect is a
 * single draw call. Particles expire in render seconds and the oldest one is overwritten when the pool is full.
 * Presentation only: nothing here reads or writes simulation state. `register`/`dispose` keep the T18a contract for
 * other effects that own their own resources.
 */
import { Color, IcosahedronGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, type Scene } from "three";
import { GlowLayer } from "./GlowLayer.js";

export type PoolTier = "low" | "medium" | "high";
export const POOL_CAPACITY: Readonly<Record<PoolTier, number>> = { low: 200, medium: 600, high: 1000 };
/**
 * QP02 load shedding. Above SHED_HALF of capacity every second non-essential spawn is dropped, above SHED_ALL none is
 * admitted, so a pile-up of overlapping signatures keeps free slots for essential particles (beam body, flares) instead
 * of the oldest particle being overwritten. Counters, not randomness: the policy is deterministic and testable.
 */
export const SHED_HALF = 0.6;
export const SHED_ALL = 0.85;

/** Longest single step update() simulates. A slow frame (CPU raster, background tab) must not kill a short-lived effect before it is drawn once. */
export const MAX_STEP_SEC = 0.05;

export interface Particle {
  /** World position in metres. */
  x: number; y: number; z: number;
  /** Velocity in metres per second. */
  vx: number; vy: number; vz: number;
  /** Lifetime in render seconds. */
  life: number;
  /** Start diameter in metres. */
  size: number;
  color: number;
  /** Downward acceleration in m/s^2 (negative rises). */
  gravity?: number;
  /** Warning-adjacent or beam body particle: never shed, only overwritten when the pool is completely full. Default false (decorative). */
  essential?: boolean;
}

export class EffectsPool {
  /** UX10: additive flashes, shockwave rings, spark streaks and point lights, budgeted per tier. */
  readonly glow = new GlowLayer();
  private disposers: Array<() => void> = [];
  private mesh: InstancedMesh | null = null;
  private tier: PoolTier | null = null;
  private cap = 0;
  private cursor = 0;
  private alive = 0;
  private shedTick = 0;
  private shedTotal = 0;
  // Per slot state: position, velocity, age, life, start size, gravity.
  private px = new Float32Array(0); private py = new Float32Array(0); private pz = new Float32Array(0);
  private vx = new Float32Array(0); private vy = new Float32Array(0); private vz = new Float32Array(0);
  private age = new Float32Array(0); private life = new Float32Array(0); private sz = new Float32Array(0);
  private grav = new Float32Array(0);
  private readonly m = new Matrix4();
  private readonly c = new Color();

  /** Number of registered disposers (T18a contract). */
  get size(): number { return this.disposers.length; }
  get activeCount(): number { return this.alive; }
  get capacity(): number { return this.cap; }
  /** Non-essential spawns dropped by the shed policy since the pool was configured. */
  get shedCount(): number { return this.shedTotal; }

  register(dispose: () => void): void { this.disposers.push(dispose); }

  /** Creates the instanced mesh for a quality tier; a no-op for the tier already in place. A tier change drops live particles. */
  configure(scene: Scene, tier: PoolTier): void {
    if (this.mesh && this.tier === tier && this.mesh.parent === scene) return;
    this.release();
    this.tier = tier;
    const n = POOL_CAPACITY[tier];
    this.cap = n;
    this.cursor = 0;
    this.alive = 0;
    this.shedTotal = 0;
    for (const k of ["px", "py", "pz", "vx", "vy", "vz", "age", "life", "sz", "grav"] as const) this[k] = new Float32Array(n);
    const mesh = new InstancedMesh(new IcosahedronGeometry(0.5, 0), new MeshBasicMaterial({ color: 0xffffff, fog: false }), n);
    mesh.name = "fx.pool";
    mesh.frustumCulled = false;
    mesh.count = n;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
    mesh.setColorAt(0, this.c.set(0xffffff));
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
    this.mesh = mesh;
    this.glow.configure(scene, tier);
  }

  /** Adds a particle, overwriting the oldest slot when full. Returns false when the pool is not configured. */
  spawn(p: Particle): boolean {
    const mesh = this.mesh;
    if (!mesh || p.life <= 0) return false;
    if (!p.essential) {
      const fill = this.alive / this.cap;
      if (fill >= SHED_ALL || (fill >= SHED_HALF && (this.shedTick++ & 1) === 0)) { this.shedTotal += 1; return false; }
    }
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    if (!(this.age[i]! < this.life[i]!)) this.alive += 1;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz;
    this.age[i] = 0; this.life[i] = p.life; this.sz[i] = p.size; this.grav[i] = p.gravity ?? 0;
    mesh.setColorAt(i, this.c.set(p.color));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.write(i, 1);
    return true;
  }

  /** Advances every live particle by dtSec of render time. */
  update(dtSec: number): void {
    const mesh = this.mesh;
    if (!mesh || !(dtSec > 0)) return;
    dtSec = Math.min(dtSec, MAX_STEP_SEC);
    this.glow.update(dtSec);
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!(this.age[i]! < this.life[i]!)) continue;
      const a = this.age[i]! + dtSec;
      this.age[i] = a;
      // A dead slot must read age >= life exactly (float32 rounding of `a` could otherwise revive it), and the live count is
      // recounted every update so it can never drift (a drifted count froze stuck particles in browser runs).
      if (a >= this.life[i]!) { this.age[i] = this.life[i]!; this.write(i, 0); continue; }
      live += 1;
      const vy = this.vy[i]! - this.grav[i]! * dtSec;
      this.vy[i] = vy;
      this.px[i] = this.px[i]! + this.vx[i]! * dtSec;
      this.py[i] = this.py[i]! + vy * dtSec;
      this.pz[i] = this.pz[i]! + this.vz[i]! * dtSec;
      this.write(i, 1 - a / this.life[i]!);
    }
    this.alive = live;
  }

  private write(i: number, scale: number): void {
    const mesh = this.mesh!;
    const s = this.sz[i]! * scale;
    this.m.makeScale(s, s, s).setPosition(this.px[i]!, this.py[i]!, this.pz[i]!);
    mesh.setMatrixAt(i, this.m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  private release(): void {
    this.glow.release();
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      (this.mesh.material as MeshBasicMaterial).dispose();
      this.mesh.dispose();
    }
    this.mesh = null;
    this.cap = 0;
    this.alive = 0;
  }

  dispose(): void {
    this.release();
    for (const d of this.disposers.splice(0)) d();
  }
}
