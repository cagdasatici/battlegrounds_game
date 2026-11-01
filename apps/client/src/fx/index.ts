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
  /** FX1: the fighter view for an entity id, if one exists (flash and freeze). */
  viewFor?: (id: string) => { flash(color: number, ms: number, level?: number): void; freeze(frames: number): void; readonly flashing: boolean } | undefined;
  /** FX1: camera shake in metres over ms of render time. */
  shake?: (amplitude: number, ms: number) => void;
  /** FX1: registers a per render frame callback and returns its unsubscribe. */
  onFrame?: (fn: (dtSec: number) => void) => () => void;
}

/** Attaches every presentation module to the bus; the returned disposer detaches them all. */
export function registerPresentation(bus: CombatBus, deps: PresentationDeps): () => void {
  const ds = [HitFx.attach(bus, deps), CombatText.attach(bus, deps), Sfx.attach(bus, deps)];
  return () => { for (const d of ds) d(); };
}
