# GFX01 environment overhaul and graphics tiers

## Diagnosis: what the quality setting did before

The setting is `low | medium | high` (shown as three buttons; default `medium`, `SettingsStore.defaultSettings`). In `GameScene.setQuality` it only changed:

- low: no shadow map, no decorative cover, no clouds, no motes, no supporting props.
- medium vs high: only the pixel budget (1.5 M vs 2.5 M) under a hard ratio cap of 1.5. Both used one 1024 shadow map, one fog, the same props. On a normal laptop window the two budgets resolve to almost the same ratio, so players saw no difference. The adaptive controller (`AdaptiveQuality`) can also lower the tier at runtime, and software GL is pinned to low.

## Now

Every tier row lives in `apps/client/src/render/environment/quality.ts` and changes many things at once:

| | low | medium | high |
|---|---|---|---|
| shadow map / blur | off | 1024 / 1.5 | 2048 / 3, wider frustum |
| pixel budget, ratio cap | 0.7 M, 1.0 | 1.5 M, 1.5 | 4 M, 2.0 |
| tone mapping | off | ACES | ACES (exposure 1.05) |
| grass clumps, flowers, pebbles | 700, 0, 30 | 2100, 300, 100 | 14000, 2200, 420 |
| wind sway, pollen and fireflies | no, 0 | yes, 140 | yes, 420 |
| scenery tree share, fog near | 35 %, 0.30 | 40 %, 0.42 | 100 %, 0.55 |
| clouds, motes, supporting props | off | on | on |

Medium triangles are held under 300 k (spec budget; checked by the browser budget specs). High has its own 520 k ceiling in `fb08-environment.spec.ts`.

## Environment

New modules in `apps/client/src/render/environment/` (theme-driven, reusable by later maps): `theme.ts`, `quality.ts`, `atmosphere.ts`, `sky.ts`, `groundShading.ts`, `coverMask.ts`, `GroundCover.ts`, `AmbientParticles.ts`, `Trees.ts`, `treePlan.ts`, `index.ts` (`EnvironmentLayer`). A map's `themeId` picks an `EnvTheme`; a beach or snow map adds an entry to `THEMES` plus its collision geometry.

Cover cluster (pillars, walls, urns) moved from the old centre coordinates to pillars (+-20, +-16), walls (+-16, 0), urns at pillars +-4 m in x (`arena.ts` `COVER_X/COVER_Z/WALL_X`); `assets/maps/islands.v1.json` regenerated; hard-coded coordinates updated in bot-navigation, arena, movement, td-base, fx-placement, gr13, kit-matrix and gr04 tests (gr04 run re-aimed at the new pillar.1 corner, `RUN_TICKS` 190).

## Measurements (this Mac, Apple M5 Max, headless Chrome with ANGLE Metal, art harness `tests/browser/harness/art.html`)

Method: 1180x820 CSS viewport, device scale 2, 120 frames rendered back to back with a 1-pixel readback after each (GPU-inclusive ms per frame), then requestAnimationFrame rate over 4 s. Default camera = gameplay framing with three fighters; overview = whole-arena camera.

| tier | render size | gameplay p50 / p90 ms | overview p50 / p90 ms | rAF fps | calls | triangles (gameplay) |
|---|---|---|---|---|---|---|
| low | 1003x697 | 1.1 / 2.3 | 1.1 / 1.6 | 60 | 57-70 | 121 k |
| medium | 1469x1020 | 1.9 / 3.2 | 1.2 / 1.5 | 60 | 74-88 | 231 k |
| high | 2360x1640 | 2.2 / 3.7 | 2.4 / 3.7 | 60 | 76-88 | 451 k |

Default stays `medium` (the "60 %" tier): it holds 60 fps with large headroom on this Mac. iPad: NOT RUN. A device check is required; the adaptive controller steps down if p90 exceeds 28 ms.

## Not done / limitations

- Bloom and SSAO were not added (post-processing would need a composer and a second target; not cheap on iPad).
- Ground cover is not removed inside crater bowls (CRATER01); grass can poke through a fresh crater.
- Grass window edge fade is visible from the overview camera, not from the gameplay camera.
- Browser screenshots were taken locally for review only; none are committed.
- SwiftShader (CPU) browser specs now run slower; the fighter timing specs load `art.html?lite=1`, which hides the environment layer.
