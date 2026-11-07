/**
 * Rigged original fighter (task T25). A skinned, toon shaded model built from the shared rig and design data,
 * animated with clips chosen from replicated state. Presentation only: nothing here decides hits, HP or positions.
 */
import { AnimationAction, AnimationMixer, Group, LoopOnce, LoopRepeat, type DataTexture, type MeshToonMaterial } from "three";
import type { KitId } from "@eb/shared/protocol";
import { TICK_RATE } from "@eb/shared/protocol";
import { FIGHTER_DESIGNS } from "@eb/shared/fighterDesign";
import { chooseClip, retimeScale } from "./FighterAnim.js";
import { buildFighterRig, type FighterRig, type Lod } from "./FighterModel.js";
import { BEAST_FORM } from "@eb/shared/config/beast";
import { buildBeastModel, type BeastModel } from "./BeastModel.js";
import { TransformBurst } from "./TransformBurst.js";

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
  private phaseAge = 0;
  private last: { x: number; y: number; z: number; yaw: number } | null = null;
  private vel = { speed: 0, vy: 0, forward: 0, right: 0 };
  private disposed = false;
  private flashColor = 0;
  private flashLevel = 0;
  private flashLeftMs = 0;
  private flashTotalMs = 0;
  private frozenFrames = 0;
  private tuckLeftS = 0;
  private tuckTotalS = 0;
  // BEAST02: Beast Awaken presentation. The beast model is built the first time this fighter transforms.
  private beastModel: BeastModel | null = null;
  private readonly beastGroup = new Group();
  private burst: TransformBurst | null = null;
  private beastWant = false;
  /** 0 = human, 1 = fully beast; the swap happens at 0.5 under the burst. */
  private beastT = 0;
  private beastClock = 0;
  private bAge = 0;
  private bSeed = 1;

  constructor(readonly kitId: KitId, ramp: DataTexture, opts: { outline?: boolean; lod?: Lod } = {}) {
    this.rig = buildFighterRig(kitId, ramp, { outline: opts.outline ?? true, ...(opts.lod ? { lod: opts.lod } : {}) });
    this.group.add(this.rig.root, ...this.rig.meshes);
    this.group.rotation.order = "YXZ"; // yaw first, so the DJ01 flip pitches about the fighter's own right axis
    this.mixer = new AnimationMixer(this.group);
    this.play("idle", true);
  }

  /**
   * Hit flash (FX1): tints the body material's emissive toward `color` for `ms` of render time, scaled by `level`
   * (the player's flash setting, 0..1) and fading out. `flashing` stays true for the whole window even at level 0.
   */
  flash(color: number, ms: number, level = 1): void {
    if (this.disposed || !(ms > 0)) return;
    this.flashColor = color; this.flashLevel = Math.min(1, Math.max(0, level));
    this.flashLeftMs = ms; this.flashTotalMs = ms;
    this.applyFlash();
  }
  /** DJ01 air jump: a quick forward tumble of the whole rig for `seconds` of render time. Visual only; ends by itself. */
  tuck(seconds: number): void {
    if (this.disposed || !(seconds > 0)) return;
    this.tuckLeftS = seconds; this.tuckTotalS = seconds;
  }
  /** Current flip pitch in radians (0 when not tumbling); test and debug hook. */
  get tuckPitch(): number { return this.group.rotation.x; }

  get flashing(): boolean { return this.flashLeftMs > 0; }
  /** Emissive multiplier currently applied (0 when idle). */
  get flashAmount(): number { return this.flashLeftMs > 0 ? this.flashLevel * (this.flashLeftMs / this.flashTotalMs) : 0; }

  /** Hitstop (FX1): pauses the animation mixer for N render frames. Visual only; never touches positions or ticks. */
  freeze(frames: number): void { if (!this.disposed && frames > 0) this.frozenFrames = Math.max(this.frozenFrames, Math.floor(frames)); }
  get frozen(): boolean { return this.frozenFrames > 0; }

  private applyFlash(): void {
    const k = this.flashAmount;
    for (const m of this.rig.meshes) {
      if (!m.name.endsWith(".body")) continue;
      const mat = m.material as MeshToonMaterial;
      mat.emissive.set(this.flashColor).multiplyScalar(k);
    }
  }

  /** Meshes that should cast shadows are flagged on creation; this lets the scene toggle them by quality. */
  setShadows(on: boolean): void {
    for (const m of this.rig.meshes) if (m.name.endsWith(".body")) { m.castShadow = on; m.receiveShadow = on; }
    // GameScene turns shadows off exactly on the low quality tier, so that tier also gets the low-poly level of detail.
    this.setLod(on ? "medium" : "low");
  }
  /** BEAST02: replicated `beast` flag. A change starts the transformation (or its reversal); presentation only. */
  setBeast(on: boolean): void {
    if (this.disposed || on === this.beastWant) return;
    this.beastWant = on;
    this.bSeed++;
    this.flash(on ? 0xffa040 : 0xc8b0ff, 450, 1);
  }
  get isBeast(): boolean { return this.beastT >= 0.5; }
  /** 0..1 transformation progress (test and debug hook). */
  get beastProgress(): number { return this.beastT; }

  private stepBeast(dtSec: number): void {
    const was = this.beastT >= 0.5;
    const dir = this.beastWant ? 1 : -1;
    if (this.beastT === (this.beastWant ? 1 : 0) && !this.beastWant && !this.beastModel) return;
    this.beastT = Math.max(0, Math.min(1, this.beastT + dir * dtSec / 0.9));
    const now = this.beastT >= 0.5;
    if (now && !this.beastModel) {
      this.beastModel = buildBeastModel();
      this.beastModel.group.position.y = -0.9; // feet at the ground; this group's origin is the capsule centre
      this.beastGroup.add(this.beastModel.group);
      this.group.add(this.beastGroup);
    }
    if (now !== was) { // the swap moment: hide one body, show the other, fire the burst
      this.burst ??= new TransformBurst(this.group);
      this.burst.trigger(now ? 9 : 6, this.bSeed);
    }
    const human = !now;
    this.rig.root.visible = human;
    for (const m of this.rig.meshes) m.visible = human;
    this.beastGroup.visible = now;
    if (this.beastModel && now) {
      // Grow from 0.5 to 1 with a little overshoot; shrink on the way back.
      const k = (this.beastT - 0.5) * 2;
      const grow = k >= 1 ? 1 : 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // easeOutBack-like
      this.beastGroup.scale.setScalar(BEAST_FORM.scale * Math.max(0.2, 0.25 + 0.75 * grow));
      this.beastClock += dtSec; this.bAge += dtSec;
      const moving = this.vel.speed > 0.6;
      const a = this.actionText;
      const slam = /\.[ab][24]$/.test(this.moveId);
      const attack = a === "Windup" || a === "Active" || a === "Recovery";
      const dur = Math.max(0.05, this.phaseTicks / TICK_RATE);
      this.beastModel.pose({
        clock: this.beastClock, walking: moving && a === "Idle",
        action: a === "Dead" ? "Dead" : a === "Stunned" || a === "Ragdolled" || a === "Captured" ? "Stunned" : attack ? a : "Idle",
        moveId: attack ? (slam ? "beast.slam" : "beast.swipe") : "", prog: Math.min(1, this.bAge / dur), defeat: a === "Dead" ? 1 : 0,
      });
    } else if (!now) {
      // Windup of the change: the human swells and glows just before the swap.
      const swell = this.beastWant ? 1 + 0.35 * Math.min(1, this.beastT / 0.5) : 1;
      this.rig.root.scale.setScalar(swell);
    }
    if (this.burst?.active) { /* advanced in update below */ }
  }

  /** Swaps to the low-poly (<= 3k triangles) or medium (<= 8k) geometry in place. */
  setLod(lod: Lod): void { if (!this.disposed) this.rig.setLod(lod); }
  /** QF01: shows the Awakened amber seams (replicated form === "Awakened"). Presentation only. */
  setAwakened(on: boolean): void { if (!this.disposed) this.rig.setAwakened(on); }
  get clipTime(): number { return this.active?.time ?? 0; }
  get meshCount(): number { return this.rig.meshes.length; }
  hasClip(id: string): boolean { return this.rig.clips.has(id); }

  setPose(x: number, y: number, z: number, yaw: number): void {
    this.last ??= { x, y, z, yaw };
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  /** Replicated action text, current move id and (optional) action length in server ticks for retiming. */
  setAction(text: string, moveId = "", phaseTicks = 0, elapsedTicks = 0): void {
    if (text !== this.actionText || moveId !== this.moveId) { this.phaseAge = Math.max(0, elapsedTicks / TICK_RATE); this.bAge = this.phaseAge; }
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
    this.mixer.timeScale = this.frozenFrames > 0 ? 0 : 1;
    const phase = this.rig.phases.get(this.currentClip);
    const timed = phase && this.active && this.phaseTicks > 0 && ["Windup", "Active", "Recovery"].includes(this.actionText);
    if (timed && this.active) {
      if (this.frozenFrames === 0) this.phaseAge += dtSec;
      const t = Math.min(1, this.phaseAge / (this.phaseTicks / TICK_RATE));
      const start = this.actionText === "Windup" ? 0 : this.actionText === "Active" ? phase.activeStart : phase.recoveryStart;
      const end = this.actionText === "Windup" ? phase.windupEnd : this.actionText === "Active" ? phase.recoveryStart : this.active.getClip().duration;
      this.active.paused = true; this.active.time = start + (end - start) * t;
    } else if (this.active) {
      this.active.paused = false;
      if (c.clip === "walk" || c.clip === "run") this.active.timeScale = Math.max(.65, Math.min(1.5, this.vel.speed / (c.clip === "walk" ? 6 : 9)));
    }
    this.mixer.update(dtSec);
    this.stepBeast(dtSec);
    this.burst?.update(dtSec);
    if (this.tuckLeftS > 0) {
      this.tuckLeftS = Math.max(0, this.tuckLeftS - dtSec);
      const k = 1 - this.tuckLeftS / this.tuckTotalS;
      this.group.rotation.x = this.tuckLeftS > 0 ? -Math.PI * 2 * (1 - (1 - k) * (1 - k)) : 0; // ease-out full turn, lands upright
    }
    if (this.frozenFrames > 0) this.frozenFrames -= 1;
    if (this.flashLeftMs > 0) {
      this.flashLeftMs = Math.max(0, this.flashLeftMs - dtSec * 1000);
      this.applyFlash();
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
    this.beastModel?.dispose();
    this.burst?.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
