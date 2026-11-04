// MODE01 / GR08 (decision 0054): results card rendered from replicated room state while phase is "roundOver".
// Presentation only; the roundOver message is a transient cue and is never needed to draw this card.
import { TICK_RATE } from "@eb/shared/protocol";

export interface RoundRow { entityId: number; displayName: string; kills: number; deaths: number; assists: number }
export interface RoundView { phase: string; roundTarget: number; roundEndsAtTick: number; standings: readonly RoundRow[] }

/** Whole seconds until the next round, never below 0. Pure so it is unit tested. */
export function rematchSecondsLeft(resumesAtTick: number, serverTick: number): number {
  return Math.max(0, Math.ceil((resumesAtTick - serverTick) / TICK_RATE));
}

/** Plain-text standings rows, best first (the server froze this order). */
export function standingsRows(rows: readonly RoundRow[]): string[] {
  return rows.map((s, i) => `${i + 1}. ${s.displayName}  ${s.kills} KOs  ${s.deaths} deaths  ${s.assists} assists`);
}

/** Active-round objective strip text: `First to N · You K · Leader L`; null for endless FFA or the results phase. */
export function objectiveText(roundTarget: number, phase: string, me: { kills: number } | undefined, leader: { displayName: string; kills: number } | undefined): string | null {
  if (roundTarget === 0 || phase === "roundOver") return null;
  return `First to ${roundTarget} · You ${me?.kills ?? 0} · Leader ${leader ? `${leader.displayName} ${leader.kills}` : "-"}`;
}

export class RoundResults {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly table: HTMLElement;
  private readonly count: HTMLElement;
  private shown = false;
  private key = "";

  constructor(parent: HTMLElement, private readonly doc: Document, onChangeFighter: () => void = () => undefined, onLeave: () => void = () => undefined) {
    this.root = doc.createElement("div");
    this.root.dataset["ui"] = "round-results";
    this.root.setAttribute("role", "status");
    this.root.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;min-width:260px;max-width:90vw;padding:20px;background:rgba(11,17,24,.92);color:#fff;font:16px Inter,system-ui,sans-serif;border-radius:16px;text-align:center;display:none";
    this.title = doc.createElement("h2"); this.title.style.margin = "0 0 8px";
    this.table = doc.createElement("div"); this.table.style.cssText = "text-align:left;margin:8px 0;font-variant-numeric:tabular-nums";
    this.count = doc.createElement("p"); this.count.dataset["round"] = "countdown"; this.count.style.cssText = "margin:8px 0";
    const actions = doc.createElement("div"); actions.style.cssText = "display:flex;gap:12px;justify-content:center";
    const mk = (label: string, key: string, fn: () => void): HTMLElement => {
      const b = doc.createElement("button"); b.textContent = label; b.dataset["round"] = key;
      b.style.cssText = "min-height:48px;min-width:120px;font:600 15px Inter,system-ui,sans-serif";
      b.addEventListener("click", fn);
      return b;
    };
    actions.append(mk("Change fighter", "change", onChangeFighter), mk("Leave", "leave", onLeave));
    this.root.append(this.title, this.table, this.count, actions);
    parent.append(this.root);
  }

  /** Idempotent: draw from the latest state each HUD tick. `suppressed` hides the card under a modal without losing state. */
  render(v: RoundView, serverTick: number, suppressed = false): void {
    const on = v.phase === "roundOver" && v.standings.length > 0;
    if (!on) { this.hide(); return; }
    this.shown = true;
    this.root.style.display = suppressed ? "none" : "block";
    const key = `${v.roundTarget}|${v.roundEndsAtTick}|${standingsRows(v.standings).join("/")}`;
    if (key !== this.key) {
      this.key = key;
      const top = v.standings[0];
      this.title.textContent = top ? `${top.displayName} wins: first to ${v.roundTarget} KOs` : "Round over";
      this.table.replaceChildren(...standingsRows(v.standings).map((t) => { const row = this.doc.createElement("div"); row.textContent = t; return row; }));
    }
    this.count.textContent = `Next round in ${rematchSecondsLeft(v.roundEndsAtTick, serverTick)}`;
  }

  hide(): void { this.shown = false; this.key = ""; this.root.style.display = "none"; }

  get visible(): boolean { return this.shown; }

  dispose(): void { this.shown = false; this.root.remove(); }
}
