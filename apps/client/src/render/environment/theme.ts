/**
 * GFX01: environment theme config. Pure data (no Three.js, no DOM): a map's `themeId` (see MapDefinition in
 * packages/shared/src/config/maps.ts) selects one of these. A later beach or snow map adds an entry to THEMES and gets the
 * sky, lighting, ground colours, ground cover, ambient particles and tree set from the shared environment modules with no new renderer code.
 * All colours are 0xRRGGBB sRGB; all numbers are D (local design choices).
 */
export interface EnvTheme {
  readonly id: string;
  readonly sky: { readonly zenith: number; readonly mid: number; readonly horizon: number; readonly nadir: number; readonly fog: number; readonly sunGlow: number };
  /** Direction towards the sun (unit-ish; normalised on use). Drives the directional light, its shadows and the sky disc together. */
  readonly sunDir: readonly [number, number, number];
  readonly sun: { readonly color: number; readonly intensity: number };
  readonly hemi: { readonly sky: number; readonly ground: number; readonly intensity: number };
  /** Cool fill from the opposite side (no shadows). */
  readonly rim: { readonly color: number; readonly intensity: number; readonly pos: readonly [number, number, number] };
  readonly ground: {
    readonly grassA: number; readonly grassB: number; readonly grassDry: number; readonly patchDark: number;
    readonly dirt: number; readonly meadow: number;
  };
  readonly cover: {
    readonly bladeBase: number; readonly bladeTip: number; readonly bladeDry: number;
    readonly flowers: readonly number[]; readonly pebbles: readonly [number, number];
  };
  readonly particles: { readonly pollen: number; readonly firefly: number; readonly fireflyShare: number };
  readonly trees: {
    readonly trunk: number; readonly birchTrunk: number;
    /** Leaf colours for round, pine and light canopies. */
    readonly oak: readonly [number, number]; readonly pine: readonly [number, number]; readonly birch: readonly [number, number];
    /** Per-instance multiplicative tints (r, g, b) giving autumn, cool and neutral individuals. */
    readonly tints: ReadonlyArray<readonly [number, number, number]>;
    /** Share of oak, pine, birch (sums to 1). */
    readonly mix: readonly [number, number, number];
  };
}

export const GROVE_THEME: EnvTheme = {
  id: "grove",
  sky: { zenith: 0x2f6aa8, mid: 0x7fb4dc, horizon: 0xcfdde0, nadir: 0x6e9eae, fog: 0xbcd0d8, sunGlow: 0xffe3b0 },
  sunDir: [0.5, 0.74, 0.44],
  sun: { color: 0xffe2b8, intensity: 2.3 },
  hemi: { sky: 0xb9d9f2, ground: 0x4a4a38, intensity: 0.95 },
  rim: { color: 0x8fc9ff, intensity: 0.65, pos: [-25, 18, -30] },
  ground: { grassA: 0x44704f, grassB: 0x9bb06a, grassDry: 0xb8b072, patchDark: 0x2f5a42, dirt: 0xb8a67c, meadow: 0x7fb25e },
  cover: {
    bladeBase: 0x2f5d34, bladeTip: 0xa9d46c, bladeDry: 0xd6c878,
    flowers: [0xf7e27a, 0xfff6e6, 0xe98aa8, 0x8fb7ff, 0xc79bff, 0xff9a6a],
    pebbles: [0x8a8478, 0xb3aa98],
  },
  particles: { pollen: 0xfff2c4, firefly: 0xd8ff7a, fireflyShare: 0.18 },
  trees: {
    trunk: 0x6b4a2c, birchTrunk: 0xe6e0d0,
    oak: [0x2f6b3a, 0x6fa84a], pine: [0x1f5a47, 0x3f8a5c], birch: [0x7fb04a, 0xc4d870],
    tints: [[1, 1, 1], [1.2, 1.02, 0.65], [0.82, 1.02, 1.12], [1.08, 0.95, 0.9], [0.95, 1.08, 0.85]],
    mix: [0.45, 0.35, 0.2],
  },
};

export const THEMES: Readonly<Record<string, EnvTheme>> = { [GROVE_THEME.id]: GROVE_THEME };

/** Unknown theme ids fall back to the grove so a new map never renders black. */
export function getEnvTheme(id: string): EnvTheme { return THEMES[id] ?? GROVE_THEME; }

export function normalizedSunDir(t: EnvTheme): [number, number, number] {
  const [x, y, z] = t.sunDir, l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
