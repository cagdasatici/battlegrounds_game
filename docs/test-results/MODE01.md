# MODE01 test report: optional first-to-N KO rounds

Decision: docs/decisions/0054-optional-first-to-n-rounds.md (owner approval 2026-11-03). Date run: 2026-11-03.

## Executed
- `pnpm typecheck`: pass. `pnpm lint`: pass (boundaries ok, timers ok). `pnpm build`: pass.
- `pnpm test` (full): 126 files passed, 1679 tests passed; the one failure (a fake-DOM assertion in the new tests/unit/round-results.test.ts) was a test bug, fixed, and that file re-run: 4 of 4 pass. The full suite was not re-run after that one-line test fix.
- `tests/integration/mode01-rounds.test.ts` (real HTTP, real Colyseus client, hand-stepped integer ticks): 5 of 5 pass.
  - target reached: phase flips to `roundOver` on the exact KO tick; `roundOver` message carries tick, `resumesAtTick = tick + 600` and sorted standings.
  - inputs (attack hold, skill edge) sent by the real client during roundOver change nothing; no non-respawn combat events; HP, position and action unchanged for 599 ticks.
  - tick KO+600: scores reset to 0/0/0, all fighters alive at full HP on new life ids, phase `playing`, two `respawn` events; a second round can end again.
  - `roundTarget` 0 (default): kills 40 never ends the round.
  - open FFA: join options with `roundTarget` refused; admin create without bots plus `roundTarget` refused; arena room without bots ignores a `roundTarget` in metadata; admin bot room honours it; sparring accepts only 0, 5, 10.
- `tests/unit/round-results.test.ts`: results card countdown, standings order, message-before-patch race, hide, dispose.
- `tests/browser/sparring-setup.spec.ts`: 6 of 6 pass, including the new Round length selector (endless omits `roundTarget`; "First to 10" sends it).

## Not green, not caused by MODE01
- `tests/browser/sparring-flow.spec.ts:141` and `:162` fail with and without this change (verified by stashing); `match.spec.ts:101` failed in the same run (known flake). Not investigated here.

## Limits
- The fifth KO in the integration test is produced by the real scoring path (recorded damage plus a void ring-out), not by melee input; kills 1 to 4 are set directly as a fixture.
- No browser test of the results card over a live match; it is covered by the fake-DOM unit test only.
- Admin room-create UI has no round selector (API accepts it); practice rooms have no rounds.
- iPad / physical device check: NOT RUN.
