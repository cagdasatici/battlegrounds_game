import type { Camera, Scene } from "three";
import type { CombatBus } from "../app/CombatBus.js";
import type { EffectsPool } from "../scene/EffectsPool.js";
import type { FighterView } from "../scene/FighterView.js";
import { CombatText } from "./CombatText.js";
import { HitFx } from "./HitFx.js";
import { Sfx } from "./Sfx.js";
import { EaFx } from "./kits/ea.js";
import { SvFx } from "./kits/sv.js";
import { TdFx } from "./kits/td.js";

export interface PresentationDeps {
  scene: Scene;
  camera: Camera;
  players: () => Map<string, unknown>;
  settings: { get(): unknown };
  localId: () => string | undefined;
  /** FX1: shared particle pool, fighter lookup for flash and hitstop, and camera shake. Optional so other slices' tests need not supply them. */
  effects?: EffectsPool;
  fighters?: (id: string) => FighterView | undefined;
  shake?: (amplitude: number, ms: number) => void;
}

/** Attaches every presentation module to the bus; the returned disposer detaches them all. */
export function registerPresentation(bus: CombatBus, deps: PresentationDeps): () => void {
  const ds = [HitFx.attach(bus, deps), CombatText.attach(bus, deps), Sfx.attach(bus, deps), SvFx.attach(bus, deps), TdFx.attach(bus, deps), EaFx.attach(bus, deps)];
  return () => { for (const d of ds) d(); };
}
