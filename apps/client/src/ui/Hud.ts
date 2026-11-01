/**
 * Touch HUD: original, unbranded control visuals placed from ControlLayout. Display only;
 * all values shown (HP, meter) come from server snapshots supplied by the caller.
 */
import type { ControlId, Layout, SafeRect } from "../input/ControlLayout.js";

export interface HudState {
  name: string;
  hp: number;
  maxHp: number;
  /** Server meter normalized to 0..1. */
  meter: number;
  facingLock: boolean;
  portrait: boolean;
}

export interface HudBox { id: ControlId; left: number; top: number; width: number; height: number; round: boolean; label: string }
export interface HudModel { boxes: HudBox[]; panel: null | "rotate" | "enlarge"; hpText: string; meterPct: number; awakenReady: boolean }

const LABELS: Record<ControlId, string> = {
  joystick: "", attack: "Strike", jump: "Jump", dash: "Dash", block: "Guard", facing: "Aim",
  skill1: "1", skill2: "2", skill3: "3", skill4: "4", awaken: "Awaken", menu: "Menu",
  fighter: "Fighter", health: "", scoreboard: "Score",
};

export function hudModel(layout: Layout, st: HudState): HudModel {
  const boxes = Object.values(layout.controls).map((c) => ({
    id: c.id, left: c.cx - c.vw / 2, top: c.cy - c.vh / 2, width: c.vw, height: c.vh,
    round: c.shape === "circle", label: c.id === "health" ? st.name : LABELS[c.id],
  }));
  const panel = st.portrait ? "rotate" : layout.tooSmall ? "enlarge" : null;
  const meter = Math.min(1, Math.max(0, st.meter));
  return {
    boxes, panel,
    hpText: `${Math.max(0, Math.round(st.hp))} / ${st.maxHp}`,
    meterPct: Math.round(meter * 100),
    awakenReady: meter >= 1,
  };
}

/** Reads the safe rectangle from visualViewport plus CSS env() safe area insets. */
export function readSafeRect(win: Window, probe: HTMLElement): SafeRect {
  const cs = win.getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  const l = px(cs.paddingLeft), t = px(cs.paddingTop), r = px(cs.paddingRight), b = px(cs.paddingBottom);
  const vv = win.visualViewport;
  const vw = vv?.width ?? win.innerWidth, vh = vv?.height ?? win.innerHeight;
  const ox = vv?.offsetLeft ?? 0, oy = vv?.offsetTop ?? 0;
  return { x0: ox + l, y0: oy + t, W: Math.max(0, vw - l - r), H: Math.max(0, vh - t - b) };
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly els = new Map<ControlId, HTMLElement>();
  private readonly panel: HTMLElement;

  constructor(parent: HTMLElement, private readonly doc: Document = document) {
    this.root = doc.createElement("div");
    this.root.className = "eb-hud";
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;font:600 13px system-ui;color:#fff";
    this.panel = doc.createElement("div");
    this.panel.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#000c;font-size:20px";
    this.root.appendChild(this.panel);
    parent.appendChild(this.root);
  }

  render(layout: Layout, st: HudState): HudModel {
    const m = hudModel(layout, st);
    for (const b of m.boxes) {
      let el = this.els.get(b.id);
      if (!el) {
        el = this.doc.createElement("div");
        el.dataset.control = b.id;
        el.style.cssText = "position:absolute;display:flex;align-items:center;justify-content:center;background:#1d2b3acc;border:2px solid #9fd3ff88;box-sizing:border-box";
        this.root.appendChild(el);
        this.els.set(b.id, el);
      }
      el.style.left = `${b.left}px`;
      el.style.top = `${b.top}px`;
      el.style.width = `${b.width}px`;
      el.style.height = `${b.height}px`;
      el.style.borderRadius = b.round ? "50%" : "10px";
      el.textContent = b.id === "health" ? `${b.label} ${m.hpText}` : b.id === "awaken" ? `${b.label} ${m.meterPct}%` : b.label;
      if (b.id === "facing") el.style.background = st.facingLock ? "#3a7bd5cc" : "#1d2b3acc";
      if (b.id === "awaken") el.style.opacity = m.awakenReady ? "1" : "0.6";
    }
    this.panel.style.display = m.panel ? "flex" : "none";
    this.panel.textContent = m.panel === "rotate" ? "Turn your iPad sideways" : m.panel === "enlarge" ? "Enlarge the window to play" : "";
    return m;
  }

  dispose(): void {
    this.root.remove();
    this.els.clear();
  }
}
