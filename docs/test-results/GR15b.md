# GR15b Confirmed-block practice lesson

Baseline commit: 88f6f7a. Node 24.22.2, pnpm 10.28.0. Decision: docs/decisions/gr-GR15b.md. PROTOCOL_VERSION unchanged (4).

Changed: `PracticeDrills.ts` (block observe, `attackDue`, `BLOCK_DRILL`), `PracticeRoom.ts` (temporary `drill:dummy` pipeline seat, one-tick attack hold in `beforeDrain`, staged placement, cleanup), `protocol.ts` (`block` enum), `PracticePanel.ts` / `main.ts` ("Block a strike", lesson-aware Retry/Exit and copy). `TickPipeline.ts` needed no change.

## Executed checks
- `pnpm typecheck`, `pnpm lint`, `pnpm content:validate`, `pnpm build`: pass.
- `pnpm test`: 140 files passed, 1 skipped, 1 failed; 1857 passed, 2 skipped, 2 todo, 1 failed (`admin.test.ts` disabled-hash route, timeout under full-suite load; rerun alone 12/12 pass).
- Unit `practice-drills`: 21 tests (10 new: success once, 7 non-passing outcomes, cross-lesson, integer schedule). Integration `practice-drills`: 6 tests (3 new, real clients: placement/guard-early/frontal block once/seat teardown; wrong facing, repeated equal first hits 180 ticks apart, retry, exit restores home and cancels; late guard, death stops dummy without success). Run 3 times, 27/27 each.
- Browser `practice-drills.spec.ts`: 8 tests (4 new Block a strike, 1024x768 and 1180x820, right and left-handed with reduced motion), plus `practice.spec.ts`. One transient failure of the unchanged Land a strike 1180x820 test in an evidence run; 3 isolated reruns passed. Screenshots: docs/test-results/GR15b-lesson-{running,success}-{right,left}-{1024x768,1180x820}.png.

## Limits
Left-handed/reduced-motion via stored settings in headless Chromium, not a device. Block lesson staged at x=2 (see decision). Physical iPad checks: NOT RUN.

## Flake fix 2026-11-04
Symptom: under full-suite load the "wrong facing and late guard" test timed out waiting for `retry` (GR15c "evade success" also failed in the same runs). Reproduced with a concurrent `pnpm test` plus looped file runs; at failure the server's drill `startTick` was unchanged, i.e. the Retry message had not been processed 3 s after sending, and the client had seen only the first hit.
Root cause (test, not product): the test loop and `waitFor(() => drv.send(...))` polled every 10 ms, sending about 100 inputs/s against the server limit of 45/s (`RATE_LIMITS.inputPerSecond`). Every excess packet is dropped and logged, which under load delayed traffic on the same socket behind the flood. No product code is involved: Retry, seat and tick scheduling are all tick-based and were correct.
Fix: `Driver.send` in tests/integration/practice-drills.test.ts is paced to one packet per 25 ms (held-state inputs, so skipped packets lose nothing). No timeouts, skips or retries changed.
Executed: file 20/20 pass in a loop with a concurrent full `pnpm test` (the suite load covered roughly the first 3 minutes of the loop, then a second file run), zero "input rate limited" lines; full `pnpm test` 148 files passed, 1 skipped, 1912 tests passed; typecheck and lint pass. Before the fix the same method failed 2 of 8 file runs and 2 of 2 full runs.
