# GR15c Telegraph-evasion practice lesson

Baseline commit: af4cb4e. Node 24.22.2, pnpm 10.28.0. Decision: docs/decisions/gr-GR15c.md. PROTOCOL_VERSION unchanged (4); no message or owner field added (enum value `evade`, owner string `failed`).

Changed: `PracticeDrills.ts` (EvadeTrial, footprint helper), `PracticeRoom.ts` (sv dummy, cast edge, observeEvade, kit restore), `protocol.ts` (`evade` enum), `PracticePanel.ts` / `main.ts` ("Leave the warning", prep/failure copy). `TickPipeline.ts` needed no change.

## Executed checks
- `pnpm typecheck`, `pnpm lint`, `pnpm content:validate`, `pnpm build`: pass.
- `pnpm test`: 141 files passed, 1 skipped; 1877 passed, 2 skipped, 2 todo, 0 failed.
- Unit `practice-drills`: 37 tests (16 new: due tick, success, 9 failing outcomes, other attacker, void, fresh retry, footprint geometry). Integration `practice-drills`: 9 tests (3 new, real clients: stationary hit fails and Exit restores td; sideways passes once, Retry fresh trial, outside start and guard fail; death and kit change cancel). 3 runs, 27/27. `sv-base` unit+integration: 67 passed.
- Browser `practice-drills.spec.ts` + `practice.spec.ts`: 13 passed (4 new Leave the warning: 1024x768 and 1180x820, right and left-handed with reduced motion). Screenshots: docs/test-results/GR15c-lesson-{prep,failed,success}-{right,left}-{1024x768,1180x820}.png.

## Limits
Left-handed/reduced-motion via stored settings in headless Chromium, not a device. The browser test steps sideways with a tight poll on the replicated windup; the 24-tick windup is tight for human play and is unchanged by design (no slower timing). Staged at x=2 (see decision). Physical iPad checks: NOT RUN.
