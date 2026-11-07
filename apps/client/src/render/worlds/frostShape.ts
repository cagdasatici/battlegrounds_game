/**
 * WORLD02: pure shape of the Frostpeak ground. The snow plain is exactly flat (y = 0) out to `FROST_PLAIN_R` metres from the centre, which covers the
 * whole collision slab (its corner is 68 m out): Rapier, client prediction and CRATER01 craters all assume a flat floor. Beyond it, foothills rise and a ring of
 * ridged mountains stands 100 to 200 m away as a visual backdrop (the tree-line walls keep fighters on the slab). No Three.js here, so a unit test can pin the rules.
 */
import { fbm, valueNoise } from "../environment/noise.js";
import { smoothstep } from "./common.js";

/** Radius (m) of the dead-flat plain. The slab corner is at hypot(50, 46) = 68. */
export const FROST_PLAIN_R = 84;
/** Outer radius (m) of the mountain ring mesh. */
export const FROST_RING_R = 235;
/** Inner radius (m) of the ring mesh; the square plain mesh covers everything inside it. */
export const FROST_RING_R0 = 72;

/** Height of the foothills and mountains at (x, z); 0 inside `FROST_PLAIN_R`. */
export function frostHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= FROST_PLAIN_R) return 0;
  const foot = smoothstep(FROST_PLAIN_R, 130, r) * (5 + 9 * fbm(x * 0.03 + 11, z * 0.03 - 4, 6));
  const n = fbm(x * 0.017 + 2, z * 0.017 + 5, 31);
  const ridge = 1 - Math.abs(2 * n - 1);
  const peak = smoothstep(96, 168, r) * (22 + 72 * ridge * ridge) * (1 - 0.6 * smoothstep(205, 235, r));
  const rough = (valueNoise(x * 0.11, z * 0.11, 17) - 0.5) * 2.4 * smoothstep(100, 150, r);
  return Math.max(0, foot + peak + rough);
}

/** Altitude (m) above which the ground is snow rather than forest or bare rock, with a little noise so the line wanders. */
export const snowLine = (x: number, z: number): number => 15 + 9 * valueNoise(x * 0.05, z * 0.05, 23);
