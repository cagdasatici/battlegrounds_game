import { contentHashOf } from "../math.js";
import { COMBAT } from "./combat.js";
import { buildIslandsMap } from "./arena.js";

/** Hash over all bundled gameplay data. Later tasks append ability registries. */
export function computeContentHash(extra: unknown[] = []): string {
  return contentHashOf(COMBAT, buildIslandsMap().contentHash, ...extra);
}
