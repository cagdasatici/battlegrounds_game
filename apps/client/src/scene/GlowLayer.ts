/**
 * UX10 additive glow layer: pooled impact flashes, shockwave rings, spark/ribbon streaks and a few dynamic point lights.
 * Three InstancedMeshes (one draw call each, hidden when empty) plus a fixed set of point lights per quality tier, so no
 * hit ever allocates a mesh, material or light. Everything expires by its own render-time life; `clearOwner` ends the
 * charge effects of an actor whose action was interrupted. Presentation only: nothing here reads or writes simulation
 * state, and render time never schedules gameplay.
 */
import {
  AdditiveBlending, BoxGeometry, Color, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial,
  PointLight, Quaternion, RingGeometry, SphereGeometry, Vector3, type BufferGeometry, type Scene,
} from "three";

export type GlowTier = "low" | "medium" | "high";
export interface GlowBudget { flashes: number; rings: number; streaks: number; lights: number }
/** Hard slot counts per tier. Dynamic lights: Low 0, Medium 2, High 4 (UX10c). */
export const GLOW_BUDGET: Readonly<Record<GlowTier, GlowBudget>> = {
  low: { flashes: 10, rings: 10, streaks: 90, lights: 0 },
  medium: { flashes: 20, rings: 20, streaks: 220, lights: 2 },
  high: { flashes: 28, rings: 28, streaks: 360, lights: 4 },
};
/** Multiplier on the particle counts an effect asks for, per tier. Low draws fewer sparks, High draws all of them. */
export const DENSITY: Readonly<Record<GlowTier, number>> = { low: 0.4, medium: 0.7, high: 1 };
/** Brightness multiplier while reduced motion is on: flashes are softer and lights are off. */
export const SOFT_SCALE = 0.45;

type Kind = "flash" | "ring" | "streak";
const Z = new Vector3(0, 0, 1);

class Slots {
  readonly mesh: InstancedMesh;
  readonly cap: number;
  private cursor = 0;
  alive = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly s0: Float32Array;
  readonly s1: Float32Array;
  readonly len: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly nx: Float32Array;
  readonly ny: Float32Array;
  readonly nz: Float32Array;
  readonly grav: Float32Array;
  readonly owner: (string | undefined)[];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly sc = new Vector3();
  private readonly col: Float32Array;

  constructor(readonly kind: Kind, geometry: BufferGeometry, cap: number, scene: Scene) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.s1 = new Float32Array(cap);
    this.len = new Float32Array(cap);
    this.r = new Float32Array(cap);
    this.g = new Float32Array(cap);
    this.b = new Float32Array(cap);
    this.nx = new Float32Array(cap);
    this.ny = new Float32Array(cap);
    this.nz = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.age.fill(1); this.life.fill(1); // dead: age >= life
    this.owner = new Array<string | undefined>(cap).fill(undefined);
    const material = new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.mesh = new InstancedMesh(geometry, material, cap);
    this.mesh.name = `fx.glow.${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, new Color(0, 0, 0));
    this.col = (this.mesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
    this.col.fill(0);
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, zero);
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Takes a free slot, else the oldest-written one (round robin), and returns its index. */
  claim(): number {
    this.mesh.visible = true;
    for (let n = 0; n < this.cap; n++) {
      const i = (this.cursor + n) % this.cap;
      if (!(this.age[i]! < this.life[i]!)) { this.cursor = (i + 1) % this.cap; return i; }
    }
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    return i;
  }

  step(dt: number, gain: number): void {
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!(this.age[i]! < this.life[i]!)) continue;
      const a = this.age[i]! + dt;
      this.age[i] = a;
      if (a >= this.life[i]!) { this.hide(i); continue; }
      live += 1;
      if (a < 0) { this.hide(i); continue; } // delayed start
      const vy = this.vy[i]! - this.grav[i]! * dt;
      this.vy[i] = vy;
      this.x[i] = this.x[i]! + this.vx[i]! * dt; this.y[i] = this.y[i]! + vy * dt; this.z[i] = this.z[i]! + this.vz[i]! * dt;
      this.draw(i, a / this.life[i]!, gain);
    }
    this.alive = live;
    this.mesh.visible = live > 0;
    if (live > 0) { this.mesh.instanceMatrix.needsUpdate = true; (this.mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true; }
  }

  private hide(i: number): void {
    this.m.makeScale(0, 0, 0);
    this.mesh.setMatrixAt(i, this.m);
    this.col[i * 3] = 0; this.col[i * 3 + 1] = 0; this.col[i * 3 + 2] = 0;
  }

  /** Writes the instance transform and faded colour for progress k in [0, 1). Fade is a colour multiply (additive blending). */
  draw(i: number, k: number, gain: number): void {
    const e = 1 - (1 - k) * (1 - k); // ease out
    let fade: number, size: number;
    if (this.kind === "flash") { fade = (1 - k) * (1 - k); size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e; this.q.identity(); this.sc.set(size, size, size); }
    else if (this.kind === "ring") {
      fade = (1 - k) ** 1.4; size = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e;
      this.v.set(this.nx[i]!, this.ny[i]!, this.nz[i]!);
      this.q.setFromUnitVectors(Z, this.v);
      this.sc.set(size, size, size);
    } else {
      fade = 1 - k * k;
      const speed = Math.hypot(this.vx[i]!, this.vy[i]!, this.vz[i]!);
      if (speed > 0.05) this.v.set(this.vx[i]! / speed, this.vy[i]! / speed, this.vz[i]! / speed); else this.v.set(this.nx[i]!, this.ny[i]!, this.nz[i]!);
      this.q.setFromUnitVectors(Z, this.v);
      const w = this.s0[i]! * (1 - 0.7 * k), l = this.len[i]! * (1 - 0.5 * k);
      this.sc.set(w, w, l);
    }
    this.m.compose(this.v.set(this.x[i]!, this.y[i]!, this.z[i]!), this.q, this.sc);
    this.mesh.setMatrixAt(i, this.m);
    const f = fade * gain;
    this.col[i * 3] = this.r[i]! * f; this.col[i * 3 + 1] = this.g[i]! * f; this.col[i * 3 + 2] = this.b[i]! * f;
  }

  /** Live slots right now (including ones still waiting on a start delay). */
  count(): number { let n = 0; for (let i = 0; i < this.cap; i++) if (this.age[i]! < this.life[i]!) n++; return n; }

  clearOwner(owner: string): number {
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (this.owner[i] === owner && this.age[i]! < this.life[i]!) { this.kill(i); n++; }
    return n;
  }

  kill(i: number): void { this.age[i] = this.life[i]!; this.owner[i] = undefined; this.hide(i); }

  clearAll(): void { for (let i = 0; i < this.cap; i++) this.kill(i); this.alive = 0; this.mesh.visible = false; this.mesh.instanceMatrix.needsUpdate = true; }

  dispose(): void {
    this.mesh.removeFromParent();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }
}

export interface FlashSpec { x: number; y: number; z: number; color: number; size: number; grow?: number; life: number; delay?: number; owner?: string; vx?: number; vy?: number; vz?: number }
export interface RingSpec { x: number; y: number; z: number; color: number; radius: number; from?: number; life: number; delay?: number; normal?: { x: number; y: number; z: number }; owner?: string; vx?: number; vy?: number; vz?: number }
export interface StreakSpec { x: number; y: number; z: number; vx: number; vy: number; vz: number; color: number; length: number; width: number; life: number; gravity?: number; delay?: number; owner?: string; /** Orientation for a streak that has no velocity (a streak lying on the ground). */ dir?: { x: number; y: number; z: number } }
export interface LightSpec { x: number; y: number; z: number; color: number; intensity: number; life: number }

const tmpColor = new Color();

export class GlowLayer {
  private tier: GlowTier | null = null;
  private flashes: Slots | null = null;
  private rings: Slots | null = null;
  private streaks: Slots | null = null;
  private lights: PointLight[] = [];
  private lightAge: number[] = [];
  private lightLife: number[] = [];
  private lightPeak: number[] = [];
  private lightCursor = 0;
  private geometries: BufferGeometry[] = [];
  private soft = false;

  get currentTier(): GlowTier | null { return this.tier; }
  /** Particle count multiplier for the current tier (1 until configured). */
  get density(): number { return this.tier ? DENSITY[this.tier] : 1; }
  get isSoft(): boolean { return this.soft; }
  /** Reduced motion: dimmer flashes, no point lights. Takes effect on the next frame. */
  setSoft(on: boolean): void { this.soft = on; }

  stats(): { flashes: number; rings: number; streaks: number; lights: number; budget: GlowBudget | null } {
    let lights = 0;
    for (let i = 0; i < this.lights.length; i++) if (this.lightAge[i]! < this.lightLife[i]!) lights++;
    return { flashes: this.flashes?.count() ?? 0, rings: this.rings?.count() ?? 0, streaks: this.streaks?.count() ?? 0, lights, budget: this.tier ? GLOW_BUDGET[this.tier] : null };
  }
  get lightCount(): number { return this.lights.length; }
  /** Live-instance total for budget checks. */
  get activeCount(): number { const s = this.stats(); return s.flashes + s.rings + s.streaks; }

  configure(scene: Scene, tier: GlowTier): void {
    this.release();
    this.tier = tier;
    const b = GLOW_BUDGET[tier];
    const flashGeo = new SphereGeometry(0.5, 10, 7), ringGeo = new RingGeometry(0.86, 1, 40), streakGeo = new BoxGeometry(1, 1, 1);
    streakGeo.translate(0, 0, 0.5); // grows forward from its origin along +Z, so a streak starts at its spawn point
    this.geometries = [flashGeo, ringGeo, streakGeo];
    this.flashes = new Slots("flash", flashGeo, b.flashes, scene);
    this.rings = new Slots("ring", ringGeo, b.rings, scene);
    this.streaks = new Slots("streak", streakGeo, b.streaks, scene);
    (this.rings.mesh.material as MeshBasicMaterial).side = DoubleSide; // rings are seen from both faces
    for (let i = 0; i < b.lights; i++) {
      const l = new PointLight(0xffffff, 0, 10, 2);
      l.name = `fx.light.${i}`;
      scene.add(l);
      this.lights.push(l); this.lightAge.push(1); this.lightLife.push(1); this.lightPeak.push(0);
    }
  }

  flash(s: FlashSpec): boolean {
    const p = this.flashes;
    if (!p || s.life <= 0) return false;
    const i = p.claim();
    this.base(p, i, s.x, s.y, s.z, s.color, s.life, s.delay, s.owner);
    p.s0[i] = s.size * 0.4; p.s1[i] = s.size * (s.grow ?? 1.4);
    p.vx[i] = s.vx ?? 0; p.vy[i] = s.vy ?? 0; p.vz[i] = s.vz ?? 0; p.grav[i] = 0;
    return true;
  }

  ring(s: RingSpec): boolean {
    const p = this.rings;
    if (!p || s.life <= 0) return false;
    const i = p.claim();
    this.base(p, i, s.x, s.y, s.z, s.color, s.life, s.delay, s.owner);
    p.s0[i] = s.from ?? s.radius * 0.15; p.s1[i] = s.radius;
    const n = s.normal ?? { x: 0, y: 1, z: 0 };
    p.nx[i] = n.x; p.ny[i] = n.y; p.nz[i] = n.z;
    p.vx[i] = s.vx ?? 0; p.vy[i] = s.vy ?? 0; p.vz[i] = s.vz ?? 0; p.grav[i] = 0;
    return true;
  }

  streak(s: StreakSpec): boolean {
    const p = this.streaks;
    if (!p || s.life <= 0) return false;
    const i = p.claim();
    this.base(p, i, s.x, s.y, s.z, s.color, s.life, s.delay, s.owner);
    p.s0[i] = s.width; p.len[i] = s.length;
    p.vx[i] = s.vx; p.vy[i] = s.vy; p.vz[i] = s.vz; p.grav[i] = s.gravity ?? 0;
    p.nx[i] = s.dir?.x ?? 0; p.ny[i] = s.dir?.y ?? 1; p.nz[i] = s.dir?.z ?? 0;
    return true;
  }

  /** Point light pulse. Takes a free light, else the one closest to done; always a no-op on Low (zero lights) and under reduced motion. */
  light(s: LightSpec): boolean {
    if (this.lights.length === 0 || this.soft || s.life <= 0) return false;
    let pick = -1, bestLeft = Infinity;
    for (let n = 0; n < this.lights.length; n++) {
      const i = (this.lightCursor + n) % this.lights.length, left = this.lightLife[i]! - this.lightAge[i]!;
      if (left <= 0) { pick = i; break; }
      if (left < bestLeft) { bestLeft = left; pick = i; }
    }
    this.lightCursor = (pick + 1) % this.lights.length;
    const l = this.lights[pick]!;
    l.position.set(s.x, s.y, s.z);
    l.color.setHex(s.color);
    this.lightAge[pick] = 0; this.lightLife[pick] = s.life; this.lightPeak[pick] = s.intensity;
    l.intensity = s.intensity;
    return true;
  }

  private base(p: Slots, i: number, x: number, y: number, z: number, color: number, life: number, delay: number | undefined, owner: string | undefined): void {
    p.x[i] = x; p.y[i] = y; p.z[i] = z;
    tmpColor.setHex(color);
    p.r[i] = tmpColor.r; p.g[i] = tmpColor.g; p.b[i] = tmpColor.b;
    p.age[i] = -(delay ?? 0); p.life[i] = life; p.owner[i] = owner;
    if ((delay ?? 0) <= 0) p.draw(i, 0, this.soft ? SOFT_SCALE : 1);
  }

  update(dtSec: number): void {
    if (!(dtSec > 0)) return;
    const dt = Math.min(dtSec, 0.05), gain = this.soft ? SOFT_SCALE : 1;
    this.flashes?.step(dt, gain); this.rings?.step(dt, gain); this.streaks?.step(dt, gain);
    for (let i = 0; i < this.lights.length; i++) {
      if (!(this.lightAge[i]! < this.lightLife[i]!)) continue;
      const a = this.lightAge[i]! + dt;
      this.lightAge[i] = a;
      const l = this.lights[i]!;
      if (a >= this.lightLife[i]!) { l.intensity = 0; continue; }
      const k = a / this.lightLife[i]!;
      l.intensity = this.lightPeak[i]! * (1 - k) * (1 - k);
    }
  }

  /** Ends every charge effect an actor owns (action interrupted, died, left). Effects with no owner are untouched. */
  clearOwner(owner: string): number {
    return (this.flashes?.clearOwner(owner) ?? 0) + (this.rings?.clearOwner(owner) ?? 0) + (this.streaks?.clearOwner(owner) ?? 0);
  }

  clearAll(): void {
    this.flashes?.clearAll(); this.rings?.clearAll(); this.streaks?.clearAll();
    for (let i = 0; i < this.lights.length; i++) { this.lightAge[i] = 1; this.lightLife[i] = 1; this.lights[i]!.intensity = 0; }
  }

  release(): void {
    this.flashes?.dispose(); this.rings?.dispose(); this.streaks?.dispose();
    this.flashes = this.rings = this.streaks = null;
    for (const l of this.lights) l.removeFromParent();
    for (const g of this.geometries) g.dispose();
    this.lights = []; this.lightAge = []; this.lightLife = []; this.lightPeak = []; this.geometries = [];
    this.tier = null;
  }
}
