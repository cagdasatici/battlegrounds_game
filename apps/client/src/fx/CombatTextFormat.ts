/**
 * Pure combat text rules (FX2, decision 0025): what text an event produces, its colour and life, and the settings
 * filter. No DOM, no Three.js. Presentation only: nothing here feeds the simulation.
 */
import type { CombatEvent, KitId } from "@eb/shared/protocol";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import { FIGHTER_DESIGNS } from "@eb/shared/fighterDesign";

export type CombatTextMode = "all" | "mine" | "off";
export interface TextSettings { damageNumbers: boolean; combatText: CombatTextMode; reducedMotion: boolean }

/** Reads the fields this module needs from an untyped settings value, falling back to defaults. */
export function textSettingsOf(x: unknown): TextSettings {
  const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
  const m = o["combatText"];
  return {
    damageNumbers: typeof o["damageNumbers"] === "boolean" ? o["damageNumbers"] : true,
    combatText: m === "mine" || m === "off" || m === "all" ? m : "all",
    reducedMotion: o["reducedMotion"] === true,
  };
}

const LABELS: ReadonlyMap<string, string> = new Map([...SV_DEFS, ...TD_DEFS, ...EA_DEFS].map((d) => [d.id, d.label]));
/** Shipped label for an ability id, or undefined for ids that are not abilities (m1 steps, dash). */
export const abilityLabel = (moveId: string | undefined): string | undefined => (moveId === undefined ? undefined : LABELS.get(moveId));
export const allAbilityIds = (): string[] => [...LABELS.keys()];

export function kitOfMove(moveId: string | undefined): KitId | undefined {
  const k = moveId?.split(".", 1)[0];
  return k === "sv" || k === "td" || k === "ea" ? k : undefined;
}
/** Kit accent colour as a CSS hex string. */
export function accentCss(kit: KitId | undefined): string {
  if (!kit) return "#5a6b7d";
  return "#" + FIGHTER_DESIGNS[kit].palette.accent.toString(16).padStart(6, "0");
}

/** damage100 / 100, with one decimal only when fractional. */
export function formatNumber(v100: number): string {
  const v = Math.round(v100) / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export type TextKind = "hit" | "heal" | "block" | "counter" | "cast" | "castSelf" | "ko" | "capture" | "release";
export interface TextSpec {
  kind: TextKind;
  text: string;
  /** CSS colour of the text (or the pill background for cast). */
  color: string;
  bold: boolean;
  /** Font size multiplier. */
  scale: number;
  lifeMs: number;
  /** Entity the text floats above; undefined for screen anchored text and the KO feed. */
  anchorId: string | undefined;
  rise: boolean;
  pill: boolean;
}

/** `"mine"` keeps only events where the local player is the actor or the target. */
export function passesFilter(e: CombatEvent, mode: CombatTextMode, localId: string | undefined): boolean {
  if (mode === "off") return false;
  if (mode === "all") return true;
  return localId !== undefined && (e.actorId === localId || e.targetId === localId);
}

/** Texts one event produces (zero, one or two). `nameOf` resolves display names for the KO feed. */
export function textsFor(e: CombatEvent, s: TextSettings, localId: string | undefined, nameOf: (id: string) => string): TextSpec[] {
  if (!passesFilter(e, s.combatText, localId)) return [];
  const base = { bold: false, scale: 1, anchorId: undefined, rise: !s.reducedMotion, pill: false } as const;
  switch (e.kind) {
    case "hit": {
      if (!s.damageNumbers || e.damage100 === undefined || e.targetId === undefined) return [];
      const heavy = e.hitClass === "heavy";
      return [{ ...base, kind: "hit", text: "-" + formatNumber(e.damage100), color: "#ff4d4d", bold: heavy, scale: heavy ? 1.4 : 1, lifeMs: 900, anchorId: e.targetId }];
    }
    case "heal": {
      if (!s.damageNumbers || e.damage100 === undefined) return [];
      return [{ ...base, kind: "heal", text: "+" + formatNumber(e.damage100), color: "#4dff88", lifeMs: 900, anchorId: e.targetId ?? e.actorId }];
    }
    case "block":
      return e.targetId === undefined ? [] : [{ ...base, kind: "block", text: "BLOCK", color: "#9fd8ff", lifeMs: 700, anchorId: e.targetId }];
    case "counter":
      // The counterer is the actor of a counter event.
      return [{ ...base, kind: "counter", text: "COUNTER!", color: "#ffcc33", bold: true, lifeMs: 1000, anchorId: e.actorId }];
    // QV09: seizure and release read as short tags over the held fighter, so a capture is not mistaken for a miss.
    case "capture":
      return e.targetId === undefined ? [] : [{ ...base, kind: "capture", text: "CAUGHT", color: "#bfe8ff", lifeMs: 700, anchorId: e.targetId }];
    case "release":
      return e.targetId === undefined ? [] : [{ ...base, kind: "release", text: "FREE", color: "#e8f4ff", lifeMs: 600, anchorId: e.targetId }];
    case "cast": {
      const label = abilityLabel(e.moveId);
      if (label === undefined) return [];
      const color = accentCss(kitOfMove(e.moveId));
      const out: TextSpec[] = [{ ...base, kind: "cast", text: label, color, pill: true, lifeMs: 1200, anchorId: e.actorId }];
      if (localId !== undefined && e.actorId === localId) out.push({ ...base, kind: "castSelf", text: label, color, pill: true, rise: false, lifeMs: 1200, anchorId: undefined });
      return out;
    }
    case "ko": {
      const victim = e.targetId ?? e.actorId;
      const label = abilityLabel(e.moveId);
      const head = e.actorId === victim ? `${nameOf(victim)} fell` : `${nameOf(e.actorId)} KO'd ${nameOf(victim)}`;
      return [{ ...base, kind: "ko", text: label ? `${head} · ${label}` : head, color: "#ffffff", pill: true, rise: false, lifeMs: 4000 }];
    }
    default:
      return [];
  }
}

/** QI01: a screen-space box for one floating tag (centre x, bottom y, size in px). */
export interface TagBox { x: number; y: number; w: number; h: number }
/**
 * Simultaneous tags (three casters in one moment) would sit on top of each other. Returns a vertical offset in px per
 * input box (<= 0, moving up) so overlapping boxes stack with `gap` px between them. Lower tags (larger y) stay put,
 * higher ones are pushed up; order of the input is preserved in the output.
 */
export function separateTags(boxes: readonly TagBox[], gap = 4): number[] {
  const out = boxes.map(() => 0);
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b]!.y - boxes[a]!.y); // bottom-most first
  const placed: number[] = [];
  for (const i of order) {
    const b = boxes[i]!;
    let moved = true;
    while (moved) {
      moved = false;
      for (const j of placed) {
        const o = boxes[j]!;
        const ay = b.y + out[i]!, by = o.y + out[j]!;
        const sameCol = Math.abs(b.x - o.x) < (b.w + o.w) / 2;
        if (sameCol && ay > by - o.h - gap && by > ay - b.h - gap) { out[i] = by - o.h - gap - b.y; moved = true; }
      }
    }
    placed.push(i);
  }
  return out;
}
