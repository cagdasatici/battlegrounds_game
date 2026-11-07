/**
 * FB08 pure palette helpers for the arena visuals: sky gradient, rock strata, plank tones, cloud-layer pixels and
 * ambient mote placement. No DOM, no Three.js; every function is deterministic so the unit test can pin it.
 * Variants (0 = original look) were drafted and screenshotted for the FB08 decision record; `ENV_VARIANT` holds the
 * chosen ones and the browser harness can override it before a scene is built.
 */
import { ARENA_SCALE } from "@eb/shared/config/arena";

export const ENV_VARIANT = { sky: 1, rock: 1, bridge: 1 };

type Rgb = readonly [number, number, number];
const hexRgb = (h: number): Rgb => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const rgbHex = (c: Rgb): number => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
export function mixHex(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t)), x = hexRgb(a), y = hexRgb(b);
  return rgbHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Azimuth (radians, atan2(z, x)) of the painted sun on the horizon backdrop at (68, -111). */
export const SUN_AZIMUTH = Math.atan2(-111, 68);

/**
 * Sky dome colour. `t` is height over dome radius in [-1, 1]; `az` the azimuth. Variant 1 adds a mid-sky blue stop and
 * a warm haze that peaks towards the sun; variant 2 is a cooler teal zenith with a stronger, whiter haze.
 */
export function skyHex(variant: number, t: number, az: number, horizon: number, zenith: number, nadir: number): number {
  if (t < 0) return mixHex(horizon, nadir, Math.min(1, -t * 2));
  if (variant === 0) return mixHex(horizon, zenith, Math.pow(t, 0.6));
  const sunward = 0.5 + 0.5 * Math.cos(az - SUN_AZIMUTH);
  const mid = variant === 1 ? 0x7fb0d4 : 0x6fbcc8;
  const top = variant === 1 ? zenith : 0x2a5f8c;
  const base = t < 0.28 ? mixHex(horizon, mid, Math.pow(t / 0.28, 0.8)) : mixHex(mid, top, Math.pow((t - 0.28) / 0.72, 0.7));
  const haze = Math.exp(-t * (variant === 1 ? 7 : 5)) * (variant === 1 ? 0.45 : 0.6) * (0.35 + 0.65 * sunward);
  return mixHex(base, variant === 1 ? 0xffe9c8 : 0xf4f6f0, haze);
}

/**
 * Rock side colour at normalised depth `d` (0 just under the grass lip, 1 at the bottom). Variant 0 is the original
 * smooth blend; 1 quantises into strata bands with a per-band warm or cool shift; 2 is the same with stronger contrast.
 */
export function strataHex(variant: number, d: number, hi: number, low: number, bank: number): number {
  const t = Math.min(1, Math.max(0, d));
  if (variant === 0) return t < 0.25 ? mixHex(bank, hi, Math.pow(t / 0.25, 0.7)) : mixHex(hi, low, (t - 0.25) / 0.75);
  // Banded: a dark bank under the lip, then sandstone-to-slate strata with a stable warm or cool shift per band.
  if (t < 0.06) return mixHex(bank, 0xd8c096, t / 0.06);
  const bands = variant === 1 ? 8 : 6;
  const band = Math.floor(t * bands), q = (band + 0.5) / bands;
  const shift = ((band * 2654435761) >>> 0) % 5 / 4; // 0..1, stable per band
  const base = mixHex(mixHex(hi, 0xe2c8a0, 0.5), low, Math.pow(q, 0.9));
  return mixHex(base, shift > 0.5 ? 0xb98a5a : 0x7c869a, (variant === 1 ? 0.2 : 0.32) * (shift > 0.5 ? shift : 1 - shift));
}

/** Plank colour for bridge plank `i`: wood with a deterministic lightness shift, worn lighter towards the middle. */
export function plankHex(variant: number, i: number, n: number, wood: number, dark: number): number {
  if (variant === 0) return mixHex(wood, dark, (i % 3) * 0.12);
  const r = mulberry32(0x51a2 + i)();
  const wear = 1 - Math.abs((i + 0.5) / n * 2 - 1);
  return mixHex(mixHex(wood, dark, r * 0.38), 0xd0a56b, wear * 0.18);
}

/** Warm cream-green island edge highlight; hue stays away from the red/yellow telegraph colours. */
export const RIM_HEX = 0xc4d68e;

/** Alpha mask (0..255) for the soft cloud shell: wrapping value noise in the horizon band, clear above and below. */
export function cloudAlpha(w: number, h: number, seed: number): Uint8Array {
  const r = mulberry32(seed), gw = 16, gh = 6, grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x: number, y: number): number => grid[(((y % gh) + gh) % gh) * gw + (((x % gw) + gw) % gw)]!;
  const sm = (t: number): number => t * t * (3 - 2 * t);
  const noise = (u: number, v: number): number => {
    const x = Math.floor(u), y = Math.floor(v), fx = sm(u - x), fy = sm(v - y);
    const a = at(x, y) + (at(x + 1, y) - at(x, y)) * fx, b = at(x, y + 1) + (at(x + 1, y + 1) - at(x, y + 1)) * fx;
    return a + (b - a) * fy;
  };
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const lat = j / (h - 1); // texture row 0 is the nadir end of the sphere, the last row the zenith
    const band = Math.max(0, 1 - Math.abs(lat - 0.58) / 0.16); // soft band just above the horizon
    for (let i = 0; i < w; i++) {
      const n = 0.6 * noise(i / w * gw, j / h * gh * 1.6) + 0.4 * noise(i / w * gw * 2.3 + 5, j / h * gh * 3.1);
      const a = Math.min(1, Math.max(0, (n - 0.46) * 4.2)) * band * 0.85;
      out[j * w + i] = Math.round(a * 255);
    }
  }
  return out;
}

/** Positions (x, y, z), phase and size for the ambient motes: a loose ring around and below the islands. */
export function motePlacements(count: number, seed: number): { x: number; y: number; z: number; phase: number; size: number }[] {
  const r = mulberry32(seed), out = [];
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, rad = (30 + r() * 70) * ARENA_SCALE;
    out.push({ x: Math.cos(a) * rad, y: -6 - r() * 28, z: Math.sin(a) * rad, phase: r() * Math.PI * 2, size: 0.35 + r() * 0.9 });
  }
  return out;
}

/** Slow vertical bob offset in metres for a mote; `timeSec` of 0 gives the rest pose used when motion is reduced. */
export const moteBob = (phase: number, timeSec: number): number => Math.sin(timeSec * 0.5 + phase) * 0.6;
