// MODE01 (decision 0054): results card shown while the server holds phase "roundOver". Presentation only.
import { TICK_RATE, type RoundOverMessage } from "@eb/shared/protocol";

/** Whole seconds until the rematch, never below 0. Pure so it is unit tested. */
export function rematchSecondsLeft(resumesAtTick: number, serverTick: number): number {
  return Math.max(0, Math.ceil((resumesAtTick - serverTick) / TICK_RATE));
}

/** Plain-text standings rows, best first (the server already sorted them). */
export function standingsRows(m: RoundOverMessage): string[] {
  return m.standings.map((s, i) => `${i + 1}. ${s.displayName}  ${s.kills} KOs  ${s.deaths} deaths  ${s.assists} assists`);
}

export class RoundResults {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLElement;
  private readonly count: HTMLElement;
  private msg: RoundOverMessage | null = null;
  /** The message can beat the state patch; only hide after the phase was seen as roundOver, or well past the deadline. */
  private sawPhase = false;

  constructor(parent: HTMLElement, private readonly doc: Document) {
    this.root = doc.createElement("div");
    this.root.dataset["ui"] = "round-results";
    this.root.setAttribute("role", "status");
    this.root.style.cssText = "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9;min-width:260px;max-width:90vw;padding:20px;background:rgba(11,17,24,.92);color:#fff;font:16px system-ui;border-radius:16px;text-align:center;pointer-events:none;display:none";
    this.title = doc.createElement("h2"); this.title.style.margin = "0 0 8px";
    this.list = doc.createElement("div"); this.list.style.cssText = "text-align:left;margin:8px 0";
    this.count = doc.createElement("p"); this.count.style.cssText = "margin:8px 0 0;font-weight:700";
    this.root.append(this.title, this.list, this.count);
    parent.append(this.root);
  }

  /** Shows the card for a roundOver message. */
  show(m: RoundOverMessage, serverTick: number): void {
    this.msg = m; this.sawPhase = false;
    const top = m.standings[0];
    this.title.textContent = top ? `${top.displayName} wins: first to ${m.roundTarget} KOs` : "Round over";
    this.list.replaceChildren(...standingsRows(m).map((t) => { const row = this.doc.createElement("div"); row.textContent = t; return row; }));
    this.root.style.display = "block";
    this.tick(serverTick);
  }

  /** Called from the HUD timer; hides the card once the server leaves roundOver. */
  update(phase: string, serverTick: number): void {
    if (!this.msg) return;
    if (phase === "roundOver") this.sawPhase = true;
    else if (this.sawPhase || serverTick > this.msg.resumesAtTick + TICK_RATE) { this.hide(); return; }
    this.tick(serverTick);
  }

  hide(): void { this.msg = null; this.sawPhase = false; this.root.style.display = "none"; }

  private tick(serverTick: number): void {
    if (this.msg) this.count.textContent = `Rematch in ${rematchSecondsLeft(this.msg.resumesAtTick, serverTick)}`;
  }

  get visible(): boolean { return this.msg !== null; }

  dispose(): void { this.msg = null; this.root.remove(); }
}
