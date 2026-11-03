# HYG01 test report

Executed 2026-11-03 on node v26.10.0 (repo wants 24.22.2; engine WARN only).

| Command | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (boundaries ok, timers ok) |
| `pnpm test` (run 1) | 9 failed in tests/integration/admin.test.ts, 1636 passed; admin.test.ts passes 12/12 in isolation, with and without HYG01 (load flake) |
| `pnpm test` (run 2) | 1 failed (latency-matrix A08 rtt 80 ms jitter 40 ms), 1644 passed; latency-matrix.test.ts passes alone (flaky under load) |
| `pnpm build` | pass |
| `playwright test --list` | 134 tests in 34 files load (catches import errors) |
| `pnpm test:browser` sparring-setup, how-to-play, admin, settings, sparring-flow | 25 passed, 1 failed: sparring-flow.spec.ts:162 (`[data-act=ready]` not found). Fails identically with HYG01 changes stashed, so pre-existing, not caused by HYG01 |
| full `pnpm test:browser` | NOT RUN to completion (stalled/very slow after 9 tests; killed) |

Evidence check: with `EB_EVIDENCE` unset, `git diff docs/test-results` is byte-identical before and after the test runs
(32 pre-existing modified files, untouched by runs). Artefacts landed in gitignored `test-results/evidence/`.

SPARRING_GUIDE_AVAILABLE: the Host sparring button is created unconditionally in the welcome flow
(apps/client/src/main.ts, `sparButton`), so the flag is now `true` and the TODO removed.

Open item (spec stop point): the 32 modified files under docs/test-results were NOT reverted and NOT committed.
Owner must say whether to keep or `git checkout -- docs/test-results`.
