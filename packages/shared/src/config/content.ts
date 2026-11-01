import { contentHashOf } from "../math.js";
import { COMBAT } from "./combat.js";

/** Hash over all bundled gameplay data. Later tasks append arena and ability registries. */
export function computeContentHash(extra: unknown[] = []): string {
  return contentHashOf(COMBAT, ...extra);
}
