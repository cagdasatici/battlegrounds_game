# VIS01 — visual overhaul

Date: 2026-11-02. Decision: [0052](../decisions/0052-visual-overhaul.md). Reviewed starting commit c10e626 (movement 9/14 m/s, double-jump scale 1.25, FORM rejection message and larger special-hit VFX). Those gameplay changes are retained. Owner authorized the full visual scope in one session and commit/push to main.

## Changed presentation

- Compact rim-lit translucent flashes with a 2.4 m size ceiling, thinner shockwave rings, tapered streak geometry, crowd-sensitive brightness and bounded point-light intensity. Slot parameters are set before the first transform is drawn (avoids stale pooled transforms).
- Special hits add a directional contact fan rather than another flash/pillar/ring explosion. Lower shared spark density; Fault Strike's opaque contact cluster shrinks from 1.3 m / 0.5 s to 0.34 m / 0.16 s, with a narrow vertical shape.
- Water uses curved dual-colour swept ribbons; ember uses rising orange flame arcs. Stone cracks are dark, opaque fragments. Shared debris now receives diffuse lighting. Horizon Break, Furnace Ray and Solar Rupture use elongated, heading-aligned beam segments with narrower cross-sections, retaining cover clipping and emission timing.
- Ember Orb has a translucent shell, animated shell shape and a reflected cyan core as well as reflected shell/trail. Every projectile resource is disposed.
- Arena: flush radial stone court with inlays, irregular flagstone routes, pillar flutes and seals, irregular rim rock outcrops, distant suspended islets and a warm sun. Quieter meadow grain, revised blue sky/fog, warmer key light, cooler fill and deeper ground light.
- Fighters: thinner charcoal outlines, cleaner fabric, more separated costume palettes, facial planes, swept locks, soles, knuckle details and kit-specific trim. Existing rigs, clips and capsule limits retained. Fine parts use cheap geometry and are omitted on Low; existing 5.5k/8k per-kit medium allocations still pass.
- Regenerated all three original fighter glTFs and asset manifest. No dependencies or imported artwork added.

## Executed checks

Node 24.22.2, pnpm 10.28.0.

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS (boundaries and timers).
- `pnpm assets:build`: PASS; regenerated manifest and fighter files.
- `pnpm build`: PASS, including assets:audit (40 entries, 3 fighters, 93 clips, approximately 6.61 MB of audited assets). Vite retains its existing large-chunk warning; no bundle splitting in this task.
- `pnpm content:validate`: PASS; map hash 6361e0b51fe4a072, 22 colliders, 8 spawns, 36 abilities.
- Focused initial regression: 188/188 PASS. New VIS01 tests: 5/5 PASS (special-hit no-extra-explosion contract, shaped particle heading/slot reuse, ribbon bounds/owner cleanup, reflected core and flush arena decoration).
- Full `pnpm test`: PASS: 119 files passed, 1 file skipped; 1,639 tests passed, 2 skipped, 2 todo (171.02 seconds)..
- Final browser run: 15/15 PASS (final skyline/ribbon run, approximately 1.5 minutes)..

Browser command:

```sh
EB_VISUAL_OUT=docs/test-results/VIS01 EB_UX10_PHASE=final EB_POLISH_TAG=vis01 pnpm exec playwright test tests/browser/environment-polish.spec.ts tests/browser/ux10-budget.spec.ts tests/browser/ux10-shots.spec.ts
```

The browser harness runs the real scene, fighter rigs and presentation modules using synthetic replicated actions and combat events. It is not a real multiplayer match. Console errors are now checked as well as page exceptions, so shader compilation errors fail these checks. The first expanded run failed seven assertions due to the harness requesting a nonexistent favicon; both test pages now use a data favicon. No error filtering was added. Intermediate unit failures were corrected by keeping fine geometry within the original per-kit caps and revising the obsolete long Fault Strike flash assertion. The final visual review additionally replaced flat distant cone silhouettes with faceted floating-island silhouettes and closed gaps between curved trail segments.

## Visual evidence and budgets

All final evidence is in [VIS01/](VIS01/). Main review images:

- `sv-b1-fault-strike-final-3-impact.png`: head, torso and legs remain visible through a brief directional contact.
- `td-b2-undertow-spiral-final-2-active.png`: swept cyan/blue water trails around the action.
- `ea-a3-furnace-ray-final-2-active.png`: narrow beam with distinct core and sheath.
- `busy-4-fighters-{low,medium,high}.png`: deliberately saturated stress fixture; all four fighters remain locatable, but concurrent attacks still overlap. This is not a claim that every pose is fully visible on every frame.
- `UX05-vis01-{overview,spawn,bridge,front}-{low,medium}.png`: environment and lineup.
- `UX08-four-fighters-{low,medium}.png`: dense east satellite, four fighters.

| Quality | Peak draw calls | Peak triangles | Peak pool particles |
|---|---:|---:|---:|
| low | 48 | 52,322 | 200 |
| medium | 68 | 101,006 | 510 |
| high | 68 | 117,886 | 721 |

The original caps remain 120 draw calls / 300k triangles, particle capacities 200/600/1000 and dynamic-light counts 0/2/4. Dense east-satellite medium evidence remains within 109 draw calls / about 175k triangles. Pool pressure can still shed cosmetic particles under stress, as designed.

## Limits

Physical iPad Safari, touch play, hardware frame rate, sustained thermals and two-human readability: **NOT RUN**. No public deployment or running production worktree restart performed. Automated geometry/object counts and SwiftShader screenshots do not prove iPad performance or owner art approval. Existing unrelated modified test evidence in the checkout is left untouched and excluded from this commit.
