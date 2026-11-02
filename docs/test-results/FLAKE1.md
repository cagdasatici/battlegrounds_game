# FLAKE1 Browser debug-probe and load flakes

Status: DONE. Environment: Apple Mac (arm64), Node 24, Playwright Chromium on SwiftShader, Vite dev client, in-process Colyseus server.

## Root cause: `window.__eb` undefined mid-run
Every browser spec starts its own Vite dev server on `apps/client` with the file watcher and HMR on. Any file change under `apps/client/src` while a spec runs (another agent editing, `git pull`, a checkout) makes Vite send a full-page reload (`[vite] (client) page reload src/fx/Sfx.ts`) to every open test page. The page restarts, `window.__eb` and the room are gone, and the next `__eb.snapshot()` throws `Cannot read properties of undefined (reading 'snapshot')`. Longer runs (QP02's 2 minute run) and busy shared checkouts (QF02, QF03, QV09 reports) hit it more often. A reload during `page.goto` also explains the `ERR_ABORTED` seen in the art specs. It is a harness problem; the product never reloads on its own (UpdateWatcher reloads only on a user click, the service worker is not registered in dev). Ruled out by instrumentation: page crash, unexpected WebSocket close, `beforeunload` outside the spec's own navigations, and Vite dependency re-optimisation (cache hit, no reload logged), over 4 loaded runs (14 busy processes on 18 cores, plus 3 concurrent runs with 40).

## Reproduction (quality-bridge `reduced-medium`, one worker, `touch apps/client/src/fx/Sfx.ts` 40 s into the run)
- Before: 3 of 3 failed (`Cannot read properties of undefined (reading 'snapshot')` once, `Cannot set properties of undefined (setting 'hp100')` twice, the latter because the reloaded page left the room and the spec's fixture lost the fighter).
- After: 0 of 3 failed (3 passed, about 58 s each). Without the touch, the earlier unmodified runs passed, so CPU load alone never reproduced it (3 of 3 plain loaded runs passed before the fix).

## Fix
`hmr: false, watch: null` in the `server` options of all 25 browser specs that create a Vite server. New guard `tests/unit/browser-dev-server-guard.test.ts` fails for any spec that creates a Vite server without both options (26 tests).

## Unit and integration flakes
- hitfx "spray travels away from the attacker": not load related. The test counted every spawned particle with `vx > 2`, but the 4 round burst particles point in random directions and sometimes exceed 2. Before: 6 of 30 isolated runs failed. Fixed to judge only the 10 spray particles (life 0.22): 0 of 30.
- ea-base `ea.b2` recast: the wait used `tick === activeStart + 2`; the fixed clock can advance several ticks in one event-loop turn under load and skip the exact value. Now `>=`. Not reproduced before or after in 8 loaded runs (24 busy processes); the change is by inspection, not measured.
- latency-matrix A20: NOT root-caused. Passed in 3 of 3 loaded isolated runs. It failed once in a full `pnpm test` (A20 rtt 250 ms jitter 40 ms, `SERVER_OFFLINE` from `RoomClient.mapJoinError`, with `Room connection was closed unexpectedly (1006)` and the Colyseus note "Room has not been up for long enough for automatic reconnection (min uptime: 5000ms)" in the log); the immediate rerun of the full suite passed. Open item: the A20 setup joins through the delay proxy and a seat dropped within about 170 ms of joining; the next step is to log which join step throws.

## Checks
typecheck PASS; lint PASS; build PASS; `pnpm test` second run 106 files passed + 1 skipped, 1531 tests passed (the first run had the one A20 failure above). Browser, one worker: quality-bridge (4), quality-skills (11), hitfx, art, art-game: 22 passed, 0 failed (9.8 m).

## NOT RUN
Physical iPad checks; the 2 minute QP02 long run (not repeated).
