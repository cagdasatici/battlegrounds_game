# BOT6 — Bots use the whole kit

Executed 2026-11-03 (iPad checks: NOT RUN; server-only slice).

| Command | Result |
|---|---|
| `pnpm vitest run tests/unit/sparring-brain.test.ts` | 29 passed |
| `pnpm vitest run tests/integration/bot6-full-kit.test.ts` (3 repeat runs) | 1 passed each |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | 124 files passed, 1 skipped; 1658 tests passed, 2 skipped, 2 todo |
| `pnpm build` | pass |

`content:validate` not run: no data files changed.

## Notes
- Dash is observable as combat action `Dash`; the integration test samples it per tick.
- Slot-1 path never sent skillUp, so bots send skillDown only. Ember Artificer Base slot 3 is excluded (TODO(BOT6)).
- Integration test places bots/human on the central island at start and after each bot respawn: bots have no
  map-wide routing, and without placement two bots stayed stuck on spawn islands (observed, td bot never cast).
- Fighting in the test kills the human and bots; rooms respawn them as normal.
