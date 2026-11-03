# Game improvement implementation packets

Review task FR01, 2026-11-03. Baseline `21860dd694301d905d8e7dcab4289e9c6b1173b1`.
Audience: Sonnet 5.5 Low and Sol 6.1 Light/Low, as selected by the owner; this document does not change model settings. [Findings](full-game-review.md).

## Execution contract

Repository root for **every path in this document**: `/Users/cagdas/Projects/battlegrounds_game`. Paths below are exact repository-relative paths, not search suggestions. New files are marked **new**. Do one task ID in one session and one coherent commit. Do not implement this entire document in one session.

1. Read `AGENTS.md`, `docs/spec.md`, `docs/tasks.md`, this packet, and the accepted decisions referenced by the packet. Confirm prerequisite rows have implementation commits and their stated automated checks pass. FR01 is a completed documentation prerequisite; all GR prerequisites require their own implementation commits.
2. Run the pinned Node 24.22.2 and pnpm 10.28.0. The installed Node at review time is `/Users/cagdas/.local/share/fnm/node-versions/v24.22.2/installation/bin/node`; use a verified equivalent if it moves. No dependency upgrades.
3. Add the packet's regression tests before its implementation. Diagnostic probes in `docs/test-results/FR01/probes.test.ts.txt` assert defects; reverse them to the intended assertions rather than adding a test that celebrates the bug.
4. Run `pnpm typecheck`, `pnpm lint`, the packet's targeted tests, `pnpm test`, `pnpm build`. Run `pnpm content:validate` after shared protocol/config/schema changes; `pnpm assets:audit` after asset changes (build already runs it). Browser commands below use real local servers and clients. No external network service is needed. Use `EB_EVIDENCE=1` only for the packet's intentional evidence refresh.
5. Write `docs/test-results/<ID>.md` with commit baseline, commands, counts, failures and device limits; update the corresponding `docs/tasks.md` row. UI packets require 1024×768 and 1180×820 landscape screenshots, plus left-handed and reduced-motion checks where affected. Physical checks remain **NOT RUN**. Use **IMPLEMENTED, DEVICE CHECK PENDING**, not DONE, for device-dependent results.
6. Stop and report if a named prerequisite is missing, a required API differs from the installed declaration, the tree has conflicting user edits, a new authority conflict appears, or a regression remains after the scoped fix. Do not change damage, cooldowns, hit stun, roster, security exposure, or an unrelated subsystem to make a check pass.
7. Append changed behavior, executed checks and limitations to the report; use the commit subject given below. Push immediately if the user has requested commit/push under the repository's Git instruction. No deployment, invitations, accounts or paid services.

### Cross-packet decisions, fixed here

These are proposed local design values, not original-game facts. Each executor records the relevant ones in `docs/decisions/gr-<ID>.md` before implementing. These filenames avoid colliding with numbered decisions created in another session.

- Keep the approved three fighters, endless open FFA, optional 5/10 KO rounds, 600-tick automatic restart, 60 Hz authority and hit-stun setting from decision 0049.
- Wire additions must invalidate stale clients: GR04 increments `PROTOCOL_VERSION` from the value at its prerequisite commit by 1; GR08 does the same; GR15a/b/c do so only when adding their specified messages/owner fields. Update literal protocol fixtures, not runtime input `v:1` (a separate input envelope version). Record old/new versions. Do not leave client and server on different constants.
- A rendering or UI failure does not grant invulnerability or pause the shared world. Input is neutralized locally and the existing server lease still protects against stuck holds.
- Durable state uses schema fields; messages may trigger transient animation/sound. A new join must recover current state without replaying old hits.
- Do not add screenshots or generated evidence from unrelated tasks. Keep transient captures under `test-results/`.

## GR00 — Restore trustworthy browser acceptance

**Priority:** P1 verification prerequisite. **Prerequisite:** FR01. **Commit:** `test(browser): reconcile baseline acceptance with current contracts`

**Files:** `tests/browser/onboarding-flow.spec.ts`, `tests/browser/p0-gate.spec.ts`, `tests/browser/match.spec.ts`, `tests/browser/quality-fight.spec.ts`; shared browser harness files only if a common observation helper is needed. No production behavior change in this packet.

The FR01 evidence report is the failure inventory. Run on Node 24.22.2 with one worker and no other test browsers. Preserve damage and replication assertions.

- Onboarding currently asserts that the guide contains zero `Host sparring` labels, although the shipped guide intentionally exposes that implemented feature. Assert the existing sparring guidance is visible and still verify opening the guide makes no auth/network request. Preserve Back focus and touch/keyboard instructions.
- `sv.b3` expects `Stunned`, which remains required by the authored 30-tick ability-specific stun. Decision 0049 disables generic M1/dash freeze only. Do **not** remove this expectation or switch the global flag. Start observation before triggering input, collect state changes continuously in each browser, and assert both clients observe the legal reaction and matching final HP. Do not depend on slow sequential snapshots catching a short state. If a server-side trace lacks the required stun, stop and report a separate production defect with tick-by-tick evidence; do not broaden this packet.
- The match and four-fighter workload failures need independent pinned-runtime reproduction. Collect the failed predicate, server action/life/protection/form and client event trace at timeout. Replace race-prone fixture ordering only when the trace demonstrates it; keep real UI input and real clients. No blanket retries, skipped cases, relaxed HP/geometry budgets or fixed sleeps to manufacture green results. If a product defect is proven, stop and report it as a separate scoped task.
- Any additional full-suite failure listed in FR01 must be reproduced and classified before GR00 is complete. A failure outside these four files requires a separately specified slice; report its exact test and evidence instead of editing unrelated behavior.

**Commands:** `pnpm exec playwright test tests/browser/onboarding-flow.spec.ts tests/browser/p0-gate.spec.ts tests/browser/match.spec.ts tests/browser/quality-fight.spec.ts --workers=1` then `pnpm test:browser`, plus common gates. Store original and final outcomes in `docs/test-results/GR00.md`; do not call the original baseline green. GR01 security work may proceed independently, but the next release candidate requires GR00 completed.

## GR01 — Active-session revocation

**Priority:** P1. **Prerequisite:** FR01. **Commit:** `fix(auth): revoke active seats and revalidate reconnects`

**Files:** `apps/server/src/auth/Services.ts`, `apps/server/src/auth/SessionStore.ts`, `apps/server/src/createServer.ts`, `apps/server/src/rooms/ArenaRoom.ts`, `apps/server/src/rooms/SparringRoom.ts`, `tests/integration/auth.test.ts`, **new** `tests/integration/gr01-session-lifecycle.test.ts`, **new** `tests/unit/session-expiry.test.ts`.

**Behavior:**

- Add `ArenaRoom.revokeAuthSession(authId: string): void`. Match internal `sessionAuthId`, neutralize input, invalidate any dropped-seat reconnection reservation, and consentingly close each matching connection with code **4401**. Remove its fighter via the existing normal leave cleanup; do not duplicate capture cleanup. Never close another session in the room.
- Subscribe to `sessions.onRevoke` once in `createGameServer`; iterate that server's live rooms and call the method. Unsubscribe on shutdown. Retain ticket revocation.
- Ordinary arena `onReconnect` rechecks `getById`; expired/revoked sessions must not receive welcome or resume. Preserve SparringDirectory's existing scoped principal checks. Host revocation continues to close the hosted match through the directory's existing lifecycle; guest tokens must not be interpreted as ordinary session IDs.
- Add a wall-clock session sweep to the existing server lifecycle sweep, throttled to once per 1,000 ms. It checks active/reserved arena seats, closes those past absolute expiry, and refreshes idle activity for connected valid seats at most once per 60,000 ms. No disk write per combat input or simulation tick. `SessionStore` exposes a batch touch-by-ID operation which never refreshes already expired records. `purgeExpired` emits the same revocation notifications for removed IDs.
- Offline/revoked players may remain vulnerable only during a legitimate, unrevoked reconnect reservation; revocation cancels that reservation immediately.

**Tests:** Two real clients in one room; revoke A via admin HTTP and via DELETE session; A receives close 4401, B continues receiving patches. Drop A, revoke while reserved, attempt reconnect token → refused; no resurrected fighter/capture. Fake wall time crosses absolute expiry with active socket → close within the 1 s sweep; activity refresh never extends the 24 h absolute limit. Assert revoke subscription cleanup on server shutdown.

**Commands:** `pnpm exec vitest run tests/integration/gr01-session-lifecycle.test.ts tests/integration/auth.test.ts tests/integration/admin.test.ts tests/unit/session-expiry.test.ts` plus common gates. Stop if installed SDK cannot explicitly invalidate a dropped reservation; inspect its installed declarations and report the missing mechanism instead of leaving reconnection authorized.

## GR02 — Preserve projectile ownership across seat reuse

**Priority:** P1. **Prerequisite:** GR01. **Commit:** `fix(combat): keep detached projectile credit bound to its occupant`

**Files:** `apps/server/src/rooms/ArenaRoom.ts`, `apps/server/src/rooms/BotArenaRoom.ts`, `apps/server/src/rooms/PracticeRoom.ts`, `apps/server/src/sim/Projectiles.ts`, `apps/server/src/kits/sv/reflectPalm.ts`, `apps/server/src/sim/HitResolver.ts`, `apps/server/src/sim/TickPipeline.ts`, `apps/server/src/sim/RespawnSystem.ts`, `apps/server/src/sim/AbilityRunner.ts`, `tests/unit/projectile.test.ts`, `tests/unit/respawn.test.ts`, **new** `tests/integration/gr02-projectile-owner.test.ts`.

**Decision:** Use a **server-only occupant generation**, incremented on each entity allocation and unchanged by respawn. Entity IDs remain uint8. Life IDs still distinguish lives. An old projectile can damage after departure, but cannot award a replacement occupant kills, assists, combat timers, meter or passives. The same occupant may receive a posthumous KO after respawn; healing/meter/reset still require the original firing life alive.

**Implementation:**

- Room maintains `Map<entityId, occupantGeneration>` and a monotonic generation counter; register humans, bots and dummy consistently. Expose `occupantOf(id)` through AbilityHost. Stamp every spawned projectile with `ownerOccupant`; preserve it after departure. Reflection replaces both occupant and life with the reflector's current values.
- All self-exclusion checks use `(entityId, occupantGeneration)`, so a new occupant of the old ID is a valid enemy target. Original-owner aiming for reflection uses a pose only when the stored occupant matches; otherwise reverse the current heading, as already done for a missing owner.
- Carry owner occupant through projectile hit candidates and damage-attribution ledger entries. Before crediting a KO/assist or starting an attacker's combat timer, resolve the identity against the room's current occupant. Departed owners grant no replacement credit. Use an environmental/absent scorer fallback in the existing event format; do not invent the new occupant's name.
- Keep detached damage, max range, reflection cap and damage caps unchanged. Pruning must not suppress valid projectile damage just because the owner left.

**Tests:** Reuse the preserved probe with intended assertion C.kills=0; also C within splash takes damage, reflection does not home toward C, old assist does not accrue to C, B's health agrees on two real clients. Same occupant dies/respawns before projectile KO → KO credit allowed, no heal/meter/reset. Fire → normal death → no replacement → projectile still lands. Run projectile, passives, respawn, REL02 and new real-client tests.

**Commands:** `pnpm exec vitest run tests/unit/projectile.test.ts tests/unit/respawn.test.ts tests/integration/gr02-projectile-owner.test.ts tests/integration/rel02-entity-reuse.test.ts tests/integration/t22-passives.test.ts` plus common gates.

## GR03 — Connection and page lifecycle

**Priority:** P1. **Prerequisite:** GR01. **Commit:** `fix(client): restore authoritative state across connection loss`

**Files:** `apps/client/src/net/RoomClient.ts`, `apps/client/src/app/AppFlow.ts`, `apps/client/src/app/GameLoop.ts`, `apps/client/src/main.ts`, `apps/client/src/net/ClockSync.ts`, `apps/client/src/scene/GameScene.ts`, **new** `apps/client/src/app/ConnectionLifecycle.ts`, **new** `tests/unit/connection-lifecycle.test.ts`, **new** `tests/browser/connection-lifecycle.spec.ts`.

**State contract:** `ConnectionPhase = 'connecting' | 'active' | 'reconnecting' | 'closed'`. Keep RoomClient subscriptions and unsubscribe handles together. Use installed SDK `onDrop`, `onReconnect`, `onLeave` declarations; do not infer them from older tutorials.

- `active` requires a new welcome **and** the matching owner epoch in a received snapshot; Ready additionally requires the authoritative local `ready` flag. Until then send no gameplay input and show “Joining arena…”.
- On drop: clear all local holds, edges, provisional input, prediction history and remote interpolation buffers; show “Reconnecting… Your fighter is still in the arena.” Block gameplay input. Do not issue another join ticket or create another seat. The SDK may retry within the server's 20 s reservation.
- On new welcome: reset clock, sampler epoch/sequence and GameLoop prediction/held-sample/send-tick state. Clear remote buffers and event state that is explicitly per epoch; retain bounded event dedup for already-seen events. Resume only after snapshot readiness. Reset pose/action from the server, never call Ready for an already ready resumed fighter.
- Terminal close: always dispose match resources and show an error route. Code 4401 → “Your session ended. Return to the welcome screen.” Code 4500 → “This arena closed. Return to the welcome screen.” Other unexpected terminal close → “Connection lost. Try joining again.” No silent rejoin/reset; explicit Back/Retry actions.
- Reload recovery: persist room code/mode beside the reconnection token in **sessionStorage**; on boot try `tryResume` once before normal lobby entry. If successful restore the same ready fighter; if rejected discard metadata and show Welcome. Never reuse an invitation token.
- `pagehide` must distinguish explicit Leave from lifecycle suspension. Preserve a dropped-seat token for reload and BFCache. On `pageshow.persisted`, rebuild/resume rather than leave a disposed canvas; prevent duplicate loops/listeners. Explicit Leave cancels reconnect, clears token and returns Welcome.

**Tests:** Real browser client + observer: drop/reconnect preserves HP, life, cooldown and score; no old held charge/attack after welcome. Reload during life and during death preserves same identity. Server close returns an actionable error, not a frozen HUD. Revoke uses 4401. Two BFCache-style pagehide/pageshow cycles leave one input listener and one game loop. Three normal leave/rejoin cycles still work. No browser offline buffering.

**Commands:** `pnpm exec vitest run tests/unit/connection-lifecycle.test.ts tests/unit/game-loop.test.ts tests/integration/room.test.ts` and `pnpm exec playwright test tests/browser/connection-lifecycle.spec.ts tests/browser/sparring-flow.spec.ts`. Physical Safari BFCache/lock-screen checks remain NOT RUN.

## GR04 — Prediction based on snapshot time

**Priority:** P1. **Prerequisites:** GR02, GR03. **Commit:** `fix(net): reconcile locomotion from authoritative snapshot ticks`

**Files:** `apps/client/src/net/Prediction.ts`, `apps/client/src/app/GameLoop.ts`, `apps/server/src/sim/TickPipeline.ts`, `apps/server/src/state/PlayerSchema.ts`, `packages/shared/src/protocol.ts`, `tests/unit/camera-prediction.test.ts`, `tests/unit/game-loop.test.ts`, `tests/integration/r14-prediction.test.ts`, **new** `tests/integration/gr04-prediction-latency.test.ts`.

- Pose replay anchor is **snapshot.serverTick**. `ackSeq` acknowledges input delivery; `ackInputTick` remains diagnostic client sample time and must not backdate an authoritative pose. Keep history by estimated server tick; discard entries ≤ serverTick and replay only the following entries, maximum 12 ticks.
- Replicate owner locomotion fields: `grounded:boolean`, `lastGroundedTick:int32`, `jumpPressTick:int32`, `jumpedSinceGrounded:boolean`, `airJumpsUsed:uint8`. Publish after physics together with pose and action. Copy these into OwnerSnapshot and fully replace prediction state at correction/respawn. A spent air jump cannot become available merely because local history was cleared.
- Reconcile every fresh owner snapshot, even if ack did not increase; autonomous movement/correction is still authoritative. Guard predicts guard gait. For Dash, Windup, Active, Recovery and Awakening use authoritative pose updates without speculative locomotion integration for this slice; keep rendering/smoothing. Idle retains ordinary locomotion prediction. This conservative policy avoids incorrectly predicting free movement during rooted/slow casts; no ability-motion predictor is introduced.
- `resetPrediction` clears local entity binding and all prior life/action/ack/send bookkeeping as required by GR03; fresh snapshot rebinds it. Reject old snapshots monotonically within an epoch.

**Tests:** Probe inverted: pose tick 10, ack 1, history through 10 → no additional replay. History through 13 → exactly ticks 11–13. Two real clients with the existing delay proxy at 0/60/120 ms RTT: walk, stop, wall contact, ground jump, air jump, delayed ack and respawn. Compare pure integration against authoritative poses with ≤0.05 m quantization tolerance at the same simulated tick. Dash/beam/recovery does not add free locomotion. Corrections never create a third jump. Keep current 0.1/2 m smoothing thresholds.

**Commands:** `pnpm exec vitest run tests/unit/camera-prediction.test.ts tests/unit/game-loop.test.ts tests/integration/r14-prediction.test.ts tests/integration/gr04-prediction-latency.test.ts tests/integration/double-jump.test.ts` plus common gates and content validation. If existing tests prescribe replay from ack time, replace only those conflicting assertions and cite spec section 22.

## GR05 — One gameplay input gate

**Priority:** P2. **Prerequisite:** GR03. **Commit:** `fix(input): suspend gameplay intent while overlays own input`

**Files:** `apps/client/src/input/PointerRouter.ts`, `apps/client/src/input/KeyboardRouter.ts`, `apps/client/src/input/IntentSampler.ts`, `apps/client/src/main.ts`, `apps/client/src/ui/Settings.ts`, **new** `apps/client/src/input/InputGate.ts`, `tests/unit/keyboard-router.test.ts`, **new** `tests/unit/input-gate.test.ts`, **new** `tests/browser/input-gate.spec.ts`.

- Gate is a set of reasons: `menu`, `settings`, `moves`, `fighter`, `sparring`, `orientation`, `connection`, `graphics`, `round`. Any active reason suppresses gameplay, but permits UI navigation and Escape to close the top overlay. Scoreboard alone remains nonmodal; opening it clears current holds once.
- Entering the gated state releases **both** keyboard down-set and pointer ownership, clears queued skill/jump/dash/awakening edges and deferred selection, resets sampler-held state, and sends one neutral input immediately when transport is active. Server lease is a fallback, not the only cancellation.
- All movement and keyHold entry points respect the gate; resizing must not erase another gate reason. Reject new gameplay keys from input/textarea/select/contenteditable and while a modal is open. Preserve keyup cleanup. Leaving a gate never restores a previous hold; require a fresh press.
- Close Moves and Settings on room leave. Opening a second overlay closes the prior one or retains the gate until both close; choose **single top overlay** for menu/settings/moves/fighter/sparring. Clear any capture camera track on every modal entry.

**Tests:** W held → menu → D press → no motion; close → no motion until new W. Key 2 with menu/settings open produces no cast/cooldown. Typing digits and WASD into settings import textarea does not play. Touch skillDown then cancel before sampling produces no late cast. Held charge cancellation sends neutral, no release shot. Rotation and reconnect gate survive resize. Existing five-pointer independence tests still pass.

**Commands:** `pnpm exec vitest run tests/unit/input-gate.test.ts tests/unit/keyboard-router.test.ts` and `pnpm exec playwright test tests/browser/input-gate.spec.ts tests/browser/settings.spec.ts` plus common gates.

## GR06 — Keyboard Jump parity

**Priority:** P2. **Prerequisite:** GR05. **Commit:** `fix(input): retain Space hold for grounded combo finishers`

**Files:** `apps/client/src/input/KeyboardRouter.ts`, `tests/unit/keyboard-router.test.ts`, **new** `tests/integration/gr06-keyboard-finisher.test.ts`.

Space down emits one jump edge and retains jumpHeld until Space up/cancel. Only Q/G remain immediate-release edges. OS repeat emits no further jump. Never modify the server's grounded/airborne finisher priority. Feed real KeyboardRouter → IntentSampler packets over the existing client harness.

**Tests:** Hold M1, press/hold Space during the combo → server fourth hit is grounded uppercut with no ordinary jump; airborne fourth hit remains downslam. Space before combo jumps normally; second distinct airborne press allows exactly one air jump; repeat generates none. Blur/menu cancels hold.

**Commands:** `pnpm exec vitest run tests/unit/keyboard-router.test.ts tests/integration/gr06-keyboard-finisher.test.ts tests/integration/m1.test.ts tests/integration/double-jump.test.ts` plus common gates.

## GR07 — Honest action status

**Priority:** P2. **Prerequisite:** GR05. **Commit:** `feat(hud): show spent skills charge and evasive readiness`

**Files:** `apps/client/src/ui/HudFormat.ts`, `apps/client/src/ui/Hud.ts`, `apps/client/src/main.ts`, `apps/client/src/ui/SkillInfo.ts`, `tests/unit/hud-format.test.ts`, **new** `tests/browser/action-status.spec.ts`.

- Add pure `skillAvailability(def, state, nowTick)` returning `{kind:'ready'|'cooldown'|'used'|'charging', text:string, fraction:number}`. State includes authoritative form, use mask, cooldown end tick, active move, owner charge start tick. Precedence: oncePerForm bit set → Used (except the currently charging move); charging matching move → Charge NN%; remaining cooldown → existing formatted seconds; otherwise Ready. “Used” persists through miss/interruption until the next server form reset. Never animate a ready pulse on form/kit/life switches or Used transitions.
- For Ember Orb Base 3 show charge percentage `floor(clamp((now-start)/180,0,1)*100)` with “Release to fire”; only use authoritative chargeStartTick and matching active move, never a local press timestamp. Full means 100%, not damage confirmation.
- While Ragdolled label Dash as **Escape** and show its authoritative evasive remaining seconds, or “Ready” when eligible after tick 12. Before tick 12 show “Wait”. Otherwise retain Dash. Do not fabricate directional dash cooldowns that are not replicated.
- Vanguard Awakened with formEndTick=0: `Awakened · choose one finisher`. Timed forms retain a countdown. Base returns to normal meter. Use mask/context status never grants client authority.

**Tests:** Real client uses td.a2 or ea.a4, misses, recovers: Used remains and server rejects retry. Form reset clears Used. Base/awakened slot change causes no false ready pulse. Charge 179 vs180 ticks displays 99 vs100; cancellation clears; evasive at 11/12 and cooldown boundary matches server. Four rows remain readable at target sizes.

**Commands:** `pnpm exec vitest run tests/unit/hud-format.test.ts` and `pnpm exec playwright test tests/browser/action-status.spec.ts` plus common gates.

## GR08 — Durable round state and live objective

**Priority:** P2. **Prerequisites:** GR03, GR05. **Commit:** `fix(rounds): replicate results and expose the active objective`

**Files:** `apps/server/src/state/ArenaSchema.ts`, `apps/server/src/rooms/ArenaRoom.ts`, `packages/shared/src/protocol.ts`, `apps/client/src/ui/RoundResults.ts`, `apps/client/src/ui/Hud.ts`, `apps/client/src/main.ts`, `apps/client/src/app/GameLoop.ts`, `apps/client/src/admin/screens.ts`, `tests/integration/mode01-rounds.test.ts`, **new** `tests/browser/round-state.spec.ts`.

- Add replicated `roundTarget:uint8` (0/5/10), `roundNumber:uint32` starting 1, `roundEndsAtTick:uint32` (0 while playing) and `roundStandings:ArraySchema<RoundStandingSchema>` with entityId, displayName, kills, deaths, assists. At result entry freeze standings in the same tick as phase; departure does not rewrite the winner. On next round clear standings/deadline and increment number. Keep the existing event as a transient cue only.
- Render results from state on join/reconnect and ordinary patches. Suppress local locomotion prediction/input while phase=roundOver using GR05. Show countdown from authoritative deadline, not a newly received event time. Do not display a shrinking respawn countdown concurrently with results.
- During active optional rounds show `First to N · You K · Leader L`, centered below health at y=68 CSS px, one line 14 px, max width 360 px; FFA shows no objective strip. Keep it below overlay layers from GR11.
- Result card contains winner, tabular frozen standings, `Next round in S`, **Change fighter** and **Leave** actions using existing paths. New fighter remains queued for next spawn. No manual rematch vote, timer change or score persistence.
- Admin bot-room form exposes Endless/First to 5/First to 10. Disable nonzero choices when bot count=0 and submit 0. Preserve strict server-side validation and default endless open FFA.

**Tests:** Real client joins mid-results → same standings/deadline as observer, no event replay needed. Drop/reconnect during results; winner leaves; no movement or queued attack carried into next round; scores reset at exactly +600. Botless admin creation remains target0. Browser checks live objective, results actions and no overlapping death card.

**Commands:** `pnpm exec vitest run tests/integration/mode01-rounds.test.ts tests/integration/admin.test.ts` and `pnpm exec playwright test tests/browser/round-state.spec.ts tests/browser/admin.spec.ts` plus common gates and content validation.

## GR09 — Graphics recovery and failed-load cleanup

**Priority:** P2. **Prerequisite:** GR05. **Commit:** `fix(render): recover graphics without leaving input active`

**Files:** `apps/client/src/main.ts`, `apps/client/src/scene/GameScene.ts`, **new** `apps/client/src/app/GraphicsLifecycle.ts`, **new** `tests/unit/graphics-lifecycle.test.ts`, **new** `tests/browser/graphics-recovery.spec.ts`.

- Listen on the active canvas for `webglcontextlost`; prevent default, acquire graphics input gate, release holds, cancel capture camera and stop scene render calls. Keep the authoritative room connected and do not change HP/protection. Show `Recovering graphics… Your fighter is still in the arena.` above every match overlay.
- On `webglcontextrestored`, use the existing renderer's restoration support, rebuild app-owned transient GPU resources only as required, discard transient particles/trails, and reconstruct live fighters/projectiles/urns from the latest state. Resume after one successful frame and a current owner snapshot. No old hit/KO replay. Keep one renderer.
- After 5,000 wall-clock ms without recovery, show `Graphics could not recover.` with **Reload** and **Leave**; Reload uses GR03 session recovery. This timeout is UI lifecycle only, never simulation.
- Asset-load creation is transactional: hold provisional renderer/scene/map locally; on reject or disposed boot release them and remove canvas; publish them to session only on success. A retry does not leave hidden canvases or orphan RAFs.

**Tests:** Browser WebGL lose-context extension during move/charge → neutral and recovery banner; restore → same life and one renderer, no old attack. Repeat three cycles and check resource counts plateau. Force environment fetch failure twice then retry; one canvas and no listener growth. A test fixture may invoke the extension; production does not expose a new debug mutation API.

**Commands:** `pnpm exec vitest run tests/unit/graphics-lifecycle.test.ts` and `pnpm exec playwright test tests/browser/graphics-recovery.spec.ts tests/browser/quality-load.spec.ts` plus common gates. Physical Safari context recovery remains NOT RUN.

## GR10 — Routine log privacy

**Priority:** P2. **Prerequisite:** FR01. **Commit:** `fix(ops): remove player names and raw addresses from routine logs`

**Files:** `apps/server/src/http/sessionRoutes.ts`, `apps/server/src/ops/StructuredLog.ts`, `tests/integration/t29-security.test.ts`, **new** `tests/unit/log-privacy.test.ts`.

Remove `name` from open-session creation log. Replace invite-rejected `ip` with `sourceHash: sha256(clientKey(req)).slice(0,8)`, matching the existing refused-open-session convention. Add `displayName`, `name`, `ip`, `ipAddress`, `remoteAddress` to structured-log key redaction as defense in depth; keep permitted session prefixes and room/entity IDs. Do not alter authentication inputs or hide errors themselves. Historical log deletion is outside this task.

**Tests:** Fixture request using `203.0.113.9` and display name `ReviewChild` → neither string appears in sink or recentLogLines; rejected/accepted categories still distinguishable; existing credential redaction tests pass.

**Commands:** `pnpm exec vitest run tests/unit/log-privacy.test.ts tests/integration/t29-security.test.ts tests/integration/admin.test.ts` plus common gates.

## GR11 — Combat HUD text budget and overlay hierarchy

**Priority:** P2. **Prerequisites:** GR05, GR07, GR08. **Commit:** `fix(ui): keep combat controls and menus readable`

**Files:** `apps/client/src/ui/Hud.ts`, `apps/client/src/ui/experience.css`, `apps/client/src/ui/Nameplates.ts`, `apps/client/src/ui/DamageCues.ts`, `apps/client/src/ui/RoundResults.ts`, `apps/client/src/ui/PracticePanel.ts`, `apps/client/src/fx/CombatText.ts`, `apps/client/src/main.ts`, **new** `apps/client/src/ui/Layers.ts`, **new** `tests/browser/hud-readability.spec.ts`.

**Fixed layout contract:**

- Preserve control hit rectangles. Skill button content has slot number at top-left, name at most **two lines**, 11 px font / 12 px line height, then state **one line**, 13 px / 14 px. Remove the role-description row from combat buttons; keep it in Moves & ranges. At ≥64 px button width use these sizes; below 64 px use 10/11 and 11/12 respectively. Padding 3 px, no vertical clipping at the existing default or minimum editor scale. Full move name remains in `aria-label`; use existing shortSkillLabel only if two lines cannot contain it, never an unreadable four-line pile.
- Numeric ring/state DOM updates in place; rebuild skill structure only on equipped move change. Make HUD controls expose accessible role and labels without creating duplicate click-triggered combat events. Pointer ownership remains in the router.
- Define shared layer constants: world canvas 0, world labels 10, damage cues 20, HUD/ability callouts 30, practice panel 35, modal backdrop 50, modal content 60, graphics/connection status 70. Update every listed overlay to these constants. While a modal owns input, hide world labels and transient combat callouts; keep the arena visible behind the backdrop and preserve underlying state.
- Cast phase text moves below the objective strip: centered y=92 px, max width 360 px, 14 px font, single line. It must not cover health at y=32 or objective y=68. Practice panel collapses to title + current hint + Expand button by default; expanded configuration may overlay the arena but never a modal.
- Freeze the killer name/kit/HP used by the KO card at the received KO event, when the actor exists; keep those values through the countdown even if the actor heals or leaves. Unknown actor → “a rival” without an invented HP. Uncredited fall → `Fell from the arena` and omit the “by … · …” line. No change to scoring.

**Tests:** Render every base/awakened slot for all three fighters at 1024×768 and 1180×820, minimum permitted editor scale, both handedness settings. Each label/state `scrollHeight <= clientHeight`; no overlap with adjacent controls. Menu with active cast and nameplates contains legible unobstructed buttons and no text above it. Low HP + round results + settings does not stack conflicting cards. Freeze KO HP despite subsequent actor heal. Save before/after screenshots for the reviewed clipping and menu cases.

**Commands:** `pnpm exec playwright test tests/browser/hud-readability.spec.ts tests/browser/layout.spec.ts tests/browser/combat-text.spec.ts tests/browser/ux11-nameplates.spec.ts` plus common gates. Do not lower the 48 px combat hit target or remove essential telegraphs to fit labels.

## GR12 — Clear entry routes and informed fighter choice

**Priority:** P2 opportunity. **Prerequisites:** GR03, GR11. **Commit:** `feat(onboarding): clarify play routes and fighter roles`

**Files:** `apps/client/src/ui/Lobby.ts`, `apps/client/src/ui/SparringSetup.ts`, `apps/client/src/ui/experience.css`, `apps/client/src/app/AppFlow.ts`, `apps/client/src/main.ts`, **new** `apps/client/src/ui/FighterPreview.ts`, `apps/client/src/scene/GameScene.ts`, `tests/browser/onboarding-flow.spec.ts`, **new** `tests/browser/fighter-choice.spec.ts`.

**Welcome copy and hierarchy:** Central card contains primary **Play with friends** (existing Play path), secondary **Practice** and **Fight bots** (existing Host sparring setup). Beneath them: **Find a room**, **How to play**, **Settings**; Admin remains a small text link. Remove duplicated floating launchers on Welcome, preserving the in-match sparring-controls action. Profile caption: `Choose the name shown in the arena.` Do not claim an invitation is always required; keep the existing invitation error only when that flow actually fails.

Add AppFlow busy state to disable repeated entry actions and display `Preparing arena…` while runtime/assets load, then `Joining arena…` during network join. Errors restore meaningful Retry/Back controls. No fake byte progress; byte progress is out of this slice.

**Fighter choice:** Use the already-loaded game renderer for a single selected original fighter preview behind/inside a 220×200 CSS px reserved preview region; never allocate another WebGLRenderer. Suspend its animation under reduced motion. Dispose the preview fighter when entering a match or leaving the lobby. Use shipped models only. Three selectable cards have verbatim text:

| Fighter | Role | Tip |
|---|---|---|
| Stone Vanguard | Heavy close-range strikes | Face your rival before committing. Your awakening spends one finisher. |
| Tide Duelist | Grabs, throws and counters | Get close, catch a rival, or wait for an attack to counter. |
| Ember Artificer | Charges, rushes and beams | Hold Ember Orb to charge. Use distance and cover to shape the fight. |

Keep the four base-move names, existing guide link and Ready action. No stat stars, unsupported difficulty ranking or damage rebalance. Practice remains a private server room; bot setup still defaults to one medium bot and endless rounds.

**Tests:** All three Welcome paths reach the existing intended room mode; no extra auth attempt on double click. Throttled asset request shows progress state. Lobby selects each kit and preview; model follows selection; Ready's server kit matches. Renderer count stays one through three lobby/match cycles; reduced motion stops idle preview animation. Fit both landscape sizes and portrait Welcome, without horizontal scroll.

**Commands:** `pnpm exec playwright test tests/browser/onboarding-flow.spec.ts tests/browser/fighter-choice.spec.ts tests/browser/sparring-setup.spec.ts` plus common gates.

## GR13 — Bounded bot routing on the existing arena

**Priority:** P2. **Prerequisite:** GR02. **Commit:** `feat(bots): route around cover and across bridge approaches`

**Files:** **new** `apps/server/src/sim/BotNavigation.ts`, `apps/server/src/rooms/BotArenaRoom.ts`, `apps/server/src/sim/World.ts` (query helper only), **new** `tests/unit/bot-navigation.test.ts`, **new** `tests/integration/gr13-bot-navigation.test.ts`.

**Decision:** A fixed deterministic ground-route planner, not a new physics simulation or navmesh dependency. Preserve knockback, exposed edges and mobility abilities. Path planning only chooses voluntary walk intent.

- At room world creation build a 1 m grid over x=[−42,42], z=[−38,38], including both ends (6,545 candidate cells). Node y comes from the current static world's highest walkable ground. Require clear upright capsule and eight radial support samples at capsule radius, using the existing step/snap tolerances. Reject unsupported/obstructed cells. Static topology is built once per room and disposed with it.
- Eight neighbors; diagonal edges require both axial neighbors and a swept clear capsule segment, so corners cannot be cut. Height change must fit existing controller step/slope limits. Cost is horizontal distance; A* heuristic Euclidean; ties by node index `zIndex*85+xIndex`. Maximum 2,048 node expansions per request.
- Start/goal snap to nearest valid grid center within 2 m, tie by node index. A bot follows waypoint centers until within 0.35 m, then advances. Replan at most once every 30 ticks, and only if the target moves ≥2 m, current path becomes invalid, or progress is <0.25 m over 120 ticks. Keep the last safe path between replans.
- No route within budget → stop safely and retry at the next 30-tick opportunity. Do not teleport, jump a gap or disable collisions. The existing per-tick ledge check remains the final safety guard. Target selection remains unchanged in this slice.

**Tests:** Pure graph routes around each main-island pillar/wall and from each satellite to center without crossing void. Deterministic output across repeated calls; cap enforcement. Real room manual ticks with idle human at center and bot at each satellite: reach within 2.5 m within 900 ticks, no fall; reverse route passes. Target behind a pillar, no indefinite stop on its front face. Knockback may still ring out a bot. Record route node count and max expansions; no claimed wall-clock budget without measurement.

**Commands:** `pnpm exec vitest run tests/unit/bot-navigation.test.ts tests/integration/gr13-bot-navigation.test.ts tests/integration/bot6-full-kit.test.ts` plus common gates. Stop if a required ground route is absent under the existing collider contract; report collider IDs rather than editing the arena in this slice.

## GR14 — Bot tactics that demonstrate the three kits

**Priority:** P2 opportunity. **Prerequisites:** GR07, GR13. **Commit:** `feat(bots): respect ability roles range and charge timing`

**Files:** `packages/shared/src/sparring.ts`, **new** `apps/server/src/sim/BotTactics.ts`, `apps/server/src/sim/SparringBrain.ts`, `apps/server/src/rooms/BotArenaRoom.ts`, `tests/unit/sparring-brain.test.ts`, **new** `tests/unit/bot-tactics.test.ts`, `tests/integration/bot6-full-kit.test.ts`.

Keep easy mode's existing walk/M1/slot1 policy. Medium uses all base slots after this decision; hard uses all base/awakened slots. Both retain existing reaction intervals (15/6 ticks). No reads of hidden client inputs or future state, no random behavior.

Add observation fields for current form/use mask, line of sight to target, current charge slot/start, and ready move IDs. A move is ready only if Idle, cooldown elapsed, form valid and once-per-form bit clear. All attacks require static line of sight unless their existing handler explicitly handles cover; bots must not infer a hit through walls.

**Role table:** Distances are horizontal meters, inclusive. These are bot selection bands, not hitbox edits.

| Move IDs | Selection distance | Extra condition |
|---|---|---|
| sv.b1, sv.b2, sv.b3, sv.b4, sv.a4, td.b1, td.b2, td.b3, td.a1, td.a2, td.a3, ea.b1 | 0–2 | Default close attack |
| td.b4, sv.a1 | 0–3 | Target currently Windup/Active and facing bot within 60 degrees |
| sv.a2 | 4–16 | Target visible |
| sv.a3 | 6–24 | Target visible |
| td.a4 | 2–8 | Safe approach route |
| ea.b2, ea.a1 | 3–7 | Safe approach route |
| ea.b4 | 3–6 | Grounded and supported destination |
| ea.b3 | 5–16 | Charge path described below |
| ea.a2 | 4–12 | Safe approach route |
| ea.a3 | 6–20 | Target visible |
| ea.a4 | 8–28 | Target visible |

Decision order: retain an in-progress charge; legal hard defensive dash; awakening when full/grounded and enemy≤6 m; eligible counter; eligible ranged/mobility move; eligible close move; guard an incoming close attack; M1 if≤2 m; otherwise route toward preferred band. When several moves qualify scan slot order cyclically from `1 + floor(age/interval)%4` as today, so no random selection.

Ember Orb: send skillDown once, maintain chargeHeldSlot=3 each tick, release with skillUp after 60 ticks on medium and 180 on hard. If target becomes invalid, lose line of sight for 30 ticks, or bot is interrupted, clear hold and charge state; send normal skillUp if still casting, accepting a partial shot under the existing handler. Never bypass cooldown. A bot may not remain charging >186 ticks. On death/respawn/kit/form change clear the tactic state.

Preferred approach distances: Ember Base 8 m if orb ready, otherwise 2 m; Ember Awakened 10 m if a3/a4 ready, otherwise 2 m; Vanguard/Duelist 2 m. Use GR13 paths for approach and retreat; do not move off a ledge to maintain spacing. Don't require player-style aim perfection or add damage buffs for difficulty.

**Tests:** Unit table covers each move ID, LOS, counter condition, once-use exclusion, difficulty rules, charge release and interruption. Real-client 3-hard-bot seeded scenario at controlled distances records a charged orb, a beam from >6 m, a counter only during attack, and at least three distinct casts per kit. No stale hold after death, no cast longer than its legal phase. This is a capability test, not proof the bots are fun or equally difficult.

**Commands:** `pnpm exec vitest run tests/unit/bot-tactics.test.ts tests/unit/sparring-brain.test.ts tests/integration/bot6-full-kit.test.ts` plus common gates/content validation. Do not modify shared ability timing or damage to make a bot succeed.

## GR15a — First outcome-based practice drill

**Priority:** P2 opportunity. **Prerequisites:** GR05, GR07, GR11. **Commit:** `feat(practice): teach a confirmed close-range hit`

**Files:** **new** `apps/server/src/sim/PracticeDrills.ts`, `apps/server/src/rooms/PracticeRoom.ts`, `apps/server/src/sim/TickPipeline.ts`, `apps/server/src/state/PlayerSchema.ts`, `packages/shared/src/protocol.ts`, `apps/client/src/ui/PracticePanel.ts`, `apps/client/src/main.ts`, **new** `tests/unit/practice-drills.test.ts`, **new** `tests/integration/practice-drills.test.ts`, **new** `tests/browser/practice-drills.spec.ts`.

Preserve the existing seven-step tutorial. Add a separate optional `Combat lessons` section. The first drill is `Land a strike` with hint `Move close, face the dummy, then land a Strike.` Completion requires one server-confirmed M1 hit with damage>0 on the dummy by this player; a cast, miss, block, hit on a bot or client claim does not count.

Add client message `practiceDrill` validated by `z.strictObject({ action: z.enum(['start','retry','exit']), drill: z.enum(['hit']) })`; register it **only in PracticeRoom** using its existing 4/s bucket. Owner fields: `drillId:string` default '', `drillState:string` in idle/running/success, `drillStartTick:uint32`, `drillSuccessTick:uint32`. No client success message exists. Add optional pipeline `onResolvedHits(tick, results)` callback, passed immutable result summaries after resolution; practice tracker consumes them. No browser-side damage observation grants progress.

Start/retry: clear optional bots through existing cleanup, reset player and dummy to base/full HP/cooldowns and practice spawn points, set player at (0,0,3), dummy at (0,0,0), face each other, disable guard/ragdoll toggles while lesson runs. This reset is private practice-only and never touches an arena room. Success persists until Retry/Exit; show `Hit confirmed. Try a different distance.` with Retry/Exit. Exit restores normal practice controls. No persistent rewards, scores, telemetry or forced lesson.

Tests: miss does not complete; one valid M1 completes once; repeated hit cannot advance a different step; other rooms reject the message; duplicate start/retry does not spawn extra dummy/bots; exit/disconnect clears callbacks. Browser displays server success, not a locally inferred result. `pnpm exec vitest run tests/unit/practice-drills.test.ts tests/integration/practice-drills.test.ts` and `pnpm exec playwright test tests/browser/practice-drills.spec.ts`, plus common gates/content validation.

## GR15b — Successful defense practice

**Priority:** P2 opportunity. **Prerequisite:** GR15a. **Commit:** `feat(practice): teach a server-confirmed guard`

**Files:** `apps/server/src/sim/PracticeDrills.ts`, `apps/server/src/rooms/PracticeRoom.ts`, `apps/server/src/sim/TickPipeline.ts`, `packages/shared/src/protocol.ts`, `apps/client/src/ui/PracticePanel.ts`, `tests/unit/practice-drills.test.ts`, `tests/integration/practice-drills.test.ts`, `tests/browser/practice-drills.spec.ts`.

Extend drill enum with `block`. Label `Block a strike`; hint `Face the dummy and hold Guard before its strike lands.` Place player 1.6 m ahead of dummy facing it, same height. The dummy performs **one ordinary first M1** every 180 ticks using the existing M1 system with a one-tick hold, starting after 120 preparation ticks. It must not produce a four-hit chain. A server `blocked` result where player is target and dummy is actor completes the drill. Merely holding guard does not. A taken hit leaves the drill running; ordinary damage applies, retry resets as in GR15a. If the player dies, show Retry instead of silently granting success. Stop dummy attacks after success/exit. No new attack definitions or damage schedule.

Implementation: add a private dummy `PipelineSeat` with its own `InputChannel`; include it in `PracticeRoom.pipelineSeats()` only while a defense/evasion lesson runs, using key `drill:dummy`. Populate neutral intent and the one-tick attack hold in `beforeDrain`, after the inherited bot hook. Keep the dummy in `extraBodyIds()` only while it is absent from pipeline seats, preventing duplicate physics/publish. Use the ordinary pipeline action transitions and hit resolver; remove the temporary seat and neutralize on success/exit/death. Never create a fake network client.

Tests: wrong facing does not pass; timing before guard startup does not pass; frontal confirmed block passes; repeated attack schedule uses integer ticks, exits/death cancel it; no counter/capture result counts as block. Run the same GR15a commands and save the additional lesson screenshot. If invoking dummy M1 would require a second tick loop, stop and report; the existing pipeline must own it.

## GR15c — Read and leave an attack warning

**Priority:** P2 opportunity. **Prerequisite:** GR15b. **Commit:** `feat(practice): teach evasion from an attack telegraph`

**Files:** `apps/server/src/sim/PracticeDrills.ts`, `apps/server/src/rooms/PracticeRoom.ts`, `apps/server/src/sim/TickPipeline.ts`, `packages/shared/src/protocol.ts`, `apps/client/src/ui/PracticePanel.ts`, `tests/unit/practice-drills.test.ts`, `tests/integration/practice-drills.test.ts`, `tests/browser/practice-drills.spec.ts`.

Extend drill enum with `evade`. Label `Leave the warning`; hint `When the ground warning appears, move sideways out of it.` For this drill only, the dummy uses Stone Vanguard and the **existing sv.b1** ability, with the player's starting center (0,0.9,2) and dummy at (0,0.9,0) facing +Z. One cast starts at preparation tick+120. No ability data override, enlarged warning or slower timing. Give the player a 120-tick preparation period with `Get ready — move sideways when the warning appears.`

Track this specific dummy cast and player life. Success requires that player starts inside its direct-hit footprint when windup begins, is outside all applicable sv.b1 footprints at active resolution, and receives no hit, block, capture, counter or protected result from that cast. Do not count protection/invulnerability or an out-of-range starting position as evasion. On success show `You left the attack before it landed.` Failure shows `Try again — move sideways when the warning appears.` No automatic repeat; Retry resets positions. Reset dummy kit on Exit to the ordinary practice Tide Duelist. Miss computation uses the same authoritative geometric helpers as the ability; do not substitute screen pixels.

Tests: stationary hit fails, starting outside fails, guard/counter/invulnerability does not pass, timely sideways movement passes, death/leave/kit-change cancels the trial, repeated Retry uses fresh cast identity. Two real clients are unnecessary in the one-human practice room, but use a real connected browser/client for end-to-end confirmation. Run the same drill commands plus `tests/integration/sv-base.test.ts`; common gates/content validation.

## GR15d — Current contract index and physical acceptance packet

**Priority:** Release gate. **Prerequisites:** GR00–GR14 and GR15a–c implemented; QD01 devices/humans available for physical execution. **Commit:** `docs(acceptance): consolidate current rules and record device outcomes`

**Files:** **new** `docs/current-contract.md`, `docs/spec.md` (link to index only), `docs/test-results/QD01.md`, `docs/test-results/DEV1.md`, **new** `docs/test-results/GR15d.md`, `docs/tasks.md`.

Create an amendment index listing current local rules and authority: movement 0020, hit-stun 0049, Quick Use 0047, double jump 0051, open join 0050/0053, visual budget 0048, rounds 0054, and the implemented GR decisions. Link exact config/code and tests; do not erase historical original rules or imply reference fidelity.

Two actual iPads, two players, model/OS/browser/viewport recorded. Run existing D01–D10 and QD01 acceptance plus:

1. Five-finger move/camera/attack/jump/skill for 30 s; rotate, background, lock/unlock and return; no inherited attack/charge. At least 5 trials per device.
2. Drop/recover Wi-Fi within 20 s, reload mid-life and mid-results, one revocation; preserve expected life/state and show correct messages. No shared passwords or tokens in recordings.
3. Ten attempts each at held-Jump uppercut, charged orb, used one-shot recognition, and evasive availability. Record observed success counts and explanations; no fabricated pass thresholds based on automation.
4. First-time lessons: without verbal instruction, each player lands, blocks and evades; record attempts and elapsed time. Target: at least 4 of 5 repetitions of each drill completed after the first guided success. Failure produces a specific follow-up, not automatic damage/timing changes.
5. Ten respawn-to-encounter intervals in 1v1; report median/range. Four-player overlap: ask attacker identity, dangerous footprint and available escape; target ≥8/10 correct answers per player using a prewritten answer key.
6. Existing 10-minute ordinary-play and 5-minute stress budgets from spec section 24, both low/medium and normal/reduced motion. Record actual FPS/frame percentiles and thermal observations where measurable. No claim from desktop SwiftShader.

If physical devices/players are missing, complete the index and blank recording sheet, set GR15d **BLOCKED: two physical iPads and two human players unavailable**, and stop; do not simulate a pass. QR01 remains blocked until its existing prerequisite evidence is present. This slice does not authorize deployment.

## Executor prompt

Use this verbatim, replacing only the ID:

> Implement **GRxx only** from `/Users/cagdas/Projects/battlegrounds_game/docs/reviews/game-improvement-spec.md`. Read the project contract and exact prerequisite reports first. Preserve accepted gameplay decisions and the three-fighter scope. Add the specified regression tests, make the scoped change, run the pinned-runtime gates, write the task evidence and update `docs/tasks.md`. Stop and report any listed stop condition; do not broaden scope or mark physical device checks passed. End with changed behavior, executed check counts, limitations and the specified commit subject. Recommend a fresh session for the next ID.
