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
  /** FX1: the fighter view for an entity id, if one exists (flash and freeze). */
  viewFor?: (id: string) => { flash(color: number, ms: number, level?: number): void; freeze(frames: number): void; readonly flashing: boolean } | undefined;
  /** FX1: camera shake in metres over ms of render time. */
  shake?: (amplitude: number, ms: number) => void;
  /** FX1: registers a per render frame callback and returns its unsubscribe. */
  onFrame?: (fn: (dtSec: number) => void) => () => void;
}

/** Attaches every presentation module to the bus once per match. Returns one disposer for all of them. */
export function registerPresentation(bus: CombatBus, deps: PresentationDeps): () => void {
  const disposers = [HitFx.attach(bus, deps), CombatText.attach(bus, deps), Sfx.attach(bus, deps)];
  return () => { for (const d of disposers.reverse()) d(); };
}
