import { Group, Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from "three";
import { fromCm } from "@eb/shared/schema";
import { SnapshotBuffer } from "../net/SnapshotBuffer.js";
import type { EffectsPool } from "./EffectsPool.js";

/** Public server state only. All positions and velocities are quantized centimetres. */
export interface LoopProjectile {
  entityId: number; ownerId: number; spawnTick: number;
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  chargeClass: string; reflectionCount: number; remainingTicks: number;
}

/** Persistent gameplay visuals, independent of short-lived/capped cosmetic effects. */
export class ProjectileViews {
  private readonly geometry = new SphereGeometry(1, 16, 10);
  private readonly core = new MeshBasicMaterial({ color: 0xffedab });
  private readonly shell = new MeshBasicMaterial({ color: 0xff691f, transparent: true, opacity: 0.38, depthWrite: false });
  private readonly reflectedCore = new MeshBasicMaterial({ color: 0xdbf8ff });
  private readonly reflected = new MeshBasicMaterial({ color: 0x75e6ff, transparent: true, opacity: 0.38, depthWrite: false });
  private readonly views = new Map<string, { group: Group; shell: Mesh; buffer: SnapshotBuffer; signature: string; tick: number; trail: { x: number; y: number; z: number } | null; dir: { x: number; y: number; z: number } }>();
  private disposed = false;

  /** UX10b: optional glow layer for the muzzle burst and the glowing trail. Cosmetic only; the orb itself is unchanged. */
  constructor(private readonly scene: Scene, private readonly effects?: EffectsPool) {}

  sync(records: Iterable<[string, LoopProjectile]>, tick: number, nowTick: number): void {
    if (this.disposed) return;
    const seen = new Set<string>();
    for (const [id, p] of records) {
      if (p.remainingTicks <= 0) continue;
      seen.add(id);
      let v = this.views.get(id);
      if (!v) {
        const group = new Group();
        group.name = `ember-orb.${id}`;
        const core = new Mesh(this.geometry, this.core);
        core.scale.setScalar(0.72);
        const shell = new Mesh(this.geometry, this.shell);
        group.add(core, shell);
        this.scene.add(group);
        v = { group, shell, buffer: new SnapshotBuffer(), signature: "", tick: -1, trail: null, dir: { x: 0, y: 0, z: 1 } };
        this.views.set(id, v);
      }
      const signature = `${p.spawnTick}/${p.ownerId}/${p.reflectionCount}`;
      // Never interpolate across the old incoming trajectory after a server-confirmed reflection.
      if (signature !== v.signature) { v.buffer.clear(); v.tick = -1; v.signature = signature; }
      if (v.tick !== tick) {
        v.buffer.push({ tick, x: fromCm(p.x), y: fromCm(p.y), z: fromCm(p.z),
          vx: fromCm(p.vx), vy: fromCm(p.vy), vz: fromCm(p.vz), yaw: 0 });
        v.tick = tick;
      }
      v.shell.material = p.reflectionCount > 0 ? this.reflected : this.shell;
      (v.group.children[0] as Mesh).material = p.reflectionCount > 0 ? this.reflectedCore : this.core;
      v.shell.scale.set(1.12, 0.86 + 0.08 * Math.sin(nowTick * 0.5), 1.12);
      v.shell.rotation.set(nowTick * 0.09, nowTick * 0.12, 0);
      v.group.scale.setScalar(p.chargeClass === "full" ? 0.5 : 0.35);
      v.group.userData = { entityId: p.entityId, ownerId: p.ownerId, reflectionCount: p.reflectionCount };
      const pose = v.buffer.sample(nowTick);
      if (pose) { v.group.position.set(pose.x, pose.y, pose.z); this.glow(v, p, pose); }
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      this.fizzle(v);
      v.group.removeFromParent();
      this.views.delete(id);
    }
  }

  /** UX10b: launch (muzzle) burst on the first drawn pose, then a glowing trail every 0.3 m of travel; a reflection flashes cyan. */
  private glow(v: { group: Group; trail: { x: number; y: number; z: number } | null; dir: { x: number; y: number; z: number } }, p: LoopProjectile, pose: { x: number; y: number; z: number }): void {
    const g = this.effects?.glow;
    if (!g) return;
    const sp = Math.hypot(p.vx, p.vy, p.vz) / 100;
    if (sp > 0.01) v.dir = { x: p.vx / 100 / sp, y: p.vy / 100 / sp, z: p.vz / 100 / sp };
    const big = p.chargeClass === "full" ? 1.4 : 1, hot = p.reflectionCount > 0 ? 0x75e6ff : 0xff8a2a, core = p.reflectionCount > 0 ? 0xdaf6ff : 0xfff1b0;
    const d = v.dir;
    if (v.trail === null) {
      g.flash({ ...pose, color: hot, size: 0.9 * big, grow: 1.7, life: 0.2 });
      g.flash({ ...pose, color: core, size: 0.5 * big, grow: 1.6, life: 0.12 });
      g.ring({ ...pose, color: core, radius: 0.9 * big, life: 0.25, normal: d });
      for (let i = 0; i < Math.max(3, Math.round(8 * g.density)); i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.5;
        g.streak({ ...pose, vx: d.x * 9 + Math.cos(a) * r, vy: d.y * 9 + Math.sin(a) * r, vz: d.z * 9 + Math.cos(a + 1) * r, color: i % 2 ? core : hot, length: 0.7, width: 0.05, life: 0.25 });
      }
      g.light({ ...pose, color: hot, intensity: 20 * big, life: 0.2 });
      v.trail = { x: pose.x, y: pose.y, z: pose.z };
      return;
    }
    if (Math.hypot(pose.x - v.trail.x, pose.y - v.trail.y, pose.z - v.trail.z) < 0.3) return;
    v.trail = { x: pose.x, y: pose.y, z: pose.z };
    const tail = (len: number): { x: number; y: number; z: number } => ({ x: pose.x - d.x * len, y: pose.y - d.y * len, z: pose.z - d.z * len }); // streaks grow forward, so start behind the orb
    g.streak({ ...tail(1.4 * big), vx: d.x * 0.3, vy: d.y * 0.3, vz: d.z * 0.3, color: hot, length: 1.4 * big, width: 0.22 * big, life: 0.3 });
    g.streak({ ...tail(1.0 * big), vx: d.x * 0.3, vy: d.y * 0.3, vz: d.z * 0.3, color: core, length: 1.0 * big, width: 0.09 * big, life: 0.22 });
    g.flash({ ...pose, color: hot, size: 0.9 * big, grow: 1.2, life: 0.1 });
  }

  private fizzle(v: { group: Group; trail: unknown }): void {
    const g = this.effects?.glow;
    if (!g || v.trail === null) return;
    const p = v.group.position;
    g.flash({ x: p.x, y: p.y, z: p.z, color: 0xff8a2a, size: 0.9, grow: 1.6, life: 0.18 });
  }

  snapshot(): { id: string; x: number; y: number; z: number; ownerId: number; reflectionCount: number }[] {
    return [...this.views].map(([id, v]) => ({ id, x: v.group.position.x, y: v.group.position.y, z: v.group.position.z,
      ownerId: Number(v.group.userData["ownerId"]), reflectionCount: Number(v.group.userData["reflectionCount"]) }));
  }

  clear(): void {
    for (const v of this.views.values()) v.group.removeFromParent();
    this.views.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.geometry.dispose(); this.core.dispose(); this.shell.dispose(); this.reflected.dispose(); this.reflectedCore.dispose();
  }
}
