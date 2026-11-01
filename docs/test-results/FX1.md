# FX1 test report: hit impact effects

Real results from this worktree (macOS, Node 24, Chromium via SwiftShader).

| Check | Result |
|---|---|
| `pnpm verify` (typecheck, lint, vitest, build, content:validate) | exit 0; 71 files, 1044 tests passed, 2 todo |
| `tests/unit/hitfx.test.ts` (pool caps 200/600/1000, overfill, expiry, dispose, flash scales with flashLevel, freeze N frames, shake decay, Reduced Motion zero shake, full event table) | passed |
| `pnpm test:browser` | 40 passed, including `tests/browser/hitfx.spec.ts` |
| hitfx.spec evidence (`FX1-playwright.json`) | pool peak active 10 particles (light hit); victim `flashing` true 0 frames after the effect spawned (limit 2) |
| iPad / physical device | NOT RUN |

Notes
- One earlier `pnpm verify` run failed `tests/integration/ea-base.test.ts` (ea.b2 recast, "timeout waiting for two active ticks") under machine load. That is server code FX1 did not touch. It passed alone and in the next full `pnpm verify`.
- Heavy hit, block, counter, heal and KO are covered by unit tests with fake views; the browser run exercised a light hit on the practice dummy only. Block, counter, heal and KO are not yet verified in a real room (nothing emits `heal`; the server sends no event `position`).
- Camera shake setting is hard-coded to 0.25 (TODO in `HitFx.ts`).
- Deviation from Owns, authorised by the coordinator: additive edits to `fx/index.ts`, `main.ts` and `GameScene.ts` (viewFor, shake, onFrame hooks). See `docs/decisions/0024-hit-impact-effects.md`.
