/**
 * Third person camera contract (spec section 9). Pure math, no Three.js: the renderer copies `pose`.
 * Camera position never affects hit detection; it is presentation only and may use render dt.
 */
import type { Collider } from "@eb/shared/config/arena";

export const CAMERA = {
  pivotHeight: 1.1,
  defaultDistance: 6.5,
  minDistance: 3.5,
  maxDistance: 10,
  fovDeg: 60,
  near: 0.1,
  far: 180,
  castRadius: 0.18,
  clearance: 0.1,
  easeOutSeconds: 0.15,
} as const;

export interface V3 { x: number; y: number; z: number }

/**
 * Rotates a camera relative stick vector (x right, z forward) into world space using camera yaw.
 * Yaw 0 faces -Z (same convention as shared/movement.ts), so forward = (-sin, -cos), right = (cos, -sin).
 * The server treats moveX/moveZ as world space (T06), so the client must send the result of this.
 */
export function cameraRelativeToWorld(stickX: number, stickZ: number, yaw: number): { x: number; z: number } {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  return { x: stickX * c - stickZ * s + 0, z: -stickX * s - stickZ * c + 0 }; // +0 normalises -0
}

/** Ray vs axis aligned box slab test. Returns entry distance in [0, maxT] or null. */
function rayBox(o: V3, d: V3, min: V3, max: V3, maxT: number): number | null {
  let t0 = 0, t1 = maxT;
  for (const k of ["x", "y", "z"] as const) {
    if (Math.abs(d[k]) < 1e-12) {
      if (o[k] < min[k] || o[k] > max[k]) return null;
      continue;
    }
    let a = (min[k] - o[k]) / d[k], b = (max[k] - o[k]) / d[k];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Ray vs vertical cylinder (finite height). Returns entry distance or null. */
function rayCylinder(o: V3, d: V3, c: V3, r: number, hh: number, maxT: number): number | null {
  const ox = o.x - c.x, oz = o.z - c.z;
  let t0 = 0, t1 = maxT;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-12) {
    if (ox * ox + oz * oz > r * r) return null;
  } else {
    const b = 2 * (ox * d.x + oz * d.z), cc = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) return null;
    const q = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - q) / (2 * a)); t1 = Math.min(t1, (-b + q) / (2 * a));
  }
  if (Math.abs(d.y) < 1e-12) {
    if (o.y < c.y - hh || o.y > c.y + hh) return null;
  } else {
    let lo = (c.y - hh - o.y) / d.y, hi = (c.y + hh - o.y) / d.y;
    if (lo > hi) [lo, hi] = [hi, lo];
    t0 = Math.max(t0, lo); t1 = Math.min(t1, hi);
  }
  return t0 <= t1 ? t0 : null;
}

/**
 * Sphere cast from `from` along unit `dir` up to `maxT` against static colliders, approximated by a ray
 * against each collider inflated by `radius` (conservative at box corners). Returns the hit distance.
 */
export function sphereCast(colliders: readonly Collider[], from: V3, dir: V3, maxT: number, radius: number): number {
  let best = maxT;
  for (const col of colliders) {
    const c = { x: col.centre[0], y: col.centre[1], z: col.centre[2] };
    let t: number | null;
    if (col.shape === "cuboid") {
      const [hx, hy, hz] = col.halfExtents;
      t = rayBox(from, dir, { x: c.x - hx - radius, y: c.y - hy - radius, z: c.z - hz - radius },
        { x: c.x + hx + radius, y: c.y + hy + radius, z: c.z + hz + radius }, best);
    } else {
      t = rayCylinder(from, dir, c, col.radius + radius, col.halfHeight + radius, best);
    }
    if (t !== null && t < best) best = t;
  }
  return best;
}

/** A capture camera track: orbit in radians at the peak, target distance in metres at the peak, total length in render ms. */
export interface CameraTrack { ms: number; orbitRad: number; distance: number }
export const CAMERA_TRACK_MAX_MS = 1200;

export interface CameraPose { position: V3; pivot: V3; yaw: number; pitch: number; distance: number }

/**
 * Orbit camera. Obstruction pulls inward immediately; clearing eases outward over 0.15 s.
 * `update` takes render dt in seconds: it never schedules gameplay.
 */
export class CameraRig {
  private desired: number = CAMERA.defaultDistance;
  private current: number = CAMERA.defaultDistance;
  private easeFrom: number = CAMERA.defaultDistance;
  private easeT = 1;
  /** Camera-shake scale (spec default 0.25); `reducedMotion` zeroes it. */
  static readonly SHAKE_SCALE = 0.25;
  reducedMotion = false;
  private shakeAmp = 0;
  private shakeLeft = 0;
  private shakeTotal = 0;
  private shakeClock = 0;
  private track: CameraTrack | null = null;
  private trackT = 0;
  pose: CameraPose = { position: { x: 0, y: 0, z: 0 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: CAMERA.defaultDistance };

  constructor(private colliders: readonly Collider[]) {}

  /** Impact shake (FX1): amplitude in metres before scaling, duration in render ms. A stronger shake replaces a weaker one. */
  shake(amplitude: number, ms: number): void {
    if (this.reducedMotion || !(amplitude > 0) || !(ms > 0)) return;
    const a = amplitude * CameraRig.SHAKE_SCALE;
    if (this.shakeLeft > 0 && a < this.shakeAmp * (this.shakeLeft / this.shakeTotal)) return;
    this.shakeAmp = a; this.shakeLeft = ms / 1000; this.shakeTotal = ms / 1000;
  }
  /** Capture camera (FX5): a short orbit plus distance ease that returns to the normal view by its end. No-op under Reduced Motion. */
  playTrack(track: CameraTrack): void {
    if (this.reducedMotion || !(track.ms > 0)) return;
    this.track = { ...track, ms: Math.min(track.ms, CAMERA_TRACK_MAX_MS) };
    this.trackT = 0;
  }
  /** Drops the track at once; the next update uses the normal camera. */
  cancelTrack(): void { this.track = null; this.trackT = 0; }
  get tracking(): boolean { return this.track !== null; }

  get shaking(): boolean { return this.shakeLeft > 0; }

  setColliders(colliders: readonly Collider[]): void { this.colliders = colliders; }

  /** Settings slider; clamped to 3.5 to 10 m. */
  setDistance(m: number): void {
    this.desired = Number.isFinite(m) ? Math.min(CAMERA.maxDistance, Math.max(CAMERA.minDistance, m)) : CAMERA.defaultDistance;
  }
  get distanceSetting(): number { return this.desired; }

  /** `centre` is the character capsule centre (corrected or smoothed mesh pose; presentation only). */
  update(centre: V3, yaw: number, pitch: number, dtSeconds: number): CameraPose {
    const pivot = { x: centre.x, y: centre.y + CAMERA.pivotHeight, z: centre.z };
    // Camera sits behind the facing direction: back = -forward = (sin yaw, cos yaw), raised by pitch.
    const dt = Number.isFinite(dtSeconds) && dtSeconds > 0 ? dtSeconds : 0;
    let camYaw = yaw, want: number = this.desired;
    if (this.reducedMotion) this.cancelTrack();
    if (this.track) {
      this.trackT += dt * 1000;
      const p = this.trackT / this.track.ms;
      if (p >= 1) this.cancelTrack();
      else {
        const bell = Math.sin(Math.PI * p); // 0 at both ends, so start and finish never snap
        camYaw = yaw + this.track.orbitRad * bell;
        want = this.desired + (this.track.distance - this.desired) * bell;
      }
    }
    const cp = Math.cos(pitch);
    const dir = { x: Math.sin(camYaw) * cp, y: -Math.sin(pitch), z: Math.cos(camYaw) * cp };
    const hit = sphereCast(this.colliders, pivot, dir, want, CAMERA.castRadius);
    const allowed = hit < want ? Math.max(0, hit - CAMERA.clearance) : want;
    if (allowed <= this.current) {
      this.current = allowed; // pull inward immediately
      this.easeFrom = allowed;
      this.easeT = 1;
    } else {
      if (this.easeT >= 1) { this.easeFrom = this.current; this.easeT = 0; }
      this.easeT = Math.min(1, this.easeT + dt / CAMERA.easeOutSeconds);
      this.current = Math.min(allowed, this.easeFrom + (allowed - this.easeFrom) * this.easeT);
    }
    const d = this.current;
    let ox = 0, oy = 0, oz = 0;
    if (this.shakeLeft > 0) {
      this.shakeClock += dt;
      const k = this.shakeAmp * (this.shakeLeft / this.shakeTotal);
      ox = Math.sin(this.shakeClock * 71) * k; oy = Math.sin(this.shakeClock * 93 + 1) * k; oz = Math.sin(this.shakeClock * 57 + 2) * k;
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
    }
    this.pose = {
      position: { x: pivot.x + dir.x * d + ox, y: pivot.y + dir.y * d + oy, z: pivot.z + dir.z * d + oz },
      pivot, yaw, pitch, distance: d,
    };
    return this.pose;
  }
}
