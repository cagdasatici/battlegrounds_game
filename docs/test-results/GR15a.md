# GR15a Confirmed-hit practice lesson

Baseline commit: 8f198fb. Node 24.22.2, pnpm 10.28.0. Decision: docs/decisions/gr-GR15a.md.

Changed: new `apps/server/src/sim/PracticeDrills.ts` (DrillTracker, ResolvedHitSummary); `TickPipeline` optional `onResolvedHits` (frozen summaries, called after resolution); `ArenaRoom` no-op hook; `PracticeRoom` registers `practiceDrill` (practice only, existing 4/s bucket), resets the pair, locks toggles/bots during a lesson, sets owner fields from the tracker; `PlayerSchema.owner` +drillId/drillState/drillStartTick/drillSuccessTick; `protocol.ts` +PracticeDrillSchema, ClientMessage.practiceDrill, **PROTOCOL_VERSION 3 -> 4**; `PracticePanel` "Combat lessons" section (Land a strike / Retry / Exit, 44 px targets); `main.ts` wiring. `sv-base.test.ts` message vocabulary fixture updated. Dummy/player lesson positions: see decision (seam conflict).

## Executed checks
- `pnpm typecheck`, `pnpm lint`, `pnpm content:validate`, `pnpm build`: pass.
- `pnpm test`: 140 files passed, 1 skipped; 1844 passed, 2 skipped, 2 todo, 1 failed (sv-base message vocabulary fixture, then fixed and rerun green with practice suites: 22 tests in 4 files).
- New unit `practice-drills`: 11 tests (tracker table). New integration `practice-drills`: 3 tests (real clients: miss does not complete, one M1 hit completes once, client success claims ignored, duplicate start, retry, exit, bots cleared, controls locked then restored, invalid payload, FFA room unaffected).
- Browser `practice-drills.spec.ts`: 4 passed (1024x768 and 1180x820, right and left-handed with reduced-motion on the left runs), plus existing `practice.spec.ts`: 1 passed. Screenshots: docs/test-results/GR15a-lesson-{running,success}-{right,left}-{1024x768,1180x820}.png.

## Limits
Left-handed/reduced-motion are checked through stored settings in headless Chromium, not a device. No bot-spawned or multi-hit lesson variants. Physical iPad checks: NOT RUN.
