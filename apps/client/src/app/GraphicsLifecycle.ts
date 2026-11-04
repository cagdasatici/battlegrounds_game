/**
 * GR09: graphics context loss/restore lifecycle. UI and rendering only: the room stays connected and the server
 * keeps simulating (no pause, no invulnerability). On loss the local input gate closes (holds released, neutral
 * intent sent by the gate subscriber) and scene render calls stop. After restore the scene drops transient visuals
 * and rendering resumes after one successful frame plus a newer owner snapshot. The 5,000 ms wall-clock limit is
 * a UI timeout, never a simulation input.
 */
export type GraphicsState = "ok" | "lost" | "restoring" | "failed";

export const RECOVERY_TIMEOUT_MS = 5000;
export const RECOVERING_TEXT = "Recovering graphics… Your fighter is still in the arena.";
export const FAILED_TEXT = "Graphics could not recover.";

export interface GraphicsScene { pauseRendering(): void; resumeRendering(): void; discardTransient(): void }
export interface MatchGate { close(): void; open(): void }
export interface GraphicsDeps {
  canvas: EventTarget;
  scene: GraphicsScene;
  /** Latest replicated server tick, or null when no room is joined. */
  ownerTick(): number | null;
  onState(state: GraphicsState): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
  timeoutMs?: number;
}

export class GraphicsLifecycle {
  private st: GraphicsState = "ok";
  private match: MatchGate | null = null;
  private timer: unknown = null;
  private restoreTick: number | null = null;
  private disposed = false;
  private readonly lostFn = (e: Event): void => { e.preventDefault(); this.lost(); };
  private readonly restoredFn = (): void => { this.restored(); };

  constructor(private readonly d: GraphicsDeps) {
    d.canvas.addEventListener("webglcontextlost", this.lostFn);
    d.canvas.addEventListener("webglcontextrestored", this.restoredFn);
  }

  get state(): GraphicsState { return this.st; }

  /** The current match supplies its input gate. If graphics are already lost the gate closes immediately. */
  setMatch(m: MatchGate | null): void {
    this.match = m;
    if (m && this.st !== "ok") m.close();
  }

  private set(s: GraphicsState): void { if (s !== this.st) { this.st = s; this.d.onState(s); } }
  private clearTimer(): void { if (this.timer !== null) { (this.d.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer); this.timer = null; } }
  private startTimer(): void {
    this.clearTimer();
    this.timer = (this.d.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
      this.timer = null;
      if (!this.disposed && (this.st === "lost" || this.st === "restoring")) this.set("failed");
    }, this.d.timeoutMs ?? RECOVERY_TIMEOUT_MS);
  }

  private lost(): void {
    if (this.disposed) return;
    this.d.scene.pauseRendering();
    this.match?.close();
    this.restoreTick = null;
    const was = this.st;
    this.set("lost");
    if (was !== "lost") this.startTimer();
  }

  private restored(): void {
    if (this.disposed || this.st === "ok") return;
    this.d.scene.discardTransient();
    this.restoreTick = this.d.ownerTick();
    this.d.scene.resumeRendering();
    this.set("restoring");
  }

  /** Call after each frame the scene actually drew. Resumes once a newer owner snapshot has arrived. */
  frameRendered(): void {
    if (this.disposed || this.st !== "restoring") return;
    const tick = this.d.ownerTick();
    if (this.restoreTick !== null && (tick === null || tick <= this.restoreTick)) return;
    this.clearTimer();
    this.match?.open();
    this.set("ok");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.d.canvas.removeEventListener("webglcontextlost", this.lostFn);
    this.d.canvas.removeEventListener("webglcontextrestored", this.restoredFn);
    this.match = null;
  }
}

/** Status banner above every match overlay (layer 70). Reload and Leave appear only after the timeout. */
export function mountGraphicsBanner(doc: Document, actions: { reload(): void; leave(): void }): { render(s: GraphicsState): void; dispose(): void } {
  const el = doc.createElement("div");
  el.dataset["ui"] = "graphics-status";
  el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
  el.style.cssText = "position:fixed;left:50%;top:140px;transform:translateX(-50%);z-index:70;max-width:min(520px,90vw);padding:10px 16px;border-radius:12px;background:#0b1118f2;color:#fff;font:600 16px Inter,system-ui,sans-serif;text-align:center";
  el.hidden = true;
  const text = doc.createElement("div");
  const row = doc.createElement("div");
  row.style.cssText = "display:flex;gap:12px;justify-content:center;margin-top:10px";
  const mk = (label: string, fn: () => void): HTMLButtonElement => {
    const b = doc.createElement("button");
    b.type = "button"; b.textContent = label; b.dataset["ui"] = `graphics-${label.toLowerCase()}`;
    b.style.cssText = "min-height:48px;min-width:96px;border-radius:10px;border:1px solid #fff6;background:#1d2b3a;color:#fff;font:600 16px Inter,system-ui,sans-serif";
    b.addEventListener("click", fn);
    return b;
  };
  row.append(mk("Reload", actions.reload), mk("Leave", actions.leave));
  el.append(text, row);
  doc.body.append(el);
  return {
    render(s) {
      el.hidden = s === "ok";
      text.textContent = s === "failed" ? FAILED_TEXT : RECOVERING_TEXT;
      row.style.display = s === "failed" ? "flex" : "none";
      // Pointer events only matter for the buttons; the recovering text never blocks the arena.
      el.style.pointerEvents = s === "failed" ? "auto" : "none";
    },
    dispose() { el.remove(); },
  };
}
