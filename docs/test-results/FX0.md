# FX0 test report

Node v22.23.4 (engine warning ignored per instruction), pnpm 10.28.0.

- `pnpm verify`: exit 0. Vitest 67 files passed, 1011 tests passed, 2 todo. Includes new
  `tests/unit/combat-bus.test.ts` (dedupe, 512 ring eviction, stale life, dispose, listener unsubscribe, presentation
  disposer) and `tests/integration/fx0-events.test.ts` (2 real Colyseus clients: same `eventId` on both for a hit with
  `hitClass: "light"`, `targetHp100: 9600`, `moveId: "dash.forward"`; a slotted sv skill emits `cast` with `moveId`).
  typecheck, lint, build and content:validate (32 abilities) ran inside verify and passed.
- `pnpm test:browser`: exit 0, 37 passed (5.5 min). Result artifacts under docs/test-results were reverted.
- Cast audit: slotted, buffered, recast, awakening and m1 (including context moves via the m1 hook) commits all emit
  `cast`. No ability commit lacked one; dash emits no `cast` (not an ability commit), so none was added.
- Not covered by an integration test: `hitClass` "heavy" branches (unit-level only via code path, not asserted).
- iPad: NOT RUN.
