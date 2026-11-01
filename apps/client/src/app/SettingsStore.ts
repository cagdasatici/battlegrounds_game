/**
 * Local settings (T27, spec sections 7 and 9). Pure module: no DOM, storage is injected. Schema version 1, strict
 * runtime validation (unknown keys, wrong types and out-of-range numbers are all rejected), 8 KB import cap.
 * Ranges not fixed by the spec are D (local design choices). Invitations are never stored here.
 */
import type { ControlId } from "../input/ControlLayout.js";

export const SETTINGS_VERSION = 1;
export const MAX_SETTINGS_BYTES = 8192;
export const STORAGE_PREFIX = "eb.settings.v1.";

/** Controls a player may move or resize. The health bar is display only and stays fixed. */
export const EDITABLE_CONTROLS: readonly ControlId[] = [
  "joystick", "attack", "jump", "dash", "block", "facing",
  "skill1", "skill2", "skill3", "skill4", "awaken", "menu", "fighter", "scoreboard",
];

export type ViewportClass = "wide" | "compact";
export type Handedness = "right" | "left";
export type Quality = "low" | "medium" | "high";

export interface ControlEdit { nx: number; ny: number; size: number }
export interface LayoutProfile { opacity: number; controls: Partial<Record<ControlId, ControlEdit>> }

export interface Settings {
  v: 1;
  /** Camera drag multiplier (D 0.5..2). */
  sensitivity: number;
  /** Camera distance in metres (spec section 9: 3.5..10). */
  cameraDistance: number;
  facingLock: boolean;
  quickUse: boolean;
  autoRun: boolean;
  handedness: Handedness;
  effectsVolume: number;
  musicVolume: number;
  quality: Quality;
  reducedMotion: boolean;
  /** Flash intensity 0..1 (spec default 0.3). */
  flashLevel: number;
  layouts: Record<ViewportClass, LayoutProfile>;
}

export const RANGES = {
  sensitivity: [0.5, 2], cameraDistance: [3.5, 10], effectsVolume: [0, 1], musicVolume: [0, 1], flashLevel: [0, 1],
  size: [0.85, 1.3], opacity: [0.35, 0.9], norm: [0, 1],
} as const satisfies Record<string, readonly [number, number]>;

export const defaultProfile = (): LayoutProfile => ({ opacity: 0.9, controls: {} });

export function defaultSettings(): Settings {
  return {
    v: 1, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: "right",
    effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: false, flashLevel: 0.3,
    layouts: { wide: defaultProfile(), compact: defaultProfile() },
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown, r: readonly [number, number]): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= r[0] && x <= r[1];
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));

function parseProfile(x: unknown): LayoutProfile | null {
  if (!isObj(x) || !onlyKeys(x, ["opacity", "controls"]) || !num(x["opacity"], RANGES.opacity) || !isObj(x["controls"])) return null;
  const controls: Partial<Record<ControlId, ControlEdit>> = {};
  for (const [id, e] of Object.entries(x["controls"])) {
    if (!(EDITABLE_CONTROLS as readonly string[]).includes(id)) return null;
    if (!isObj(e) || !onlyKeys(e, ["nx", "ny", "size"])) return null;
    if (!num(e["nx"], RANGES.norm) || !num(e["ny"], RANGES.norm) || !num(e["size"], RANGES.size)) return null;
    controls[id as ControlId] = { nx: e["nx"], ny: e["ny"], size: e["size"] };
  }
  return { opacity: x["opacity"], controls };
}

/** Strict parse of an already decoded value. Returns null when anything is unknown or out of range. */
export function parseSettings(x: unknown): Settings | null {
  if (!isObj(x)) return null;
  const keys = ["v", "sensitivity", "cameraDistance", "facingLock", "quickUse", "autoRun", "handedness", "effectsVolume",
    "musicVolume", "quality", "reducedMotion", "flashLevel", "layouts"];
  if (!onlyKeys(x, keys) || keys.some((k) => !(k in x))) return null;
  if (x["v"] !== SETTINGS_VERSION) return null;
  if (!num(x["sensitivity"], RANGES.sensitivity) || !num(x["cameraDistance"], RANGES.cameraDistance)) return null;
  if (!num(x["effectsVolume"], RANGES.effectsVolume) || !num(x["musicVolume"], RANGES.musicVolume) || !num(x["flashLevel"], RANGES.flashLevel)) return null;
  for (const k of ["facingLock", "quickUse", "autoRun", "reducedMotion"] as const) if (typeof x[k] !== "boolean") return null;
  if (x["handedness"] !== "right" && x["handedness"] !== "left") return null;
  if (x["quality"] !== "low" && x["quality"] !== "medium" && x["quality"] !== "high") return null;
  const l = x["layouts"];
  if (!isObj(l) || !onlyKeys(l, ["wide", "compact"])) return null;
  const wide = parseProfile(l["wide"]), compact = parseProfile(l["compact"]);
  if (!wide || !compact) return null;
  return {
    v: 1, sensitivity: x["sensitivity"], cameraDistance: x["cameraDistance"], facingLock: x["facingLock"] as boolean,
    quickUse: x["quickUse"] as boolean, autoRun: x["autoRun"] as boolean, handedness: x["handedness"],
    effectsVolume: x["effectsVolume"], musicVolume: x["musicVolume"], quality: x["quality"],
    reducedMotion: x["reducedMotion"] as boolean, flashLevel: x["flashLevel"], layouts: { wide, compact },
  };
}

export type ImportResult = { ok: true; settings: Settings } | { ok: false; reason: "too_large" | "not_json" | "invalid" };

/** Import/export text path: capped at 8 KB (bytes, not characters), JSON only, known keys only. */
export function parseSettingsText(text: string): ImportResult {
  if (new TextEncoder().encode(text).length > MAX_SETTINGS_BYTES) return { ok: false, reason: "too_large" };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: "not_json" }; }
  const s = parseSettings(raw);
  return s ? { ok: true, settings: s } : { ok: false, reason: "invalid" };
}

export const exportSettings = (s: Settings): string => JSON.stringify(s);

/** Profile labels are the local Arel/Nora style names; never an authentication identity. */
export const profileKey = (name: string): string => STORAGE_PREFIX + (/^[A-Za-z0-9 _-]{1,16}$/.test(name) ? name : "default");

export interface KeyValueStorage { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** Per-profile persistence. Corrupt, oversized, wrong version or throwing storage falls back to defaults. */
export class SettingsStore {
  private cur: Settings;
  private readonly subs = new Set<(s: Settings) => void>();
  private readonly key: string;

  constructor(private readonly storage: KeyValueStorage | null, profile: string) {
    this.key = profileKey(profile);
    this.cur = this.load();
  }

  private load(): Settings {
    try {
      const t = this.storage?.getItem(this.key);
      if (t) {
        const r = parseSettingsText(t);
        if (r.ok) return r.settings;
        try { this.storage?.removeItem(this.key); } catch { /* ignore */ }
      }
    } catch { /* storage unavailable */ }
    return defaultSettings();
  }

  get(): Settings { return this.cur; }

  /** Validates, persists and notifies. Returns false (and changes nothing) when the value is invalid. */
  set(next: Settings): boolean {
    const ok = parseSettings(next);
    if (!ok) return false;
    this.cur = ok;
    try { this.storage?.setItem(this.key, exportSettings(ok)); } catch { /* quota or private mode: stays in memory */ }
    for (const f of [...this.subs]) f(ok);
    return true;
  }

  update(patch: Partial<Omit<Settings, "v">>): boolean { return this.set({ ...this.cur, ...patch }); }

  /** Layout edits for one viewport class. */
  setProfile(cls: ViewportClass, profile: LayoutProfile): boolean {
    return this.set({ ...this.cur, layouts: { ...this.cur.layouts, [cls]: profile } });
  }

  reset(): void { this.set(defaultSettings()); }
  import(text: string): ImportResult { const r = parseSettingsText(text); if (r.ok) this.set(r.settings); return r; }

  subscribe(fn: (s: Settings) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}
