import { COMBAT } from "./config/combat.js";

/** Awakening meter threshold in hundredths of damage points: Stone Vanguard 20000, others 35000 (spec 15). */
export const meterRequired100 = (kitId: string): number =>
  kitId === "sv" ? COMBAT.meter.svRequired100 : COMBAT.meter.otherRequired100;

/** BEAST02: the meter can bank two full bars (Beast Awaken needs both). */
export const METER_STACKS = 2;
export const meterCap100 = (kitId: string): number => meterRequired100(kitId) * METER_STACKS;
/** 0..2: whole bars plus the fraction of the next; the HUD draws two segments from this. */
export const meterStackFraction = (kitId: string, meter100: number): number =>
  Math.min(METER_STACKS, Math.max(0, meter100 / meterRequired100(kitId)));

/** Threshold normalised meter in 0..1 for the HUD; the HUD shows an integer percent and "Ready" at 1. */
export const meterFraction = (kitId: string, meter100: number): number =>
  Math.min(1, Math.max(0, meter100 / meterRequired100(kitId)));
