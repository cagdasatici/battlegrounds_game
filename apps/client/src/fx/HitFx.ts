import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** FX0 stub. FX1 implements hit impact effects here. */
export const HitFx = {
  attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => undefined; },
};
