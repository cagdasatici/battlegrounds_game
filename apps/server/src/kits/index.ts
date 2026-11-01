import { buildAbilityRegistry, type AbilityRegistry } from "@eb/shared/abilities";
import { ALL_ABILITY_DEFS } from "@eb/shared/config/kits/index";
import { MELEE_HANDLER, type AbilityHandler } from "../sim/AbilityRunner.js";
import { SV_HANDLERS } from "./sv.js";
import { TD_HANDLERS } from "./td.js";
import { PROJECTILE_HANDLERS } from "./projectile.js";
import { CONTEXT_HANDLERS } from "./context.js";

export const ALL_HANDLERS: readonly AbilityHandler[] = [MELEE_HANDLER, ...SV_HANDLERS, ...TD_HANDLERS, ...PROJECTILE_HANDLERS, ...CONTEXT_HANDLERS];

/** Validated registry of every shipped definition; throws on any invalid or unhandled definition. */
export function buildKitRegistry(): AbilityRegistry {
  return buildAbilityRegistry(ALL_ABILITY_DEFS, new Set(ALL_HANDLERS.map((h) => h.name)));
}
