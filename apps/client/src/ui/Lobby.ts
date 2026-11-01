/**
 * Welcome, lobby and error screens (T18c, spec section 6). Original text only; plain language for children, no stack
 * traces. One delegated click listener on the root, removed in dispose(). Display and intent only.
 */
import { P0_KITS, type KitId } from "@eb/shared/protocol";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import type { FlowError, FlowState } from "../app/AppFlow.js";

export const KIT_LABEL: Readonly<Record<KitId, string>> = { sv: "Stone Vanguard", td: "Tide Duelist", ea: "Ember Artificer" };
const KIT_DEFS = { sv: SV_DEFS, td: TD_DEFS, ea: EA_DEFS } as const;

/** Four base move labels for a shipped kit. */
export function baseMoveLabels(kit: KitId): string[] {
  return KIT_DEFS[kit].filter((d) => d.form === "Base" && d.slot !== null).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((d) => d.label);
}

/** Only shipped, selectable kits are listed; hidden kits are never disabled placeholders. */
export const lobbyKits = (): KitId[] => [...P0_KITS];

export const ERROR_TEXT: Readonly<Record<FlowError, string>> = {
  ROOM_FULL: "This room is full right now. Try again in a moment.",
  INVITE_INVALID: "Your invitation does not work. Ask a grown-up for a new invitation link.",
  VERSION_MISMATCH: "This game was updated. Reload the page to get the new version, or ask a grown-up for help.",
  SERVER_OFFLINE: "We cannot reach the game right now. Check the connection and try again.",
  ASSET_FAILED: "Some game files did not load. Try again.",
  UNSUPPORTED: "This device cannot show the 3D arena (WebGL2 or WebAssembly is unavailable).",
};

export interface LobbyView {
  /** Seats currently occupied in the private room, and its capacity. */
  seated: number;
  capacity: number;
  connection: "online" | "offline";
  /** "practice" shows the training room text instead of the seat count. */
  mode?: "play" | "practice";
  /** WEB2: an update is ready and no match is running. */
  updateVisible?: boolean;
}
export interface LobbyActions {
  play(): void;
  practice(): void;
  /** Opens the standalone How to play guide (HELP2). Optional so older callers keep working. */
  guide?(): void;
  retry(): void;
  back(): void;
  ready(kit: KitId): void;
  /** Opens the settings panel (T27). Optional so older callers keep working. */
  settings?(): void;
  /** WEB2: user tapped Update; the caller activates the waiting worker and reloads. */
  update?(): void;
}

export class Lobby {
  private readonly root: HTMLElement;
  private selected: KitId;
  private name: string;
  private last: { st: FlowState; view: LobbyView } | null = null;
  private readonly onClick: (e: Event) => void;

  constructor(
    parent: HTMLElement, private readonly act: LobbyActions, init: { kit: KitId; name: string }, private readonly doc: Document = document,
  ) {
    this.selected = init.kit;
    this.name = init.name;
    this.root = doc.createElement("div");
    this.root.className = "eb-screen";
    this.root.style.cssText = "position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0b1118;color:#fff;font:16px system-ui;text-align:center;padding:16px;box-sizing:border-box";
    this.onClick = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-act]") as HTMLElement | null;
      const a = b?.dataset["act"];
      if (a === "play") this.act.play();
      else if (a === "practice") this.act.practice();
      else if (a === "guide") this.act.guide?.();
      else if (a === "retry") this.act.retry();
      else if (a === "back") this.act.back();
      else if (a === "settings") this.act.settings?.();
      else if (a === "update") this.act.update?.();
      else if (a === "ready") this.act.ready(this.selected);
      else if (a === "name" && b?.dataset["name"]) { this.name = b.dataset["name"]; if (this.last) this.render(this.last.st, this.last.view); }
      else if (a === "kit" && b?.dataset["kit"]) { this.selected = b.dataset["kit"] as KitId; if (this.last) this.render(this.last.st, this.last.view); }
    };
    this.root.addEventListener("click", this.onClick);
    parent.append(this.root);
  }

  get kit(): KitId { return this.selected; }
  /** A local label only; it never authenticates (the invitation does). */
  get displayName(): string { return this.name; }

  private add(tag: string, text: string, attrs: Record<string, string> = {}): HTMLElement {
    const el = this.doc.createElement(tag);
    el.textContent = text;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (tag === "button") el.style.cssText = "min-width:220px;min-height:48px;font:600 17px system-ui;border-radius:12px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff";
    this.root.append(el);
    return el;
  }

  render(st: FlowState, view: LobbyView): void {
    this.last = { st, view };
    this.root.replaceChildren();
    this.root.dataset["screen"] = st.screen;
    this.root.style.display = st.screen === "match" ? "none" : "flex";
    if (st.screen === "match") return;
    if (st.screen === "boot") { this.add("h1", "Elemental Battlegrounds"); this.add("p", "Preparing arena…"); return; }
    if (st.screen === "welcome") {
      this.add("h1", "Elemental Battlegrounds");
      this.add("p", `Connection: ${view.connection}`, { "data-ui": "status" });
      const names = this.doc.createElement("div");
      names.style.cssText = "display:flex;gap:12px;justify-content:center";
      for (const n of ["Arel", "Nora"]) {
        const b = this.doc.createElement("button");
        b.dataset["act"] = "name"; b.dataset["name"] = n; b.textContent = n;
        b.setAttribute("aria-pressed", String(n === this.name));
        b.style.cssText = `min-width:120px;min-height:44px;font:600 16px system-ui;border-radius:12px;color:#fff;background:#1d2b3a;border:3px solid ${n === this.name ? "#ffd479" : "#9fd3ff55"}`;
        names.append(b);
      }
      this.root.append(names);
      this.add("p", "Your name is only a label. An invitation from a grown-up lets you in.", { "data-ui": "presets" });
      this.add("button", "Play", { "data-act": "play" });
      this.add("button", "How to play", { "data-act": "guide" });
      this.add("button", "Practice", { "data-act": "practice" });
      this.add("button", "Settings", { "data-act": "settings" });
      if (view.updateVisible) this.add("button", "Update", { "data-act": "update" });
      return;
    }
    if (st.screen === "error" && st.error) {
      this.add("h2", "Something went wrong");
      this.add("p", ERROR_TEXT[st.error], { "data-ui": "error", "data-code": st.error });
      if (st.canRetry) this.add("button", "Retry", { "data-act": "retry" });
      if (st.error === "VERSION_MISMATCH") this.add("button", "Update", { "data-act": "update" });
      this.add("button", "Back", { "data-act": "back" });
      return;
    }
    // lobby
    const practice = view.mode === "practice";
    this.add("h2", practice ? "Practice room" : "Private arena");
    this.add("p", practice ? "A training dummy waits for you. Nothing here counts in a real match." : `Players seated: ${view.seated} of ${view.capacity}`, { "data-ui": "room-status" });
    const row = this.doc.createElement("div");
    row.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;justify-content:center";
    for (const k of lobbyKits()) {
      const b = this.doc.createElement("button");
      b.dataset["act"] = "kit"; b.dataset["kit"] = k;
      b.textContent = KIT_LABEL[k];
      b.setAttribute("aria-pressed", String(k === this.selected));
      b.style.cssText = `min-width:180px;min-height:48px;font:600 16px system-ui;border-radius:12px;color:#fff;border:3px solid ${k === this.selected ? "#ffd479" : "#9fd3ff55"};background:#1d2b3a`;
      row.append(b);
    }
    this.root.append(row);
    this.add("p", `Moves: ${baseMoveLabels(this.selected).join(", ")}`, { "data-ui": "moves" });
    this.add("p", practice ? "Awakening: finish the first steps and the practice room fills your meter." : "Awakening: land and take hits to fill the meter, then press Awaken.", { "data-ui": "awakening" });
    this.add("button", "Ready", { "data-act": "ready" });
    this.add("button", "Back", { "data-act": "back" });
  }

  /** Moves focus to a rendered action button, e.g. the launcher that opened an overlay. */
  focusAct(act: string): void {
    (this.root.querySelector(`button[data-act="${act}"]`) as HTMLElement | null)?.focus();
  }

  dispose(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
    this.last = null;
  }
}
