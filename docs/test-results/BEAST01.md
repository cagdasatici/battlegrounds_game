# BEAST01 test report (2026-11-07)

Executed on the development Mac (Node v26.10.0, project engine asks for 24.22.2; pnpm warns). Physical iPad checks: **NOT RUN**. Balance and feel with real players: **NOT RUN**.

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm content:validate` | pass (islands.v1 hash 9a80341aa55229b2) |
| `pnpm build` (includes `assets:audit`) | pass |
| `pnpm vitest run` | see the final run recorded in the commit message of this task |
| `tests/unit/beast.test.ts` | config, hurtbox, throw safety, lifecycle, expiry, death, hit, duplicate, miss, block, non-lethal, interruption, velocity lock, capture discard |
| `tests/integration/beast.test.ts` | real client: warning, spawn, a real throw from beside the corner stays on the island, defeat heals and clears; friendly rules with bots |
| `tests/unit/beast-view.test.ts` | banner text, placement, telegraphs, camera-inside hiding, defeat, dispose |
| `tests/browser/beast.spec.ts` | real Chromium: warning banner, boss bar, windup telegraph, defeat banner, no page errors; screenshots in test-results/evidence (not committed) |

Arena change: existing tests that hard coded the old geometry were updated (respawn spawn anchors, bridge probe points, nav bounds, the GR04 start point and run length, a `-0` normalisation in the GR15b home check, and ArenaView landmark offsets).
