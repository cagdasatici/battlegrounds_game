/** Pure parameter tables for the original synthesized combat sounds. No DOM, no samples, no recordings. */

export type SoundKind =
  | "hitLight" | "hitHeavy" | "block" | "counter" | "heal" | "ko"
  | "castStone" | "castWater" | "castHeat" | "castGeneric"
  | "swing" | "swingFinisher"
  | "awakenStone" | "awakenWater" | "awakenHeat"
  | "hitSpecialStone" | "hitSpecialWater" | "hitSpecialHeat"
  | "capture" | "release" | "respawn" | "airJump";

/** QS01: sustained beds for channelled abilities, one per element. */
export type LoopKind = "loopStone" | "loopWater" | "loopHeat";

export interface Layer {
  src: "osc" | "noise";
  wave?: "sine" | "square" | "sawtooth" | "triangle";
  /** Start and end frequency (Hz) for an oscillator, or the filter cutoff sweep for noise. */
  f0: number;
  f1: number;
  filter?: "lowpass" | "bandpass" | "highpass";
  gain: number;
  /** Seconds. */
  attack: number;
  dur: number;
  /** Delay before the layer starts, seconds. */
  delay?: number;
  /** Amplitude modulation rate in Hz, used for the crackle. */
  crackleHz?: number;
}

export interface Recipe { layers: Layer[]; dur: number }

const r = (layers: Layer[]): Recipe => ({ layers, dur: Math.max(...layers.map((l) => (l.delay ?? 0) + l.dur)) });

export const RECIPES: Record<SoundKind, Recipe> = {
  hitLight: r([
    { src: "noise", f0: 3000, f1: 1200, filter: "bandpass", gain: 0.5, attack: 0.002, dur: 0.08 },
    { src: "osc", wave: "triangle", f0: 220, f1: 110, gain: 0.4, attack: 0.002, dur: 0.09 },
  ]),
  airJump: r([
    { src: "osc", wave: "triangle", f0: 360, f1: 720, gain: 0.25, attack: 0.004, dur: 0.12 },
    { src: "noise", f0: 2400, f1: 4200, filter: "highpass", gain: 0.2, attack: 0.002, dur: 0.1 },
  ]),
  hitHeavy: r([
    { src: "noise", f0: 1800, f1: 300, filter: "lowpass", gain: 0.7, attack: 0.002, dur: 0.22 },
    { src: "osc", wave: "sine", f0: 140, f1: 45, gain: 0.8, attack: 0.002, dur: 0.28 },
  ]),
  block: r([
    { src: "osc", wave: "square", f0: 880, f1: 760, gain: 0.4, attack: 0.001, dur: 0.07 },
    { src: "noise", f0: 5000, f1: 4000, filter: "highpass", gain: 0.45, attack: 0.001, dur: 0.05 },
  ]),
  counter: r([
    { src: "osc", wave: "sawtooth", f0: 400, f1: 1400, gain: 0.3, attack: 0.005, dur: 0.14 },
    { src: "osc", wave: "sine", f0: 1760, f1: 1760, gain: 0.3, attack: 0.002, dur: 0.2, delay: 0.1 },
  ]),
  heal: r([
    { src: "osc", wave: "sine", f0: 523, f1: 523, gain: 0.3, attack: 0.02, dur: 0.18 },
    { src: "osc", wave: "sine", f0: 659, f1: 659, gain: 0.3, attack: 0.02, dur: 0.18, delay: 0.1 },
    { src: "osc", wave: "sine", f0: 784, f1: 784, gain: 0.3, attack: 0.02, dur: 0.3, delay: 0.2 },
  ]),
  ko: r([
    { src: "osc", wave: "sawtooth", f0: 300, f1: 40, gain: 0.6, attack: 0.005, dur: 0.7 },
    { src: "noise", f0: 1200, f1: 100, filter: "lowpass", gain: 0.5, attack: 0.005, dur: 0.6 },
  ]),
  // QS01 element identities. Stone: low transient then falling chip ticks. Tide: short noise sweep then a descending
  // water tone. Ember: rising charge then a dry ignition crack (high, short, no tail).
  castStone: r([
    { src: "osc", wave: "sine", f0: 90, f1: 50, gain: 0.7, attack: 0.005, dur: 0.2 },
    { src: "noise", f0: 400, f1: 120, filter: "lowpass", gain: 0.6, attack: 0.005, dur: 0.14 },
    { src: "noise", f0: 2600, f1: 2000, filter: "bandpass", gain: 0.35, attack: 0.001, dur: 0.025, delay: 0.1 },
    { src: "noise", f0: 2000, f1: 1500, filter: "bandpass", gain: 0.3, attack: 0.001, dur: 0.025, delay: 0.17 },
    { src: "noise", f0: 1500, f1: 1000, filter: "bandpass", gain: 0.25, attack: 0.001, dur: 0.025, delay: 0.24 },
  ]),
  castWater: r([
    { src: "noise", f0: 300, f1: 2400, filter: "bandpass", gain: 0.45, attack: 0.05, dur: 0.16 },
    { src: "osc", wave: "sine", f0: 820, f1: 330, gain: 0.35, attack: 0.02, dur: 0.3, delay: 0.1 },
  ]),
  castHeat: r([
    { src: "osc", wave: "sawtooth", f0: 160, f1: 820, gain: 0.3, attack: 0.15, dur: 0.3 },
    { src: "noise", f0: 4500, f1: 6500, filter: "highpass", gain: 0.5, attack: 0.001, dur: 0.06, delay: 0.3 },
    { src: "noise", f0: 5000, f1: 3500, filter: "highpass", gain: 0.25, attack: 0.001, dur: 0.12, delay: 0.3, crackleHz: 55 },
  ]),
  castGeneric: r([
    { src: "osc", wave: "triangle", f0: 330, f1: 520, gain: 0.3, attack: 0.01, dur: 0.12 },
  ]),
  // Strike swings (m1 presses): a short air whoosh, rising then falling, so a punch is heard even when it misses.
  swing: r([
    { src: "noise", f0: 700, f1: 2600, filter: "bandpass", gain: 0.32, attack: 0.02, dur: 0.1 },
    { src: "noise", f0: 2600, f1: 900, filter: "bandpass", gain: 0.18, attack: 0.005, dur: 0.07, delay: 0.09 },
  ]),
  swingFinisher: r([
    { src: "noise", f0: 400, f1: 3200, filter: "bandpass", gain: 0.5, attack: 0.04, dur: 0.16 },
    { src: "osc", wave: "sawtooth", f0: 140, f1: 70, gain: 0.3, attack: 0.02, dur: 0.22 },
    { src: "noise", f0: 3200, f1: 600, filter: "bandpass", gain: 0.25, attack: 0.005, dur: 0.12, delay: 0.15 },
  ]),
  // Awakening: a long rising power-up, then an element-coloured release. Longer and louder than any cast.
  awakenStone: r([
    { src: "osc", wave: "sine", f0: 45, f1: 110, gain: 0.8, attack: 0.25, dur: 0.6 },
    { src: "noise", f0: 120, f1: 900, filter: "lowpass", gain: 0.55, attack: 0.3, dur: 0.6 },
    { src: "osc", wave: "sine", f0: 70, f1: 35, gain: 0.9, attack: 0.005, dur: 0.5, delay: 0.6 },
    { src: "noise", f0: 2200, f1: 1200, filter: "bandpass", gain: 0.4, attack: 0.001, dur: 0.05, delay: 0.62 },
    { src: "noise", f0: 1800, f1: 1100, filter: "bandpass", gain: 0.3, attack: 0.001, dur: 0.05, delay: 0.75 },
  ]),
  awakenWater: r([
    { src: "noise", f0: 200, f1: 3600, filter: "bandpass", gain: 0.5, attack: 0.3, dur: 0.6 },
    { src: "osc", wave: "sine", f0: 300, f1: 1200, gain: 0.4, attack: 0.3, dur: 0.6 },
    { src: "osc", wave: "sine", f0: 1500, f1: 400, gain: 0.5, attack: 0.01, dur: 0.55, delay: 0.6 },
    { src: "noise", f0: 4200, f1: 800, filter: "bandpass", gain: 0.4, attack: 0.01, dur: 0.4, delay: 0.6 },
  ]),
  awakenHeat: r([
    { src: "osc", wave: "sawtooth", f0: 110, f1: 1100, gain: 0.4, attack: 0.4, dur: 0.6 },
    { src: "noise", f0: 3000, f1: 6000, filter: "highpass", gain: 0.3, attack: 0.3, dur: 0.6, crackleHz: 40 },
    { src: "noise", f0: 5200, f1: 3000, filter: "highpass", gain: 0.7, attack: 0.001, dur: 0.1, delay: 0.6 },
    { src: "osc", wave: "square", f0: 220, f1: 55, gain: 0.5, attack: 0.002, dur: 0.45, delay: 0.6 },
    { src: "noise", f0: 4000, f1: 2500, filter: "highpass", gain: 0.3, attack: 0.001, dur: 0.3, delay: 0.62, crackleHz: 55 },
  ]),
  // Special-move impacts: the heavy hit body plus an element accent, so skills read differently from plain punches.
  hitSpecialStone: r([
    { src: "noise", f0: 1800, f1: 250, filter: "lowpass", gain: 0.7, attack: 0.002, dur: 0.24 },
    { src: "osc", wave: "sine", f0: 120, f1: 38, gain: 0.9, attack: 0.002, dur: 0.34 },
    { src: "noise", f0: 2400, f1: 1500, filter: "bandpass", gain: 0.35, attack: 0.001, dur: 0.03, delay: 0.08 },
    { src: "noise", f0: 1800, f1: 1200, filter: "bandpass", gain: 0.3, attack: 0.001, dur: 0.03, delay: 0.16 },
  ]),
  hitSpecialWater: r([
    { src: "noise", f0: 3500, f1: 500, filter: "bandpass", gain: 0.6, attack: 0.002, dur: 0.22 },
    { src: "osc", wave: "sine", f0: 160, f1: 60, gain: 0.7, attack: 0.002, dur: 0.26 },
    { src: "osc", wave: "sine", f0: 900, f1: 300, gain: 0.3, attack: 0.005, dur: 0.22, delay: 0.04 },
  ]),
  hitSpecialHeat: r([
    { src: "noise", f0: 2400, f1: 400, filter: "lowpass", gain: 0.7, attack: 0.002, dur: 0.22 },
    { src: "osc", wave: "sine", f0: 150, f1: 50, gain: 0.8, attack: 0.002, dur: 0.28 },
    { src: "noise", f0: 5200, f1: 3500, filter: "highpass", gain: 0.5, attack: 0.001, dur: 0.18, crackleHz: 60 },
  ]),
  capture: r([
    { src: "osc", wave: "square", f0: 300, f1: 200, gain: 0.35, attack: 0.002, dur: 0.12 },
    { src: "noise", f0: 1200, f1: 600, filter: "bandpass", gain: 0.5, attack: 0.002, dur: 0.1 },
  ]),
  release: r([
    { src: "noise", f0: 600, f1: 2400, filter: "bandpass", gain: 0.35, attack: 0.01, dur: 0.14 },
    { src: "osc", wave: "triangle", f0: 260, f1: 520, gain: 0.25, attack: 0.01, dur: 0.14 },
  ]),
  respawn: r([
    { src: "osc", wave: "sine", f0: 330, f1: 330, gain: 0.25, attack: 0.02, dur: 0.15 },
    { src: "osc", wave: "sine", f0: 440, f1: 440, gain: 0.25, attack: 0.02, dur: 0.15, delay: 0.1 },
    { src: "osc", wave: "sine", f0: 660, f1: 660, gain: 0.25, attack: 0.02, dur: 0.3, delay: 0.2 },
  ]),
};

/** Loop beds: a layer set that repeats until stopped. `dur` is the seed length; the voice loops through noise and oscillators. */
export const LOOPS: Record<LoopKind, Recipe> = {
  loopStone: r([
    { src: "noise", f0: 220, f1: 220, filter: "lowpass", gain: 0.5, attack: 0.05, dur: 1 },
    { src: "osc", wave: "sine", f0: 55, f1: 55, gain: 0.35, attack: 0.05, dur: 1 },
  ]),
  loopWater: r([
    { src: "noise", f0: 1400, f1: 1400, filter: "bandpass", gain: 0.4, attack: 0.05, dur: 1 },
    { src: "osc", wave: "sine", f0: 420, f1: 420, gain: 0.15, attack: 0.05, dur: 1 },
  ]),
  loopHeat: r([
    { src: "osc", wave: "sawtooth", f0: 110, f1: 110, gain: 0.22, attack: 0.05, dur: 1 },
    { src: "noise", f0: 4200, f1: 4200, filter: "highpass", gain: 0.3, attack: 0.05, dur: 1, crackleHz: 24 },
  ]),
};

/** Abilities held longer than this many ticks (0.5 s at 60 Hz) have a sustained bed. */
export const SUSTAIN_MIN_TICKS = 30;

/** Loop bed for a kit ability id, or null for m1, dash and unknown ids. */
export function loopKindFor(moveId: string | undefined): LoopKind | null {
  if (moveId === undefined || !isMajorMove(moveId)) return null;
  if (moveId.startsWith("sv.")) return "loopStone";
  if (moveId.startsWith("td.")) return "loopWater";
  if (moveId.startsWith("ea.")) return "loopHeat";
  return null;
}

/** Lower number = more important. */
export type Priority = 0 | 1 | 2;
export const PRIORITY_LOCAL_HIT: Priority = 0;
export const PRIORITY_MAJOR_NEARBY: Priority = 1;
export const PRIORITY_OTHER: Priority = 2;

export const MAX_VOICES = 16;
export const MAX_AUDIBLE_M = 45;
/** Nearby major abilities: within this distance (m) of the listener. */
export const NEARBY_M = 20;

/** Linear fall-off: 1 at 0 m, 0.5 at 22.5 m, 0 at 45 m and beyond. */
export function attenuation(distM: number): number {
  if (!(distM >= 0)) return 0;
  return Math.max(0, 1 - distM / MAX_AUDIBLE_M);
}

export function castKind(moveId: string | undefined): SoundKind {
  if (moveId === undefined) return "castGeneric";
  if (moveId.startsWith("sv.")) return "castStone";
  if (moveId.startsWith("td.")) return "castWater";
  if (moveId.startsWith("ea.")) return "castHeat";
  return "castGeneric";
}

/** Element of a kit move id (`sv.`, `td.`, `ea.`), or null for m1, dash and unknown ids. */
export function elementOf(moveId: string | undefined): "Stone" | "Water" | "Heat" | null {
  if (moveId === undefined) return null;
  if (moveId.startsWith("sv.")) return "Stone";
  if (moveId.startsWith("td.")) return "Water";
  if (moveId.startsWith("ea.")) return "Heat";
  return null;
}

/** Awakening is the server's `<kit>.activate` move (Awakening.ts). */
export const isAwakenMove = (moveId: string | undefined): boolean => moveId !== undefined && moveId.endsWith(".activate");

/** Strike press: m1.1 to m1.3 are plain swings, m1.4.* is the finisher. Null for every other move. */
export function swingKind(moveId: string | undefined): "swing" | "swingFinisher" | null {
  if (moveId === undefined || !moveId.startsWith("m1.")) return null;
  return moveId.startsWith("m1.4") ? "swingFinisher" : "swing";
}

/** m1 casts and dashes are minor; skills and awakening are major. */
export function isMajorMove(moveId: string | undefined): boolean {
  return moveId !== undefined && !moveId.startsWith("m1.") && !moveId.startsWith("dash");
}
