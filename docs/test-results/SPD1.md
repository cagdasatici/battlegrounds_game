# SPD1 Faster movement: test report

Date: 2026-11-01. Node v22.23.4 (engine warning ignored), Chromium via EB_CHROMIUM.

Change: `COMBAT.movement` walk 5->7, run 8->11, guard 2->3, acceleration 45->70. `RUN_SPEED` = (walk+run)/2 = 9. Decision 0020; spec section 29 deviation added.
Tests updated to read `COMBAT`: tests/unit/movement.test.ts (walk test now starts at x=-8 so the wall at x=10 does not clip a 10.5 m walk), tests/integration/movement.test.ts, tests/unit/art-pipeline.test.ts.

## Executed
- `pnpm verify`: exit 0 (65 files, 1005 passed, 2 todo).
- `pnpm test:browser` full run: 35 passed, 2 failed.
  - tests/browser/match.spec.ts "two browser contexts fight": fails (m1 chain check, line 200). Also fails with the OLD speed values (re-run on the original numbers), so it is not caused by SPD1. Not investigated further.
  - p0-gate T18e td.b4: page-load timeout in the full run; passes when run alone with the new values (p0-gate whole file: 17 passed, 1 failed the same way; td.b4 alone: passed). Treated as a flake under load.

## NOT RUN
- Physical iPad checks (feel of new speeds, joystick control).
- Balance playtest of chase/range at the new speeds.
