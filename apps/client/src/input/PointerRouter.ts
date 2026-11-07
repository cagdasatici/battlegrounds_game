/**
 * Spec section 8: each pointer is captured by the control it first lands on and owns exactly that
 * control until release. Precedence button -> joystick -> camera. First pointer wins a hold control;
 * an ignored extra pointer can never release the owner's action. The router only records local
 * intent; the server decides every outcome.
 */
import type { InputGate } from "./InputGate.js";
import { HIT_ORDER, clamp, hitTest, type ControlId, type Layout } from "./ControlLayout.js";

export const CAMERA_SENSITIVITY = 0.003; // rad per CSS px, divided by s (D)
export const PITCH_MIN = (-55 * Math.PI) / 180;
export const PITCH_MAX = (25 * Math.PI) / 180;

export type SkillSlot = 1 | 2 | 3 | 4;
export type LocalEdge =
  | { kind: "jump" | "dash" | "awaken" }
  | { kind: "skillDown" | "skillUp"; slot: SkillSlot };

export interface PointerInput { pointerId: number; x: number; y: number }

type Owner = ControlId | "camera" | "ignored";

export interface RouterHooks {
  /** Whether the server meter is full (from the latest snapshot). Awakening never fires otherwise. */
  awakeningReady?: () => boolean;
  isChargeSlot?: (slot: SkillSlot) => boolean;
  onFacingLockChange?: (on: boolean) => void;
  onMenu?: () => void;
  onFighter?: () => void;
  onScoreboard?: () => void;
  /** Called after every release-all (cancel, blur, menu...) so the caller can send neutral intent now. */
  onNeutral?: () => void;
  /** GR05: while closed, gameplay presses are ignored; only menu, fighter and scoreboard controls still work. */
  gate?: InputGate;
}

export class PointerRouter {
  private layout: Layout;
  private readonly owners = new Map<number, Owner>();
  private readonly holders = new Map<ControlId, number>();
  private readonly last = new Map<number, { x: number; y: number }>();
  private edges: LocalEdge[] = [];
  moveX = 0;
  moveZ = 0;
  yaw = 0;
  pitch = 0;
  facingLock = false;
  /** CAM01: camera swings back behind the character when not being dragged. */
  cameraFollow = true;
  /** True while a pointer is dragging the camera. */
  get lookActive(): boolean { for (const o of this.owners.values()) if (o === "camera") return true; return false; }
  autoRun = false;
  quickUse = true;
  private readonly deferredSkills = new Set<number>();
  /** Camera drag multiplier from Settings (T27). Local presentation only. */
  sensitivity = 1;
  disabled = false;

  constructor(layout: Layout, private readonly hooks: RouterHooks = {}) {
    this.layout = layout;
  }

  /** Layout changes (rotate, resize, split view) never inherit pointers. */
  setLayout(layout: Layout): void {
    this.releaseAll();
    this.layout = layout;
    this.disabled = layout.tooSmall;
  }

  private readonly releaseListeners = new Set<() => void>();
  /** Lets sibling routers (keyboard) drop their own hold state whenever everything is released. */
  onReleaseAll(fn: () => void): () => void { this.releaseListeners.add(fn); return () => { this.releaseListeners.delete(fn); }; }
  /** True while any gate reason is active. */
  get gated(): boolean { return this.hooks.gate?.closed === true; }

  get activePointers(): number { return this.owners.size; }
  ownerOf(pointerId: number): Owner | undefined { return this.owners.get(pointerId); }
  held(id: ControlId): boolean { return this.holders.has(id); }
  get chargeHeldSlot(): 0 | SkillSlot {
    for (const i of [1, 2, 3, 4] as const) if (this.holders.has(`skill${i}`)) return i;
    return 0;
  }

  /** True while a local edge waits to be sent (the sampler then sends immediately within the rate bucket). */
  get hasEdges(): boolean { return this.edges.length > 0; }

  /**
   * Keyboard or mouse hold of a control (T18b). Uses a reserved negative pseudo pointer id per control, so the
   * same first-holder-wins rule and edge generation apply as for touch.
   */
  keyHold(id: ControlId, on: boolean): void {
    const token = -1 - HIT_ORDER.indexOf(id);
    if (on) {
      if (this.disabled || this.holders.has(id)) return;
      if (this.gated && id !== "menu") return;
      this.owners.set(token, id);
      this.holders.set(id, token);
      this.press(id);
    } else {
      this.release(token, false);
    }
  }

  /** Keyboard movement in camera relative stick space. Ignored while a joystick pointer owns movement. */
  setKeyboardMove(x: number, z: number): void {
    if (this.holders.has("joystick")) return;
    if (this.gated && (x !== 0 || z !== 0)) return;
    this.moveX = x;
    this.moveZ = z;
  }

  takeEdges(): LocalEdge[] {
    const e = this.edges;
    this.edges = [];
    return e;
  }

  /** Returns true when the pointer was captured (caller should setPointerCapture). */
  down(p: PointerInput): boolean {
    if (this.disabled || this.owners.has(p.pointerId)) return false;
    const hit = hitTest(this.layout, p.x, p.y);
    if (this.gated && (hit === null || (hit !== "menu" && hit !== "fighter" && hit !== "scoreboard"))) return false;
    if (hit === null) {
      this.owners.set(p.pointerId, "camera");
      this.last.set(p.pointerId, { x: p.x, y: p.y });
      return true;
    }
    if (this.holders.has(hit)) {
      // First pointer wins; the extra pointer is swallowed and cannot touch the control.
      this.owners.set(p.pointerId, "ignored");
      return true;
    }
    this.owners.set(p.pointerId, hit);
    this.holders.set(hit, p.pointerId);
    this.press(hit);
    if (hit === "joystick") this.updateStick(p.x, p.y);
    return true;
  }

  move(p: PointerInput): void {
    const o = this.owners.get(p.pointerId);
    if (o === "joystick") this.updateStick(p.x, p.y);
    else if (o === "camera") {
      const prev = this.last.get(p.pointerId);
      if (!prev) return;
      const k = (CAMERA_SENSITIVITY * this.sensitivity) / this.layout.s;
      this.yaw -= (p.x - prev.x) * k;
      this.pitch = clamp(this.pitch - (p.y - prev.y) * k, PITCH_MIN, PITCH_MAX);
      this.last.set(p.pointerId, { x: p.x, y: p.y });
    }
    // Moving over other buttons never activates them.
  }

  /** pointerup: a normal release. */
  up(pointerId: number): void { this.release(pointerId, false); }

  /** pointercancel / lostpointercapture: release without completing any tap semantics. */
  cancel(pointerId: number): void { this.release(pointerId, true); }

  /** Blur, visibility loss, orientation change and menu opening. */
  releaseAll(): void {
    for (const id of [...this.owners.keys()]) this.release(id, true);
    this.moveX = 0;
    this.moveZ = 0;
    this.deferredSkills.clear();
    for (const f of [...this.releaseListeners]) f();
    this.hooks.onNeutral?.();
  }

  private press(id: ControlId): void {
    switch (id) {
      case "jump": this.edges.push({ kind: "jump" }); break;
      case "dash": this.edges.push({ kind: "dash" }); break;
      case "awaken": if (this.hooks.awakeningReady?.() === true) this.edges.push({ kind: "awaken" }); break;
      case "facing": this.facingLock = !this.facingLock; this.hooks.onFacingLockChange?.(this.facingLock); break;
      case "skill1": case "skill2": case "skill3": case "skill4":
        if (!this.quickUse && !this.hooks.isChargeSlot?.(Number(id.slice(5)) as SkillSlot)) this.deferredSkills.add(Number(id.slice(5)));
        else this.edges.push({ kind: "skillDown", slot: Number(id.slice(5)) as SkillSlot });
        break;
      case "menu": this.hooks.onMenu?.(); this.releaseAll(); break;
      case "fighter": this.hooks.onFighter?.(); break;
      case "scoreboard": this.hooks.onScoreboard?.(); break;
      default: break; // attack, block, joystick are pure held state
    }
  }

  private release(pointerId: number, cancelled: boolean): void {
    const o = this.owners.get(pointerId);
    if (o === undefined) return;
    this.owners.delete(pointerId);
    this.last.delete(pointerId);
    if (o === "camera" || o === "ignored") return; // camera release never stops movement or guard
    if (this.holders.get(o) !== pointerId) return;
    this.holders.delete(o);
    if (o === "joystick") { this.moveX = 0; this.moveZ = 0; }
    if (o.startsWith("skill")) {
      const slot = Number(o.slice(5)) as SkillSlot;
      if (this.deferredSkills.delete(slot)) { if (!cancelled) this.edges.push({ kind: "skillDown", slot }); }
      if (!cancelled) this.edges.push({ kind: "skillUp", slot });
      else this.edges = this.edges.filter((e) => !(e.kind === "skillDown" && e.slot === slot)); // cancelled before sampling: no late cast
    }
  }

  private updateStick(x: number, y: number): void {
    const j = this.layout.controls.joystick;
    const s = this.layout.s;
    const dx = x - j.cx, dy = y - j.cy;
    const r = Math.hypot(dx, dy);
    const dead = 10 * s, cap = 56 * s;
    if (r <= dead) { this.moveX = 0; this.moveZ = 0; return; }
    const mag = clamp((r - dead) / (cap - dead), 0, 1);
    this.moveX = (dx / r) * mag;
    this.moveZ = (-dy / r) * mag; // screen up is camera forward
  }
}

/** Minimal event surface so the DOM binding can be exercised with a real EventTarget in tests. */
export interface PointerSurface extends EventTarget {
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
  style?: { touchAction: string };
}
export interface LifecycleTarget extends EventTarget {}

type PEvt = Event & { pointerId: number; clientX: number; clientY: number };

/**
 * Binds Pointer Events on the combat surface only. Returns a cleanup that removes every listener,
 * releases captures and sends neutral intent.
 */
export function attachPointerRouter(
  router: PointerRouter, surface: PointerSurface, win: LifecycleTarget, doc: LifecycleTarget,
): () => void {
  const prevTouch = surface.style?.touchAction;
  if (surface.style) surface.style.touchAction = "none";
  const captured = new Set<number>();
  const pt = (e: PEvt): PointerInput => ({ pointerId: e.pointerId, x: e.clientX, y: e.clientY });
  const onDown = (e: Event) => {
    const p = e as PEvt;
    if (router.down(pt(p))) {
      e.preventDefault();
      try { surface.setPointerCapture?.(p.pointerId); captured.add(p.pointerId); } catch { /* not capturable */ }
    }
  };
  const onMove = (e: Event) => router.move(pt(e as PEvt));
  const onUp = (e: Event) => { const id = (e as PEvt).pointerId; captured.delete(id); router.up(id); };
  const onCancel = (e: Event) => { const id = (e as PEvt).pointerId; captured.delete(id); router.cancel(id); };
  const onAll = () => { captured.clear(); router.releaseAll(); };
  const onVis = () => { if ((doc as { visibilityState?: string }).visibilityState !== "visible") onAll(); };
  const onCtx = (e: Event) => e.preventDefault();
  const pairs: [EventTarget, string, (e: Event) => void][] = [
    [surface, "pointerdown", onDown], [surface, "pointermove", onMove], [surface, "pointerup", onUp],
    [surface, "pointercancel", onCancel], [surface, "lostpointercapture", onCancel],
    [surface, "contextmenu", onCtx],
    [win, "blur", onAll], [win, "orientationchange", onAll], [win, "pagehide", onAll],
    [doc, "visibilitychange", onVis],
  ];
  for (const [t, n, f] of pairs) t.addEventListener(n, f);
  return () => {
    for (const [t, n, f] of pairs) t.removeEventListener(n, f);
    for (const id of captured) { try { surface.releasePointerCapture?.(id); } catch { /* gone */ } }
    captured.clear();
    router.releaseAll();
    if (surface.style && prevTouch !== undefined) surface.style.touchAction = prevTouch;
  };
}
