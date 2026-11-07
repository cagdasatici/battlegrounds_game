/** GFX01: deterministic 2D value noise for ground colour and ground-cover density. Pure; no Three.js. */
const hash = (ix: number, iz: number, seed: number): number => {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1]. */
export function valueNoise(x: number, z: number, seed = 1): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a + (a - b - c + d) * fx) * fz;
}

/** Three octave fractal noise in [0, 1]. */
export function fbm(x: number, z: number, seed = 1): number {
  return (valueNoise(x, z, seed) * 0.57 + valueNoise(x * 2.1 + 7, z * 2.1 - 3, seed + 1) * 0.29 + valueNoise(x * 4.3 - 5, z * 4.3 + 9, seed + 2) * 0.14);
}
