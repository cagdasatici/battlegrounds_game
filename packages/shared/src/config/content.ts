import { contentHashOf } from "../math.js";
import { COMBAT } from "./combat.js";
import { MAP_REGISTRY, buildMapCollision } from "./maps.js";
import { ALL_ABILITY_DEFS } from "./kits/index.js";

/** Hash over all bundled gameplay data, including every ability definition. */
export function computeContentHash(extra: unknown[] = []): string {
  return contentHashOf(COMBAT, ...Object.values(MAP_REGISTRY).map((m) => buildMapCollision(m).contentHash), ALL_ABILITY_DEFS, ...extra);
}
