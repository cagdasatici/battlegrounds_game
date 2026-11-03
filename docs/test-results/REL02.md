# REL02 test report: reuse entity ids

Executed 2026-11-03 (Node v26.10.0, engine warning for 24.22.2 ignored by pnpm).

| Command | Result |
|---|---|
| `rg -n nextEntityId apps tests packages` | 0 hits |
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (boundaries ok, timers ok) |
| `pnpm vitest run tests/unit/entity-id-alloc.test.ts tests/integration/rel02-entity-reuse.test.ts` | 2 files, 4 tests passed |
| `pnpm test` (full) | 122 files passed, 1 skipped; 1645 tests passed, 2 skipped, 2 todo |
| `pnpm build` | pass |

Notes: practice protocol allows at most 2 bots, so the test cycles 130 times with 2 bots (260 bot lives, past the uint8 limit) instead of 100 cycles of 3. Test lifts only the practice command token bucket; traffic uses real sockets. Stale-event check uses a real CombatBus on a real client.
Physical iPad: NOT RUN (not applicable).
