/**
 * Touch HUD: original, unbranded control visuals placed from ControlLayout. Display only;
 * all values shown (HP, meter) come from server snapshots supplied by the caller.
 */
import type { ControlId, Layout, SafeRect } from "../input/ControlLayout.js";
import { shortSkillLabel, skillStatus, type ScoreRow } from "./HudFormat.js";

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
  /** Four slot texts from cooldownEndTicks (empty string = ready). */
  cooldowns?: readonly string[];
  /** Four equipped short skill names for the current form. When given, skill buttons show name and readiness. */
  skills?: readonly string[];
  /** True for a short window after the server confirmed a block of the local player's guard. */
  blocked?: boolean;
  formText?: string;
  stillpointText?: string;
  rejection?: string | null;
  /** Death overlay: scorer name and whole seconds left. */
  respawn?: { by: string; seconds: number } | null;
  scoreboard?: readonly ScoreRow[] | null;
  /** Kit choice panel; null = closed. */
  /** Esc/Menu panel: the arena keeps running while it is open. */
  menuOpen?: boolean;
  kitMenu?: { kits: readonly { id: string; label: string }[]; current: string; pending: string } | null;
}

export interface HudBox { id: ControlId; left: number; top: number; width: number; height: number; round: boolean; label: string; sub?: string; ready?: boolean }
export interface HudModel { boxes: HudBox[]; panel: null | "rotate" | "enlarge"; hpText: string; meterPct: number; awakenReady: boolean; meterText: string }

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
    if (slot >= 0 && st.skills) {
      const s = skillStatus(st.cooldowns?.[slot] ?? "");
      box.label = `${slot + 1} ${shortSkillLabel(st.skills[slot] ?? "")}`.trim();
      box.sub = s.text; box.ready = s.ready;
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

  private readonly info: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly death: HTMLElement;
  private readonly board: HTMLElement;
  private readonly kitPanel: HTMLElement;
  private readonly menuPanel: HTMLElement;
  private kitKey = "";
  private opacity = 1;
  private readonly kitListener: (e: Event) => void;
  private readonly menuListener: (e: Event) => void;

  constructor(parent: HTMLElement, private readonly doc: Document = document, private readonly onKitPick: (kit: string) => void = () => undefined, private readonly onLeave: () => void = () => undefined, private readonly onSettings: () => void = () => undefined) {
    this.root = doc.createElement("div");
    this.root.className = "eb-hud";
    this.root.style.cssText = "position:fixed;inset:0;pointer-events:none;font:600 13px system-ui;color:#fff";
    this.panel = doc.createElement("div");
    this.panel.style.cssText = "position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:#000c;font-size:20px";
    this.root.appendChild(this.panel);
    const mk = (cls: string, css: string): HTMLElement => {
      const el = doc.createElement("div");
      el.dataset.hud = cls;
      el.style.cssText = `position:fixed;display:none;${css}`;
      this.root.appendChild(el);
      return el;
    };
    this.info = mk("info", "left:50%;top:8px;transform:translateX(-50%);text-shadow:0 1px 2px #000;white-space:pre");
    this.badge = mk("block-feedback", "left:50%;top:44%;transform:translateX(-50%);background:#e8b84af0;color:#111;padding:6px 18px;border-radius:14px;font-size:20px");
    this.badge.textContent = "Blocked!";
    this.toast = mk("rejection", "left:50%;top:56%;transform:translateX(-50%);background:#000a;padding:6px 14px;border-radius:14px");
    this.death = mk("respawn", "inset:0;align-items:center;justify-content:center;flex-direction:column;background:#300a;font-size:26px;text-align:center");
    this.board = mk("scoreboard", "right:12px;top:60px;background:#0b1118ee;border:2px solid #9fd3ff88;border-radius:10px;padding:8px 12px;min-width:220px");
    this.kitPanel = mk("kit", "left:50%;top:50%;transform:translate(-50%,-50%);background:#0b1118f2;border:2px solid #9fd3ff88;border-radius:12px;padding:12px 16px;pointer-events:auto;text-align:center");
    this.menuPanel = mk("menu", "left:50%;top:50%;transform:translate(-50%,-50%);background:#0b1118f2;border:2px solid #9fd3ff88;border-radius:12px;padding:12px 16px;pointer-events:auto;text-align:center");
    this.menuPanel.append(Object.assign(doc.createElement("div"), { textContent: "The arena continues while this menu is open." }));
    const leave = Object.assign(doc.createElement("button"), { textContent: "Leave" });
    leave.dataset["leave"] = "1";
    leave.style.cssText = "display:block;margin:10px auto;min-width:200px;min-height:44px;font:600 15px system-ui";
    const settings = Object.assign(doc.createElement("button"), { textContent: "Settings" });
    settings.dataset["settings"] = "1";
    settings.style.cssText = leave.style.cssText;
    this.menuPanel.append(settings, leave);
    this.menuListener = (e: Event): void => {
      const d = (e.target as HTMLElement | null)?.dataset;
      if (d?.["leave"]) this.onLeave();
      else if (d?.["settings"]) this.onSettings();
    };
    this.menuPanel.addEventListener("click", this.menuListener);
    this.kitListener = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-kit]") as HTMLElement | null;
      if (b?.dataset["kit"]) this.onKitPick(b.dataset["kit"]);
    };
    this.kitPanel.addEventListener("click", this.kitListener);
    parent.appendChild(this.root);
  }

  /** HP bar fill drawn as a gradient on the health box. */
  private fill(el: HTMLElement, frac: number): void {
    const pct = Math.round(Math.min(1, Math.max(0, frac)) * 100);
    el.style.background = `linear-gradient(90deg,#3fae6acc ${pct}%,#1d2b3acc ${pct}%)`;
  }

  private renderExtras(st: HudState): void {
    const line = [st.formText, st.stillpointText].filter((t) => t !== undefined && t !== "").join("   ");
    this.info.style.display = line ? "block" : "none";
    this.info.textContent = line;
    this.badge.style.display = st.blocked ? "block" : "none";
    this.toast.style.display = st.rejection ? "block" : "none";
    this.toast.textContent = st.rejection ?? "";
    const d = st.respawn;
    this.death.style.display = d ? "flex" : "none";
    this.death.textContent = d ? `Knocked out by ${d.by}\nRespawning in ${Math.max(1, d.seconds)}` : "";
    this.death.style.whiteSpace = "pre";
    const rows = st.scoreboard;
    this.board.style.display = rows ? "block" : "none";
    this.board.textContent = rows
      ? ["Player   KO  Deaths  Assists", ...rows.map((r) => `${r.self ? "> " : ""}${r.name}   ${r.kills}   ${r.deaths}   ${r.assists}`)].join("\n")
      : "";
    this.board.style.whiteSpace = "pre";
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
          b.style.cssText = "display:block;margin:8px auto;min-width:200px;min-height:44px;font:600 15px system-ui";
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
  }

  /** Control opacity from the layout editor (0.35 to 0.90); display only. */
  setOpacity(o: number): void { this.opacity = Number.isFinite(o) ? Math.min(1, Math.max(0.2, o)) : 1; }

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
      if (b.sub !== undefined) {
        el.replaceChildren(
          Object.assign(this.doc.createElement("span"), { textContent: b.label }),
          Object.assign(this.doc.createElement("span"), { textContent: b.ready ? "Ready" : b.sub }),
        );
        Object.assign(el.style, { flexDirection: "column", lineHeight: "1.15", fontSize: "10px", whiteSpace: "nowrap", textAlign: "center", overflow: "hidden" });
        el.style.borderStyle = b.ready ? "solid" : "dashed";
        el.style.borderWidth = b.ready ? "3px" : "2px";
      } else {
        el.textContent = b.id === "health" ? `${b.label} ${m.hpText}` : b.label;
      }
      if (b.id === "block") {
        el.style.background = st.blocked ? "#e8b84acc" : "#1d2b3acc";
        el.style.borderColor = st.blocked ? "#fff" : "#9fd3ff88";
      }
      const o = (layout as { opacity?: number }).opacity ?? this.opacity;
      el.style.opacity = String(o);
      if (b.id.startsWith("skill")) el.style.opacity = String(b.ready === true || b.label.length === 1 ? o : o * 0.6);
      if (b.id === "facing") el.style.background = st.facingLock ? "#3a7bd5cc" : "#1d2b3acc";
      if (b.id === "awaken") el.style.opacity = String(m.awakenReady ? o : o * 0.65);
      if (b.id === "health") this.fill(el, st.maxHp > 0 ? st.hp / st.maxHp : 0);
    }
    this.renderExtras(st);
    this.panel.style.display = m.panel ? "flex" : "none";
    this.panel.textContent = m.panel === "rotate" ? "Turn your iPad sideways" : m.panel === "enlarge" ? "Enlarge the window to play" : "";
    return m;
  }

  dispose(): void {
    this.kitPanel.removeEventListener("click", this.kitListener);
    this.menuPanel.removeEventListener("click", this.menuListener);
    this.root.remove();
    this.els.clear();
  }
}
