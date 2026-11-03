// UX12: damage direction arcs and low-HP vignette. Presentation only; never touches gameplay state.
import { edgePoint, type Projected } from "./Nameplates.js";

/** Max simultaneous arcs. D value. */
export const MAX_ARCS = 4;
export const ARC_MS = 600;
export const ARC_HEAVY_MS = 900;
/** HP fraction at or below which the vignette shows. D value. */
export const LOW_HP_FRAC = 0.3;

/** Screen-edge angle facing the attacker, in view or not. */
export function cueAngle(q: Projected): number {
  return edgePoint(q, 2, 2).angleRad;
}

export function vignetteAlpha(hpFrac: number, nowMs: number, reducedMotion: boolean): number {
  if (hpFrac > LOW_HP_FRAC) return 0;
  return reducedMotion ? 0.4 : 0.35 + 0.15 * Math.sin(nowMs / 160);
}

interface Arc { el: HTMLElement; start: number; dur: number }

export class DamageCues {
  private readonly root: HTMLElement;
  private readonly vignette: HTMLElement;
  private arcs: Arc[] = [];

  constructor(parent: HTMLElement, private readonly doc: Document) {
    this.root = doc.createElement("div");
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:6;overflow:hidden";
    this.vignette = doc.createElement("div");
    this.vignette.setAttribute("data-vignette", "");
    this.vignette.style.cssText = "position:absolute;inset:0;pointer-events:none;box-shadow:none";
    this.root.append(this.vignette);
    parent.append(this.root);
  }

  hit(angleRad: number, heavy: boolean, nowMs: number): void {
    while (this.arcs.length >= MAX_ARCS) this.arcs.shift()?.el.remove();
    const el = this.doc.createElement("div");
    el.setAttribute("data-arc", "");
    const c = Math.cos(angleRad), s = Math.sin(angleRad);
    const k = Math.min(1 / (Math.abs(c) || 1e-9), 1 / (Math.abs(s) || 1e-9));
    el.style.cssText = `position:absolute;pointer-events:none;width:260px;height:24px;background:radial-gradient(ellipse at center,rgba(224,80,58,0.85),rgba(224,80,58,0) 70%);left:${50 + 50 * c * k}%;top:${50 + 50 * s * k}%;transform:translate(-50%,-50%) rotate(${angleRad + Math.PI / 2}rad);opacity:1`;
    this.root.append(el);
    this.arcs.push({ el, start: nowMs, dur: heavy ? ARC_HEAVY_MS : ARC_MS });
  }

  frame(nowMs: number, hpFrac: number, reducedMotion: boolean): void {
    this.arcs = this.arcs.filter((a) => {
      const t = (nowMs - a.start) / a.dur;
      if (t >= 1) { a.el.remove(); return false; }
      a.el.style.opacity = String(Math.max(0, 1 - t));
      return true;
    });
    const alpha = vignetteAlpha(hpFrac, nowMs, reducedMotion);
    this.vignette.style.boxShadow = alpha > 0 ? `inset 0 0 120px rgba(160,0,0,${alpha})` : "none";
  }

  dispose(): void {
    this.arcs = [];
    this.root.remove();
  }
}
