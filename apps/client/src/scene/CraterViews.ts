import { BufferGeometry, CircleGeometry, DodecahedronGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, TorusGeometry, type Scene } from "three";
import { craterDepth } from "@eb/shared/config/beast";
import { fromCm } from "@eb/shared/schema";

/** Public replicated crater record (CraterSchema). Centimetres; startTick is an absolute server tick. */
export interface LoopCrater { id: number; x: number; z: number; radius100: number; startTick: number }

interface View { group: Group; scar: Mesh; rim: Mesh; ember: Mesh; rocks: Mesh[]; radius: number; start: number }

const ROCKS = 9;

/**
 * Presentation of the sparring craters: a scorched scar, a raised broken rim with rubble, and an ember core that cools.
 * All of it follows `craterDepth(tick, start)` (1 = fresh, 0 = healed): the rubble sinks back, the scar fades. The server
 * owns the list and the timing; these meshes never affect collision.
 */
export class CraterViews {
  private readonly views = new Map<number, View>();
  private readonly geos: BufferGeometry[] = [];
  private readonly scarGeo = this.keep(new CircleGeometry(1, 40));
  private readonly rimGeo = this.keep(new TorusGeometry(1, 0.07, 6, 40));
  private readonly rockGeo = this.keep(new DodecahedronGeometry(1, 0));
  private readonly scarMat = new MeshBasicMaterial({ color: 0x241810, transparent: true, opacity: 0.6, depthWrite: false });
  private readonly emberMat = new MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly rimMat = new MeshStandardMaterial({ color: 0x5a4636, roughness: 1, flatShading: true });
  private readonly rockMat = new MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95, flatShading: true });
  private disposed = false;

  constructor(private readonly scene: Scene) {}

  private keep<G extends BufferGeometry>(g: G): G { this.geos.push(g); return g; }

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
  }

  private create(c: LoopCrater): View {
    const radius = fromCm(c.radius100);
    const group = new Group(); group.name = "beast.crater";
    group.position.set(fromCm(c.x), 0.02, fromCm(c.z));
    const scar = new Mesh(this.scarGeo, this.scarMat); scar.rotation.x = -Math.PI / 2; scar.scale.setScalar(radius); scar.name = "beast.crater";
    const ember = new Mesh(this.scarGeo, this.emberMat); ember.rotation.x = -Math.PI / 2; ember.scale.setScalar(radius * 0.55); ember.position.y = 0.01; ember.name = "beast.crater";
    const rim = new Mesh(this.rimGeo, this.rimMat); rim.rotation.x = -Math.PI / 2; rim.scale.setScalar(radius); rim.position.y = 0.04; rim.name = "beast.crater";
    const rocks: Mesh[] = [];
    for (let i = 0; i < ROCKS; i++) {
      const a = ((i + 0.4 * Math.sin(c.id * 3 + i * 7)) / ROCKS) * Math.PI * 2, rr = radius * (0.95 + 0.12 * Math.sin(i * 5 + c.id));
      const m = new Mesh(this.rockGeo, this.rockMat);
      m.position.set(Math.cos(a) * rr, 0.1, Math.sin(a) * rr); m.rotation.set(i, i * 2.1, i * 0.7); m.name = "beast.crater";
      (m.userData as { base: number }).base = 0.18 + 0.2 * (0.5 + 0.5 * Math.sin(i * 12.9 + c.id));
      rocks.push(m); group.add(m);
    }
    group.add(scar, ember, rim);
    this.scene.add(group);
    return { group, scar, rim, ember, rocks, radius, start: c.startTick };
  }

  private shape(v: View, tick: number): void {
    const d = craterDepth(tick, v.start);
    this.scarMat.opacity = 0.6; // shared material: the per-crater fade is carried by scale so several craters can coexist
    v.scar.scale.setScalar(v.radius * (0.55 + 0.45 * d));
    v.ember.scale.setScalar(v.radius * 0.55 * d * d);
    v.ember.visible = d > 0.35;
    v.rim.scale.set(v.radius, v.radius, Math.max(0.05, d));
    v.rim.position.y = 0.04 * d;
    for (const r of v.rocks) { const b = (r.userData as { base: number }).base; r.scale.setScalar(Math.max(0.001, b * d)); r.position.y = 0.1 * d; }
    v.group.visible = d > 0.01;
  }

  snapshot(): { id: number; x: number; z: number; radius: number; visible: boolean }[] {
    return [...this.views].map(([id, v]) => ({ id, x: v.group.position.x, z: v.group.position.z, radius: v.radius, visible: v.group.visible }));
  }

  clear(): void { for (const v of this.views.values()) v.group.removeFromParent(); this.views.clear(); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    for (const g of this.geos) g.dispose();
    this.scarMat.dispose(); this.emberMat.dispose(); this.rimMat.dispose(); this.rockMat.dispose();
  }
}
