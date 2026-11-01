/**
 * Rigged original fighter (task T25). A skinned, toon shaded model built from the shared rig and design data,
 * animated with clips chosen from replicated state. Presentation only: nothing here decides hits, HP or positions.
 */
import { AnimationAction, AnimationMixer, Group, LoopOnce, LoopRepeat, type DataTexture, type MeshToonMaterial } from "three";
import type { KitId } from "@eb/shared/protocol";
import { TICK_RATE } from "@eb/shared/protocol";
import { FIGHTER_DESIGNS } from "@eb/shared/fighterDesign";
import { chooseClip, retimeScale } from "./FighterAnim.js";
import { buildFighterRig, type FighterRig } from "./FighterModel.js";

export const KIT_COLORS: Readonly<Record<KitId, number>> = {
  sv: FIGHTER_DESIGNS.sv.palette.accent, td: FIGHTER_DESIGNS.td.palette.accent, ea: FIGHTER_DESIGNS.ea.palette.accent,
};
export const FIGHTER = { radius: 0.35, bodyLength: 1.1 } as const; // total height 1.8 m, matches the physics capsule
const FADE_S = 0.12;

export class FighterView {
  readonly group = new Group();
  actionText = "idle";
  moveId = "";
  /** Name of the clip currently playing (test and debug hook). */
  currentClip = "";
  private readonly rig: FighterRig;
  private readonly mixer: AnimationMixer;
  private active: AnimationAction | null = null;
  private phaseTicks = 0;
  private last: { x: number; y: number; z: number; yaw: number } | null = null;
  private vel = { speed: 0, vy: 0, forward: 0, right: 0 };
  private disposed = false;
  private flashLeft = 0;
  private freezeLeft = 0;

  constructor(readonly kitId: KitId, ramp: DataTexture, opts: { outline?: boolean } = {}) {
    this.rig = buildFighterRig(kitId, ramp, { outline: opts.outline ?? true });
    this.group.add(this.rig.root, ...this.rig.meshes);
    this.mixer = new AnimationMixer(this.group);
    this.play("idle", true);
  }

  /** Meshes that should cast shadows are flagged on creation; this lets the scene toggle them by quality. */
  setShadows(on: boolean): void { for (const m of this.rig.meshes) if (m.name.endsWith(".body")) { m.castShadow = on; m.receiveShadow = on; } }
  get meshCount(): number { return this.rig.meshes.length; }
  /** FX1 (decision 0024): true while a hit flash is showing. Visual only. */
  get flashing(): boolean { return this.flashLeft > 0; }
  /** Tints the body emissive with `color` at `level` (the flashLevel setting, 0 to 1) for `ms` of render time. */
  flash(color: number, ms: number, level = 1): void {
    const m = this.bodyMaterial();
    if (!m || !(ms > 0) || !(level > 0)) return;
    m.emissive.set(color);
    m.emissiveIntensity = Math.min(1, Math.max(0, level));
    this.flashLeft = ms / 1000;
  }
  /** Pauses the animation mixer for `frames` render frames (hitstop). Never touches positions or ticks. */
  freeze(frames: number): void { if (frames > 0) this.freezeLeft = Math.max(this.freezeLeft, Math.floor(frames)); }
  private bodyMaterial(): MeshToonMaterial | null {
    const m = this.rig.meshes.find((x) => x.name.endsWith(".body"));
    return (m?.material as MeshToonMaterial | undefined) ?? null;
  }
  hasClip(id: string): boolean { return this.rig.clips.has(id); }

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.last ??= { x, y, z, yaw };
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  /** Replicated action text, current move id and (optional) action length in server ticks for retiming. */
  setAction(text: string, moveId = "", phaseTicks = 0): void {
    this.actionText = text;
    this.moveId = moveId;
    this.phaseTicks = phaseTicks;
  }

  /** Advances animation by dtSec of render time. Clip choice uses presented motion, not authoritative state. */
  update(dtSec: number): void {
    if (this.disposed) return;
    const g = this.group.position;
    const l = this.last;
    if (l && dtSec > 0) {
      const dx = (g.x - l.x) / dtSec, dz = (g.z - l.z) / dtSec;
      const sin = Math.sin(this.group.rotation.y), cos = Math.cos(this.group.rotation.y);
      // Facing at yaw 0 is -Z; yaw turns left, so the forward unit vector is (-sin, -cos).
      const smooth = (a: number, b: number): number => a + (b - a) * Math.min(1, dtSec * 12);
      this.vel.forward = smooth(this.vel.forward, -dx * sin - dz * cos);
      this.vel.right = smooth(this.vel.right, dx * cos - dz * sin);
      this.vel.speed = smooth(this.vel.speed, Math.hypot(dx, dz));
      this.vel.vy = smooth(this.vel.vy, (g.y - l.y) / dtSec);
    }
    if (l) { l.x = g.x; l.y = g.y; l.z = g.z; l.yaw = this.group.rotation.y; }
    const c = chooseClip({ action: this.actionText, moveId: this.moveId, kit: this.kitId, ...this.vel, hasClip: (id) => this.hasClip(id) });
    const locomotion = c.clip === "idle" || c.clip === "walk" || c.clip === "run";
    let next = c.clip, loop = c.loop;
    if (this.currentClip === "ragdollPose" && c.clip !== "ragdollPose" && c.clip !== "death") { next = "getup"; loop = false; }
    else if (this.currentClip === "fall" && locomotion) { next = "land"; loop = false; }
    else if ((this.currentClip === "getup" || this.currentClip === "land") && locomotion && this.active !== null && this.active.time < this.active.getClip().duration - 0.02) next = this.currentClip;
    if (next !== this.currentClip) this.play(next, loop);
    this.mixer.timeScale = this.freezeLeft > 0 ? 0 : 1;
    if (this.freezeLeft > 0) this.freezeLeft--;
    this.mixer.update(dtSec);
    if (this.flashLeft > 0) {
      this.flashLeft -= dtSec;
      if (this.flashLeft <= 0) { this.flashLeft = 0; const m = this.bodyMaterial(); if (m) { m.emissive.set(0x000000); m.emissiveIntensity = 1; } }
    }
  }

  private play(id: string, loop: boolean): void {
    const clip = this.rig.clips.get(id);
    if (!clip) return;
    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.timeScale = !loop && this.moveId.startsWith(id) ? retimeScale(clip.duration, this.phaseTicks, TICK_RATE) : 1;
    next.enabled = true;
    if (this.active && this.active !== next) next.crossFadeFrom(this.active, FADE_S, false);
    next.play();
    this.active = next;
    this.currentClip = id;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.group);
    this.rig.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
