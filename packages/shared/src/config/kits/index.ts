import type { AbilityDef } from "../../abilities.js";
import { PROP_DEFS } from "../props.js";
import { WALL_DEFS } from "../wall.js";
import { EA_DEFS } from "./ea.js";
import { SV_DEFS } from "./sv.js";
import { TD_DEFS } from "./td.js";

export { EA_DEFS, PROP_DEFS, SV_DEFS, TD_DEFS, WALL_DEFS };
/** Every shipped ability definition, in stable kit order. Included in the content hash. */
export const ALL_ABILITY_DEFS: readonly AbilityDef[] = [...SV_DEFS, ...TD_DEFS, ...EA_DEFS, ...WALL_DEFS, ...PROP_DEFS];
