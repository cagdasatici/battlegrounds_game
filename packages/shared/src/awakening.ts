import { COMBAT } from "./config/combat.js";

/** Awakening meter threshold in hundredths of damage points: Stone Vanguard 20000, others 35000 (spec 15). */
export const meterRequired100 = (kitId: string): number =>
  kitId === "sv" ? COMBAT.meter.svRequired100 : COMBAT.meter.otherRequired100;

/** Threshold normalised meter in 0..1 for the HUD; the HUD shows an integer percent and "Ready" at 1. */
export const meterFraction = (kitId: string, meter100: number): number =>
  Math.min(1, Math.max(0, meter100 / meterRequired100(kitId)));
