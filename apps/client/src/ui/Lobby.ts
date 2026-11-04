/**
 * Welcome, lobby and error screens (T18c, spec section 6). Original text only; plain language for children, no stack
 * traces. One delegated click listener on the root, removed in dispose(). Display and intent only.
 */
import "./experience.css";
import { P0_KITS, type KitId } from "@eb/shared/protocol";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import { FighterPreview } from "./FighterPreview.js";
import type { FlowBusy, FlowError, FlowState } from "../app/AppFlow.js";
import { CLOSE_TEXT } from "../app/ConnectionLifecycle.js";

export const KIT_LABEL: Readonly<Record<KitId, string>> = { sv: "Stone Vanguard", td: "Tide Duelist", ea: "Ember Artificer" };
const KIT_DEFS = { sv: SV_DEFS, td: TD_DEFS, ea: EA_DEFS } as const;

/** GR12: verbatim fighter role and tip shown on each lobby card. */
export const KIT_CHOICE: Readonly<Record<KitId, { role: string; tip: string }>> = {
  sv: { role: "Heavy close-range strikes", tip: "Face your rival before committing. Your awakening spends one finisher." },
  td: { role: "Grabs, throws and counters", tip: "Get close, catch a rival, or wait for an attack to counter." },
  ea: { role: "Charges, rushes and beams", tip: "Hold Ember Orb to charge. Use distance and cover to shape the fight." },
};

/** Four base move labels for a shipped kit. */
export function baseMoveLabels(kit: KitId): string[] {
  return KIT_DEFS[kit].filter((d) => d.form === "Base" && d.slot !== null).sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)).map((d) => d.label);
}

/** Only shipped, selectable kits are listed; hidden kits are never disabled placeholders. */
export const lobbyKits = (): KitId[] => [...P0_KITS];

/** GR12: plain status text for an entry action in flight. No byte progress is implied. */
export const BUSY_TEXT: Readonly<Record<FlowBusy, string>> = { preparing: "Preparing arena…", joining: "Joining arena…" };

export const ERROR_TEXT: Readonly<Record<FlowError, string>> = {
  ROOM_FULL: "This room is full right now. Try again in a moment.",
  INVITE_INVALID: "Your invitation does not work. Ask a grown-up for a new invitation link.",
  VERSION_MISMATCH: "This game was updated. Reload the page to get the new version, or ask a grown-up for help.",
  SERVER_OFFLINE: "We cannot reach the game right now. Check the connection and try again.",
  ASSET_FAILED: "Some game files did not load. Try again.",
  UNSUPPORTED: "This device cannot show the 3D arena (WebGL2 or WebAssembly is unavailable).",
  SESSION_ENDED: CLOSE_TEXT.session,
  ARENA_CLOSED: CLOSE_TEXT.arena,
  CONNECTION_LOST: CLOSE_TEXT.lost,
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
  /** GR12: false for a guest who arrived by sparring link; Fight bots and Find a room are then not offered. */
  hostTools?: boolean;
}
export interface LobbyActions {
  play(): void;
  practice(): void;
  /** GR12: opens the Host sparring setup (Fight bots). */
  bots?(): void;
  /** GR12: opens the room list (Find a room). */
  rooms?(): void;
  /** Opens the standalone How to play guide (HELP2). Optional so older callers keep working. */
  guide?(): void;
  moves?(): void;
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
  private content: HTMLElement;
  private selected: KitId;
  private name: string;
  private last: { st: FlowState; view: LobbyView } | null = null;
  private readonly onClick: (e: Event) => void;
  /** GR12: the one reserved preview region; the app attaches the loaded scene to it. */
  readonly preview: FighterPreview;

  constructor(
    parent: HTMLElement, private readonly act: LobbyActions, init: { kit: KitId; name: string }, private readonly doc: Document = document,
  ) {
    this.selected = init.kit;
    this.preview = new FighterPreview(doc);
    this.name = init.name;
    this.root = doc.createElement("div");
    this.root.className = "eb-screen";
    this.content = this.root;
    this.root.style.cssText = "position:fixed;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0b1118;color:#fff;font:16px system-ui;text-align:center;padding:16px;box-sizing:border-box";
    this.onClick = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-act]") as HTMLElement | null;
      const a = b?.dataset["act"];
      if (a === "play") this.act.play();
      else if (a === "practice") this.act.practice();
      else if (a === "bots") this.act.bots?.();
      else if (a === "rooms") this.act.rooms?.();
      else if (a === "moves") this.act.moves?.();
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
    this.content.append(el);
    return el;
  }

  render(st: FlowState, view: LobbyView): void {
    this.last = { st, view };
    this.root.replaceChildren();
    this.content = this.doc.createElement("div");
    this.content.className = "eb-lobby-body";
    this.root.append(this.content);
    this.root.dataset["screen"] = st.screen;
    this.root.removeAttribute("aria-busy");
    if (st.screen !== "lobby") this.preview.hide();
    this.root.style.display = st.screen === "match" ? "none" : "flex";
    if (st.screen === "match") return;
    if (st.screen === "boot") { this.add("h1", "Elemental Battlegrounds"); this.add("p", "Preparing arena…"); return; }
    if (st.screen === "welcome") {
      this.content.className = "eb-home";
      const hero = this.doc.createElement("div"); hero.className = "eb-hero"; this.content.append(hero);
      const home = this.content; this.content = hero;
      this.add("span", "THE FLOATING ISLES", { class: "eb-eyebrow" });
      this.add("h1", "Elemental Battlegrounds");
      this.add("p", "Find your element. Own the arena.");
      const art = this.doc.createElement("div"); art.className = "eb-hero-art"; art.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 3; i++) art.append(this.doc.createElement("i")); hero.append(art);
      this.add("p", "Three fighters. Four players. One sky-high showdown.");
      const actions = this.doc.createElement("div"); actions.className = "eb-home-actions"; home.append(actions); this.content = actions;
      this.add("h2", "Step into the arena");
      this.add("p", st.busy ? BUSY_TEXT[st.busy] : "Practice, bot sparring and private matches.", { "data-ui": "status", role: "status" });
      const names = this.doc.createElement("div");
      names.className = "eb-name-row";
      for (const n of ["Arel", "Nora"]) {
        const b = this.doc.createElement("button");
        b.dataset["act"] = "name"; b.dataset["name"] = n; b.textContent = n;
        b.setAttribute("aria-pressed", String(n === this.name));
        b.style.cssText = `min-width:120px;min-height:44px;font:600 16px system-ui;border-radius:12px;color:#fff;background:#1d2b3a;border:3px solid ${n === this.name ? "#ffd479" : "#9fd3ff55"}`;
        names.append(b);
      }
      this.content.append(names);
      this.add("p", "Choose the name shown in the arena.", { "data-ui": "presets" });
      this.add("button", "Play with friends", { "data-act": "play" });
      const modes = this.doc.createElement("div"); modes.className = "eb-mode-row"; this.content.append(modes);
      const actions2 = this.content; this.content = modes;
      this.add("button", "Practice", { "data-act": "practice" });
      if (view.hostTools !== false) this.add("button", "Fight bots", { "data-act": "bots" });
      this.content = actions2;
      const more = this.doc.createElement("div"); more.className = "eb-more-row"; this.content.append(more);
      this.content = more;
      if (view.hostTools !== false) this.add("button", "Find a room", { "data-act": "rooms" });
      this.add("button", "How to play", { "data-act": "guide" });
      this.add("button", "Settings", { "data-act": "settings" });
      this.content = actions2;
      this.add("a", "Admin · manage rooms", { href: "/admin.html", "data-ui": "admin-link" });
      this.disableWhileBusy(st);
      if (view.updateVisible) this.add("button", "Update", { "data-act": "update" });
      this.disableWhileBusy(st);
      return;
    }
    if (st.screen === "error" && st.error) {
      this.add("h2", "Something went wrong");
      this.add("p", ERROR_TEXT[st.error], { "data-ui": "error", "data-code": st.error });
      if (st.busy) this.add("p", BUSY_TEXT[st.busy], { "data-ui": "status", role: "status" });
      if (st.canRetry) this.add("button", "Retry", { "data-act": "retry" });
      if (st.error === "VERSION_MISMATCH") this.add("button", "Update", { "data-act": "update" });
      this.add("button", "Back", { "data-act": "back" });
      this.disableWhileBusy(st);
      return;
    }
    // lobby
    const practice = view.mode === "practice";
    this.add("h2", practice ? "Practice room" : "Private arena");
    this.add("p", practice ? "A training dummy waits for you. Nothing here counts in a real match." : `Players seated: ${view.seated} of ${view.capacity}`, { "data-ui": "room-status" });
    const pick = this.doc.createElement("div"); pick.className = "eb-fighter-pick";
    const cards = this.doc.createElement("div"); cards.className = "eb-fighter-cards"; cards.setAttribute("role", "group"); cards.setAttribute("aria-label", "Choose your fighter");
    for (const k of lobbyKits()) {
      const b = this.doc.createElement("button");
      b.dataset["act"] = "kit"; b.dataset["kit"] = k;
      b.setAttribute("aria-pressed", String(k === this.selected));
      for (const [cls, text] of [["eb-card-name", KIT_LABEL[k]], ["eb-card-role", KIT_CHOICE[k].role], ["eb-card-tip", KIT_CHOICE[k].tip]] as const) {
        const span = this.doc.createElement("span"); span.className = cls; span.textContent = text; b.append(span);
      }
      cards.append(b);
    }
    pick.append(this.preview.el, cards);
    this.content.append(pick);
    this.preview.show(this.selected);
    this.add("p", `Moves: ${baseMoveLabels(this.selected).join(", ")}`, { "data-ui": "moves" });
    this.add("p", practice ? "Awakening: finish the first steps and the practice room fills your meter." : "Awakening: land and take hits to fill the meter, then press Awaken.", { "data-ui": "awakening" });
    const actionRow = this.doc.createElement("div"); actionRow.className = "eb-lobby-actions"; this.content.append(actionRow);
    this.content = actionRow;
    this.add("button", "Moves & ranges", { "data-act": "moves" });
    this.add("button", "Ready", { "data-act": "ready" });
    this.add("button", "Back", { "data-act": "back" });
  }

  /** GR12: while an entry action runs every control on the screen is inert, so a double click cannot repeat it. */
  private disableWhileBusy(st: FlowState): void {
    if (!st.busy) return;
    for (const b of Array.from(this.root.querySelectorAll("button"))) b.disabled = true;
    this.root.setAttribute("aria-busy", "true");
  }

  /** Moves focus to a rendered action button, e.g. the launcher that opened an overlay. */
  focusAct(act: string): void {
    (this.root.querySelector(`button[data-act="${act}"]`) as HTMLElement | null)?.focus();
  }

  dispose(): void {
    this.root.removeEventListener("click", this.onClick);
    this.preview.dispose();
    this.root.remove();
    this.last = null;
  }
}
