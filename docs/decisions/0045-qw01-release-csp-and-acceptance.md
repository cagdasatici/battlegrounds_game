# 0045 QW01 release acceptance decisions (delegated)

The owner delegated design decisions to the orchestrator. Not a human sign-off.

1. Defect found and fixed at the root: the release CSP is `style-src 'self'` (no unsafe-inline). `HowToPlay.ts` and `SparringSetup.ts` injected a `<style>` element with text, which the browser blocks in the production build (it works under the Vite dev server, which sends no CSP, so no earlier test saw it). Both now use `apps/client/src/ui/adoptCss.ts` (a constructed stylesheet set through the CSS object model, which CSP allows) and remove it on dispose. The CSP was not loosened. Every QW01 browser context fails its test on any console message that mentions the Content Security Policy.
2. Offline with no session: the cached shell loads and shows the existing plain "cannot reach the game" state with Retry and Back. This is accepted as the offline Welcome; no separate offline Welcome was built. Back online, Retry for a visitor with no invitation shows the plain invitation message.
3. Update while in a room: the update check runs only on the Welcome screen, so a build published during a match is offered after Leave, never mid-match. Accepted as designed (WEB2); no reload happens under the player.
4. Disconnect test: the server drops the guest socket after 5.5 s of uptime because the Colyseus SDK does not auto-reconnect a room younger than 5 s (its `minUptime`). A drop inside the first 5 s returns the guest to Welcome. Accepted; a real loss that early is a new join.
5. Seat expiry is exercised as a released seat: with the device unable to return, the sparring seat is freed after the 20 s reservation (real time, the Colyseus window). The injected test clock moves only link and sparring-directory deadlines.
6. Full roster is exercised through a listed four-fighter sparring match (shown as a disabled "Full" row); the arena full and last-seat race stay covered by `tests/integration/room-list.test.ts`.
