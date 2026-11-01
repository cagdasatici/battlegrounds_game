# WEB2 test report: update button

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only).

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| pnpm test | PASS: 100 files passed, 1 skipped; 1344 tests passed (includes tests/unit/update-watcher.test.ts, 9 tests: same build, new bundle, buildId-only change, waiting worker, in match, offline, overlapping checks, single timer/listener, dispose) |
| pnpm build | PASS |
| playwright tests/browser/update.spec.ts | PASS (3 consecutive runs): no button on same build; a second served build shows Update; tap activates the waiting worker, reloads, old cache deleted |
| playwright install.spec.ts, flow.spec.ts | PASS (regression) |

Behaviour: the page compares its loaded `/assets/*` scripts with the latest `/asset-manifest.json` (client bundle, not buildId). buildId is fetched for display only. Checks run on launch, on visibilitychange and every 10 min, only off the match screen. The button is hidden while a room is joined and `apply()` refuses in a match. VERSION_MISMATCH error screen also offers Update. No automatic reload.

Not run: physical iPad checks (home-screen app update flow): NOT RUN.
Limitations: the button reloads onto the new files only after the new worker installs (waits up to 5 s, then reloads anyway). sw.js needed no change: it already waits and handles SKIP_WAITING.
