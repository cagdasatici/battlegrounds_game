import type { PerspectiveCamera, Scene } from "three";
import type { CombatBus } from "../app/CombatBus.js";
import type { SettingsStore } from "../app/SettingsStore.js";
import { CombatText } from "./CombatText.js";
import { HitFx } from "./HitFx.js";
import { Sfx } from "./Sfx.js";

export interface PresentationDeps {
  scene: Scene;
  camera: PerspectiveCamera;
  players: () => Map<string, unknown>;
  settings: SettingsStore;
  localId: () => string | undefined;
}

/** Attaches every presentation module to the bus once per match. Returns one disposer for all of them. */
export function registerPresentation(bus: CombatBus, deps: PresentationDeps): () => void {
  const disposers = [HitFx.attach(bus, deps), CombatText.attach(bus, deps), Sfx.attach(bus, deps)];
  return () => { for (const d of disposers.reverse()) d(); };
}
