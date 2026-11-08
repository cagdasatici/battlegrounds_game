// BEAST01: boss bar and arrival banner for the sparring beast. Presentation only: it shows replicated HP and phase text.
import { beastBanner, type LoopBeast } from "../scene/BeastView.js";
import { MIN_GAP_PX, PHONE_HEIGHT, type Layout } from "../input/ControlLayout.js";
import { LAYER } from "./Layers.js";

export class BeastBar {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly track: HTMLElement;
  private shown = "";

  constructor(parent: HTMLElement, doc: Document) {
    this.root = doc.createElement("div");
    this.root.setAttribute("data-ui", "beast-bar");
    this.root.setAttribute("role", "status");
    this.root.style.cssText = `position:fixed;top:var(--beast-top,calc(max(10px,env(safe-area-inset-top)) + 46px));left:var(--beast-center,50%);transform:translateX(-50%);width:var(--beast-width,min(420px,70vw));pointer-events:none;z-index:${LAYER.status - 5};display:none;text-align:center;font:700 14px/1.2 system-ui,sans-serif;color:#fff;text-shadow:0 1px 3px #000`;
    this.label = doc.createElement("div");
    this.track = doc.createElement("div");
    this.track.style.cssText = "margin-top:4px;height:12px;border-radius:7px;background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.35);overflow:hidden";
    this.fill = doc.createElement("div");
    this.fill.style.cssText = "height:100%;width:100%;background:linear-gradient(90deg,#c0392b,#ff6b3d)";
    this.track.append(this.fill);
    this.root.append(this.label, this.track);
    parent.append(this.root);
  }

  setLayout(layout: Layout): void {
    const { x0, y0, W, H } = layout.safe;
    const style = this.root.style;
    if (H >= PHONE_HEIGHT) {
      for (const prop of ["--beast-top", "--beast-center", "--beast-width"]) style.removeProperty(prop);
      return;
    }
    const width = 144;
    const joystickOnLeft = layout.controls.joystick.cx <= x0 + W / 2;
    const sideOffset = MIN_GAP_PX + width / 2;
    // Clear the two host-action rows and use the open space above the movement thumb.
    style.setProperty("--beast-top", `${y0 + 120}px`);
    style.setProperty("--beast-center", `${x0 + (joystickOnLeft ? sideOffset : W - sideOffset)}px`);
    style.setProperty("--beast-width", `${width}px`);
  }

  frame(beast: LoopBeast | undefined, serverTick: number): void {
    const b = beastBanner(beast, serverTick);
    if (!b) { if (this.shown !== "") { this.root.style.display = "none"; this.shown = ""; } return; }
    if (this.shown === "") this.root.style.display = "block";
    this.shown = b.text;
    if (this.label.textContent !== b.text) this.label.textContent = b.text;
    this.track.style.display = b.frac === null ? "none" : "block";
    if (b.frac !== null) this.fill.style.width = `${Math.round(b.frac * 1000) / 10}%`;
  }

  dispose(): void { this.root.remove(); }
}
