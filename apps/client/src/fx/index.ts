import type { Camera, Scene } from "three";
import type { CombatBus } from "../app/CombatBus.js";
import { CombatText } from "./CombatText.js";
import { HitFx } from "./HitFx.js";
import { Sfx } from "./Sfx.js";

export interface PresentationDeps {
  scene: Scene;
  camera: Camera;
  players: () => Map<string, unknown>;
  settings: { get(): unknown };
  localId: () => string | undefined;
}

/** Attaches every presentation module to the bus; the returned disposer detaches them all. */
export function registerPresentation(bus: CombatBus, deps: PresentationDeps): () => void {
  const ds = [HitFx.attach(bus, deps), CombatText.attach(bus, deps), Sfx.attach(bus, deps)];
  return () => { for (const d of ds) d(); };
}
