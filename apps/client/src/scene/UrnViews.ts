import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D, type Scene } from "three";
import { fromCm } from "@eb/shared/schema";

/** Public replicated urn record (UrnSchema). x/y/z are quantized centimetres; ids are small integers. */
export interface LoopUrn { id: number; state: string; holderId: number; returnTick: number; x: number; y: number; z: number }

/** Resolves a replicated entity id to the visible fighter group, or undefined when it is not on screen. */
export type HolderLookup = (entityId: number) => Object3D | undefined;

const HAND = { side: 0.42, up: 0.95, fwd: 0.28 }; // metres in the holder's local frame (yaw 0 faces -Z)

interface View { group: Group; ring: Mesh; state: string; holderId: number; anchor: { x: number; y: number; z: number } | null }

/**
 * Presentation of the replicated urn lifecycle. Reads server state only and never decides pickups, hits or timing:
 * anchored = vessel at its anchor, reserved = pulsing highlight at the anchor, held = vessel at the visible holder's
 * hand, returning = hidden until the server republishes anchored. A held urn whose holder is missing or dead is hidden.
 * The thrown flight is a server projectile; no streak is drawn because the schema publishes no throw endpoints.
 */
export class UrnViews {
  private readonly body = new SphereGeometry(1, 14, 10);
  private readonly neck = new CylinderGeometry(0.55, 0.7, 0.5, 14);
  private readonly ringGeo = new CylinderGeometry(1, 1, 0.04, 20, 1, true);
  private readonly ochre = new MeshBasicMaterial({ color: 0xc58a2c });
  private readonly dark = new MeshBasicMaterial({ color: 0x6b4515 });
  private readonly glow = new MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8 });
  private readonly views = new Map<number, View>();
  private lookup: HolderLookup = () => undefined;
  private clockSec = 0;
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  sync(records: Iterable<[string, LoopUrn]>, lookup: HolderLookup): void {
    if (this.disposed) return;
    this.lookup = lookup;
    const seen = new Set<number>();
    for (const [, u] of records) {
      seen.add(u.id);
      let v = this.views.get(u.id);
      if (!v) {
        const group = new Group();
        group.name = `urn.${u.id}`;
        const vessel = new Mesh(this.body, this.ochre); vessel.scale.set(0.3, 0.24, 0.3);
        const neck = new Mesh(this.neck, this.dark); neck.scale.set(0.3, 0.4, 0.3); neck.position.y = 0.26;
        const ring = new Mesh(this.ringGeo, this.glow); ring.scale.set(0.55, 1, 0.55); ring.position.y = -0.2; ring.visible = false;
        group.add(vessel, neck, ring);
        this.scene.add(group);
        v = { group, ring, state: "", holderId: 0, anchor: null };
        this.views.set(u.id, v);
      }
      v.state = u.state;
      v.holderId = u.holderId;
      // Reserved/held publish the holder's pose; only an anchored record carries the true anchor.
      if (u.state === "anchored" || (!v.anchor && u.state === "reserved")) v.anchor = { x: fromCm(u.x), y: fromCm(u.y), z: fromCm(u.z) };
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.group.removeFromParent();
      this.views.delete(id);
    }
    this.place();
  }

  /** Re-places held vessels after fighters were interpolated this frame. Also advances the reserved pulse. */
  update(dtSec = 0): void {
    if (this.disposed) return;
    this.clockSec += dtSec;
    this.place();
  }

  private place(): void {
    for (const v of this.views.values()) {
      const g = v.group;
      v.ring.visible = false;
      if (v.state === "anchored" || v.state === "reserved") {
        g.visible = v.anchor !== null;
        if (v.anchor) g.position.set(v.anchor.x, v.anchor.y, v.anchor.z);
        g.rotation.y = 0;
        if (v.state === "reserved") {
          v.ring.visible = true;
          v.ring.scale.setScalar(0.5 + 0.1 * Math.sin(this.clockSec * 10));
        }
      } else if (v.state === "held") {
        const holder = this.lookup(v.holderId);
        g.visible = holder !== undefined && holder.visible;
        if (holder) {
          const yaw = holder.rotation.y, s = Math.sin(yaw), c = Math.cos(yaw);
          // Forward is (-sin, -cos); right is (cos, -sin).
          g.position.set(holder.position.x + c * HAND.side - s * HAND.fwd, holder.position.y + HAND.up,
            holder.position.z - s * HAND.side - c * HAND.fwd);
          g.rotation.y = yaw;
        }
      } else {
        g.visible = false; // returning (or unknown): hidden until the server republishes anchored
      }
    }
  }

  snapshot(): { id: number; state: string; visible: boolean; x: number; y: number; z: number; holderId: number }[] {
    return [...this.views].map(([id, v]) => ({ id, state: v.state, visible: v.group.visible, x: v.group.position.x,
      y: v.group.position.y, z: v.group.position.z, holderId: v.holderId }));
  }

  clear(): void {
    for (const v of this.views.values()) v.group.removeFromParent();
    this.views.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.body.dispose(); this.neck.dispose(); this.ringGeo.dispose();
    this.ochre.dispose(); this.dark.dispose(); this.glow.dispose();
  }
}
