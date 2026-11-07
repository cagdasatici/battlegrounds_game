/**
 * GFX01: what each graphics tier actually changes. Pure table, so unit tests and the settings screen read the same numbers.
 * Before GFX01 medium and high differed only by a pixel budget that a normal laptop window never reached (the ratio cap was 1.5 and
 * both tiers shared the 1024 shadow map), so players saw no difference. Now every tier row differs in several visible ways.
 */
export type Quality = "low" | "medium" | "high";

export interface EnvQualityProfile {
  readonly tier: Quality;
  /** Rendered pixel budget and the ratio window relative to CSS pixels. */
  readonly pixelBudget: number;
  readonly pixelRatioMin: number;
  readonly pixelRatioMax: number;
  /** Sun shadow: map edge in texels, frustum half width (m), PCF blur radius. Size 0 means no shadows. */
  readonly shadowMapSize: number;
  readonly shadowHalf: number;
  readonly shadowRadius: number;
  /** ACES filmic tone mapping (0 = off) and its exposure. */
  readonly toneMapping: boolean;
  readonly exposure: number;
  /** Instanced ground cover: grass clumps, flower heads, pebbles drawn; the camera-following window edge (m). */
  readonly grass: number;
  readonly flowers: number;
  readonly pebbles: number;
  readonly coverWindow: number;
  /** Wind sway on grass, flowers and tree canopies. */
  readonly sway: boolean;
  /** Ambient pollen and fireflies. */
  readonly particles: number;
  /** WORLD02: falling snow flakes drawn on snow maps (themes with `features.snow`). */
  readonly snow: number;
  /** Fog start as a share of the camera far plane and the share of trees kept (draw distance and scenery density). */
  readonly fogNear: number;
  readonly fogFar: number;
  readonly treeShare: number;
  readonly cloudShell: boolean;
  readonly motes: boolean;
  readonly extraProps: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<Quality, EnvQualityProfile>> = {
  low: {
    tier: "low", pixelBudget: 700_000, pixelRatioMin: 0.6, pixelRatioMax: 1,
    shadowMapSize: 0, shadowHalf: 24, shadowRadius: 1,
    toneMapping: false, exposure: 1,
    grass: 700, flowers: 0, pebbles: 30, coverWindow: 30, sway: false, particles: 0, snow: 160,
    fogNear: 0.3, fogFar: 0.6, treeShare: 0.35, cloudShell: false, motes: false, extraProps: false,
  },
  medium: {
    tier: "medium", pixelBudget: 1_500_000, pixelRatioMin: 0.6, pixelRatioMax: 1.5,
    shadowMapSize: 1024, shadowHalf: 24, shadowRadius: 1.5,
    toneMapping: true, exposure: 1,
    grass: 3200, flowers: 400, pebbles: 100, coverWindow: 46, sway: true, particles: 140, snow: 700,
    fogNear: 0.42, fogFar: 0.85, treeShare: 0.4, cloudShell: true, motes: true, extraProps: true,
  },
  high: {
    tier: "high", pixelBudget: 4_000_000, pixelRatioMin: 0.6, pixelRatioMax: 2,
    shadowMapSize: 2048, shadowHalf: 30, shadowRadius: 3,
    toneMapping: true, exposure: 1.05,
    grass: 22000, flowers: 3000, pebbles: 420, coverWindow: 84, sway: true, particles: 420, snow: 2200,
    fogNear: 0.55, fogFar: 1, treeShare: 1, cloudShell: true, motes: true, extraProps: true,
  },
};

export const profileFor = (q: Quality): EnvQualityProfile => QUALITY_PROFILES[q];

/** Ratio between CSS and rendered pixels for a tier: fit the pixel budget, never above the device ratio or the tier's window. */
export function pixelRatioForProfile(p: EnvQualityProfile, cssW: number, cssH: number, dpr: number): number {
  const fit = Math.sqrt(p.pixelBudget / Math.max(1, cssW * cssH));
  return Math.min(p.pixelRatioMax, Math.max(p.pixelRatioMin, Math.min(dpr, fit)));
}
