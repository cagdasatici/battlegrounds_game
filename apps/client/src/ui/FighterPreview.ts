/**
 * GR12 lobby fighter preview. This module owns only the reserved 220x200 CSS px region and the "which kit" intent;
 * the fighter is drawn by the already-loaded game renderer (GameScene.renderPreview), so no second WebGLRenderer
 * exists. The caller's single idle loop calls tick(); there is no scheduler here. hide() disposes the preview fighter.
 */
import type { KitId } from "@eb/shared/protocol";
import type { PreviewRect } from "../scene/GameScene.js";

export const PREVIEW_SIZE = { width: 220, height: 200 } as const;

/** The slice of GameScene the preview needs. */
export interface PreviewTarget {
  setPreviewKit(kit: KitId | null): void;
  renderPreview(rect: PreviewRect, dtSec: number, animate: boolean): void;
}

export class FighterPreview {
  readonly el: HTMLElement;
  private kit: KitId | null = null;
  private applied: KitId | null = null;
  private target: PreviewTarget | null = null;
  private lastMs = 0;
  /** Reduced motion holds the pose still. Set by the app from settings and the OS preference. */
  reducedMotion: () => boolean = () => false;

  constructor(doc: Document = document) {
    this.el = doc.createElement("div");
    this.el.className = "eb-preview";
    this.el.setAttribute("aria-hidden", "true");
    this.el.dataset["ui"] = "fighter-preview";
    this.el.style.cssText = `width:${PREVIEW_SIZE.width}px;height:${PREVIEW_SIZE.height}px;flex:none;box-sizing:border-box`;
  }

  /** Supplies (or clears) the loaded scene. Assets load at first entry, so this can arrive after show(). */
  attach(target: PreviewTarget | null): void {
    if (this.target && this.target !== target) this.target.setPreviewKit(null);
    this.target = target; this.applied = null;
  }

  show(kit: KitId): void { this.kit = kit; this.el.dataset["kit"] = kit; }

  /** Leaving the lobby or entering a match: release the preview fighter. */
  hide(): void {
    this.kit = null; this.applied = null;
    delete this.el.dataset["modelKit"];
    this.target?.setPreviewKit(null);
  }

  /** One frame. Returns true when the preview drew (the caller then skips the arena draw). */
  tick(nowMs: number): boolean {
    const t = this.target, kit = this.kit;
    if (!t || !kit || !this.el.isConnected) { this.lastMs = 0; return false; }
    if (this.applied !== kit) { t.setPreviewKit(kit); this.applied = kit; this.el.dataset["modelKit"] = kit; }
    const dt = this.lastMs ? Math.min(0.1, (nowMs - this.lastMs) / 1000) : 0;
    this.lastMs = nowMs;
    const animate = !this.reducedMotion();
    this.el.dataset["animating"] = String(animate);
    const r = this.el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    t.renderPreview({ left: r.left, top: r.top, width: r.width, height: r.height }, dt, animate);
    return true;
  }

  dispose(): void { this.hide(); this.target = null; this.el.remove(); }
}
