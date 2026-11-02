/**
 * Pure HUD text rules (spec sections 6, 9, 15, 22). No DOM; every input is a replicated server value or an
 * estimated server tick. Display only: the server settles every discrepancy.
 */
import { meterFraction } from "@eb/shared/awakening";
import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import { COMBAT } from "@eb/shared/config/combat";
import { TICK_RATE, type RejectReason } from "@eb/shared/protocol";

/** Remaining time: one decimal under 10 s (never shows 0.0 while locked), ceiling seconds from 10 s. Empty when ready. */
export function cooldownLabel(endTick: number, nowTick: number): string {
  const r = endTick - nowTick;
  if (r <= 0) return "";
  if (r >= 10 * TICK_RATE) return String(Math.ceil(r / TICK_RATE));
  const tenths = Math.min(99, Math.ceil(r / (TICK_RATE / 10)));
  return (tenths / 10).toFixed(1);
}

export function rejectionText(reason: RejectReason | undefined): string {
  switch (reason) {
    case "STATE": return "Recovering";
    case "COOLDOWN": return "Cooling down";
    case "METER": return "Need full meter";
    default: return "Cannot use now";
  }
}

export const REJECTION_MS = 700;

/** One rejection message at a time, shown for 0.7 s; further rejections during that window are dropped (rate limit). */
export class RejectionNotice {
  private text: string | null = null;
  private until = 0;
  push(reason: RejectReason | undefined, nowMs: number): void {
    if (this.text !== null && nowMs < this.until) return;
    this.text = rejectionText(reason);
    this.until = nowMs + REJECTION_MS;
  }
  current(nowMs: number): string | null {
    return this.text !== null && nowMs < this.until ? this.text : null;
  }
}

/** Whole seconds left of the respawn countdown (3, 2, 1, then 0 at the respawn tick). */
export function respawnSecondsLeft(koTick: number, nowTick: number, respawnTicks: number = COMBAT.respawnTicks): number {
  return Math.max(0, Math.ceil((koTick + respawnTicks - nowTick) / TICK_RATE));
}

export interface ScoreInput { entityId: number; displayName: string; kills: number; deaths: number; assists: number; local: boolean }
export interface ScoreRow { name: string; kills: number; deaths: number; assists: number; self: boolean }

export function scoreboardRows(players: readonly ScoreInput[]): ScoreRow[] {
  return [...players]
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.displayName.localeCompare(b.displayName) || a.entityId - b.entityId)
    .map((p) => ({ name: p.displayName, kills: p.kills, deaths: p.deaths, assists: p.assists, self: p.local }));
}

/** Meter as a threshold normalized fraction plus the integer percent, or "Ready" at full. */
export function meterLabel(kitId: string, meter100: number): { fraction: number; text: string } {
  const fraction = meterFraction(kitId, meter100);
  return { fraction, text: fraction >= 1 ? "Ready" : `${Math.floor(fraction * 100)}%` };
}

export function formTimerText(form: string, formEndTick: number, nowTick: number): string {
  if (form === "Base") return "";
  const t = cooldownLabel(formEndTick, nowTick);
  return t === "" ? "" : `${form} ${t}`;
}

/** Stillpoint Reversal remaining time; the field is owner-only, so only the owner ever sees it. */
export function stillpointText(remainingTicks: number): string {
  const t = cooldownLabel(remainingTicks, 0);
  return t === "" ? "" : `Stillpoint ${t}`;
}

/** Short on-button skill name: whole label up to 12 characters, else its first word (never empty). */
export function shortSkillLabel(label: string): string {
  const t = label.trim();
  return t.length <= 24 ? t : `${t.slice(0, 23)}…`;
}

/** Readiness text for a skill button: "Ready" or the cooldown label. Text and shape, never colour alone. */
export function skillStatus(cooldown: string): { ready: boolean; text: string } {
  return cooldown === "" ? { ready: true, text: "Ready" } : { ready: false, text: cooldown };
}

export const BLOCK_FEEDBACK_MS = 800;

/** Server-confirmed block feedback: shown only after a "block" combat event, for 0.8 s. Display only. */
export class BlockNotice {
  private until = 0;
  confirm(nowMs: number): void { this.until = nowMs + BLOCK_FEEDBACK_MS; }
  active(nowMs: number): boolean { return nowMs < this.until; }
}

const KIT_DEFS: Readonly<Record<string, typeof SV_DEFS>> = { sv: SV_DEFS, td: TD_DEFS, ea: EA_DEFS };

/** Equipped short skill names for slots 1 to 4 of a kit and form; unknown kit gives four empty names. */
export function equippedSkillNames(kitId: string, form: string): string[] {
  const defs = KIT_DEFS[kitId] ?? [];
  return [1, 2, 3, 4].map((slot) => shortSkillLabel(defs.find((d) => d.slot === slot && d.form === (form === "Awakened" ? "Awakened" : "Base"))?.label ?? ""));
}
