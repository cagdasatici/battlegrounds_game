# BOT3 — Host setup controls

Date: 1 November 2026. Runtime: Node v24.22.2 (repository pin).
Prerequisite: BOT0 DONE, frozen contracts from f8a66a5, completed verification
recorded in docs/test-results/BOT0.md. Shared export names and types match the plan.

## Delivered

- `apps/client/src/ui/SparringSetup.ts` exports the frozen standalone
  `mountSparringSetup(root, actions): () => void` interface. Default one Medium
  bot, ordered 0–3 opponent rows, all three difficulties, Stone Vanguard and
  Tide Duelist choice. Start freezes setup; successful End permits a new setup.
- Injected start/copyLink/end callbacks only; no live networking or main.ts edits.
  Pending mutations suppress repeated clicks and errors allow retry without
  exposing callback error details. Three bots disable guest-link creation.
- Each copy request obtains a fresh URL; clipboard denial/unavailability exposes
  a read-only selected input. URLs are cleared on subsequent operations/disposal.
  Disposal aborts listeners, removes the view and ignores pending completions.
- `tests/browser/sparring-setup.spec.ts` uses a local Vite fixture defined in
  the test file, with injected callbacks and deterministic pending/failure modes.

## Executed checks

- `pnpm typecheck`: PASS on pinned Node 24.
- `pnpm exec playwright test tests/browser/sparring-setup.spec.ts`: PASS,
  6 tests in real Chromium. Covers defaults, difficulty ordering, add/remove
  limits, both fighters, zero-bot Start, frozen roster, full bot roster, pending
  duplicate suppression, retry for all actions, end/rehost, selected clipboard
  fallback, clipboard success and disposal during each pending action.
- Screenshot: `docs/test-results/BOT3-setup.png`, 1024×768 touch-enabled Chromium;
  visually inspected, all three bot rows and setup actions fit within viewport.
- Initial sandboxed browser/full-suite attempts encountered forbidden listening
  sockets; stopped and rerun with local socket access. The first authorized
  browser run found hidden-label CSS overriding the hidden attribute; fixed
  scoped hidden styling and all six tests passed on rerun.
- `pnpm verify`: aggregate NOT PASSED. Typecheck/lint passed; 89 files and
  1261 tests passed, 2 existing TODOs. One existing latency-matrix A20 reconnect
  case at 250 ms RTT / 40 ms jitter failed with MatchMakeError at line 155.
  This run also discovered concurrent BOT1/BOT2 work in the shared workspace;
  those files were not edited or staged for BOT3.
- Isolated retry `pnpm exec vitest run tests/integration/latency-matrix.test.ts`:
  PASS, 37 passed / 2 existing TODOs, 170.82 seconds. Aggregate failure remains
  recorded; no latency test or transport changes were made.
- `pnpm build`: PASS, including assets:audit (28 entries, 3 fighters, 93 clips).
  Existing large client chunk warning remains. Initial sandboxed build hit a
  forbidden tsx IPC socket; authorized rerun passed.
- `pnpm content:validate`: PASS, content hash 6361e0b51fe4a072.
- `git diff --check`: PASS.

## Limitations

Physical iPad checks: NOT RUN. This standalone view is not yet reachable from
the game; live flow, authenticated links and server capacity enforcement belong
to BOT4C/BOT4. No invitation was delivered and no service was deployed.
