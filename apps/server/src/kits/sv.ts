import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { BARRAGE } from "./sv/barrage.js";
import { LAUNCHER } from "./sv/launcher.js";
import { REFLECT_PALM } from "./sv/reflectPalm.js";
import { FAULT_STRIKE } from "./sv/faultStrike.js";
import { LETHAL_COUNTER } from "./sv/lethalCounter.js";
import { GROUND_WAVE } from "./sv/groundWave.js";

/** Stone Vanguard handlers. T12 adds faultStrike, barrage, reflectPalm and launcher; T15 the awakened four. */
export const SV_HANDLERS: AbilityHandler[] = [FAULT_STRIKE, BARRAGE, REFLECT_PALM, LAUNCHER, LETHAL_COUNTER, GROUND_WAVE];
