import type { AbilityHandler } from "../sim/AbilityRunner.js";
import { FAULT_STRIKE } from "./sv/faultStrike.js";

/** Stone Vanguard handlers. T12 adds faultStrike, barrage, reflectPalm and launcher; T15 the awakened four. */
export const SV_HANDLERS: AbilityHandler[] = [FAULT_STRIKE];
