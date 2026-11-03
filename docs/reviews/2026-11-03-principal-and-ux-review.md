# Full-game review — 3 November 2026

Baseline: main at 2220911 (VIS01 merged). Reviewer lenses: principal engineer, then staff UX designer (game experience).
Implementation specs for the gaps below are in [backlog-v3](../backlog-v3.md). Ledger rows are in [tasks](../tasks.md).

## Executed checks at this baseline

| Check | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` (boundaries, timers) | PASS |
| `pnpm test` | PASS: 119 files, 1639 tests, 2 skipped, 2 todo, 171.9 s |
| `pnpm test:browser`, `pnpm build` | NOT RUN in this review |
| Physical iPad | NOT RUN |

## Part 1 — Principal engineer

### What is strong

- Authority model is right and consistently enforced. Clients send intent edges only; the server owns HP, hits,
  cooldowns, forms and score (`apps/server/src/rooms/ArenaRoom.ts`, `apps/server/src/net/ValidateInput.ts`).
- Fixed 60 Hz accumulator with a catch-up cap and an overload gate (`apps/server/src/sim/FixedClock.ts`). Timer lint
  forbids `setTimeout` damage scheduling. This is the hardest thing to retrofit and it is already done.
- Owner-only state through Colyseus `view()` keeps cooldown internals and tutorial state private (decision 0007).
- Join tickets are one-use, bound to room code, content hash and protocol version, and burned on failed comparison.
- Cleanup discipline: every `enterMatch` subscription, interval and rAF pushes a disposer (`apps/client/src/main.ts`).
- Test depth is unusual for a hobby game: 1,639 unit/integration tests with real Colyseus clients and a latency proxy.

### Findings (most severe first)

| ID | Severity | Finding | Evidence | Spec |
|---|---|---|---|---|
| E1 | High | **A single exception inside a tick has no containment.** `onSchedulerTick` calls `sim.advance` which calls `pipeline.step` with no try/catch, and the process registers no `uncaughtException` handler. One unforeseen ability edge case (null pose, removed entity mid-capture) throws on every subsequent tick from the Colyseus interval. Depending on where it surfaces, either the room freezes silently with connected players, or the Node process exits and every room drops. | `ArenaRoom.ts` `onSchedulerTick`/`stepTick`; `apps/server/src/main.ts` only handles signals | REL01 |
| E2 | High | **`entityId` is a `uint8` and is never reused.** `nextEntityId++` runs on every join, every bot add, every practice bot reset (`PracticeRoom` calls `clearBots(); addBots(...)`) and every dummy. After 255 allocations in one room instance the id serializes as `id & 0xff`, colliding with live players: wrong HP bars, wrong owner view, events routed to the wrong fighter. The OPEN_JOIN shared arena and a practice room where a child toggles bot count repeatedly are the realistic triggers. | `ArenaRoom.ts:66,151`, `BotArenaRoom.ts:32`, `PracticeRoom.ts:53,80`, `PlayerSchema.ts` `entityId: "uint8"` | REL02 |
| E3 | Medium | **Open-join sessions are bound to the source IP hash.** An iPad that moves between Wi-Fi and cellular, or a carrier that rotates CGNAT addresses, gets its session revoked on next `/api/open-session` and a new seat; the old avatar lingers for the 20 s reconnect reservation. Under Cloudflare Access the IP binding adds little security and costs reconnect reliability. This was a deliberate decision (0050), so it is an owner call. | `apps/server/src/http/sessionRoutes.ts` open-session handler | OPEN01 (owner decision) |
| E4 | Medium | **Test runs mutate committed evidence.** 30 test files write PNG/JSON into `docs/test-results/`. Every routine run dirties the tree (32 modified files at review time), which makes evidence non-reproducible and makes coherent commits harder for executors. | `tests/browser/*.spec.ts` `outDir` constants; `git status` | HYG01 |
| E5 | Low | `pipelineSeats()` in `BotArenaRoom` builds a new `Map` on every call, and `beforeDrain` allocates an enemy array per tick. Fine at 4 fighters; note for T30. | `BotArenaRoom.ts` | none (T30 note) |
| E6 | Low | `lifeId` is `uint16` and `lifeSeq` is room-lifetime; it wraps after 65,535 lives. Not reachable in a family session; add a labelled TODO when REL02 touches this file. | `PlayerSchema.ts` | REL02 note |
| E7 | Low | `main.ts` (659 lines) owns match wiring, HUD state assembly, debug probe and settings hooks in one closure. It works and is well cleaned up, but every new HUD feature lands here. New UX slices below add separate modules and only wire them from `enterMatch`. | `apps/client/src/main.ts` | structural rule in backlog-v3 |
| E8 | Low | HUD repaints at a fixed 10 Hz via `setInterval` and `JSON.stringify` diffing. HP drops therefore lag up to 100 ms behind the hit flash. Acceptable; the new damage feedback (UX12) runs on the existing capture rAF instead. | `main.ts` `drawHud`, `hudTimer` | UX12 |
| E9 | Info | `SPARRING_GUIDE_AVAILABLE = false` with `TODO(BOT4C)` although BOT4C is implemented. | `main.ts:41-42` | HYG01 (one-line fix) |

Engineering score at this baseline: architecture 88, reliability 74 (E1, E2), security 85, test evidence 86,
maintainability 75. The two High items are small, contained fixes and should land before any more feature work.

## Part 2 — Staff UX designer (game experience)

Method: read the HUD, flow, practice, bot and FX code paths and the existing Chromium screenshots. No human playtest
and no iPad run were possible in this review, so every claim below is about what the build *presents*, not measured
player behaviour. The QD01 playtest should validate these.

### What is strong

- Combat *feel* investment is real: hitstop, shake, damage-scaled flashes, per-ability telegraphs and signatures,
  synthesized audio, double jump, KO blast (FX0–FX5, QV01–QV09, UX10, VIS01).
- First-run path exists: welcome, How to play, server-confirmed practice steps, Add opponents from practice.
- Touch layout editor, handedness and reduced motion respect the target audience (children on iPads).

### The core experience problem

The game has strong *moment-to-moment* feedback on the fighter you are hitting, and almost no *situational*
information. On a touch screen with a third-person camera, players lose track of who is where, how hurt they are, and
whether they are winning. Concretely:

| ID | Impact | Gap | Evidence | Spec |
|---|---|---|---|---|
| X1 | Critical | **No opponent health or name in the world.** Nothing shows an enemy's HP, so players cannot tell whether to press or retreat, and a KO arrives as a surprise. Damage numbers are momentary. This is the single largest readability gap in a brawler. | No nameplate/HP code in `apps/client/src/scene` or `ui`; HUD shows only own HP | UX11 |
| X2 | High | **Off-screen threats are invisible.** In 3–4 fighter FFA, the attacker is often behind the camera. There is no edge indicator and no damage-direction cue. | `Hud.ts` has no indicator layer | UX11, UX12 |
| X3 | High | **Taking damage is under-signalled for the victim.** FX are tuned for the hit fighter as seen by others; the local player gets HP bar change at 10 Hz and the shared flash. No screen-edge hit pulse, no low-HP state. Kids will not read a bar change mid-combo. | `main.ts` `drawHud`; `Hud.fill` | UX12 |
| X4 | High | **Skill buttons communicate cooldown as text.** `Ready` vs a dashed border and a seconds label at 10 px. On a 10-inch iPad mid-fight, a radial sweep and a ready pulse are readable peripherally; text is not. | `Hud.render` `b.sub`, font 10 px | UX13 |
| X5 | High | **Solo opponents do not teach the game.** Bots are always Stone Vanguard, walk only, never dash, jump, awaken, or use slots 2–4; hard bots use slot 1 only. A child practising alone never sees the other kits' moves, never learns to block a special, never sees awakening. The bot is a punching bag with a guard button. | `SparringBrain.ts` (49 lines), `BotArenaRoom.addBots` `kitId = "sv"` | BOT6 |
| X6 | Medium | **KO screen and scoreboard are developer text.** The death overlay is two lines of text on a red wash; the scoreboard is space-aligned text in a proportional font, so columns do not line up. Missing: who beat you with what fighter, how much HP they had left, a respawn ring, and a one-tap "change fighter" on the death screen (the moment players actually want to switch). | `Hud.renderExtras` | UX14 |
| X7 | Medium | **No session goal.** FFA has no end, no winner, no rematch moment (`docs/spec.md` FFA rule: "no timed round"). For siblings playing together, a "first to N KOs" round gives a reason to keep playing and a natural break. This conflicts with the spec as written, so it is an owner decision. | `docs/spec.md` FFA rule | MODE01 (owner decision) |
| X8 | Low | Hit stun is disabled (decision 0049). Without any stagger, trades can feel like two fighters flailing through each other. Do not change blindly; add a QD01 playtest question: "Did hits feel like they connected?" | `docs/decisions/0049-hit-stun-disabled.md` | QD01 question |

UX score at this baseline (presentation only, not measured): combat feedback 82, situational awareness 45,
progression/goal 40, solo practice value 50, onboarding 72.

## Priority order

1. REL01, REL02 (stability; small).
2. UX11 nameplates and off-screen arrows (largest readability gain per line of code).
3. UX12 damage direction and low-HP state.
4. UX13 cooldown rings.
5. BOT6 bots that use the whole kit.
6. UX14 KO screen and scoreboard.
7. HYG01 evidence hygiene.
8. Owner decisions first, then implement: OPEN01, MODE01.
