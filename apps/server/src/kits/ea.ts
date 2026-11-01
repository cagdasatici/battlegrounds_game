import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { CINDER_ARRAY } from "./ea/cinderArray.js";
import { FURNACE_DROP } from "./ea/furnaceDrop.js";
import { VENT_RUSH } from "./ea/ventRush.js";

/**
 * Ember Artificer handlers. T20 adds cinderArray, ventRush and furnaceDrop; Ember Orb (ea.b3) reuses the generic
 * chargeProjectile handler from T19 (kits/projectile.ts). The awakened four arrive with T21.
 */
export const EA_HANDLERS: AbilityHandler[] = [CINDER_ARRAY, VENT_RUSH, FURNACE_DROP];
