import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** Stub (FX3 fills this in). */
export const Sfx = { attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => {}; } };
