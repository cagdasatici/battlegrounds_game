import { BoxGeometry, CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from "three";

/**
 * Presentation burst for Beast Awaken (and its reversal): an expanding shockwave ring, a flash disc, and debris that
 * flies out and falls. Parented to the fighter's group (origin = capsule centre), lives about a second, never touches
 * gameplay. Geometry is shared; everything is disposed with `dispose`.
 */
const LIFE_S = 1.0;
const DEBRIS = 22;

interface Piece { mesh: Mesh; vx: number; vy: number; vz: number; spin: number }

export class TransformBurst {
  private readonly root = new Group();
  private readonly ring = new Mesh(new RingGeometry(0.85, 1, 40), new MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, depthWrite: false }));
  private readonly flash = new Mesh(new CircleGeometry(1, 28), new MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false }));
  private readonly debrisGeo = new BoxGeometry(0.28, 0.28, 0.28);
  private readonly debrisMat = new MeshBasicMaterial({ color: 0x6b5a4a, transparent: true, opacity: 1 });
  private pieces: Piece[] = [];
  private age = LIFE_S;
  private reach = 8;
  private disposed = false;

  /** `groundOffset` is the feet height relative to the parent's origin (the capsule centre is 0.9 m above the ground). */
  constructor(parent: Group, private readonly groundOffset = -0.9) {
    this.ring.rotation.x = -Math.PI / 2; this.flash.rotation.x = -Math.PI / 2;
    this.ring.name = "beast.fx"; this.flash.name = "beast.fx"; this.root.name = "beast.fx";
    this.root.visible = false;
    this.root.add(this.ring, this.flash);
    parent.add(this.root);
  }

  get active(): boolean { return this.age < LIFE_S; }

  /** `reach` is the ring's final radius in metres; `seed` makes the debris deterministic. */
  trigger(reach = 8, seed = 1): void {
    if (this.disposed) return;
    this.reach = reach; this.age = 0; this.root.visible = true;
    for (const p of this.pieces) { p.mesh.removeFromParent(); }
    this.pieces = [];
    const rnd = (n: number): number => { const s = Math.sin(n * 91.7 + seed * 13.3) * 43758.5; return s - Math.floor(s); };
    for (let i = 0; i < DEBRIS; i++) {
      const m = new Mesh(this.debrisGeo, this.debrisMat);
      m.name = "beast.fx";
      const a = rnd(i) * Math.PI * 2, sp = (0.45 + 0.55 * rnd(i + 40)) * reach * 1.1;
      m.position.set(Math.cos(a) * 0.6, this.groundOffset + 0.2, Math.sin(a) * 0.6);
      m.scale.setScalar(0.6 + rnd(i + 80) * 1.6);
      this.root.add(m);
      this.pieces.push({ mesh: m, vx: Math.cos(a) * sp, vy: 4 + rnd(i + 120) * reach * 0.7, vz: Math.sin(a) * sp, spin: (rnd(i + 160) - 0.5) * 12 });
    }
  }

  update(dtSec: number): void {
    if (this.disposed || !this.active) return;
    this.age = Math.min(LIFE_S, this.age + dtSec);
    const t = this.age / LIFE_S;
    if (t >= 1) { this.root.visible = false; for (const p of this.pieces) p.mesh.removeFromParent(); this.pieces = []; return; }
    const r = Math.max(0.2, this.reach * (1 - (1 - t) * (1 - t)));
    this.ring.position.y = this.groundOffset + 0.08; this.ring.scale.setScalar(r);
    (this.ring.material as MeshBasicMaterial).opacity = 0.9 * (1 - t);
    this.flash.position.y = this.groundOffset + 0.06; this.flash.scale.setScalar(this.reach * 0.45 * (1 - t * 0.5));
    (this.flash.material as MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - t * 2.4);
    for (const p of this.pieces) {
      p.vy -= 22 * dtSec;
      p.mesh.position.x += p.vx * dtSec; p.mesh.position.y = Math.max(this.groundOffset + 0.1, p.mesh.position.y + p.vy * dtSec); p.mesh.position.z += p.vz * dtSec;
      p.mesh.rotation.x += p.spin * dtSec; p.mesh.rotation.z += p.spin * 0.7 * dtSec;
    }
    this.debrisMat.opacity = Math.min(1, (1 - t) * 2.2);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.ring.geometry.dispose(); (this.ring.material as MeshBasicMaterial).dispose();
    this.flash.geometry.dispose(); (this.flash.material as MeshBasicMaterial).dispose();
    this.debrisGeo.dispose(); this.debrisMat.dispose();
    this.pieces = [];
  }
}
