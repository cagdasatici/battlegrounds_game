/**
 * Touch HUD: original, unbranded control visuals placed from ControlLayout. Display only;
 * all values shown (HP, meter) come from server snapshots supplied by the caller.
 */
import { MIN_GAP_PX, MIN_TARGET_PX, PHONE_HEIGHT, type ControlId, type Layout, type SafeRect } from "../input/ControlLayout.js";
import { shortSkillLabel, skillStatus, type ScoreRow, type SkillAvailability } from "./HudFormat.js";
import { LAYER } from "./Layers.js";

export interface HudState {
  name: string;
  hp: number;
  maxHp: number;
  /** Server meter normalized to 0..1. */
  meter: number;
  facingLock: boolean;
  portrait: boolean;
  /** "Ready" or "NN%"; defaults to the integer percent of `meter`. */
  meterText?: string;
  /** BEAST02: second banked awaken bar, 0..1, and whether both bars are full (Awaken will transform). */
  meter2?: number;
  beastReady?: boolean;
  /** Four slot texts from cooldownEndTicks (empty string = ready). */
  cooldowns?: readonly string[];
  /** Four equipped short skill names for the current form. When given, skill buttons show name and readiness. */
  skills?: readonly string[];
  skillRoles?: readonly string[];
  /** Authoritative per-slot status (ready/cooldown/used/charging); overrides `cooldowns` text when given. */
  skillStates?: readonly SkillAvailability[];
  /** Identity of each equipped move (kit|form|id); the ready pulse only fires for a cooldown ending on the same move. */
  skillKeys?: readonly string[];
  /** Ragdolled: Dash button shows Escape plus its authoritative readiness text. */
  dash?: { label: string; text: string } | null;
  /** Per slot cooldown fraction, 0 = ready, 1 = just used (radial ring). */
  cooldownFracs?: readonly number[];
  reducedMotion?: boolean;
  /** GR08: `First to N \u00b7 You K \u00b7 Leader L`; null/absent for endless FFA and the results phase. */
  objective?: string | null;
  castText?: string;
  /** True for a short window after the server confirmed a block of the local player's guard. */
  blocked?: boolean;
  formText?: string;
  stillpointText?: string;
  rejection?: string | null;
  /** Death overlay: scorer name and whole seconds left. */
  /** GR11: `by`/`byKit`/`byHpFrac` are frozen at the KO event; `fell` = uncredited fall (no "by" line). */
  respawn?: { by: string; byKit: string; byHpFrac: number | null; seconds: number; frac: number; fell?: boolean } | null;
  scoreboard?: readonly ScoreRow[] | null;
  /** Kit choice panel; null = closed. */
  /** Esc/Menu panel: the arena keeps running while it is open. */
  menuOpen?: boolean;
  kitMenu?: { kits: readonly { id: string; label: string }[]; current: string; pending: string } | null;
}

export interface HudBox { id: ControlId; left: number; top: number; width: number; height: number; round: boolean; label: string; sub?: string; ready?: boolean; hint?: string; slot?: number; name?: string }
export interface HudModel { boxes: HudBox[]; panel: null | "rotate" | "enlarge"; hpText: string; meterPct: number; awakenReady: boolean; meterText: string; meter2Pct: number; beastReady: boolean }

const LABELS: Record<ControlId, string> = {
  joystick: "", attack: "Strike", jump: "Jump", dash: "Dash", block: "Guard", facing: "Aim",
  skill1: "1", skill2: "2", skill3: "3", skill4: "4", awaken: "Awaken", menu: "Menu",
  fighter: "Fighter", health: "", scoreboard: "Score",
};

function boxLabel(id: ControlId, st: HudState, meterText: string): string {
  if (id === "health") return st.name;
  if (id === "awaken") return `${LABELS[id]} ${meterText}`;
  const slot = id === "skill1" ? 0 : id === "skill2" ? 1 : id === "skill3" ? 2 : id === "skill4" ? 3 : -1;
  const cd = slot >= 0 ? st.cooldowns?.[slot] ?? "" : "";
  return cd === "" ? LABELS[id] : `${LABELS[id]} ${cd}`;
}

export function hudModel(layout: Layout, st: HudState): HudModel {
  const meter = Math.min(1, Math.max(0, st.meter));
  const meterText = st.meterText ?? (meter >= 1 ? "Ready" : `${Math.round(meter * 100)}%`);
  const boxes: HudBox[] = Object.values(layout.controls).map((c) => {
    const box: HudBox = {
      id: c.id, left: c.cx - c.vw / 2, top: c.cy - c.vh / 2, width: c.vw, height: c.vh,
      round: c.shape === "circle", label: boxLabel(c.id, st, meterText),
    };
    const slot = c.id === "skill1" ? 0 : c.id === "skill2" ? 1 : c.id === "skill3" ? 2 : c.id === "skill4" ? 3 : -1;
    if (c.id === "dash" && st.dash) { box.label = st.dash.label; box.sub = st.dash.text; box.ready = st.dash.text === "Ready"; }
    if (slot >= 0 && st.skills) {
      const a = st.skillStates?.[slot];
      const s = a ? { ready: a.kind === "ready", text: a.text } : skillStatus(st.cooldowns?.[slot] ?? "");
      box.label = `${slot + 1} ${shortSkillLabel(st.skills[slot] ?? "")}`.trim();
      box.sub = s.text; box.ready = s.ready;
      if (a?.kind === "charging") box.hint = "Release to fire"; // aria-label only (GR11: no role row on the button)
      box.slot = slot + 1; box.name = shortSkillLabel(st.skills[slot] ?? "");
    }
    if (c.id === "block" && st.blocked) { box.label = "Blocked!"; box.ready = true; }
    return box;
  });
  const panel = st.portrait ? "rotate" : layout.tooSmall ? "enlarge" : null;
  return {
    boxes, panel, meterText,
    hpText: `${Math.max(0, Math.round(st.hp))} / ${st.maxHp}`,
    meterPct: Math.round(meter * 100),
    awakenReady: meter >= 1,
    meter2Pct: Math.round(Math.min(1, Math.max(0, st.meter2 ?? 0)) * 100),
    beastReady: st.beastReady === true,
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
  private readonly stateEls = new WeakMap<HTMLElement, HTMLElement>();
  private readonly panel: HTMLElement;

  private readonly info: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly death: HTMLElement;
  private readonly board: HTMLElement;
  private readonly kitPanel: HTMLElement;
  private readonly menuPanel: HTMLElement;
  private readonly backdrop: HTMLElement;
  private kitKey = "";
  private koKey = "";
  private boardKey = "";
  private koRing: HTMLElement | null = null;
  private readonly koListener: (e: Event) => void;
  private prevFracs: number[] = [];
  private prevKinds: string[] = [];
  private prevKeys: string[] = [];
  private readonly pulseTimers = new Set<ReturnType<typeof setTimeout>>();
  private opacity = 1;
  private readonly objectiveEl: HTMLElement;
  private readonly kitListener: (e: Event) => void;
  private readonly menuListener: (e: Event) => void;

  constructor(parent: HTMLElement, private readonly doc: Document = document, private readonly onKitPick: (kit: string) => void = () => undefined, private readonly onLeave: () => void = () => undefined, private readonly onSettings: () => void = () => undefined, private readonly onMoves: () => void = () => undefined, private readonly onFighter: () => void = () => undefined) {
    this.root = doc.createElement("div");
    this.root.className = "eb-hud";
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;font:600 13px Inter,system-ui,sans-serif;color:#fff";
    this.panel = doc.createElement("div");
    this.panel.style.cssText = `z-index:${LAYER.modalContent};position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#000c;font-size:20px;text-align:center`;
    this.panel.dataset.hud = "orientation";
    this.root.appendChild(this.panel);
    const mk = (cls: string, css: string): HTMLElement => {
      const el = doc.createElement("div");
      el.dataset.hud = cls;
      el.style.cssText = `position:fixed;display:none;${css}`;
      this.root.appendChild(el);
      return el;
    };
    this.backdrop = mk("backdrop", `z-index:${LAYER.modalBackdrop};inset:0;background:#0b111866;pointer-events:none`);
    this.info = mk("info", `left:50%;top:92px;transform:translateX(-50%);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;text-shadow:0 1px 2px #000;z-index:${LAYER.hud}`);
    this.objectiveEl = mk("objective", `left:50%;top:68px;transform:translateX(-50%);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;text-shadow:0 1px 2px #000;z-index:${LAYER.hud}`);
    this.badge = mk("block-feedback", `z-index:${LAYER.hud};left:50%;top:44%;transform:translateX(-50%);background:#e8b84af0;color:#111;padding:6px 18px;border-radius:14px;font-size:20px`);
    this.badge.textContent = "Blocked!";
    this.toast = mk("rejection", `z-index:${LAYER.hud};left:50%;top:56%;transform:translateX(-50%);background:#000a;padding:6px 14px;border-radius:14px`);
    this.death = mk("respawn", `z-index:${LAYER.hud};inset:0;align-items:center;justify-content:center;flex-direction:column;background:#300a;font-size:26px;text-align:center`);
    this.board = mk("scoreboard", `z-index:${LAYER.hud};right:12px;top:60px;background:#0b1118ee;border:2px solid #9fd3ff88;border-radius:10px;padding:8px 12px;min-width:220px`);
    this.kitPanel = mk("kit", `z-index:${LAYER.modalContent};left:50%;top:50%;transform:translate(-50%,-50%);background:#0b1118f2;border:2px solid #9fd3ff88;border-radius:12px;padding:12px 16px;pointer-events:auto;text-align:center`);
    this.menuPanel = mk("menu", `z-index:${LAYER.modalContent};left:50%;top:50%;transform:translate(-50%,-50%);background:#0b1118f2;border:2px solid #9fd3ff88;border-radius:12px;padding:12px 16px;pointer-events:auto;text-align:center`);
    this.menuPanel.append(Object.assign(doc.createElement("div"), { textContent: "The arena continues while this menu is open." }));
    const leave = Object.assign(doc.createElement("button"), { textContent: "Leave" });
    leave.dataset["leave"] = "1";
    leave.style.cssText = "display:block;margin:10px auto;min-width:200px;min-height:44px;font:600 15px Inter,system-ui,sans-serif";
    const settings = Object.assign(doc.createElement("button"), { textContent: "Settings" });
    settings.dataset["settings"] = "1";
    settings.style.cssText = leave.style.cssText;
    const moves = Object.assign(doc.createElement("button"), { textContent: "Moves & ranges" });
    moves.dataset["moves"] = "1"; moves.style.cssText = leave.style.cssText;
    this.menuPanel.append(moves, settings, leave);
    this.menuListener = (e: Event): void => {
      const d = (e.target as HTMLElement | null)?.dataset;
      if (d?.["leave"]) this.onLeave();
      else if (d?.["moves"]) this.onMoves();
      else if (d?.["settings"]) this.onSettings();
    };
    this.menuPanel.addEventListener("click", this.menuListener);
    this.kitListener = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-kit]") as HTMLElement | null;
      if (b?.dataset["kit"]) this.onKitPick(b.dataset["kit"]);
    };
    this.kitPanel.addEventListener("click", this.kitListener);
    this.koListener = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-ko-kit]") as HTMLElement | null;
      if (b) this.onFighter();
    };
    this.death.addEventListener("click", this.koListener);
    parent.appendChild(this.root);
  }

  /** HP bar fill drawn as a gradient on the health box. */
  private fill(el: HTMLElement, frac: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
    el.style.setProperty?.("--fill", `${pct}%`);
    el.dataset["low"] = pct <= 30 ? "1" : "0"; // CSS draws the bar and turns it red when low
  }

  private placeExtras(layout: Layout): void {
    const { x0, y0, W, H } = layout.safe;
    const compact = H < PHONE_HEIGHT;
    const health = layout.controls.health;
    const awaken = layout.controls.awaken;
    // Keep the header near health if a custom layout places Awaken elsewhere.
    const compactHeader = health.cy + health.vh / 2 + MIN_TARGET_PX + 2 * MIN_GAP_PX;
    const awakenBottom = awaken.cy + awaken.hh / 2;
    const awakenInHeader = awaken.cy - awaken.hh / 2 < compactHeader + 46;
    const objectiveY = !compact ? y0 + 68 : awakenInHeader ? Math.max(compactHeader, awakenBottom + MIN_GAP_PX) : compactHeader;
    // Leave room for the right-hand skill arc even at the narrowest supported landscape width.
    const statusWidth = compact ? Math.min(240, Math.max(0, W - 360)) : Math.min(360, Math.max(0, W - 16));
    const center = x0 + W / 2;
    if (compact) this.root.dataset["compact"] = "";
    else delete this.root.dataset["compact"];
    for (const [el, top] of [[this.objectiveEl, objectiveY], [this.info, objectiveY + (compact ? 22 : 24)]] as const) {
      el.style.left = `${center}px`;
      el.style.top = `${top}px`;
      el.style.maxWidth = `${statusWidth}px`;
    }
    this.badge.style.left = this.toast.style.left = `${center}px`;
    // The compact objective and cast rows can extend below 44% on short screens.
    this.badge.style.top = `${compact ? Math.max(y0 + H * 0.44, objectiveY + 48) : y0 + H * 0.44}px`;
    this.toast.style.top = `${compact ? Math.max(y0 + H * 0.56, objectiveY + 86) : y0 + H * 0.56}px`;
    this.board.style.right = `calc(100% - ${x0 + W - 12}px)`;
    this.board.style.top = `${y0 + 60}px`;
    for (const el of [this.kitPanel, this.menuPanel]) {
      el.style.left = `${center}px`;
      el.style.top = `${y0 + H / 2}px`;
      el.style.boxSizing = "border-box";
      el.style.maxWidth = `${Math.max(0, W - 16)}px`;
      el.style.maxHeight = `${Math.max(0, H - 16)}px`;
      el.style.overflow = "auto";
    }
  }

  private renderExtras(st: HudState): void {
    const line = [st.castText, st.formText, st.stillpointText].filter((t) => t !== undefined && t !== "").join("   ");
    this.info.style.display = line ? "block" : "none";
    this.info.textContent = line;
    this.objectiveEl.style.display = st.objective ? "block" : "none";
    this.objectiveEl.textContent = st.objective ?? "";
    this.badge.style.display = st.blocked ? "block" : "none";
    this.toast.style.display = st.rejection ? "block" : "none";
    this.toast.textContent = st.rejection ?? "";
    const d = st.respawn;
    this.death.style.display = d ? "flex" : "none";
    this.renderKo(d ?? null);
    const rows = st.scoreboard;
    this.board.style.display = rows ? "block" : "none";
    this.renderBoard(rows ?? null);
    const km = st.kitMenu;
    const key = km ? `${km.current}|${km.pending}|${km.kits.map((k) => k.id).join(",")}` : "";
    if (key !== this.kitKey) {
      this.kitKey = key;
      this.kitPanel.replaceChildren();
      if (km) {
        const h = this.doc.createElement("div");
        h.textContent = km.pending ? `Next life: ${km.pending}` : "Choose your fighter";
        this.kitPanel.append(h);
        for (const k of km.kits) {
          const b = this.doc.createElement("button");
          b.dataset["kit"] = k.id;
          b.textContent = k.id === km.current ? `${k.label} (current)` : k.label;
          b.style.cssText = "display:block;margin:8px auto;min-width:200px;min-height:44px;font:600 15px Inter,system-ui,sans-serif";
          this.kitPanel.append(b);
        }
        const n = this.doc.createElement("div");
        n.textContent = "Changes apply at your next respawn, or after 8 quiet seconds.";
        n.style.cssText = "font-size:11px;opacity:.8";
        this.kitPanel.append(n);
      }
    }
    this.kitPanel.style.display = km ? "block" : "none";
    this.menuPanel.style.display = st.menuOpen ? "block" : "none";
    this.backdrop.style.display = st.menuOpen || km ? "block" : "none";
  }

  /** KO card: rebuilt only when its content changes; the ring is updated in place. */
  private renderKo(d: NonNullable<HudState["respawn"]> | null): void {
    const sec = d ? Math.max(1, d.seconds) : 0;
    const key = d ? `${d.fell ? "fell" : "by"}|${d.by}|${d.byKit}|${d.byHpFrac === null ? "-" : Math.round(d.byHpFrac * 100)}|${sec}` : "";
    if (key !== this.koKey) {
      this.koKey = key;
      this.koRing = null;
      this.death.replaceChildren();
      if (d) {
        const mk = (tag: string, text = "", css = ""): HTMLElement => { const e = this.doc.createElement(tag); e.textContent = text; if (css) e.style.cssText = css; return e; };
        const card = mk("div", "", "display:flex;flex-direction:column;align-items:center;gap:10px;padding:22px 32px;border-radius:18px;background:#102521f5;border:1px solid #ffffff30");
        card.append(mk("div", "Knocked out", "font-size:28px;font-weight:700"), mk("div", d.fell ? "Fell from the arena" : d.byKit ? `by ${d.by} \u00b7 ${d.byKit}` : `by ${d.by}`, "font-size:16px"));
        if (d.byHpFrac !== null) {
          const pct = Math.round(Math.min(1, Math.max(0, d.byHpFrac)) * 100);
          const bar = mk("div", "", `width:64px;height:8px;border-radius:4px;background:linear-gradient(90deg,#3fae6a ${pct}%,#1d2b3a ${pct}%)`);
          bar.dataset["koBar"] = "1";
          card.append(bar, mk("div", `${pct} HP left`, "font-size:12px;opacity:.85"));
        }
        const ring = mk("div", String(sec), "width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700");
        ring.dataset["koRing"] = "1";
        this.koRing = ring;
        const btn = mk("button", "Change fighter", "min-width:200px;min-height:44px;pointer-events:auto;font:600 15px Inter,system-ui,sans-serif");
        btn.dataset["koKit"] = "1";
        card.append(ring, btn);
        this.death.append(card);
      }
    }
    if (d && this.koRing) {
      const deg = Math.round(Math.min(1, Math.max(0, d.frac)) * 360);
      this.koRing.style.background = `conic-gradient(#c7f38b ${deg}deg, #ffffff22 0)`;
    }
  }

  /** Real table; rebuilt only when row content changes. Row order comes from scoreboardRows. */
  private renderBoard(rows: readonly ScoreRow[] | null): void {
    const key = rows ? rows.map((r) => `${r.name}|${r.kills}|${r.deaths}|${r.assists}|${r.self ? 1 : 0}`).join(";") : "";
    if (key === this.boardKey) return;
    this.boardKey = key;
    this.board.replaceChildren();
    if (!rows) return;
    const cell = (tag: string, text: string, num: boolean): HTMLElement => {
      const c = this.doc.createElement(tag); c.textContent = text;
      c.style.cssText = num ? "text-align:right;font-variant-numeric:tabular-nums;padding:2px 8px" : "text-align:left;padding:2px 8px";
      return c;
    };
    const tr = (cells: HTMLElement[], cls = ""): HTMLElement => { const r = this.doc.createElement("tr"); r.className = cls; r.append(...cells); return r; };
    const table = this.doc.createElement("table");
    table.style.cssText = "border-collapse:collapse";
    const thead = this.doc.createElement("thead");
    thead.append(tr([cell("th", "Player", false), cell("th", "KO", true), cell("th", "Deaths", true), cell("th", "Assists", true)]));
    const tbody = this.doc.createElement("tbody");
    for (const r of rows) {
      const row = tr([cell("td", r.name, false), cell("td", String(r.kills), true), cell("td", String(r.deaths), true), cell("td", String(r.assists), true)], r.self ? "self" : "");
      if (r.self) row.style.cssText = "font-weight:700;box-shadow:inset 3px 0 0 #c7f38b";
      tbody.append(row);
    }
    table.append(thead, tbody);
    this.board.append(table);
  }

  /** Radial cooldown sweep plus a 400 ms pulse when the slot becomes ready (display only). */
  private ring(el: HTMLElement, i: number, st: HudState): void {
    const a = st.skillStates?.[i];
    const f = a ? (a.kind === "cooldown" ? a.fraction : 0) : st.cooldownFracs?.[i] ?? 0;
    const kind = a ? a.kind : f > 0 ? "cooldown" : "ready";
    const key = st.skillKeys?.[i] ?? "";
    el.style.backgroundImage = f > 0 ? `conic-gradient(#0009 ${f * 360}deg, transparent 0)` : "";
    // Pulse only when a cooldown on the same equipped move ends; never on form/kit/life switches or Used transitions.
    if (this.prevKinds[i] === "cooldown" && kind === "ready" && this.prevKeys[i] === key && st.reducedMotion !== true) {
      el.classList.add("eb-ready-pulse");
      const t = setTimeout(() => { this.pulseTimers.delete(t); el.classList.remove("eb-ready-pulse"); }, 400);
      this.pulseTimers.add(t);
    }
    this.prevFracs[i] = f; this.prevKinds[i] = kind; this.prevKeys[i] = key;
  }

  /** Control opacity from the layout editor (0.35 to 0.90); display only. */
  setOpacity(o: number): void { this.opacity = Number.isFinite(o) ? Math.min(1, Math.max(0.2, o)) : 1; }

  /**
   * GR11 text budget for skill/dash buttons: slot number top-left, name <= 2 lines (11/12 px, 10/11 px under 64 px wide),
   * one state line (13/14 px, 11/12 px under 64 px wide). The DOM is rebuilt only when the equipped move changes;
   * state text, border and ring update in place every tick.
   */
  private paintStateButton(el: HTMLElement, b: HudBox): void {
    const wide = b.width >= 64;
    const structure = `${b.slot ?? 0}|${b.name ?? b.label}|${wide ? 1 : 0}`;
    if (el.dataset["structure"] !== structure) {
      el.dataset["structure"] = structure;
      const mk = (css: string, text: string, role: string): HTMLElement => { const e = this.doc.createElement("span"); e.dataset["part"] = role; e.style.cssText = css; e.textContent = text; return e; };
      const nameCss = `display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;text-align:left;font-size:${wide ? 11 : 10}px;line-height:${wide ? 12 : 11}px;max-height:${wide ? 24 : 22}px;text-indent:${b.slot ? 10 : 0}px;font-weight:600`;
      const stateCss = `display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;font-size:${wide ? 13 : 11}px;line-height:${wide ? 14 : 12}px;max-height:${wide ? 14 : 12}px;font-weight:700`;
      const kids: HTMLElement[] = [];
      if (b.slot) kids.push(mk(`position:absolute;left:3px;top:2px;font-size:10px;line-height:11px;opacity:.85`, String(b.slot), "slot"));
      kids.push(mk(nameCss, b.name ?? b.label, "name"), mk(stateCss, "", "state"));
      el.replaceChildren(...kids);
      this.stateEls.set(el, kids[kids.length - 1]!);
      Object.assign(el.style, { flexDirection: "column", justifyContent: "center", alignItems: "stretch", whiteSpace: "normal", overflow: "hidden", padding: "3px", gap: "0px" });
      el.style.position = "absolute";
    }
    const state = this.stateEls.get(el);
    const t = b.ready ? "Ready" : b.sub ?? "";
    if (state && state.textContent !== t) state.textContent = t;
    if (el.dataset["state"] !== b.sub) el.dataset["state"] = b.sub ?? "";
    el.style.borderStyle = b.ready ? "solid" : "dashed";
    el.style.borderWidth = b.ready ? "3px" : "2px";
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
      el.style.zIndex = String(LAYER.hud);
      if (b.sub !== undefined) this.paintStateButton(el, b);
      else {
        const t = b.id === "health" ? `${b.label} ${m.hpText}` : b.label;
        if (el.dataset["structure"] !== undefined) { delete el.dataset["structure"]; this.stateEls.delete(el); el.textContent = ""; }
        if (el.textContent !== t) el.textContent = t;
      }
      if (el.dataset["a11y"] !== "1") { el.dataset["a11y"] = "1"; el.setAttribute("role", b.id === "health" ? "img" : "button"); }
      const aria = b.sub !== undefined ? `${b.name ?? b.label}, ${b.slot ? "slot " + b.slot + ", " : ""}${b.ready ? "Ready" : b.sub}${b.hint ? ", " + b.hint : ""}` : (b.id === "health" ? `${b.label} ${m.hpText}` : b.label);
      if (el.getAttribute("aria-label") !== aria) el.setAttribute("aria-label", aria);
      if (b.id === "block") {
        el.style.background = st.blocked ? "#e8b84acc" : "#1d2b3acc";
        el.style.borderColor = st.blocked ? "#fff" : "#9fd3ff88";
      }
      const o = (layout as { opacity?: number }).opacity ?? this.opacity;
      el.style.opacity = String(o);
      if (b.id.startsWith("skill")) el.style.opacity = String(b.ready === true || b.label.length === 1 ? o : o * 0.6);
      if (b.id.startsWith("skill")) this.ring(el, Number(b.id.slice(5)) - 1, st);
      if (b.id === "facing") el.style.background = st.facingLock ? "#3a7bd5cc" : "#1d2b3acc";
      if (b.id === "awaken") { el.style.opacity = String(m.awakenReady ? o : o * 0.65); el.style.setProperty?.("--fill", `${Math.max(0, Math.min(100, m.meterPct))}%`); el.style.setProperty?.("--fill2", `${m.meter2Pct}%`); el.dataset["ready"] = m.awakenReady ? "1" : "0"; el.dataset["beast"] = m.beastReady ? "1" : m.meter2Pct > 0 ? "saving" : "0"; }
      if (b.id === "health") this.fill(el, st.maxHp > 0 ? st.hp / st.maxHp : 0);
    }
    this.placeExtras(layout);
    this.renderExtras(st);
    this.panel.style.display = m.panel ? "flex" : "none";
    this.panel.textContent = m.panel === "rotate" ? "Turn your device sideways" : m.panel === "enlarge" ? "Enlarge the window to play" : "";
    return m;
  }

  dispose(): void {
    this.kitPanel.removeEventListener("click", this.kitListener);
    this.menuPanel.removeEventListener("click", this.menuListener);
    this.death.removeEventListener("click", this.koListener);
    for (const t of this.pulseTimers) clearTimeout(t);
    this.pulseTimers.clear();
    this.root.remove();
    this.els.clear();
  }
}
