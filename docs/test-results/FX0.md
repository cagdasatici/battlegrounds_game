# FX0 test results (2026-11-01)

Slice: combat event contract and presentation bus (decision 0021).

| Check | Result |
|-------|--------|
| `pnpm verify` (typecheck, lint, test, build, content:validate) | exit 0; 70 files passed; 1028 tests passed, 2 todo |
| `tests/unit/combat-bus.test.ts` (7 tests: duplicate eventId once, ring of 512, stale life dropped, unknown fighter passes, dispose unsubscribes, listener unsubscribe, stub disposer) | passed |
| `tests/integration/fx0-events.test.ts` (2 real Colyseus clients; A hits B with M1) | passed: both clients got identical hit events with `hitClass` (heavy only for `m1.4.finisher`), `targetHp100` equal to the victim's HP after the hit, and `moveId`; every `cast` has `moveId` on both clients; non-hit events carry no `hitClass` |
| `pnpm test:browser` (Chromium) | exit 0; 39 passed |
| iPad / device checks | NOT RUN |

Notes: the cast-emit audit found all commit paths (M1, skillDown, buffered skill, awakening) already emit `cast`; none added.
`heal` is only a type member. Running the browser suite regenerates tracked evidence files under `docs/test-results`; those were reverted and not committed.
