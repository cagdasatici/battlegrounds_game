# WORLD02 Frostpeak snowy mountain map

## What changed

- New map `frost` (collision id `frost.v1`, theme `frost`): a flat snow slab 100 x 92 m (top y = 0), four tree-line walls (`tree.*`, role `guardrail`) 1 m inside the slab edge, 8 pine trunks, 6 boulders and 4 knee-high drifts as cover, 8 spawns, 8 urns, 4 beast anchors. Source `packages/shared/src/config/worlds.ts`, artifact `assets/maps/frost.v1.json`.
- The registry entry makes everything from WORLD01 apply with no new code path: `mapId: "frost"` is accepted by the sparring and admin schemas, the room loads the artifact, urns and beast anchors follow the map, the picker lists it, `GameScene.setWorld` swaps to it. Craters (`packages/shared/src/craterGround.ts`) are map independent (flat Rapier floor plus a ground offset), and the registry-wide test proves it on all three maps.
- Visuals (`apps/client/src/render/worlds/frostWorld.ts`, `frostShape.ts`): a square snow plain with sparkle grain, a pine tree line outside the walls (two loose rows), a polar mesh of foothills and ridged mountains up to about 95 m high from 72 to 235 m out, 8 hero peaks, forest/rock/snow colouring by altitude and slope, snow-capped pines and boulders, drifts, 7 glossy ice patches with cracks (the crater cut opens them too), grey stratus clouds, ravens, cold blue fog and a low pale sun (`FROST_THEME`).
- Falling snow: `SnowFall.ts` (shader-driven Points, no CPU per frame). Flake count is a new tier column, `EnvQualityProfile.snow`: low 160, medium 700, high 2200. Reduced motion freezes the flakes. Snow replaces pollen on snow themes (`features.snow`); grass is 5 percent and flowers are off.

## Executed checks (this Mac)

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint` | pass |
| `pnpm test` | 159 files passed, 1 skipped; 2023 tests passed |
| `pnpm build`, `pnpm assets:build`, `pnpm assets:audit` | pass (50 manifest entries) |
| `pnpm content:validate` | pass for islands.v1, coast.v1, frost.v1 |
| `tests/unit/maps.test.ts` | registry-wide per-map checks now run for frost too (artifact equality, bounds, spawns clear of obstacles, urns, beast ring, edge clamp, craters); ice patches inside the slab; tree-line walls |
| `tests/unit/world-visuals.test.ts` | plain dead flat over the slab; mountains form a ring (at least 20 of 24 sectors above 40 m, none below 15 m); view contract; snow count equals 160 / 700 / 2200 on low / medium / high; all three worlds swap in any order with equal resource counts |
| `tests/browser/world-maps.spec.ts` (frost) | Chromium with SwiftShader: no console or shader errors; triangles low 97 k, medium 195 k, high 246 k |

Screenshots (medium tier, SwiftShader): `docs/test-results/WORLD-frost-overview.png`, `-sea.png`, `-shore.png`, `-north.png`; budgets in `WORLD-frost-budget.json` (the view names come from the shared art harness).

## Not run / limits

- Physical iPad check: NOT RUN. Real GPU frame timings: NOT RUN.
- Ice patches do not change footing (decoration only).
- The tree-line walls are `guardrail` colliders, so the wall-attack context can trigger at the tree line.
- Mountains are outside the walls and cannot be reached; they are a backdrop.
