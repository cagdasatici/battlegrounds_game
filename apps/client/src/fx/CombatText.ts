import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** Stub (FX2 fills this in). */
export const CombatText = { attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => {}; } };
