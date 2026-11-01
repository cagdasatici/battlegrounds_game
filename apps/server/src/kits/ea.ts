import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { ARC_DESCENT } from "./ea/arcDescent.js";
import { FURNACE_RAY, SOLAR_VENT } from "./ea/beams.js";
import { CINDER_ARRAY } from "./ea/cinderArray.js";
import { COMET_LOCK } from "./ea/cometLock.js";
import { FURNACE_DROP } from "./ea/furnaceDrop.js";
import { VENT_RUSH } from "./ea/ventRush.js";

/**
 * Ember Artificer handlers. T20 adds cinderArray, ventRush and furnaceDrop; Ember Orb (ea.b3) reuses the generic
 * chargeProjectile handler from T19 (kits/projectile.ts). T21 adds arcDescent, cometLock, furnaceRay and solarVent;
 * the activation (ea.activate) lives in sim/Awakening.ts.
 */
export const EA_HANDLERS: AbilityHandler[] = [CINDER_ARRAY, VENT_RUSH, FURNACE_DROP, ARC_DESCENT, COMET_LOCK, FURNACE_RAY, SOLAR_VENT];
