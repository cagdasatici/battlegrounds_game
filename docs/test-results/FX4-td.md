# FX4-td test report

Slice: Tide Duelist ability effects (apps/client/src/fx/kits/td.ts, registered in fx/index.ts).
- `pnpm vitest run tests/unit/fx-td.test.ts`: 5 passed. Covers: a recipe for every `td.*` id in TD_DEFS and no extras,
  every recipe within the 100 particle low-quality cap (low pool holds 200), windup once per action start and active
  once more, impact only for a td hit, vanished player state dropped, and all particles expire.
- `pnpm typecheck`, `pnpm lint`: pass. Full `pnpm test`: 83 files, 1183 passed, 2 todo.

Not done / limits: the windup decal is a ring of 12 particles at the recipe radius, not a mesh decal. Radii are recipe
constants, not read from each ability shape at runtime (`shapeRadius` exists for checks). Windup and active effects are
triggered by a requestAnimationFrame scan of replicated players.
NOT RUN: visual read in a real fight, GPU cost, iPad.
