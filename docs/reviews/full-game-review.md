# Full game review: principal engineering and staff game UX

Date: 2026-11-03. Task: FR01. Reviewed commit: `21860dd694301d905d8e7dcab4289e9c6b1173b1`.

## Verdict

The core is substantial: three original kits, authoritative combat, real multiplayer, configurable sparring, practice, a coherent environment, and extensive automated coverage. The next investment should be **trustworthy state transitions and readable player decisions**, before more visual effects or abilities. The green unit/integration verification currently permits broken account revocation, incorrect projectile attribution after seat reuse, and misleading action readiness. Those are higher priority than polish.

This is a functioning private-game candidate, **not a verified iPad release**. QD01 and DEV1 remain blocked on physical devices and human play. This review does not assign numerical quality scores: neither player comprehension nor device performance was measured sufficiently to justify them.

Deliverables: [implementation slices](game-improvement-spec.md), [execution evidence](../test-results/FR01.md). New task IDs are GR00–GR14 and GR15a–d. They supplement, rather than repeat, the implemented backlog-v3 work.

## Method and evidence boundaries

- Read the implementation contract, task ledger, original specification, relevant amendments, and previous review. Traced authentication through tickets/room lifecycle; simulation through hits, projectiles, scoring and respawn; client boot, input, prediction, HUD, rounds, practice, bots, scene lifecycle, audio, and update handling. Inspected associated unit, integration, and browser tests. This is a system review with targeted deep traces, not a claim that every line of every ability handler was independently re-proved.
- Ran the repository verification command on installed Node **24.22.2**, pnpm **10.28.0**. It passed 127 test files; 1 file skipped; 1,680 tests passed, 2 skipped, 2 todo. Typecheck, boundary/timer lint, build, content validation and provenance audit passed. The default shell initially used Node 26; its incomplete run is not the acceptance result.
- Ran four temporary diagnostic tests. They assert the **observed defects**, so their passing result means reproduction, not correctness. Source and output are preserved under `docs/test-results/FR01/`; the temporary test file was removed from the normal suite.
- Exercised the built game on an isolated loopback server with temporary data through the browser: Welcome → Practice → Ready; keyboard movement and skills; menu input; Leave → Host sparring → First to 5 KOs → match; fall and respawn. Inspected at 1024×768. This was a short reviewer walkthrough, not a human usability study or a complete balance playtest. Browser suite results are recorded in the evidence report.
- Physical iPad Safari, five-finger input, thermal performance, remote Wi-Fi/cellular transition, and subjective audio quality: **NOT RUN**. No production services or user accounts were changed. No new reference-game facts are asserted; all proposals are local design choices (D).

Evidence labels below: **R** = reproduced by a targeted probe or reviewer UI interaction; **C** = confirmed from the current code path; **H** = hypothesis requiring a specified playtest. Prior screenshots and reports establish history, not current performance.

## Principal engineer assessment

### Foundations worth preserving

1. Server authority is correctly located. Strict input schemas, one-use room-bound tickets, action generations, hit ledgers, fixed integer ticks, and actual Colyseus client tests are sound choices. Keep client UI fixes out of damage authority.
2. Ability definitions and handlers separate tuning from execution. Original asset provenance is audited in the build: 40 manifest entries, 3 fighters with 93 clips, 6,606,298 bytes. This is a stronger basis for expansion within the existing kits than adding another fighter.
3. Explicit exception containment and reusable entity IDs from REL01/REL02 fix real earlier problems. However, reusable IDs now require auditing every **persistent reference**, not only the replicated player map.
4. Disposable presentation modules, pooled effects, reduced-motion settings and a lazy renderer are useful foundations. Preserve them while fixing the app-level lifecycle.
5. The test suite is broad but often proves subsystems independently. The highest-value additions cross boundaries: revoke → active socket, disconnect → client state, projectile → departed owner → replacement, round event → later join, and server state → actionable HUD.

### Findings in priority order

| ID | Priority / evidence | Finding and player consequence | Implementation |
|---|---|---|---|
| E01 | P1 / R+C | **Revocation does not remove an active arena client.** `auth/Services.ts:57` subscribes only to ticket revocation; `ArenaRoom.ts:191` reconnects without checking the session again. The probe revokes the session, waits 1.1 s, and the same socket still receives a server pong. Expiry also lacks an arena-seat enforcement path. Admin sign-out is therefore incomplete. | GR01 |
| E02 | P1 / R+C | **Detached projectile ownership is unsafe after entity reuse.** `ArenaRoom.ts:240` allocates the lowest free ID; fired projectiles survive departure; `TickPipeline.ts:370–379` increments the current occupant's kills by entity ID before its separate life check for passive rewards. Probe: A fires, leaves, C takes ID 1, A's shot kills B, C receives the KO. `Projectiles.ts` also skips a target solely by owner ID and reflects toward that ID's current pose. A replacement can be incorrectly immune or treated as the original shooter. | GR02 |
| E03 | P1 / C | **Reconnect exists as a library feature, not a complete app journey.** `RoomClient.ts:256` defines `tryResume`, with no app caller. `main.ts:409` resets sampler epoch only; clock, prediction, held intent and remote buffers are not reset together. Ordinary non-sparring terminal leaves other than code 4500 are ignored by the app handler (`main.ts:265`). `pagehide` always disposes and leaves consentingly. There is no reconnecting input gate or clear restart state. SDK auto-reconnect may recover transport, but it does not fulfill the app contract. | GR03 |
| E04 | P1 / R+C | **Prediction uses input acknowledgment as the pose time.** `Prediction.ts:107` anchors a current server pose to `ackInputTick`; `TickPipeline.ts:501` publishes that field from the client sample tick. A delayed input acknowledgment can be older than the state tick, so replay advances time already represented by the pose. The probe supplies a pose at tick 10 with ack tick 1 and observes >0.5 m extra displacement. Shared integration alone does not prove parity. Grounded/air-jump/coyote state also remains local across correction, and ability movement restrictions are not fully represented in replay. | GR04 |
| E05 | P2 / R+C | **Input cancellation is incomplete across UI and keyboard ownership.** With the menu open, pressing 2 casts Gravel Flurry and consumes cooldown. `KeyboardRouter.ts:71–85` accepts window keys without a UI gate; settings merely calls `router.releaseAll()` (`main.ts:471`). `PointerRouter.releaseAll` does not clear queued edges. Its movement setter bypasses `disabled`, and keyboard's own `down` set is not cleared by menu-open cancellation. This creates accidental casts, stale movement and typing conflicts. | GR05 |
| E06 | P2 / R+C | **Keyboard cannot perform the intended held-Jump uppercut gesture.** `KeyboardRouter.ts:47–48` releases jump during keydown. The server correctly checks `jumpHeld` during M1, but it is always false for Space. A unit probe confirms the mismatch; existing keyboard tests assert edges but never hold semantics. | GR06 |
| E07 | P2 / C | **Ready is not equivalent to available.** `Hud.ts:68` derives Ready only from cooldown text. Spent once-per-form moves have cooldown 0 and remain labelled Ready although `AbilityRunner.ts:441` rejects the use mask. Owner evasive cooldown and charge start exist but are not represented in the HUD; Vanguard's untimed awakening has end tick 0 and receives no form timer label. The server remains correct while the interface gives false instructions. | GR07 |
| E08 | P2 / C | **Round results cannot be reconstructed from state.** Only `phase` is replicated (`state/ArenaSchema.ts`); target, deadline and standings exist in a one-shot message (`ArenaRoom.ts:290–305`). `RoundResults.update` does nothing until that message has arrived. A player joining/reconnecting during results can see a frozen match without winner/countdown. `GameLoop` has no phase gate and continues local prediction while the server freezes it. | GR08 |
| E09 | P2 / C | **No app response to WebGL context loss.** No `webglcontextlost/restored` handler exists in client source. Three.js may recover internal renderer state, but the app neither neutralizes input nor displays recovery status. The player can control an unseen vulnerable fighter. Failure/retry during async asset loading also lacks transactional cleanup of the provisional renderer. | GR09 |
| E10 | P2 / C | **Routine logs contain data the contract excludes.** `sessionRoutes.ts:121` logs `clientKey(req)` as `ip`; line 163 logs display name. `StructuredLog.ts` redacts credentials but neither field. The same lines are retained for the admin log view. This is a concrete contract violation, not an assertion of public exposure. | GR10 |
| E11 | P2 / C | **Sparring does not yet exercise fighter roles or dependable pursuit.** Every skill decision requires ≤2 m (`SparringBrain.ts:36–48`), Ember Orb is explicitly skipped, and once-used slots are still considered ready. Movement tries a straight line and stops at unsafe geometry (`BotArenaRoom.ts:104`) without an alternate route. The code cannot teach ranged spacing and cannot route around an obstacle to the target. A bot was stationary at a bridge margin during the walkthrough; systematic stuck frequency remains unmeasured. | GR13, GR14 |

P1 means fix before treating online/private play as reliable. P2 means a substantive usability/correctness issue to address before the next release candidate. No demonstrated remote code execution or arbitrary client damage exploit was found in the inspected paths; this is not a comprehensive penetration-test certification.

### Browser acceptance gap

The full browser run is not a clean acceptance result. Onboarding contains an obsolete “no Host sparring” assertion; the sv.b3 reaction expectation also fails on a pinned-runtime rerun and needs observation/authority tracing. Its 30-tick ability stun remains required despite decision 0049. The multiplayer fight passes on rerun, while the four-fighter workload times out awaiting awakening in the broad run. Exact counts and any further failures are in FR01 evidence. GR00 specifies bounded test reconciliation; it forbids removing expected reactions, relaxing budgets or calling retries proof of correctness.

### Secondary engineering debt, deliberately not release-blocking

- `FixedClock.overloadTimes` is pruned only when `isOverloaded` is called, normally during auth. `RespawnSystem.rewarded` retains every rewarded life until room disposal. Both collections can grow in a long-lived room; room-lifetime `uint16` life IDs also wrap. Bounded-room-lifetime policy or widening/pruning deserves a separate follow-up if persistent hosting duration increases. Do not mix it into the player-facing fixes.
- `main.ts` is now 703 lines and manages several independent animation callbacks and overlays. Extract the connection/input lifecycle in the slices that need it; a broad rewrite would add risk without fixing the demonstrated defects by itself.
- Build reports a ~5.24 MB runtime JS chunk (~1.91 MB gzip). The shell is lazy, so this is not evidence that the initial shell budget failed. Measure first-join download/compile on the actual iPads before splitting dependencies further.
- The command called `lint` checks import boundaries and timer strings only, as documented by decision 0002. A passing result is not full semantic linting.
- Performance integration tests are opt-in, not included in the 1,680 passing tests. Browser software-renderer draw budgets do not establish tablet FPS. Keep this distinction in release reports.
- `docs/spec.md` still contains original movement/no-double-jump values and Quick Use selection semantics alongside accepted amendments in decisions 0020, 0047 and 0051. Executors must read amendments; GR15 adds a current-authority index without silently retuning anything.

## Staff UX designer assessment: game experience

### What the current game communicates well

The arena has a consistent floating-island identity. The three fighters and effects use distinct materials and color families; the scene has cover, exposed edges and bridges that can make positioning meaningful. The welcome screen has an obvious Play action, practice is reachable, controls can be rearranged, and the new enemy HP/nameplates remove a major information gap from the earlier build. KO/respawn and server-confirmed hit feedback are implemented, not mockups.

The main weakness has shifted from **missing feedback** to **feedback competing with itself, or contradicting action rules**. More particles would not solve that. Players need reliable answers to: “What can I do now?”, “What is dangerous?”, “What am I trying to win?”, and “What should I try differently next time?”

### Journey findings and opportunities

| Journey | Observation | Design consequence and proposed change |
|---|---|---|
| Choose how to play | Play/Practice are central; Host sparring/Find a room float separately; Welcome says an invitation unlocks play even in open-join mode. Loading after Practice initially leaves the same welcome screen visible. **R+C** | Treat training, friends and bots as three explicit routes with truthful auth copy and a visible busy state. Retain the existing APIs and game modes. GR12. |
| Choose a fighter | Lobby offers names and a comma-separated move list, without the specified model preview or a concise playstyle comparison. **R+C** | Show one selected original fighter preview with a short role and one tactical tip. The user should choose based on an intended action, not unfamiliar move names. GR12. |
| Read skill controls | At 1024×768, the first skill wraps name and role into more vertical text than the 60 px button can show. “Fault Strike / Strike + wave / Ready” visibly clips. **R+C** | Keep full names accessible, but remove role prose from combat buttons and budget exactly two name lines plus one state line. Put descriptions in the existing guide. GR11. |
| Understand action availability | Once-used awakening skills still say Ready; charge progress and evasive availability are absent; an untimed Vanguard form gets no persistent form label. **C** | Explicit “Used”, charge percentage, “Escape” cooldown, and form-specific wording are more useful than another effects pass. GR07. |
| Use a menu while fighting | Combat text appears over the menu; enemy nameplate crosses Settings; top action text overlaps health. Keyboard can still cast. **R+C** | Define one overlay hierarchy and one input gate. Keep “The arena continues…” but make the menu itself legible and safe to operate. GR05 + GR11. |
| Pursue victory | First-to-five setup works, but the active HUD does not show target or leader progress. Results are event-only and not interactive. **R+C** | Persistent “First to 5 · You 2 · Leader 4”, reconstructable standings/countdown, and visible Leave/Fighter access give the match a readable arc. Preserve the approved automatic 600-tick restart. GR08. |
| Learn combat | Current tutorial confirms moving, turning, M1 starts, guarding duration, dash, skill starts and awakening. It never requires a hit, successful block, or reading an attack. **C** | Completing the checklist proves button use, not competence. Add a separate, optional three-drill practice track using confirmed server outcomes: land, defend, evade. GR15. |
| Practice solo | With one bot, kit rotation always starts at Stone Vanguard. Medium bots only use slots 1–2; even hard ranged fighters wait for melee reach; charged orb is absent. **C** | Preserve easy mode, give medium/hard role-aware distance policies and explicit bot kit selection in a separate later UI change if demanded. First fix routing and role behavior (GR13/14). |
| Recover from defeat | KO card and fighter-change entry are useful. The killer HP is sampled live during the countdown, not frozen at the KO, so “HP left” can change after the fight. Environmental deaths render a trailing separator. **C; minor** | GR11 freezes the displayed killer snapshot when available and uses “Fell from the arena” for an uncredited fall. Do not alter scoring. |

### Design priorities and hypotheses

**Opportunity 1 — Make the existing actions trustworthy.** GR03–GR09 and GR11 remove contradictions between input, simulation and display. Expected benefit: less perceived unfairness. Validate through reconnect, repeated skill use and menu scenarios, not subjective ratings alone.

**Opportunity 2 — Teach one useful combat decision at a time.** A named “Land a strike”, “Block a strike”, “Leave the warning” practice track can turn the existing dummy, telegraphs and bots into a learning loop. No rewards economy, accounts, unlocks or additional roster are needed. Completing a drill must mean the server observed success.

**Opportunity 3 — Let the arena matter without making pursuit fail.** Cover and bridges are valuable when they support approach/escape choices. Bots need a deterministic route around obstacles; ranged fighters need distance-appropriate decisions. Keep path planning server-side and bounded. Do not remove ring-outs or invisible-wall the whole map to hide navigation problems.

**Opportunity 4 — Use the approved round mode to create a satisfying session.** The target belongs in the live match, not only setup and results. Preserve endless open FFA. Avoid adding ranked scores, persistent progression or arbitrary round timers.

Hypotheses for QD01, not findings proven by this review:

- Generic M1 stun is disabled by explicit owner decision 0049; ability stuns, captures and ragdolls still exist. Test whether players can distinguish a safe opening from a trade. **Do not turn generic stun back on as a review fix.**
- Spawn separation may lengthen the journey back to a two-player fight. Record time from respawn to first encounter over ten lives before changing spawn selection. Existing safe-spawn rules outrank a desire for faster encounters.
- Default effects, multiple cast labels and low-HP vignette may overwhelm children in a four-player fight. Measure identification of attacker, attack footprint and available escape, with normal/reduced motion, before changing damage or authored telegraph duration.
- Current art is coherent but model previews and readable silhouettes may improve fighter choice more than more environmental detail. Blind kit identification on both tablets is more useful than another unmeasured aesthetic score.

## Recommended order and release decision

0. **Acceptance credibility:** GR00 reconciles browser failures without weakening approved combat assertions.
1. **Trust/security:** GR01 revocation, GR02 identity-safe projectile attribution, GR03 connection lifecycle, GR04 prediction.
2. **Control/readability:** GR05 overlay input, GR06 held Jump, GR07 action status, GR08 round state, GR09 graphics recovery, GR10 privacy logging, GR11 HUD hierarchy.
3. **Learning/replay value:** GR12 entry and fighter choice, GR13 routing, GR14 bot tactics, GR15 practice drills and playtest packet.
4. Run QD01/DEV1 on actual devices after the relevant slices. Release approval remains blocked on those results and resolution of P1 items. More VFX, a fourth fighter, new hosting or a monetization/progression system are not recommended within this scope.

The implementation specification fixes behavior and test expectations for each slice. Documentation of a proposed slice is not implementation approval for a whole batch; execute one ID per fresh session. If an executor finds a changed prerequisite or a conflicting accepted amendment, stop and report the exact conflict instead of choosing a new game rule.
