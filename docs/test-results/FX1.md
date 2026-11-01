# FX1 test report

Commands run on the Mac (node v26.10.0, engines wants 24.22.2; Chromium 1248 via EB_CHROMIUM):
- `pnpm typecheck`: pass.
- `pnpm lint`: pass (boundaries ok, timers ok).
- `pnpm vitest run`: 1157 passed, 2 todo, 1 failed before fixing `game-scene.test.ts` (the pool mesh `fx.pool` was not an
  allowed scene mesh name; the assertion now allows it). After the fix `game-scene` and `hitfx` pass (20 tests).
  Full unit suite not re-run after that one-line fix.
- `pnpm exec playwright test tests/browser/hitfx.spec.ts`: pass. Evidence in `docs/test-results/FX1-playwright.json`:
  confirmed hit, pool active and victim flashing on the same frame as the event.
- `pnpm build`: the root script fails on `assets:audit` because of the untracked `assets/.DS_Store`, which is not part of
  FX1. `pnpm run build` in `apps/client` passes.
- Full `pnpm test:browser`: 41 passed (5.2 m), including the new hitfx spec.

NOT RUN: iPad (visual read of flash, hitstop and shake; frame rate with a full 1000-particle pool), real GPU timing,
Reduced Motion in the browser (unit tested only).
