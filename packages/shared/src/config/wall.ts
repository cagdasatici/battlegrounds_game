import { defineAbility, KIT_PREFIXES, type AbilityDef } from "../abilities.js";

/**
 * Shared wall attack (T23, spec 13 and 16): one definition template mapped over the kit prefixes, so every fighter has
 * `sv.wall`, `td.wall` and `ea.wall` without any kit file listing it. Startup 8, capture window 3, hits [3,3,6] at
 * capture + [0,12,30], release at +36 with R60 F7 U3, recovery 18, cooldown 360. The capture hit is B and counterable;
 * later hits are not (sequence handler). All numbers are D except where the spec card states them.
 */
export const WALL_DEFS: AbilityDef[] = KIT_PREFIXES.map((p) => defineAbility({
  id: `${p}.wall`, label: "Wall Combo", handler: "wallCombo", startup: 8, active: 3, recovery: 18, cooldown: 360,
  hitOffsets: [0, 12, 30], damage100: [300, 300, 600], range: 2, block: "B", input: "context",
  stunTicks: 0, ragdollTicks: 60, launch: { forward: 7, up: 3 },
}));
