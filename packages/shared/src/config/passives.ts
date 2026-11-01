import type { KitId } from "../protocol.js";

/**
 * T22 reward registry (spec sections 15 and 16, decision 0028). Pure data: which lethal ability hit pays which passive.
 * Values are hundredths of HP. D values are local design choices; the numbers below are the spec 15 and 16 table.
 * The server pays at most one reward per victim life, to the actual killer, from a living killer of the same life.
 */
export type KillReward =
  | { readonly kind: "heal"; readonly amount100: number }
  | { readonly kind: "resetCooldowns"; readonly moveIds: readonly string[] };

/** Tide Duelist finisher heal by lethal move (spec 15). td.a4, basic attacks, dash and context moves pay nothing. */
const TD_FINISHER_HEAL100: Readonly<Record<string, number>> = {
  "td.b1": 3500, "td.b2": 3000, "td.b3": 2000, "td.b4": 4000, "td.a1": 5000, "td.a2": 5000, "td.a3": 5000,
};

/** Ember Artificer reset passive (spec 16): these cooldown buckets are made ready on a lethal ability hit. */
export const EA_RESET_MOVE_IDS: readonly string[] = ["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2"];
/**
 * Lethal moves that qualify for the Artificer reset. ea.a3 Furnace Ray and ea.a4 Solar Vent are explicitly excluded
 * (spec 16 and the R08 conflict note), as are basic attacks, dash, evasive and context moves.
 */
export const EA_RESET_TRIGGER_MOVE_IDS: readonly string[] = ["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2"];

/** The reward a lethal hit by `kit` with `moveId` pays, or null. Sv has no kill reward (its heals are per ability). */
export function killRewardFor(kit: KitId, moveId: string | undefined): KillReward | null {
  if (!moveId) return null;
  if (kit === "td") {
    const amount100 = TD_FINISHER_HEAL100[moveId] ?? 0;
    return amount100 > 0 ? { kind: "heal", amount100 } : null;
  }
  if (kit === "ea") return EA_RESET_TRIGGER_MOVE_IDS.includes(moveId) ? { kind: "resetCooldowns", moveIds: EA_RESET_MOVE_IDS } : null;
  return null;
}
