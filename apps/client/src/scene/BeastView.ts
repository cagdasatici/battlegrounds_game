import {
  BoxGeometry, CircleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry,
  type Object3D, type Scene,
} from "three";
import { BEAST, BEAST_MOVES } from "@eb/shared/config/beast";
import { fromCm, fromYaw } from "@eb/shared/schema";

/** Public replicated beast record (BeastSchema). Centimetres, 1/1024 turn yaw, integer ticks. */
export interface LoopBeast {
  phase: string; x: number; y: number; z: number; facingYaw: number; hp100: number; hpMax100: number;
  action: string; moveId: string; actionStartTick: number; actionEndTick: number; phaseEndTick: number; scale100: number; walking: boolean;
}

/** What the HUD needs, derived from the same record. */
export function beastBanner(b: LoopBeast | undefined, serverTick: number): { text: string; frac: number | null } | null {
  if (!b) return null;
  if (b.phase === "warning") return { text: `Something huge is coming in ${Math.max(0, Math.ceil((b.phaseEndTick - serverTick) / 60))}`, frac: null };
  if (b.phase === "alive" && b.hpMax100 > 0) return { text: "The Beast", frac: Math.max(0, Math.min(1, b.hp100 / b.hpMax100)) };
  if (b.phase === "defeated") return { text: "The Beast is down!", frac: 0 };
  return null;
}

const PHASE_NONE = "none";

/**
 * Presentation of the sparring beast: an original 5.5x brute built from primitives (no borrowed artwork), a ground
 * marker while it is on its way, and red ground telegraphs for the swipe cone and the slam circle. It reads server state
 * only; it never decides a hit, a position or a timer. Animation clocks are local presentation time.
 */
export class BeastView {
  private readonly root = new Group();
  private readonly body = new Group();
  private readonly marker: Mesh;
  private readonly swipeZone: Mesh;
  private readonly slamZone: Mesh;
  private readonly geos: Array<{ dispose(): void }> = [];
  private readonly mats: Array<{ dispose(): void }> = [];
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly head = new Group();
  private rec: LoopBeast | undefined;
  private tick = 0;
  private clock = 0;
  private appearT = 1;
  private lastPhase = PHASE_NONE;
  private viewer: { x: number; y: number; z: number } | null = null;
  private disposed = false;

  constructor(private readonly scene: Scene) {
    const fur = this.mat(new MeshStandardMaterial({ color: 0x5b2a2a, roughness: 0.95, flatShading: true }));
    const dark = this.mat(new MeshStandardMaterial({ color: 0x2e1717, roughness: 0.9, flatShading: true }));
    const bone = this.mat(new MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6, flatShading: true }));
    const eye = this.mat(new MeshBasicMaterial({ color: 0xffd34a }));
    const add = <G extends BoxGeometry | CylinderGeometry | SphereGeometry | ConeGeometry>(g: G): G => { this.geos.push(g); return g; };

    // Everything below is in normal-fighter metres; the root scales it by BEAST.scale. Faces -Z.
    const torso = new Mesh(add(new SphereGeometry(0.62, 12, 9)), fur); torso.scale.set(1.25, 1.1, 0.95); torso.position.y = 1.15;
    const belly = new Mesh(add(new SphereGeometry(0.5, 10, 8)), dark); belly.scale.set(1.05, 0.9, 0.7); belly.position.set(0, 0.95, -0.28);
    const shoulders = new Mesh(add(new BoxGeometry(1.9, 0.5, 0.8)), fur); shoulders.position.y = 1.62;
    this.head.position.set(0, 1.95, -0.2);
    const skull = new Mesh(add(new SphereGeometry(0.34, 10, 8)), fur); skull.scale.set(1.15, 0.95, 1);
    const jaw = new Mesh(add(new BoxGeometry(0.42, 0.16, 0.34)), dark); jaw.position.set(0, -0.2, -0.16);
    for (const s of [-1, 1]) {
      const horn = new Mesh(add(new ConeGeometry(0.1, 0.55, 8)), bone); horn.position.set(s * 0.3, 0.3, 0); horn.rotation.z = -s * 0.7;
      const e = new Mesh(add(new SphereGeometry(0.06, 6, 5)), eye); e.position.set(s * 0.14, 0.04, -0.3);
      const tusk = new Mesh(add(new ConeGeometry(0.05, 0.22, 6)), bone); tusk.position.set(s * 0.14, -0.22, -0.3); tusk.rotation.x = Math.PI;
      this.head.add(horn, e, tusk);
    }
    this.head.add(skull, jaw);

    for (const [arm, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(s * 1.05, 1.6, 0);
      const upper = new Mesh(add(new CylinderGeometry(0.2, 0.17, 0.9, 8)), fur); upper.position.y = -0.45;
      const fist = new Mesh(add(new SphereGeometry(0.27, 8, 7)), dark); fist.position.y = -1.0;
      arm.add(upper, fist);
    }
    for (const [leg, s] of [[this.legL, -1], [this.legR, 1]] as const) {
      leg.position.set(s * 0.42, 0.75, 0);
      const thigh = new Mesh(add(new CylinderGeometry(0.24, 0.2, 0.75, 8)), fur); thigh.position.y = -0.35;
      const foot = new Mesh(add(new BoxGeometry(0.4, 0.18, 0.55)), dark); foot.position.set(0, -0.72, -0.08);
      leg.add(thigh, foot);
    }
    this.body.add(torso, belly, shoulders, this.head, this.armL, this.armR, this.legL, this.legR);
    this.body.scale.setScalar(BEAST.scale);
    this.root.add(this.body);
    this.root.name = "beast"; this.root.visible = false;

    const zone = (m: MeshBasicMaterial, geo: CircleGeometry): Mesh => { const z = new Mesh(geo, m); z.rotation.x = -Math.PI / 2; z.visible = false; z.renderOrder = 2; return z; };
    const red = (): MeshBasicMaterial => this.mat(new MeshBasicMaterial({ color: 0xff3b2e, transparent: true, opacity: 0.3, depthWrite: false }));
    // Circle geometry lies in XY facing +Z; after rotating -90deg about X, local +Y of the geometry points to world -Z (forward).
    const swipeG = new CircleGeometry(BEAST_MOVES["beast.swipe"].reach, 28, Math.PI / 2 - (BEAST_MOVES["beast.swipe"].halfAngleDeg * Math.PI) / 180, (2 * BEAST_MOVES["beast.swipe"].halfAngleDeg * Math.PI) / 180);
    const slamG = new CircleGeometry(BEAST_MOVES["beast.slam"].reach, 36);
    this.geos.push(swipeG, slamG);
    this.swipeZone = zone(red(), swipeG); this.slamZone = zone(red(), slamG);
    const ring = new CircleGeometry(1, 36); this.geos.push(ring);
    this.marker = new Mesh(ring, this.mat(new MeshBasicMaterial({ color: 0xffa23a, transparent: true, opacity: 0.4, depthWrite: false })));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.marker.renderOrder = 2;
    for (const o of [this.root, this.swipeZone, this.slamZone, this.marker]) o.traverse((n) => { if (n.name === "") n.name = "beast.part"; });
    scene.add(this.root, this.swipeZone, this.slamZone, this.marker);
  }

  private mat<M extends { dispose(): void }>(m: M): M { this.mats.push(m); return m; }

  sync(rec: LoopBeast | undefined, serverTick: number): void {
    if (this.disposed) return;
    this.rec = rec; this.tick = serverTick;
    const phase = rec?.phase ?? PHASE_NONE;
    if (phase !== this.lastPhase) {
      if (phase === "alive") this.appearT = 0;
      this.lastPhase = phase;
    }
    this.place();
  }

  /** Camera position, so the body is hidden while the camera sits inside it (a 5.5x body would otherwise fill the screen). */
  setViewer(p: { x: number; y: number; z: number } | null): void { this.viewer = p; }

  update(dtSec = 0): void {
    if (this.disposed) return;
    this.clock += dtSec;
    this.appearT = Math.min(1, this.appearT + dtSec / 0.7);
    this.place();
  }

  /** Test and debug view of what is on screen. */
  snapshot(): { visible: boolean; x: number; y: number; z: number; scale: number; telegraph: string } {
    const t = this.swipeZone.visible ? "swipe" : this.slamZone.visible ? "slam" : this.marker.visible ? "marker" : "";
    return { visible: this.root.visible, x: this.root.position.x, y: this.root.position.y, z: this.root.position.z, scale: this.body.scale.x, telegraph: t };
  }

  private place(): void {
    const b = this.rec;
    const show = (o: Object3D, v: boolean): void => { o.visible = v; };
    show(this.swipeZone, false); show(this.slamZone, false); show(this.marker, false);
    if (!b || b.phase === PHASE_NONE) { show(this.root, false); return; }
    const x = fromCm(b.x), z = fromCm(b.z), ground = b.phase === "warning" ? 0 : fromCm(b.y) - 0.9;
    if (b.phase === "warning") {
      show(this.root, false);
      const pulse = 0.5 + 0.5 * Math.sin(this.clock * 8);
      this.marker.position.set(x, ground + 0.06, z);
      this.marker.scale.setScalar(BEAST.footprintRadius * (1.4 + 0.3 * pulse));
      (this.marker.material as MeshBasicMaterial).opacity = 0.25 + 0.3 * pulse;
      show(this.marker, true);
      return;
    }
    const v = this.viewer;
    const inside = v !== null && Math.hypot(v.x - x, v.z - z) < BEAST.scale * 0.85 && v.y - ground < BEAST.scale * 2.2;
    show(this.root, !inside);
    const yaw = fromYaw(b.facingYaw);
    this.root.position.set(x, ground, z);
    this.root.rotation.y = yaw;
    const appear = easeOut(this.appearT);
    const defeated = b.phase === "defeated";
    // Telegraphs: the zone fills in as the windup runs.
    const dur = Math.max(1, b.actionEndTick - b.actionStartTick);
    const prog = Math.max(0, Math.min(1, (this.tick - b.actionStartTick) / dur));
    if (!defeated && b.action === "Windup") {
      const zone = b.moveId === "beast.slam" ? this.slamZone : this.swipeZone;
      zone.position.set(x, ground + 0.07, z);
      zone.rotation.z = yaw; // Euler X-then-Z in the rotated frame spins the sector about world Y
      (zone.material as MeshBasicMaterial).opacity = 0.18 + 0.45 * prog;
      show(zone, true);
    }
    // Pose.
    let armL = 0, armR = 0, lean = 0, headX = 0, sink = 0, tilt = 0;
    const walk = b.walking && b.action === "Idle" ? Math.sin(this.clock * 4.5) : 0;
    if (defeated) {
      const t = Math.min(1, Math.max(0, 1 - (b.phaseEndTick - this.tick) / BEAST.defeatedTicks));
      tilt = -1.45 * easeOut(Math.min(1, t * 2)); sink = t > 0.6 ? (t - 0.6) * 2.5 * BEAST.scale : 0; armL = armR = 0.5; headX = 0.6;
      if (t >= 1) show(this.root, false);
    } else if (b.action === "Windup") {
      if (b.moveId === "beast.slam") { armL = armR = -2.6 * prog; lean = -0.15 * prog; }
      else { armR = -2.2 * prog; lean = 0.2 * prog; }
    } else if (b.action === "Active") {
      if (b.moveId === "beast.slam") { armL = armR = 0.5; lean = 0.35; headX = 0.3; }
      else { armR = 1.0; lean = -0.25; }
    } else if (b.action === "Recovery") {
      armL = armR = 0.25; lean = 0.1;
    } else if (b.action === "Stunned") {
      headX = 0.5 + 0.1 * Math.sin(this.clock * 12); lean = 0.25; armL = armR = 0.4;
    } else {
      armL = walk * 0.5; armR = -walk * 0.5;
    }
    this.armL.rotation.x = armL; this.armR.rotation.x = armR;
    this.legL.rotation.x = -walk * 0.5; this.legR.rotation.x = walk * 0.5;
    this.head.rotation.x = headX;
    this.body.rotation.x = lean; this.root.rotation.x = tilt;
    this.body.position.y = Math.abs(walk) * 0.06 - sink / BEAST.scale;
    this.body.scale.setScalar(BEAST.scale * (0.35 + 0.65 * appear));
  }

  clear(): void {
    this.rec = undefined; this.lastPhase = PHASE_NONE;
    this.root.visible = false; this.swipeZone.visible = false; this.slamZone.visible = false; this.marker.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent(); this.swipeZone.removeFromParent(); this.slamZone.removeFromParent(); this.marker.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }
