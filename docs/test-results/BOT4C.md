# BOT4C — Connect the sparring client journey

Date: 1 November 2026. Prerequisite: BOT3 99e5722 (ledger 848898f).
Status: IMPLEMENTED (DEVICE CHECK PENDING).

## Behavior and scope

- Welcome exposes Host sparring. The BOT3 setup creates a private match, joins using the returned code and sends the selected sv/td kit through the existing Ready path. Running hosts can reopen controls to copy a fresh guest link or end the match. Setup suppresses overlapping starts and permits retry after failure; failed joins release the created match where the end route is reachable.
- The spar fragment is removed before boot requests. Its bearer remains in memory until redemption or disposal. Fresh guests can enter a display name, redeem the link, choose a fighter in the existing lobby and Ready. Matching guest tickets use the redemption CSRF; ordinary endpoints continue to obtain adult CSRF.
- Page reload recovers scoped credentials through GET /api/sparring/guest. A fresh ordinary Welcome makes no recovery request, preserving its existing no-invitation behavior.
- Host Leave ends its match before leaving; guest Leave only leaves its room. Server room closure returns the guest to Welcome. Pending joins cannot transition back into the lobby after Back/disposal. Existing combat bus and presentation subscriptions remain intact.
- No server, bot, ability, asset, dependency or protocol changes. Untracked BOT1 work present at session start was left untouched.

## Executed checks

All final checks used the pinned Node 24.22.2 and pnpm 10.28.0.

| Check | Result |
|---|---|
| pnpm verify | PASS: 91 files; 1,279 tests passed, 2 existing TODOs; typecheck, lint, build, asset audit and content validation passed |
| Final pnpm typecheck | PASS |
| Final targeted sparring-flow + app-flow unit run | PASS: 24 tests in 2 files |
| Final tests/unit run | PASS: 1,133 tests in 63 files, including pre-existing untracked BOT1 tests |
| Existing sparring-setup browser suite | PASS: 6 tests |
| Existing flow browser suite after recovery fix | PASS: 7 tests |
| 1024×768 touch browser layout and fragment smoke check | PASS: zero page errors, fragment consumed/stripped; BOT4C-welcome.png and BOT4C-setup.png |
| git diff --check | PASS |

The first browser regression run found an extra recovery request on a fresh Welcome. Recovery was restricted to reload navigation; the affected suite then passed. Initial sandbox attempts could not bind local ports/tsx IPC sockets; verification completed with local execution permission. Build retains the existing large-chunk warning.

## Coverage and limitations

The new fake transport tests cover exact create/link/end requests, request ordering, scoped CSRF isolation, cookie recovery, route errors (401/403/409/429/503), malformed credentials, host start suppression, selected Ready kit, failed-start retry, guest flow, ordinary practice, unsubscribe and late-join cleanup. The browser smoke check verifies fragment removal using the actual boot-options reader without including credentials in screenshots.

Actual hosted-room combat and two-context guest/host sparring journeys are NOT RUN in this client slice: BOT4 supplies server integration and BOT5 owns their end-to-end acceptance. The existing real-server browser app-flow regression passed. Physical iPad selectors, reconnect, clipboard and ten-minute matches: NOT RUN.
