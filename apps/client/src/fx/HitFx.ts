import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";

/** Stub (FX1 fills this in). */
export const HitFx = { attach(_bus: CombatBus, _deps: PresentationDeps): () => void { return () => {}; } };
