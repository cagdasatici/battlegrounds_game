import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** FX0 stub. FX2 implements damage numbers, callouts and the KO feed here. */
export const CombatText = {
  attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => undefined; },
};
