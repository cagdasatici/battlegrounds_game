import type { EffectsPool } from "./EffectsPool.js";
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, type Scene } from "three";
import { buildBeastModel, type BeastModel } from "./BeastModel.js";
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
  /** Built the first time a beast is on screen (about 50 draw calls; nothing is built for rooms that never see one). */
  private model: BeastModel | null = null;
  private readonly marker: Mesh;
  private readonly shadow: Mesh;
  private readonly swipeZone: Mesh;
  private readonly slamZone: Mesh;
  private readonly geos: Array<{ dispose(): void }> = [];
  private readonly mats: Array<{ dispose(): void }> = [];
  private rec: LoopBeast | undefined;
  private tick = 0;
  private clock = 0;
  private appearT = 1;
  private lastPhase = PHASE_NONE;
  private viewer: { x: number; y: number; z: number } | null = null;
  private disposed = false;

  private lastDefeat = 0;

  constructor(private readonly scene: Scene, private readonly effects?: EffectsPool) {
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
    // Soft contact shadow so the huge body sits on the ground.
    this.shadow = new Mesh(ring, this.mat(new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false })));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.scale.setScalar(BEAST.scale * 0.8); this.shadow.position.y = 0.04; this.shadow.renderOrder = 1;
    this.root.add(this.shadow);
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
    let sink = 0, defeat = 0;
    if (defeated) {
      defeat = Math.min(1, Math.max(0, 1 - (b.phaseEndTick - this.tick) / BEAST.defeatedTicks));
      sink = defeat > 0.9 ? (defeat - 0.9) * 10 * 0.6 * BEAST.scale : 0; // lies still, then settles into the ground
      if (defeat >= 1) show(this.root, false);
      if (this.effects && !inside) for (const i of beastDeathImpacts(this.lastDefeat, defeat)) this.dust(BEAST_DEATH_IMPACTS[i]!, x, ground, z, yaw);
    }
    this.lastDefeat = defeat;
    if (!this.model) { this.model = buildBeastModel(); this.model.group.traverse((n) => { if (n.name === "") n.name = "beast.part"; }); this.body.add(this.model.group); }
    this.model.pose({ clock: this.clock, walking: b.walking, action: defeated ? "Dead" : b.action, moveId: b.moveId, prog, defeat });
    this.body.position.y = -sink;
    this.body.scale.setScalar(BEAST.scale * (0.35 + 0.65 * appear));
  }

  /** Ground-impact dust for one death beat: a low ring of grit plus heavier clods, along the side the body falls to. */
  private dust(imp: BeastDeathImpact, x: number, y: number, z: number, yaw: number): void {
    const fx = this.effects!, k = BEAST.scale;
    // rotation.z > 0 tips the model toward its local -X; with the root yaw that is world (-cos yaw, 0, sin yaw).
    const dx = -Math.cos(yaw), dz = Math.sin(yaw), cx = x + dx * imp.offset * k, cz = z + dz * imp.offset * k, r = imp.spread * k;
    for (let i = 0; i < imp.count; i++) {
      const a = Math.random() * Math.PI * 2, d = r * (0.4 + 0.6 * Math.random()), sp = 2 + Math.random() * 4 * imp.power;
      const clod = i % 4 === 0;
      fx.spawn({
        x: cx + Math.cos(a) * d, y: y + 0.2, z: cz + Math.sin(a) * d,
        vx: Math.cos(a) * sp, vy: clod ? 3 + Math.random() * 4 * imp.power : 0.4 + Math.random() * 1.2, vz: Math.sin(a) * sp,
        life: clod ? 0.7 + Math.random() * 0.4 : 1.2 + Math.random() * 0.8, size: clod ? 0.35 + Math.random() * 0.3 : 1.1 + Math.random() * 1.4 * imp.power,
        color: clod ? 0x5a4636 : 0xb8a58a, gravity: clod ? 14 : -0.25,
      });
    }
  }

  clear(): void {
    this.rec = undefined; this.lastPhase = PHASE_NONE; this.lastDefeat = 0;
    this.root.visible = false; this.swipeZone.visible = false; this.slamZone.visible = false; this.marker.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent(); this.swipeZone.removeFromParent(); this.slamZone.removeFromParent(); this.marker.removeFromParent();
    this.model?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
  }
}

function easeOut(t: number): number { return 1 - (1 - t) * (1 - t); }

/** One ground hit in the beast's death sequence (BeastModel defeat phases). Offset and spread are in model units (x BEAST.scale). */
export interface BeastDeathImpact { at: number; offset: number; spread: number; count: number; power: number }

/** Knees hit the ground, the body slams down on its side, it rolls onto its back. D values matching BeastModel's phase edges. */
export const BEAST_DEATH_IMPACTS: readonly BeastDeathImpact[] = [
  { at: 0.34, offset: 0, spread: 0.45, count: 24, power: 0.7 },
  { at: 0.68, offset: 1.3, spread: 1.2, count: 60, power: 1.2 },
  { at: 0.86, offset: 1.3, spread: 1.0, count: 34, power: 0.8 },
];

/** Indices of impacts crossed going from defeat progress `prev` to `cur` (each fires once; none when time goes backwards). */
export function beastDeathImpacts(prev: number, cur: number): number[] {
  const out: number[] = [];
  BEAST_DEATH_IMPACTS.forEach((imp, i) => { if (prev < imp.at && cur >= imp.at) out.push(i); });
  return out;
}
