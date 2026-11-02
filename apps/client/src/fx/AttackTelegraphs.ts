import { BufferGeometry, CircleGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, PlaneGeometry, type Scene } from "three";
import { colliderAabb, type Collider } from "@eb/shared/config/arena";
import { ALL_ABILITY_DEFS } from "@eb/shared/config/kits/index";
import type { AbilityDef } from "@eb/shared/abilities";
import { forwardOf } from "@eb/shared/math";
import { fromYaw } from "@eb/shared/schema";
import type { PresentationDeps } from "./index.js";

/**
 * QV02: retained attack warnings. One pooled slot per telegraphed actor, drawn from the replicated action phase and
 * removed when that phase ends. Presentation only: it reads replicated players and the replicated tick, never schedules
 * damage and never feeds the simulation. Separate from the expendable FX1 particles so a saturated particle pool cannot
 * erase a warning. The outline always draws (low quality and Reduced Motion); the animated fill is dropped there.
 */

/** Moves that get a warning: area or directional shapes whose extent is fixed by the definition and the actor pose. */
export const TELEGRAPHED_MOVES: readonly string[] = ["sv.b1", "sv.b2", "sv.a2", "sv.a3", "td.a3", "ea.b1", "ea.a3", "ea.a4"];
/**
 * Area moves deliberately left without a warning because the replicated public record cannot identify where the area
 * lands. TODO: add a recipe when the server publishes the field named here.
 */
export const UNTELEGRAPHED_MOVES: Readonly<Record<string, string>> = {
  "ea.b2": "travel endpoint: the early-end recast tick is not replicated, so the 8 m travel end is unknown",
  "ea.b4": "detonation point: ground-contact point within 8 m ahead is not replicated",
  "ea.a1": "sweep end and missed-probe blast point are not replicated",
  "ea.a2": "dash stop point (wall or capture) is not replicated",
  "td.a4": "dash stop point (wall or capture) is not replicated",
};

export const TELEGRAPH_CAPACITY = 6;
const WINDUP_COLOR = 0xffc34d, ACTIVE_COLOR = 0xff4a3a;
const BEAM_ORIGIN_FORWARD = 0.6, BEAM_ORIGIN_UP = 0.4; // spec 16, mirrors DEFAULT_BEAM_ORIGIN on the server
const LIFT = 0.06;

export interface TelegraphPlayer {
  entityId: number; lifeId: number; x: number; y: number; z: number; facingYaw: number;
  action?: string; moveId?: string; actionStartTick?: number; actionEndTick?: number;
}
export interface TelegraphOptions {
  tick: number; reducedMotion: boolean; lowQuality: boolean;
  surface?: PresentationDeps["surfaceHeight"] | undefined;
  /** Horizontal distance from (ox,oy,oz) along (fx,fz) to the first solid cover, up to `max`. Defaults to unobstructed. */
  cover?: ((ox: number, oy: number, oz: number, fx: number, fz: number, max: number) => number) | undefined;
}
type Phase = "Windup" | "Active";
interface Slot { group: Group; fill: Mesh; line: Line; fillMat: MeshBasicMaterial; lineMat: LineBasicMaterial; key: string; actor: number; move: string; phase: Phase; ox: number; oy: number; oz: number; yaw: number; used: boolean }
export interface TelegraphInfo { key: string; phase: Phase; progress: number; length: number; width: number; kind: string }

const DEF_BY_ID = new Map<string, AbilityDef>(ALL_ABILITY_DEFS.map((d) => [d.id, d]));

/** Distance along a horizontal ray to the first collider box that spans the ray height; `max` when clear. Cylinders use their bounding box (slightly conservative). */
export function rayCoverLength(colliders: readonly Collider[], ox: number, oy: number, oz: number, fx: number, fz: number, max: number): number {
  let best = max;
  for (const c of colliders) {
    const b = colliderAabb(c);
    if (oy < b.min[1] || oy > b.max[1]) continue;
    let t0 = 0, t1 = best;
    for (const [o, d, lo, hi] of [[ox, fx, b.min[0], b.max[0]], [oz, fz, b.min[2], b.max[2]]] as const) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t1 = -1; break; } continue; }
      const a = (lo - o) / d, e = (hi - o) / d;
      t0 = Math.max(t0, Math.min(a, e)); t1 = Math.min(t1, Math.max(a, e));
    }
    if (t1 >= t0 && t0 < best) best = Math.max(0, t0);
  }
  return best;
}

const unitRect = (): BufferGeometry => new BufferGeometry().setAttribute("position", new Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, -1, -0.5, 0, -1], 3));
const unitCircle = (): BufferGeometry => {
  const v: number[] = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; v.push(Math.cos(a), 0, Math.sin(a)); }
  return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(v, 3));
};

export class AttackTelegraphs {
  private readonly slots: Slot[] = [];
  private readonly root = new Group();
  private readonly plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5); // forward span [0,1] along -Z
  private readonly disc = new CircleGeometry(1, 32).rotateX(-Math.PI / 2);
  private readonly rect = unitRect();
  private readonly ring = unitCircle();
  private readonly byActor = new Map<number, Slot>();
  private disposed = false;
  /** Warnings refused because every slot was busy. */
  dropped = 0;
  /** Every warning phase ever started, as "Phase:key" (capped). Lets tests prove a skipped phase was never drawn retroactively. */
  readonly history: string[] = [];

  constructor(private readonly scene: Scene, readonly capacity = TELEGRAPH_CAPACITY) {
    this.root.name = "fx.telegraphs";
    for (let i = 0; i < capacity; i++) {
      const fillMat = new MeshBasicMaterial({ color: WINDUP_COLOR, transparent: true, opacity: 0.2, depthWrite: false, fog: false });
      const lineMat = new LineBasicMaterial({ color: WINDUP_COLOR, fog: false });
      const fill = new Mesh(this.plane, fillMat), line = new Line(this.rect, lineMat);
      line.computeLineDistances();
      const group = new Group();
      group.add(fill, line);
      group.visible = false;
      this.root.add(group);
      this.slots.push({ group, fill, line, fillMat, lineMat, key: "", actor: -1, move: "", phase: "Windup", ox: 0, oy: 0, oz: 0, yaw: 0, used: false });
    }
    scene.add(this.root);
  }

  get activeCount(): number { return this.slots.filter((s) => s.used).length; }

  /** Reconciles the slots with this frame's replicated players. Call every frame with a materialized collection. */
  sync(players: Iterable<unknown>, o: TelegraphOptions): void {
    if (this.disposed) return;
    const live = new Set<number>();
    for (const v of players) {
      const p = v as TelegraphPlayer;
      live.add(p.entityId);
      const def = p.moveId && TELEGRAPHED_MOVES.includes(p.moveId) ? DEF_BY_ID.get(p.moveId) : undefined;
      const phase = p.action === "Windup" || p.action === "Active" ? p.action : null;
      const start = p.actionStartTick ?? 0, end = p.actionEndTick ?? 0;
      const slot = this.byActor.get(p.entityId);
      if (!def || !phase || o.tick >= end) { if (slot) this.release(slot); continue; }
      const key = `${p.entityId}:${p.lifeId}:${def.id}:${start}`;
      let s = slot;
      if (s && s.key !== key) {
        // Windup -> Active of the same cast and life transfers the slot and its committed origin; anything else replaces it.
        const sameCast = s.move === def.id && s.key.startsWith(`${p.entityId}:${p.lifeId}:`) && s.phase === "Windup" && phase === "Active";
        if (sameCast) { s.key = key; this.note("Active", key); } else { this.release(s); s = undefined; }
      }
      if (!s) {
        s = this.acquire(p.entityId);
        if (!s) { this.dropped++; continue; } // saturated: keep the warnings already shown; no retroactive eviction
        s.key = key; this.note(phase, key); s.move = def.id; s.ox = p.x / 100; s.oy = p.y / 100; s.oz = p.z / 100; s.yaw = fromYaw(p.facingYaw);
      }
      s.phase = phase;
      if (def.turnRate > 0) s.yaw = fromYaw(p.facingYaw); // the server turns the aim at turnRate, so follow the replicated facing
      if (def.moveScale > 0) { s.ox = p.x / 100; s.oy = p.y / 100; s.oz = p.z / 100; }
      this.draw(s, def, phase === "Windup" ? clamp01((o.tick - start) / Math.max(1, end - start)) : 1, o);
    }
    for (const [actor, s] of [...this.byActor]) if (!live.has(actor)) this.release(s);
  }

  snapshot(): { capacity: number; active: number; dropped: number; history: string[]; entries: TelegraphInfo[] } {
    const entries = this.slots.filter((s) => s.used).map((s) => ({ key: s.key, phase: s.phase, progress: Number(s.fill.userData.progress ?? 0), length: Number(s.group.userData.length ?? 0), width: Number(s.group.userData.width ?? 0), kind: String(s.group.userData.kind ?? "") }));
    return { capacity: this.capacity, active: entries.length, dropped: this.dropped, history: [...this.history], entries };
  }

  private note(phase: Phase, key: string): void { this.history.push(`${phase}:${key}`); if (this.history.length > 64) this.history.shift(); }

  private acquire(actor: number): Slot | undefined {
    const s = this.slots.find((x) => !x.used);
    if (!s) return undefined;
    s.used = true; s.actor = actor; s.group.visible = true;
    this.byActor.set(actor, s);
    return s;
  }

  private release(s: Slot): void {
    this.byActor.delete(s.actor);
    s.used = false; s.actor = -1; s.key = ""; s.move = ""; s.group.visible = false;
  }

  private draw(s: Slot, def: AbilityDef, progress: number, o: TelegraphOptions): void {
    const shape = def.shape;
    const [fx, fz] = forwardOf(s.yaw);
    const color = s.phase === "Windup" ? WINDUP_COLOR : ACTIVE_COLOR;
    s.fillMat.color.setHex(color); s.lineMat.color.setHex(color);
    const surf = o.surface?.(s.ox, s.oz, s.oy);
    const baseY = (surf ?? s.oy - 0.9) + LIFT;
    let ox = s.ox, oz = s.oz, length = 0, width = 0, kind: string;
    if (shape.kind === "sphere") {
      kind = "ring"; length = width = shape.r * 2;
      const cx = ox + fx * def.range, cz = oz + fz * def.range;
      s.fill.geometry = this.disc; s.line.geometry = this.ring;
      s.group.position.set(cx, baseY, cz); s.group.rotation.y = 0;
      s.line.scale.set(shape.r, 1, shape.r);
      const animate = !o.reducedMotion && !o.lowQuality;
      const k = animate ? Math.max(0.15, progress) : 1;
      s.fill.scale.set(shape.r * k, 1, shape.r * k);
    } else {
      let len = shape.kind === "box" ? shape.d : shape.length;
      width = shape.kind === "box" ? shape.w : shape.radius * 2;
      if (shape.kind === "beam") {
        ox += fx * BEAM_ORIGIN_FORWARD; oz += fz * BEAM_ORIGIN_FORWARD;
        len = o.cover ? Math.min(len, o.cover(ox, s.oy + BEAM_ORIGIN_UP, oz, fx, fz, len)) : len;
      }
      kind = shape.kind; length = len;
      s.fill.geometry = this.plane; s.line.geometry = this.rect;
      s.group.position.set(ox, baseY, oz); s.group.rotation.y = s.yaw;
      s.line.scale.set(width, 1, len);
      const animate = !o.reducedMotion && !o.lowQuality;
      s.fill.scale.set(width, 1, animate ? Math.max(0.1, progress) * len : len);
    }
    s.fillMat.opacity = o.reducedMotion || o.lowQuality ? 0.18 : s.phase === "Windup" ? 0.12 + 0.28 * progress : 0.5;
    s.fillMat.visible = true;
    s.fill.userData.progress = progress;
    s.group.userData.length = length; s.group.userData.width = width; s.group.userData.kind = kind;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const s of this.slots) { s.fillMat.dispose(); s.lineMat.dispose(); }
    for (const g of [this.plane, this.disc, this.rect, this.ring]) g.dispose();
    this.slots.length = 0; this.byActor.clear();
  }

  /** Presentation hook: runs a per-frame sync from the replicated tick. The disposer cancels the frame and frees the pool. */
  static attach(_bus: unknown, deps: PresentationDeps): () => void {
    if (!deps.serverTick) return () => {};
    const t = new AttackTelegraphs(deps.scene);
    let raf = 0, alive = true;
    const frame = (): void => {
      if (!alive) return;
      const s = deps.settings.get() as { reducedMotion?: boolean; quality?: string } | undefined;
      t.sync([...deps.players().values()], { tick: deps.serverTick!(), reducedMotion: s?.reducedMotion === true, lowQuality: s?.quality === "low", surface: deps.surfaceHeight, cover: deps.cover });
      raf = requestAnimationFrame(frame);
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
    deps.onTelegraphs?.(t);
    return () => {
      alive = false;
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf);
      deps.onTelegraphs?.(null);
      t.dispose();
    };
  }
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
