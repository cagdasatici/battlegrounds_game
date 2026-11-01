# FX4-sv test report

Slice: Stone Vanguard ability effects (apps/client/src/fx/kits/sv.ts, registered in fx/index.ts; shared machinery in fx/kits/common.ts,
extracted from td.ts with its exports unchanged).
- `pnpm vitest run tests/unit/fx-sv.test.ts`: 6 passed. Covers: a recipe for every `sv.*` id in the kit defs (11) and no extras,
  every recipe within the 100 particle low-quality cap, windup decal radius derived from the ability shape, windup once per
  action start and active once more with everything expiring, impact only for a sv hit, vanished player state dropped.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm content:validate`: pass. `pnpm vitest run tests/unit`: 59 files, 1067 passed.

Element language: fans of thrown chips and ground fractures.
Not done / limits: decal is a ring of 12 particles (radius clamped to 1-10 m), not a mesh decal. Effects are triggered by a
requestAnimationFrame scan of replicated players. Browser and network suites were not re-run for this slice.
NOT RUN: visual read in a real fight, GPU cost, iPad.
