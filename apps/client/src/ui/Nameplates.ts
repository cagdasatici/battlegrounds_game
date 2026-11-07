// UX11: world nameplates with enemy HP and off-screen arrows. Presentation only; never touches gameplay state.
import { LAYER } from "./Layers.js";
export interface V3 { x: number; y: number; z: number }
export interface PlateFighter { id: string; name: string; hpFrac: number; pos: V3; local: boolean; alive: boolean; kitId: string }
export type Projected = { x: number; y: number; depth: number };
export type PlateOut =
  | { kind: "plate"; id: string; name: string; hpFrac: number; left: number; top: number; kitId: string }
  | { kind: "arrow"; id: string; left: number; top: number; angleRad: number; kitId: string };

/** Metres above capsule centre where the plate anchors. D value. */
export const PLATE_HEAD_OFFSET = 1.35;
/** Pixels between an arrow and the safe-area edge. D value. */
export const ARROW_MARGIN = 40;
export const NEAR = 0.1;

/** Screen-edge point (inset by ARROW_MARGIN) facing a projected point; behind-camera points mirror. UX12 reuses angleRad. */
export function edgePoint(q: Projected, W: number, H: number): { left: number; top: number; angleRad: number } {
  let sx = q.x * W / 2, sy = -q.y * H / 2;
  if (q.depth <= NEAR) { sx = -sx; sy = -sy; }
  if (sx === 0 && sy === 0) sy = H / 2;
  const s = Math.min((W / 2 - ARROW_MARGIN) / Math.abs(sx || 1e-9), (H / 2 - ARROW_MARGIN) / Math.abs(sy || 1e-9));
  return { left: W / 2 + sx * s, top: H / 2 + sy * s, angleRad: Math.atan2(sy, sx) };
}

export function plateLayout(fighters: readonly PlateFighter[], project: (p: V3) => Projected, W: number, H: number): PlateOut[] {
  const out: PlateOut[] = [];
  for (const f of fighters) {
    if (f.local || !f.alive) continue;
    const q = project({ x: f.pos.x, y: f.pos.y + PLATE_HEAD_OFFSET, z: f.pos.z });
    if (q.depth > NEAR && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1) {
      out.push({ kind: "plate", id: f.id, name: f.name, hpFrac: f.hpFrac, left: (q.x + 1) / 2 * W, top: (1 - q.y) / 2 * H, kitId: f.kitId });
      continue;
    }
    const e = edgePoint(q, W, H);
    out.push({ kind: "arrow", id: f.id, left: e.left, top: e.top, angleRad: e.angleRad, kitId: f.kitId });
  }
  return out;
}

const KIT_TINT: Record<string, string> = { sv: "#c9a26b", td: "#4fb3e8", ea: "#ff7a3d" };
export const arrowTint = (kitId: string): string => KIT_TINT[kitId] ?? "#ffffff";
export const hpColour = (frac: number): string => (frac > 0.5 ? "#3fae6a" : frac > 0.25 ? "#e8b84a" : "#e0503a");

interface Entry { el: HTMLElement; kind: PlateOut["kind"]; fill?: HTMLElement; label?: HTMLElement }

export class Nameplates {
  private readonly root: HTMLElement;
  private readonly pool = new Map<string, Entry>();

  /** `origin` shifts plates by the safe-area origin (rect.x0/y0) when layout W/H describe the safe rect only. */
  constructor(parent: HTMLElement, private readonly doc: Document, private readonly origin: () => { x: number; y: number } = () => ({ x: 0, y: 0 })) {
    this.root = doc.createElement("div");
    this.root.setAttribute("data-ui", "nameplates");
    this.root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${LAYER.worldLabels};overflow:hidden`;
    parent.append(this.root);
  }

  update(outs: readonly PlateOut[]): void {
    const seen = new Set<string>();
    const o = this.origin();
    for (const out of outs) {
      seen.add(out.id);
      let e = this.pool.get(out.id);
      if (e && e.kind !== out.kind) { e.el.remove(); this.pool.delete(out.id); e = undefined; }
      if (!e) { e = out.kind === "plate" ? this.makePlate(out.id) : this.makeArrow(out.id); this.pool.set(out.id, e); this.root.append(e.el); }
      e.el.style.left = `${out.left + o.x}px`;
      e.el.style.top = `${out.top + o.y}px`;
      if (out.kind === "plate") {
        if (e.label) {
          const bot = /^Bot \d/.test(out.name);
          const text = bot ? `\u{1F916} ${out.name}` : out.name;
          if (e.label.textContent !== text) e.label.textContent = text;
          e.label.style.color = bot ? "#ff7043" : "#fff";
          e.el.style.filter = bot ? "drop-shadow(0 0 4px #ff3d00)" : "";
        }
        if (e.fill) {
          const f = Math.max(0, Math.min(1, out.hpFrac));
          e.fill.style.width = `${f * 100}%`;
          e.fill.style.background = hpColour(f);
        }
      } else {
        e.el.style.transform = `translate(-50%,-50%) rotate(${out.angleRad}rad)`;
        e.el.style.borderLeftColor = arrowTint(out.kitId);
      }
    }
    for (const [id, e] of this.pool) if (!seen.has(id)) { e.el.remove(); this.pool.delete(id); }
  }

  dispose(): void {
    this.pool.clear();
    this.root.remove();
  }

  private makePlate(id: string): Entry {
    const el = this.doc.createElement("div");
    el.setAttribute("data-plate", id);
    el.style.cssText = "position:absolute;pointer-events:none;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:2px";
    const label = this.doc.createElement("div");
    label.style.cssText = "font:600 12px Inter,system-ui,sans-serif,sans-serif;color:#fff;text-shadow:0 1px 1px #000;white-space:nowrap;pointer-events:none";
    const bar = this.doc.createElement("div");
    bar.style.cssText = "width:64px;height:6px;background:rgba(0,0,0,.55);border-radius:3px;overflow:hidden;pointer-events:none";
    const fill = this.doc.createElement("div");
    fill.style.cssText = "height:100%;width:100%;pointer-events:none";
    bar.append(fill);
    el.append(label, bar);
    return { el, kind: "plate", fill, label };
  }

  private makeArrow(id: string): Entry {
    const el = this.doc.createElement("div");
    el.setAttribute("data-arrow", id);
    // 22 px triangle pointing along +x before rotation.
    el.style.cssText = "position:absolute;pointer-events:none;width:0;height:0;border-top:11px solid transparent;border-bottom:11px solid transparent;border-left:22px solid #fff";
    return { el, kind: "arrow" };
  }
}
