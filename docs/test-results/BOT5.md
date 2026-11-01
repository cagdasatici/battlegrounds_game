# BOT5 — End-to-end sparring journeys

Date: 1 November 2026. Prerequisites: BOT4 57ac46d; BOT4C b0c2383.
Status: IMPLEMENTED (DEVICE CHECK PENDING).

## Browser acceptance

`tests/browser/sparring-flow.spec.ts` runs the real client with Vite proxying HTTP and WebSockets to a local authoritative server. Each player uses an isolated Chromium browser context, a 1024×768 viewport and touch support. The pinned Node 24.22.2/pnpm 10.28.0 runtime and local Playwright Chromium 156 run with SwiftShader.

All five targeted journeys PASS (30.8 seconds):

1. Solo Easy: selected fighter joins through setup and Ready; the bot's ordinary M1 attacks reduce replicated host HP. Attack, guard, skill and movement controls are visible. Host ends and creates a different match.
2. Mixed Medium/Hard: deterministic server fixtures arrange poses and an observable legal Windup. The browser sees Medium guard and Hard cast `sv.b1`. The shared combat invariants hold. Fixtures arrange observations; they do not substitute client damage claims or a new combat handler.
3. Zero bots/fresh guest: copy obtains a real fresh link, clipboard denial reveals its selectable fallback, and a new isolated context strips the fragment, redeems, chooses a fighter and sends Ready. The guest has a scoped cookie and no ordinary session cookie. Real pointer input on the touch Attack control causes the KO; both browsers replicate the same HP/kills/deaths. Host end returns the guest to Welcome.
4. Full room: three bots plus host fill the roster; Copy is disabled and the real link endpoint returns 409.
5. Expired link: injected wall time crosses the ten-minute TTL; a fresh guest receives 401 and the invitation error without receiving membership credentials.

Fixtures place fighters on continuous main-island ground and, for the KO, lower the victim's HP. Actual hits, damage, interruption, death and scoring remain authoritative and use the existing tick pipeline. The mixed-tier fixture pauses the existing scheduler and advances integer ticks; it installs no second scheduler.

## Executed checks

- Targeted BOT5 Playwright suite: PASS, 5/5.
- `pnpm typecheck` and `pnpm lint`: PASS before the final full run.
- First final `pnpm verify` while the full browser suite ran concurrently: FAIL, 1,289 tests passed and one existing R18 A20 reconnect row (RTT 20 ms/jitter 40 ms) raised MatchMakeError. Earlier BOT1/BOT4 full gates passed. Load sensitivity is an inference, not a proven cause; the serial full rerun passed: 92 files, 1,290 tests, 2 existing TODOs; typecheck, lint, build, assets:audit and content:validate all passed. No production changes were made between these runs.
- Full `pnpm test:browser`: PASS, 52/52 in 5.6 minutes, including ordinary invite, FFA, dummy practice, full ability matrix, layout/settings, effects, setup cleanup, and all five BOT5 journeys.
- `git diff --check`: PASS.
- Screenshot review: `BOT5-solo.png` and `BOT5-shared-outcome.png`; no bearer links or credentials visible.

## Actual limitations and device record

- Physical iPad A: touch difficulty selectors, guest clipboard, reconnect and ten-minute match — NOT RUN.
- Physical iPad B: touch difficulty selectors, guest clipboard, reconnect and ten-minute match — NOT RUN.
- Desktop Chromium with touch emulation is browser evidence only; it does not establish physical iPad behavior or performance.
- At 1024×768 the existing Sparring controls button overlaps part of the scoreboard control. Attack/guard/skill/movement controls remain visible. This test slice does not change the client layout.
- Bots use the specified direct approach and stop at obstacles/unsupported ground. No map-wide pathfinding is claimed.
- Existing large-chunk build warning remains. No deployment or invitation delivery was performed.
