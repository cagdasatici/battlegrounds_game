import { Group, Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from "three";
import { fromCm } from "@eb/shared/schema";
import { SnapshotBuffer } from "../net/SnapshotBuffer.js";

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
  private readonly shell = new MeshBasicMaterial({ color: 0xff691f, wireframe: true });
  private readonly reflected = new MeshBasicMaterial({ color: 0x75e6ff, wireframe: true });
  private readonly views = new Map<string, { group: Group; shell: Mesh; buffer: SnapshotBuffer; signature: string; tick: number }>();
  private disposed = false;

  constructor(private readonly scene: Scene) {}

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
        v = { group, shell, buffer: new SnapshotBuffer(), signature: "", tick: -1 };
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
      v.group.scale.setScalar(p.chargeClass === "full" ? 0.5 : 0.35);
      v.group.userData = { entityId: p.entityId, ownerId: p.ownerId, reflectionCount: p.reflectionCount };
      const pose = v.buffer.sample(nowTick);
      if (pose) v.group.position.set(pose.x, pose.y, pose.z);
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.group.removeFromParent();
      this.views.delete(id);
    }
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
    this.geometry.dispose(); this.core.dispose(); this.shell.dispose(); this.reflected.dispose();
  }
}
