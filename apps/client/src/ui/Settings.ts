/**
 * Settings panel and touch layout editor (T27, spec sections 6, 7 and 9). Display and local preference only: nothing
 * here reaches the server. Delegated listeners are removed in dispose(); open() releases held inputs through the
 * injected callback. Original text and styling.
 */
import { computeLayout, type ControlId, type SafeRect } from "../input/ControlLayout.js";
import {
  currentEdit, editControl, resetControl, resolveLayout, viewportClass,
} from "../input/LayoutEdit.js";
import {
  EDITABLE_CONTROLS, MAX_SETTINGS_BYTES, RANGES, defaultProfile, exportSettings, type Settings, type SettingsStore,
} from "../app/SettingsStore.js";

export interface SettingsHooks {
  /** Safe rectangle of the viewport right now (visualViewport plus env insets). */
  safeRect(): SafeRect;
  /** Called on open so the caller can release every held input and send neutral intent. */
  onOpen?(): void;
  onClose?(): void;
  /** True while a match is running: shows the "arena continues" note. */
  inMatch?(): boolean;
}

const SLIDERS: readonly { k: "sensitivity" | "cameraDistance" | "effectsVolume" | "musicVolume" | "flashLevel"; label: string; step: number }[] = [
  { k: "sensitivity", label: "Camera speed", step: 0.05 },
  { k: "cameraDistance", label: "Camera distance (m)", step: 0.1 },
  { k: "effectsVolume", label: "Effects volume", step: 0.05 },
  { k: "musicVolume", label: "Music volume", step: 0.05 },
  { k: "flashLevel", label: "Flash level", step: 0.05 },
];
const TOGGLES: readonly { k: "facingLock" | "quickUse" | "autoRun" | "reducedMotion"; label: string }[] = [
  { k: "facingLock", label: "Camera facing lock" },
  { k: "quickUse", label: "Quick Use" },
  { k: "autoRun", label: "Auto run" },
  { k: "reducedMotion", label: "Reduced motion" },
];

const BTN = "min-width:120px;min-height:44px;font:600 15px system-ui;border-radius:10px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff";

export class SettingsPanel {
  private readonly root: HTMLElement;
  private readonly editor: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly note: HTMLElement;
  private readonly io: HTMLTextAreaElement;
  private readonly unsub: () => void;
  private isOpen = false;
  private editing = false;
  private selected: ControlId | null = null;
  private drag: { id: ControlId; pid: number; sx: number; sy: number; cx: number; cy: number; el: HTMLElement } | null = null;
  private readonly onClick: (e: Event) => void;
  /** Keys typed into the panel must not drive the fighter (keyboard router listens on window). */
  private readonly onKey: (e: Event) => void = (e) => { if (this.isOpen) e.stopPropagation(); };
  private readonly onInput: (e: Event) => void;
  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onUp: (e: PointerEvent) => void;
  private readonly onCancel: (e: PointerEvent) => void;

  constructor(parent: HTMLElement, private readonly store: SettingsStore, private readonly hooks: SettingsHooks, private readonly doc: Document = document) {
    this.root = doc.createElement("div");
    this.root.dataset["ui"] = "settings";
    this.root.style.cssText = "position:fixed;inset:0;display:none;z-index:50;overflow:auto;background:#0b1118f5;color:#fff;font:15px system-ui;padding:16px;box-sizing:border-box";
    this.editor = doc.createElement("div");
    this.editor.dataset["ui"] = "layout-editor";
    this.editor.style.cssText = "position:fixed;inset:0;display:none;z-index:60;background:#0b1118f0;color:#fff;font:14px system-ui;touch-action:none;user-select:none";
    this.msg = doc.createElement("div");
    this.msg.dataset["ui"] = "settings-message";
    this.msg.setAttribute("role", "status");
    this.note = doc.createElement("p");
    this.io = doc.createElement("textarea");
    this.io.dataset["ui"] = "settings-json";
    this.io.rows = 4;
    this.io.style.cssText = "width:100%;box-sizing:border-box;font:12px monospace";
    this.build();
    parent.append(this.root, this.editor);

    this.onClick = (e: Event): void => this.click(e);
    this.onInput = (e: Event): void => this.input(e);
    this.onDown = (e: PointerEvent): void => this.down(e);
    this.onMove = (e: PointerEvent): void => this.move(e);
    this.onUp = (e: PointerEvent): void => this.up(e, false);
    this.onCancel = (e: PointerEvent): void => this.up(e, true);
    this.root.addEventListener("click", this.onClick);
    this.root.addEventListener("input", this.onInput);
    this.root.addEventListener("keydown", this.onKey);
    this.root.addEventListener("keyup", this.onKey);
    this.editor.addEventListener("click", this.onClick);
    this.editor.addEventListener("input", this.onInput);
    this.editor.addEventListener("pointerdown", this.onDown);
    this.editor.addEventListener("pointermove", this.onMove);
    this.editor.addEventListener("pointerup", this.onUp);
    this.editor.addEventListener("pointercancel", this.onCancel);
    this.unsub = store.subscribe(() => { this.sync(); if (this.editing) this.renderEditor(); });
    this.sync();
  }

  get isVisible(): boolean { return this.isOpen; }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.hooks.onOpen?.();
    this.note.style.display = this.hooks.inMatch?.() ? "block" : "none";
    this.root.style.display = "block";
    this.sync();
  }

  close(): void {
    if (!this.isOpen) return;
    this.endEdit();
    this.isOpen = false;
    this.root.style.display = "none";
    // A hidden element must not keep focus, or later keys would be delivered to it instead of the game.
    const f = this.doc.activeElement as HTMLElement | null;
    if (f && (this.root.contains(f) || this.editor.contains(f))) f.blur();
    this.hooks.onClose?.();
  }

  dispose(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.removeEventListener("input", this.onInput);
    this.root.removeEventListener("keydown", this.onKey);
    this.root.removeEventListener("keyup", this.onKey);
    this.editor.removeEventListener("click", this.onClick);
    this.editor.removeEventListener("input", this.onInput);
    this.editor.removeEventListener("pointerdown", this.onDown);
    this.editor.removeEventListener("pointermove", this.onMove);
    this.editor.removeEventListener("pointerup", this.onUp);
    this.editor.removeEventListener("pointercancel", this.onCancel);
    this.unsub();
    this.drag = null;
    this.root.remove();
    this.editor.remove();
    this.isOpen = false;
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", attrs: Record<string, string> = {}, parent: HTMLElement = this.root): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    if (text) e.textContent = text;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (tag === "button") e.style.cssText = BTN;
    parent.append(e);
    return e;
  }

  private build(): void {
    this.el("h2", "Settings");
    this.note.textContent = "The arena continues while this menu is open.";
    this.root.append(this.note);
    for (const s of SLIDERS) {
      const [lo, hi] = RANGES[s.k];
      const row = this.el("label", s.label);
      row.style.cssText = "display:flex;align-items:center;gap:12px;min-height:44px;justify-content:space-between";
      const r = this.el("input", "", { type: "range", min: String(lo), max: String(hi), step: String(s.step), "data-k": s.k, "aria-label": s.label }, row);
      r.style.cssText = "width:50%;min-height:44px";
    }
    for (const t of TOGGLES) {
      const b = this.el("button", t.label, { "data-toggle": t.k, "aria-pressed": "false" });
      b.style.display = "block"; b.style.margin = "6px 0"; b.style.width = "100%";
    }
    const hand = this.el("button", "Left hand layout", { "data-toggle": "hand", "aria-pressed": "false" });
    hand.style.display = "block"; hand.style.margin = "6px 0"; hand.style.width = "100%";
    const q = this.el("div", "Graphics quality ");
    for (const v of ["low", "medium", "high"]) { const b = this.el("button", v, { "data-quality": v, "aria-pressed": "false" }, q); b.style.minWidth = "80px"; b.style.margin = "0 4px"; }
    const act = this.el("div");
    act.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin:12px 0";
    this.el("button", "Edit touch layout", { "data-act": "edit" }, act);
    this.el("button", "Reset all settings", { "data-act": "reset-all" }, act);
    this.el("button", "Close", { "data-act": "close" }, act);
    this.el("h3", "Export or import");
    this.root.append(this.io);
    const ioa = this.el("div");
    ioa.style.cssText = "display:flex;gap:8px;margin:8px 0";
    this.el("button", "Export", { "data-act": "export" }, ioa);
    this.el("button", "Import", { "data-act": "import" }, ioa);
    this.root.append(this.msg);
  }

  /** Writes current values into the controls. */
  private sync(): void {
    const s = this.store.get();
    for (const r of this.root.querySelectorAll<HTMLInputElement>("input[data-k]")) r.value = String(s[r.dataset["k"] as (typeof SLIDERS)[number]["k"]]);
    for (const b of this.root.querySelectorAll<HTMLElement>("button[data-toggle]")) {
      const k = b.dataset["toggle"]!;
      b.setAttribute("aria-pressed", String(k === "hand" ? s.handedness === "left" : s[k as (typeof TOGGLES)[number]["k"]]));
    }
    for (const b of this.root.querySelectorAll<HTMLElement>("button[data-quality]")) b.setAttribute("aria-pressed", String(b.dataset["quality"] === s.quality));
  }

  private say(text: string): void { this.msg.textContent = text; }

  private input(e: Event): void {
    const t = e.target as HTMLInputElement | null;
    const k = t?.dataset?.["k"];
    if (t && k) {
      if (!this.store.update({ [k]: Number(t.value) } as Partial<Settings>)) this.say("That value is out of range.");
      return;
    }
    const sel = t?.dataset?.["edit"];
    if (t && sel && this.selected) {
      const s = this.store.get();
      const cls = viewportClass(this.hooks.safeRect().W);
      const profile = s.layouts[cls];
      if (sel === "opacity") { this.store.setProfile(cls, { ...profile, opacity: Number(t.value) }); return; }
      const base = computeLayout(this.hooks.safeRect());
      const cur = currentEdit(base, profile, s.handedness, this.selected);
      const r = editControl(base, profile, s.handedness, this.selected, { ...cur, size: Number(t.value) });
      if (r.ok) { this.store.setProfile(cls, r.profile); this.say(""); } else { this.say("That size would overlap another button or leave the screen."); this.renderEditor(); }
    }
  }

  private click(e: Event): void {
    const b = (e.target as HTMLElement | null)?.closest?.("button") as HTMLElement | null;
    if (!b) return;
    const s = this.store.get();
    const tg = b.dataset["toggle"];
    if (tg === "hand") { this.store.update({ handedness: s.handedness === "left" ? "right" : "left" }); return; }
    if (tg) { this.store.update({ [tg]: !s[tg as (typeof TOGGLES)[number]["k"]] } as Partial<Settings>); return; }
    if (b.dataset["quality"]) { this.store.update({ quality: b.dataset["quality"] as Settings["quality"] }); return; }
    switch (b.dataset["act"]) {
      case "close": this.close(); break;
      case "edit": this.beginEdit(); break;
      case "edit-done": this.endEdit(); break;
      case "reset-all": this.store.reset(); this.say("Settings reset to defaults."); break;
      case "reset-layout": {
        const cls = viewportClass(this.hooks.safeRect().W);
        this.store.setProfile(cls, defaultProfile());
        this.selected = null; this.say("Layout reset."); break;
      }
      case "reset-control": {
        if (!this.selected) break;
        const cls = viewportClass(this.hooks.safeRect().W);
        this.store.setProfile(cls, resetControl(s.layouts[cls], this.selected));
        break;
      }
      case "export": this.io.value = exportSettings(s); this.say("Settings exported below."); break;
      case "import": {
        if (new TextEncoder().encode(this.io.value).length > MAX_SETTINGS_BYTES) { this.say("That text is too long (8 KB limit)."); break; }
        const r = this.store.import(this.io.value);
        this.say(r.ok ? "Settings imported." : r.reason === "too_large" ? "That text is too long (8 KB limit)." : r.reason === "not_json" ? "That is not settings text." : "Those settings are not valid.");
        break;
      }
      default: break;
    }
  }

  // ----- layout editor -----

  private beginEdit(): void {
    this.editing = true;
    this.selected = null;
    this.root.style.display = "none";
    this.editor.style.display = "block";
    this.renderEditor();
  }

  private endEdit(): void {
    if (!this.editing) return;
    this.editing = false;
    this.drag = null;
    this.editor.style.display = "none";
    this.editor.replaceChildren();
    this.msg.style.cssText = "";
    this.root.append(this.msg);
    if (this.isOpen) this.root.style.display = "block";
  }

  private renderEditor(): void {
    const safe = this.hooks.safeRect();
    const s = this.store.get();
    const cls = viewportClass(safe.W);
    const base = computeLayout(safe);
    const { layout, fellBack } = resolveLayout(base, s.layouts[cls], s.handedness);
    this.editor.replaceChildren();
    for (const id of EDITABLE_CONTROLS) {
      const c = layout.controls[id];
      const b = this.el("div", id.startsWith("skill") ? id.slice(5) : id, { "data-edit-control": id }, this.editor);
      b.style.cssText = `position:absolute;left:${c.cx - c.hw / 2}px;top:${c.cy - c.hh / 2}px;width:${c.hw}px;height:${c.hh}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;border-radius:${c.shape === "circle" ? "50%" : "10px"};background:#1d2b3a;opacity:${layout.opacity};border:3px solid ${id === this.selected ? "#ffd479" : "#9fd3ff"};cursor:grab`;
    }
    const bar = this.el("div", "", { "data-ui": "editor-bar" }, this.editor);
    bar.style.cssText = `position:absolute;left:50%;top:${safe.y0 + 8}px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;background:#000a;padding:8px 12px;border-radius:12px;max-width:90%`;
    this.el("span", fellBack ? "Saved layout did not fit; showing defaults." : `Drag a button (${cls} layout).`, {}, bar);
    const size = this.el("input", "", { type: "range", min: String(RANGES.size[0]), max: String(RANGES.size[1]), step: "0.01", "data-edit": "size", "aria-label": "Button size" }, bar);
    size.disabled = this.selected === null;
    if (this.selected) size.value = String(currentEdit(base, s.layouts[cls], s.handedness, this.selected).size);
    else size.value = "1";
    this.el("input", "", { type: "range", min: String(RANGES.opacity[0]), max: String(RANGES.opacity[1]), step: "0.01", "data-edit": "opacity", "aria-label": "Button opacity", value: String(s.layouts[cls].opacity) }, bar);
    this.el("button", "Reset button", { "data-act": "reset-control" }, bar);
    this.el("button", "Reset layout", { "data-act": "reset-layout" }, bar);
    this.el("button", "Done", { "data-act": "edit-done" }, bar);
    this.editor.append(this.msg);
    this.msg.style.cssText = `position:absolute;left:50%;top:${safe.y0 + 70}px;transform:translateX(-50%);color:#ffd479`;
  }

  private down(e: PointerEvent): void {
    const el = (e.target as HTMLElement | null)?.closest?.("[data-edit-control]") as HTMLElement | null;
    if (!el || this.drag) return;
    const id = el.dataset["editControl"] as ControlId;
    const r = el.getBoundingClientRect();
    this.selected = id;
    this.drag = { id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, cx: r.left + r.width / 2, cy: r.top + r.height / 2, el };
    try { this.editor.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
    el.style.borderColor = "#ffd479";
    this.say("");
  }

  private target(e: PointerEvent): { nx: number; ny: number } | null {
    const d = this.drag;
    if (!d) return null;
    const { x0, y0, W, H } = this.hooks.safeRect();
    const cx = d.cx + (e.clientX - d.sx), cy = d.cy + (e.clientY - d.sy);
    return { nx: Math.min(1, Math.max(0, (cx - x0) / W)), ny: Math.min(1, Math.max(0, (cy - y0) / H)) };
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pid) return;
    const t = this.target(e);
    if (!t) return;
    const { x0, y0, W, H } = this.hooks.safeRect();
    const w = d.el.offsetWidth, h = d.el.offsetHeight;
    d.el.style.left = `${x0 + t.nx * W - w / 2}px`;
    d.el.style.top = `${y0 + t.ny * H - h / 2}px`;
    const s = this.store.get();
    const cls = viewportClass(W);
    const base = computeLayout(this.hooks.safeRect());
    const cur = currentEdit(base, s.layouts[cls], s.handedness, d.id);
    d.el.style.borderColor = editControl(base, s.layouts[cls], s.handedness, d.id, { ...cur, ...t }).ok ? "#ffd479" : "#ff6b6b";
  }

  private up(e: PointerEvent, cancelled: boolean): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pid) return;
    const t = cancelled ? null : this.target(e);
    this.drag = null;
    try { this.editor.releasePointerCapture?.(e.pointerId); } catch { /* already released */ }
    if (t) {
      const s = this.store.get();
      const cls = viewportClass(this.hooks.safeRect().W);
      const base = computeLayout(this.hooks.safeRect());
      const cur = currentEdit(base, s.layouts[cls], s.handedness, d.id);
      const r = editControl(base, s.layouts[cls], s.handedness, d.id, { ...cur, ...t });
      if (r.ok) { this.store.setProfile(cls, r.profile); this.say(""); return; }
      this.say("That spot overlaps another button or leaves the screen. The button went back.");
    }
    this.renderEditor();
  }
}
