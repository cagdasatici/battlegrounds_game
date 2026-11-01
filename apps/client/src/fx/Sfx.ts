import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** FX0 stub. FX3 implements the audio bus here. */
export const Sfx = {
  attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => undefined; },
};
