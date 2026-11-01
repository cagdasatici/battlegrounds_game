import { contentHashOf } from "../math.js";
import { COMBAT } from "./combat.js";
import { buildIslandsMap } from "./arena.js";
import { ALL_ABILITY_DEFS } from "./kits/index.js";

/** Hash over all bundled gameplay data, including every ability definition. */
export function computeContentHash(extra: unknown[] = []): string {
  return contentHashOf(COMBAT, buildIslandsMap().contentHash, ALL_ABILITY_DEFS, ...extra);
}
