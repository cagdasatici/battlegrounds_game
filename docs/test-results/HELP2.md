# HELP2 verification · 1 November 2026

Branch `codex/help2` (from `codex/help1`, which holds HELP1 `7cfc40d`). Status: IMPLEMENTED (DEVICE CHECK PENDING).

Welcome now has "How to play" (`data-act=guide`). It mounts the HELP1 guide as a local overlay with no network request. Back restores Welcome and focuses the launcher. Try practice closes the guide and calls the existing `flow.practice()` once, so invitation handling, errors, server-confirmed progression and Leave are unchanged. The guide is replayable; no stored first-run or tutorial state. Auth and progression are untouched.

Sparring copy: `SPARRING_GUIDE_AVAILABLE = false` in `apps/client/src/main.ts` with a TODO(BOT4C). Whichever of HELP2/BOT4C lands second must connect it to the real Host sparring action and exercise both paths. Not done here because no such action exists on this branch.

## Executed checks
- `tests/browser/onboarding-flow.spec.ts` 2/2 PASS (local Google Chrome): unauthenticated open/back with zero /api or /matchmake requests and focus restored to launcher; invited guide, Try practice, first server-confirmed move step, leave, reopen, three cycles with identical room-request counts per cycle.
- Also PASS with it: how-to-play.spec.ts and flow.spec.ts (12/12 in the combined run).
- pnpm typecheck, pnpm lint, pnpm build, pnpm content:validate: PASS. Unit suite: see ledger.
- Full `pnpm test:browser` and `pnpm verify` not run as a whole (HELP1 noted the full test stage stalls).

Physical iPads: NOT RUN (DEV1).
