# Task ledger

Status values: TODO, IN PROGRESS, BLOCKED, DONE, IMPLEMENTED (DEVICE CHECK PENDING).
Source: docs/spec.md section 27, amended by docs/decisions/0001-split-t18.md (T18 split) and
docs/implementation-plan.md (fix packets R01 to R16, execution order). Notes hold open items; they are not statuses.

## Specification tasks

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|------|-------|-----------|--------|--------|-------------|-------|
| T01 | Bootstrap | none | DONE | 8ea8a19 4234310 | docs/test-results/T01.md | Fresh-clone typecheck fails: R01. Node 24 never run: R15 |
| T02 | Shared contracts | T01 | DONE | c6a11ed | docs/test-results/T02.md | |
| T03 | Authentication | T02 | DONE | d72ea24 | docs/test-results/T03.md | |
| T04 | Room lifecycle | T03 | DONE | 7999339 | docs/test-results/T04.md | Overload gate unused: R09 |
| T05 | Arena colliders | T02 | DONE | 05dfad7 | docs/test-results/T05.md | |
| T06 | Movement | T04 T05 | DONE | 81cea56 | docs/test-results/T06.md | |
| T07 | Touch shell | T02 | IMPLEMENTED (DEVICE CHECK PENDING) | 8dd6b61 | docs/test-results/T07.md | Browser layout evidence: R13 |
| T08 | Camera and prediction | T06 T07 | IMPLEMENTED (DEVICE CHECK PENDING) | d19004e | docs/test-results/T08.md | Real collider and ackInputTick: R08, R14 |
| T09 | Combat states | T06 | DONE | 0f446aa | docs/test-results/T09.md | |
| T10 | M1 and guard | T07 T09 | IMPLEMENTED (DEVICE CHECK PENDING) | 54ad14c | docs/test-results/T10.md | Forward-dash hit missing: R06 |
| T11 | Ability framework | T09 | DONE | 5962f5a | docs/test-results/T11.md | R02 R03 R04 R05 R07 |
| T12 | Vanguard base | T11 | DONE | 46a193c 812929c ebdf0a0 2c6ff88 653894e | docs/test-results/T12.md | Ember Orb reflect acceptance covered by T19 (projectile.test.ts, Rift Palm vs test orb). Wire tests: R12 |
| T13 | Duelist base | T11 | DONE | ea963db 1f315a3 557018b 2cdffcd aa9916b feef664 | docs/test-results/T13.md | Projectile reflect A10 A19 covered by T19 (td.b4 vs test orb, thin cover). Wire tests: R12 |
| T14 | Awakening system | T12 T13 | DONE | a403214 | docs/test-results/T14.md | Ocean Surge line of sight: R05. HUD: T18c |
| T15 | Vanguard awakening | T14 | DONE | afee336 b4a53b5 9595eff 7fc484b d0fd5ca f0c1ac9 | docs/test-results/T15.md | Skybreak and beam anchors: R05. Owner status: R08 |
| T16 | Duelist awakening | T14 R02 R04 R05 | DONE | 3bfd775 3dc1869 e2ba01d ac688b3 | docs/test-results/T16.md | td.a2 area and td.a4 wall stop unit-only. Spec gaps as D values in T16.md |
| T17 | Respawn and FFA | T10 T14 R10 | DONE | d4af402 | docs/test-results/T17.md | A13 A18 pass. decisions/0008. Hit-region 2 m approximation (D) |
| T18a | Scene and fighter views | R01 R17 T05 | IMPLEMENTED (DEVICE CHECK PENDING) | eff9c06 fd3c78a | docs/test-results/T18a.md | decisions/0001. Chromium SwiftShader run only |
| T18b | Client input and prediction loop | T18a R08 R14 | IMPLEMENTED (DEVICE CHECK PENDING) | 4c051b9 5975c02 55b0915 78eecfa 5053d53 | docs/test-results/T18b.md | Playwright two-context match passes. No double-W run or mouse-look; cast movement not predicted |
| T18c | App flow, lobby and HUD | T18b T14 | IMPLEMENTED (DEVICE CHECK PENDING) | 8246b5e f17098f 84f5cf8 | docs/test-results/T18c.md | Playwright 9/9. Form timer and Stillpoint not browser-tested |
| T18d | Practice room and onboarding | T18c T17 | IMPLEMENTED (DEVICE CHECK PENDING) | 14ebb33 7563d46 3953a63 28239f4 | docs/test-results/T18d.md | decisions/0009. Playwright 10/10. Dummy can be KO'd by >60 HP hit |
| T18e | P0 playable gate | T15 T16 T17 T18d R12 R13 | IMPLEMENTED (DEVICE CHECK PENDING) | 61b79ba 3f8d897 00e3469 | docs/test-results/T18e.md | 16 PASS 0 FAIL 13 NOT RUN. D01-D09 need both iPads (plan section 7) |
| T19 | Charge and projectile system | T18e | IMPLEMENTED (DEVICE CHECK PENDING) | 107e90d 83feef4 | docs/test-results/T19.md | A10 A11 A19 pass on test-only ea.b3 (T20 ships it). D03 NOT RUN. Rules: decision 0010 |
| T20 | Artificer base | T19 | IMPLEMENTED (DEVICE CHECK PENDING) | cef3142 eaff0cd | docs/test-results/T20.md | decisions/0014. Ember Orb ea.b3 now shipped, T19 tests repointed. Wire rows use a server kit fixture (Artificer not selectable). iPad NOT RUN. Browser suite flaky: see T20.md |
| T21 | Artificer awakening | T20 | IMPLEMENTED (DEVICE CHECK PENDING) | b4e72a5 bbcda67 244ec29 | docs/test-results/T21.md | decisions/0022. ea.a1 to ea.a4 and ea.activate; Artificer now selectable in the lobby. iPad NOT RUN. Browser specs need exclusive ports: see T21.md |
| T22 | Passives | T21 | IMPLEMENTED (DEVICE CHECK PENDING) | 45d4b64 | docs/test-results/T22.md | decisions/0028. Registry, CombatSystem.heal, heal events with targetHp100, ea cooldown reset. Wire: tests/integration/t22-passives.test.ts. iPad NOT RUN |
| T23 | Props and wall context | T18e T19 | IMPLEMENTED (DEVICE CHECK PENDING) | 3a476b2 f59234b ce40158 591be2d 53997fe | docs/test-results/T23.md | decisions/0016. Wire: tests/integration/t23-urns, t23-wall, t23-gale tests. flow.spec T27 mirror check fails in browser run (client, untouched); iPad NOT RUN |
| T24 | Duelist P1 variants | T16 | IMPLEMENTED (DEVICE CHECK PENDING) | 65c11d6 c37d624 | docs/test-results/T24.md | decisions/0012-t24-duelist-p1-variants. Wire: tests/integration/t24-variants.test.ts (3 clients chain, elevated slam) |
| T25 | Original art pipeline | T18e | IMPLEMENTED (DEVICE CHECK PENDING) | d71a447 b17bed8 | docs/test-results/T25.md | decisions/0015. assets:audit passes (3 fighters, 84 clips). Fighters and arena rebuilt as original rigged toon art; glTF files verified but runtime builds the same rig in code. Before/after: T25-before*.png, T25-after*.png. iPad perf NOT RUN |
| ART1 | Environment art from CC0 packs | ART0 | IMPLEMENTED (DEVICE CHECK PENDING) | 4c5f8c3 | docs/test-results/ART1.md | decisions/0023. Quaternius CC0 props instanced outside walkable ground; collider meshes aligned within 0.05 m; 66 calls, 92.7k tris medium (SwiftShader). iPad perf NOT RUN |
| ART1-follow-up | Art-direct east spawn-to-bridge route with MegaKit | ART1 | IMPLEMENTED (DEVICE CHECK PENDING) | 6f5b3b5 | docs/test-results/ART1-route.md | Owner-scoped route pass; opposite pine skyline, low margin cover, 4 browser / 6 unit checks pass. Physical iPad NOT RUN |
| ART2 | Smooth skinned fighter meshes, textures and LOD | B1 | IMPLEMENTED (DEVICE CHECK PENDING) | 57f849f | docs/test-results/ART2.md | decisions/0027. Rounded boxes, 12-segment tapered limbs, 0.06 m two-bone joint blend, 512 px per-kit atlas, low LOD; medium 3.3-4.3k tris, low 1.6-2.1k. iPad perf NOT RUN |
| T26 | Effects audio and camera | T21 T23 T25 | RETIRED (decision 0021) | | | Split into FX0-FX5 |
| T27 | Settings and layout editor | T07 T18e | IMPLEMENTED (DEVICE CHECK PENDING) | 2281bc6 | docs/test-results/T27.md | decisions/0013. Playwright 34/34. D05 D06 NOT RUN. Several settings stored, not yet consumed |
| T28 | Production hosting | T04 T18e | IMPLEMENTED (DEVICE CHECK PENDING) | 3778216 | docs/test-results/T28.md | decisions/0011. Local build/serve/health/two-client verified; TLS, host, iPad remote checks NOT RUN (no host chosen) |
| T29 | Security hardening | T22 T28 | IMPLEMENTED (DEVICE CHECK PENDING) | 1b980e1 | docs/test-results/T29.md | decisions/0030. CSP, 5/30 per min, WS origin, invalid-message drop. Safari/iPad, TLS NOT RUN |
| T30 | Performance pass | T24 T26 T27 | IN PROGRESS | pending | docs/test-results/T30.md | decisions/0031. Adaptive quality controller done and unit tested. Section 24 budget measurements (tick, network, memory, draw calls with final art, iPad) NOT RUN. QP02 measured peak combat server tick, serializer and bytes (docs/test-results/QP02.md); iPad rows remain NOT RUN |
| T31 | Fidelity calibration | T18e T27 | IMPLEMENTED (DEVICE CHECK PENDING) | 779475b | docs/test-results/T31.md | decisions/0017. Layout JSON + ledger done; all O01-O08 NOT RUN. test:browser: 1 intermittent T27 flow test failure |
| T33a | Owner ops kit: one-command start | T28 | IMPLEMENTED (DEVICE CHECK PENDING) | d3c3333 | docs/test-results/T33a.md | `pnpm play`; QR encoder + origin logic unit-tested; Tailscale path and iPad scan NOT RUN |
| T32 | Release candidate | T29 T30 T31 | BLOCKED | | docs/test-results/T32.md | Missing: DEV1 owner iPad session and T30 device rows. Automated gates pass |
| DEV1 | iPad device session (owner-run) | T30 BOT5 HELP2 | BLOCKED | | docs/test-results/DEV1.md | Missing: physical iPads; all rows NOT RUN |

## Review fix packets (docs/implementation-plan.md section 4)

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|------|-------|-----------|--------|--------|-------------|-------|
| R01 | Clean-checkout gate, real lint | none | DONE | ddc63ad | docs/test-results/R01.md | ESLint skipped (TS7 unsupported): decisions/0002 |
| R02 | Captured victims hit-eligible | R01 | DONE | 44d4ada 1e93e0c | docs/test-results/R02.md | Blocks T16 |
| R03 | Single offensive buffer | R01 | DONE | ee2e601 07505a5 | docs/test-results/R03.md | consumeBuffer kept as thin wrapper |
| R04 | Armor startup and onHit | R01 | DONE | e2e620e | docs/test-results/R04.md | Blocks T16 |
| R05 | Shape anchors and area line of sight | R01 | DONE | 001386d | docs/test-results/R05.md | Blocks T16 |
| R06 | Forward-dash hitbox | R01 | DONE | 756a123 | docs/test-results/R06.md | Pass-through misses targets <0.5 m at tick 15 |
| R07 | turnRate during casts | R01 | DONE | 8d79d59 | docs/test-results/R07.md | One-tick body lag; aim follows move stick |
| R08 | Replicated cooldowns and owner state | R01 | DONE | eebc8e8 | docs/test-results/R08.md | Colyseus view() decorator, decisions/0007 |
| R09 | Protocol details and overload gate | R01 | DONE | 9d1d694 | docs/test-results/R09.md | |
| R10 | One owner for the fighter kit | R01 | DONE | c858d75 | docs/test-results/R10.md | Blocks T17 |
| R11 | Shared knockback vector | R01 | DONE | 6d605fe | docs/test-results/R11.md | |
| R12 | Two-client matrix for every move, A15 | R02 R03 R04 R05 R06 | DONE | 71be8ea 630c400 3e577bc | docs/test-results/R12.md | 18 moves + A15 on two real clients; block/miss/duplicate stay in unit tests |
| R13 | Browser layout evidence | R01 | DONE | db8ce44 | docs/test-results/R13.md | Desktop Chromium only; iPad D01-D06 NOT RUN |
| R14 | Prediction on the real collider | R08 | DONE | 628964f | docs/test-results/R14.md | Corner contact untested; face-centre only |
| R15 | Node 24 run and decision records | R01 | DONE | 9e8246a | docs/test-results/R15.md | Decisions numbered 0003-0006 (0002 taken by R01) |
| R17 | Tick pipeline extraction | R01 | DONE | 85fa1a7 | docs/test-results/R17.md | Wave 1 |
| R18 | Latency matrix on loopback | R12 | DONE | 87dd454 | docs/test-results/R18.md | In-process TCP delay proxy. 1%/3% loss NOT RUN; A12/A15 not under latency |


## Backlog v2 slices

| ID | Title | Prerequisites | Status | Commit | Test report | Notes |
|---|---|---|---|---|---|---|
| SPD1 | Faster movement | M0 | IMPLEMENTED (DEVICE CHECK PENDING) | 185454c | docs/test-results/SPD1.md | decisions/0020. walk 7, run 11, guard 3, accel 70; iPad NOT RUN |
| FX0 | Combat event contract and presentation bus | M0 | DONE | 20028c9 | docs/test-results/FX0.md | decisions/0021 |
| FX3 | Audio bus and original synthesized sounds | FX0 | IMPLEMENTED (DEVICE CHECK PENDING) | 914b6f7 | docs/test-results/FX3.md | decisions/0026. audibility and iPad unlock NOT RUN |
| FX2 | Combat text: damage numbers, power callouts, KO feed | FX0 | IMPLEMENTED (DEVICE CHECK PENDING) | 89e125a | docs/test-results/FX2.md | decisions/0025. settings schema v2; iPad NOT RUN |
| FX4-td | Tide Duelist ability effects | FX1 | IMPLEMENTED (DEVICE CHECK PENDING) | d41b63b | docs/test-results/FX4-td.md | recipes for 8 td abilities; iPad NOT RUN |
| FX4-sv | Stone Vanguard ability effects | FX1 | IMPLEMENTED (DEVICE CHECK PENDING) | 2cbc0d0 | docs/test-results/FX4-sv.md | recipes for 11 sv abilities; iPad NOT RUN |
| FX4-ea | Ember Artificer ability effects | FX1 T21 | IMPLEMENTED (DEVICE CHECK PENDING) | b07be69 | docs/test-results/FX4-ea.md | recipes for 8 ea abilities; iPad NOT RUN |
| FX4-align | Directional FX and terrain placement | FX4-sv FX4-td FX4-ea | IMPLEMENTED (DEVICE CHECK PENDING) | 2c31554 | docs/test-results/FX4-align.md | Four headings, mixed-height terrain and defender-side Gravel Flurry verified in Chromium. iPad NOT RUN |
| FX5 | Capture camera and reduced motion | FX1 | IMPLEMENTED (DEVICE CHECK PENDING) | ab5030b | docs/test-results/FX5.md | decisions/0029. iPad NOT RUN |
| FX1 | Hit impact effects: sparks, flash, hitstop, shake | FX0 | IMPLEMENTED (DEVICE CHECK PENDING) | 53e03bc | docs/test-results/FX1.md | decisions/0024. shake scale constant 0.25; iPad NOT RUN |

## Hosted sparring (documentation only)

Execution details, ownership and acceptance gates are in [the sparring plan](sparring-plan.md). Reports and commit hashes are filled after execution.

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| BOT0 | Freeze sparring contracts | T18d T33a | DONE | f8a66a5 | docs/test-results/BOT0.md |
| BOT1 | Deterministic opponents | BOT0 | DONE | fd80a2c | docs/test-results/BOT1.md |
| BOT2 | Private match membership | BOT0 | DONE | e761c3a | docs/test-results/BOT2.md |
| BOT3 | Host setup controls | BOT0 | IMPLEMENTED (DEVICE CHECK PENDING) | 99e5722 | docs/test-results/BOT3.md |
| BOT4 | Authoritative room integration | BOT1 BOT2 | IMPLEMENTED (DEVICE CHECK PENDING) | 57ac46d | docs/test-results/BOT4.md |
| BOT4C | Client journey integration | BOT3 | IMPLEMENTED (DEVICE CHECK PENDING) | b0c2383 | docs/test-results/BOT4C.md |
| BOT5 | End-to-end sparring journeys | BOT4 BOT4C | IMPLEMENTED (DEVICE CHECK PENDING) | 8e863b8 | docs/test-results/BOT5.md |

## Player onboarding and instructions

The [dispatch board](agent-dispatch.md) contains the file ownership, acceptance tests and merge order. T18d remains the owner of server-confirmed practice progression.

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| HELP1 | Standalone How to play guide for touch and keyboard | T18c T18d | IMPLEMENTED, DEVICE CHECK PENDING | 7cfc40d | docs/test-results/HELP1.md |
| HELP2 | Welcome entry and guided practice handoff | HELP1 | IMPLEMENTED (DEVICE CHECK PENDING) | 5cedad5 | docs/test-results/HELP2.md | Reconciled from history. SPARRING_GUIDE_AVAILABLE still false (main.ts TODO BOT4C); iPad NOT RUN |

## Web app, room list and admin (documentation only)

Plan and file ownership are in [the web plan](web-plan.md); hosting steps are in [Cloudflare hosting](cloudflare-hosting.md).

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| WEB1 | Installable app and offline shell | | IMPLEMENTED, DEVICE CHECK PENDING | 26e30db | docs/test-results/WEB1.md |
| WEB2 | Update button | WEB1 | IMPLEMENTED, DEVICE CHECK PENDING | 8ce5d9c | docs/test-results/WEB2.md |
| WEB3 | Room list and one-tap join | BOT5 | IMPLEMENTED, DEVICE CHECK PENDING | 1122d6e | docs/test-results/WEB3.md |
| WEB4 | Admin API and login | | DONE | ff63044 | docs/test-results/WEB4.md |
| WEB5 | Admin app screens | WEB4 WEB3 | IMPLEMENTED, DEVICE CHECK PENDING | 8ce5d9c | docs/test-results/WEB5.md |

## Scoped follow-up

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|---|---|---|---|---|---|---|
| ORB2 | Render Ember Orb from replicated server state (item 2) | T19 T20 T21 | IMPLEMENTED (DEVICE CHECK PENDING) | b19f246 | docs/test-results/ORB2.md | Two Chromium contexts: flight, reflection, expiry. Physical iPad NOT RUN |

## Quality 90 release track

Execute one row per session using [the Quality 90 instructions](quality-90-plan.md). This is dispatch order. A TODO row carries a planned evidence path until its executor supplies results.

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| Q00 | Baseline and evidence inventory | FX4-align ORB2 WEB1 WEB2 WEB3 WEB4 WEB5 | DONE | 0192299 | docs/test-results/Q00.md |
| Q01 | Reproducible fight and load capture | Q00 | DONE | caff92f | docs/test-results/Q01.md |
| QA01 | Reliable sparring and replay | Q01 BOT5 | DONE | 577f9bc | docs/test-results/QA01.md |
| QC01 | Close-combat visibility | Q01 | IMPLEMENTED, DEVICE CHECK PENDING | bf64d3a | docs/test-results/QC01.md |
| QE01 | East bridge MegaKit art pass | Q01 ART1 | IMPLEMENTED (DEVICE CHECK PENDING) | de8cf2a | docs/test-results/QE01.md |
| QF01 | Stone Vanguard silhouette and animation | Q01 ART2 | IMPLEMENTED (DEVICE CHECK PENDING) | c8e12ad | docs/test-results/QF01.md |
| QV01 | Visible urn lifecycle | Q01 T23 ORB2 | IMPLEMENTED (DEVICE CHECK PENDING) | 57f849f | docs/test-results/QV01.md |
| QV02 | Durable attack telegraphs | Q01 FX4-align | IMPLEMENTED (DEVICE CHECK PENDING) | b857f02 | docs/test-results/QV02.md |
| QV03 | Fault Strike signature | QV02 QF01 | IMPLEMENTED, DEVICE CHECK PENDING | e8d4716 | docs/test-results/QV03.md |
| QV04 | Undertow Spiral signature | QV02 | IMPLEMENTED, DEVICE CHECK PENDING | cdcbb3e | docs/test-results/QV04.md |
| QV05 | Furnace Ray signature | QV02 | IMPLEMENTED, DEVICE CHECK PENDING | c345010 | docs/test-results/QV05.md |
| QI01 | Integrated bridge fight and owner approval | QE01 QF01 QC01 QV03 QV04 QV05 | IMPLEMENTED (DEVICE CHECK PENDING) | 958faa4 5d2b834 | docs/test-results/QI01.md | Delegated approval, decision 0033. Fault Strike impact flash visibility carried to QV06 |
| QE02 | Full arena art coverage | QI01 | IMPLEMENTED, DEVICE CHECK PENDING | 7526d45 | docs/test-results/QE02.md | Delegated assessment, decision 0040. QD01 owns bridge identification |
| QF02 | Tide Duelist silhouette and animation | QI01 QF01 | IMPLEMENTED (DEVICE CHECK PENDING) | 38f4a42 | docs/test-results/QF02.md |
| QF03 | Ember Artificer silhouette and animation | QF02 | IMPLEMENTED (DEVICE CHECK PENDING) | 0ecd4a9 | docs/test-results/QF03.md |
| QV06 | Vanguard ability and awakening coverage | QI01 QV01 QV03 | IMPLEMENTED (DEVICE CHECK PENDING) | 06dc60a | docs/test-results/QV06.md | Delegated assessment, decision 0036. Fault Strike flash carried item shown |
| QV07 | Duelist ability and awakening coverage | QF02 QV04 | DONE | eaf39b8 | docs/test-results/QV07.md |
| QV08 | Artificer ability and awakening coverage | QF03 QV05 ORB2 | IMPLEMENTED (DEVICE CHECK PENDING) | 7971e5e, cc4b33a | docs/test-results/QV08.md |
| QV09 | Universal attacks and contextual outcomes | QV01 QV06 QV07 QV08 | IMPLEMENTED, DEVICE CHECK PENDING | 00afaca | docs/test-results/QV09.md |
| QS01 | Original kit and defensive audio | QV09 | IMPLEMENTED, DEVICE CHECK PENDING | 22db7e9 | docs/test-results/QS01.md |
| QU01 | Touch HUD and first match | QC01 QA01 | IMPLEMENTED (DEVICE CHECK PENDING) | 511e38b | docs/test-results/QU01.md |
| QP01 | Production load and join cycles | QE02 QF03 QV09 QS01 QU01 | IMPLEMENTED (DEVICE CHECK PENDING) | d3d8d97 | docs/test-results/QP01.md |
| QP02 | Peak combat and adaptive quality | QP01 Q01 | IMPLEMENTED (DEVICE CHECK PENDING) | 78b3bfd | docs/test-results/QP02.md |
| QW01 | Production web and rematch acceptance | QP01 QA01 WEB5 | IMPLEMENTED (DEVICE CHECK PENDING) | d8c036a | docs/test-results/QW01.md |
| QD01 | Two-iPad acceptance and human playtest | QP02 QW01 | BLOCKED | | docs/test-results/QD01.md | Missing: two physical iPads and two human players (owner-run). All automated prerequisites implemented. Recording sheet prepared 2026-11-02; device evidence and blind stimuli/answer key still pending |
| FLAKE1 | Browser debug-probe and load flakes | QP02 | DONE | 8e46984 | docs/test-results/FLAKE1.md |
| QR01 | Measured score and release verdict | QD01 | BLOCKED | | docs/test-results/QR01.md | Missing: QD01 device and playtest results |

## Owner experience revision (approved 2026-11-02)

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| UX01 | Discoverable admin and configurable bot rooms | WEB5 BOT4 | IMPLEMENTED (DEVICE CHECK PENDING) | ae871ef | docs/test-results/UX01.md |
| UX02 | Add opponents from practice | UX01 | IMPLEMENTED (DEVICE CHECK PENDING) | 19338be | docs/test-results/UX02.md |
| UX03 | Menu and settings visual redesign | UX02 | IMPLEMENTED (DEVICE CHECK PENDING) | 935da97 | docs/test-results/UX03.md |
| UX04 | Settings runtime and feedback | UX03 | IMPLEMENTED (DEVICE CHECK PENDING) | 234b573 | docs/test-results/UX04.md |
| UX05 | Environment graphics refinement | UX04 | IMPLEMENTED (DEVICE CHECK PENDING) | 370c5b8 | docs/test-results/UX05.md |
| UX06 | Character joints and movement refinement | UX05 | IMPLEMENTED (DEVICE CHECK PENDING) | 764e567 | docs/test-results/UX06.md |
| UX07 | Ability descriptions and area readability | UX06 | IMPLEMENTED (DEVICE CHECK PENDING) | efd5c57 | docs/test-results/UX07.md |
| UX08 | Complete local admin bootstrap and owner setup | UX01 UX07 | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (UX08 commit) + decision 0048 triangle cap 300k; iPad fps NOT RUN | docs/test-results/UX08.md |
| UX09 | Disable generic on-hit freeze behind HIT_STUN flag | UX08 | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (UX09 commit); decision 0049; iPad check NOT RUN | tests/unit/hit-stun-flag.test.ts |
| OJ01 | Open join: Arel/Nora sessions without invitation, one shared room, rename fix, real client tests | UX09 | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (OJ01 commit) | tests/integration/open-join.test.ts | decision 0050 |
| ACC01 | Cloudflare Access gate and fail-closed Access token check | OJ01 | IMPLEMENTED, DEVICE CHECK PENDING | see git log (OJ01 commit) | tests/unit/access-jwt.test.ts | Access app `battle` created 2026-11-02 (Allow: 3 player emails, 1 month); prod runs f46b37f with OPEN_JOIN=1; unauthenticated public request 302s to Access, direct server call 403. Real email-PIN login from a phone on mobile data NOT RUN |
| SFX01 | Strike swings, awakening, special-hit, grab and respawn sounds | QS01 | IMPLEMENTED, DEVICE CHECK PENDING | see git log (OJ01 commit) | tests/unit/audio-bus.test.ts | Synthesized only; audibility on iPad NOT RUN |
| UX10a | Combat VFX: shared impact language (flash, sparks, shockwave, light pulse, damage-scaled shake, block ripple, KO blast) | UX09 | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (UX10a commit); iPad check NOT RUN | docs/test-results/UX10.md |
| UX10b | Combat VFX: per-ability windup/active/impact signatures, M1 finisher, projectile launch and trail | UX10a | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (UX10b commit); iPad check NOT RUN | docs/test-results/UX10.md |
| UX10c | Combat VFX: quality tiers, light/particle budgets, busy four-fighter budget test | UX10b | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (UX10c commit); iPad check NOT RUN | docs/test-results/UX10.md |
| DJ01 | Double jump: one server-authoritative air jump per airtime, prediction parity, replicated flag, flip/ring/sound | UX10c | IMPLEMENTED (DEVICE CHECK PENDING) | see git log (DJ01 commit); iPad check NOT RUN | tests/unit/double-jump.test.ts, tests/integration/double-jump.test.ts | decision 0051 |

## Background hosting and admin startup (approved 2026-11-02)

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| OPS01 | Load host-local admin credential in production startup | UX08 WEB4 T28 | IMPLEMENTED, DEVICE CHECK PENDING | see git log (OPS01 commit) | docs/test-results/OPS01.md |
| OPS02 | Verify minimal background hosting and on-demand room lifecycle | T28 OPS01 | DONE | see git log (OPS02 commit) | docs/test-results/OPS02.md |

## Owner visual overhaul (approved 2026-11-02)

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|---|---|---|---|---|---|---|
| VIS01 | Combat readability, elemental trails, shaped beams, arena art, lighting and fighter finish | UX10c UX05 UX06 DJ01 | IMPLEMENTED (DEVICE CHECK PENDING) | 9623b26 | docs/test-results/VIS01.md | Owner authorized one-session scope and main push; decision 0052. Existing gameplay changes preserved. Physical iPad NOT RUN |

## Backlog v3 (review 2026-11-03)

Specs: [backlog-v3](backlog-v3.md). Findings: [review](reviews/2026-11-03-principal-and-ux-review.md). Execute in this order, one per session.

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| REL01 | Contain tick exceptions | none | IMPLEMENTED (DEVICE CHECK PENDING) | 33a08b4 | docs/test-results/REL01.md |
| REL02 | Reuse entity ids | REL01 | DONE | 085f75c | docs/test-results/REL02.md |
| UX11 | Nameplates, enemy HP, off-screen arrows | REL02 | IMPLEMENTED (DEVICE CHECK PENDING) | 3bb0c5a; iPad NOT RUN | docs/test-results/UX11.md |
| UX12 | Damage direction and low-HP vignette | UX11 | IMPLEMENTED (DEVICE CHECK PENDING) | ea73a6c; iPad NOT RUN | docs/test-results/UX12.md |
| UX13 | Radial cooldown rings and ready pulse | UX11 | IMPLEMENTED, DEVICE CHECK PENDING | abd003a | docs/test-results/UX13.md |
| BOT6 | Bots use the whole kit | REL02 | DONE | c211427 | docs/test-results/BOT6.md |
| UX14 | KO card and tabular scoreboard | UX13 | IMPLEMENTED, DEVICE CHECK PENDING | 43076a3 | docs/test-results/UX14.md |
| HYG01 | Test artefacts out of committed evidence | none | DONE | d0b499a | docs/test-results/HYG01.md |
| OPEN01 | Open-join session survives IP change | 0053 | DONE | 2bc07ad | docs/test-results/OPEN01.md |
| MODE01 | Optional first-to-N rounds | 0054 | IMPLEMENTED, DEVICE CHECK PENDING | 5f509f0; iPad NOT RUN | docs/test-results/MODE01.md | Host selector in sparring setup only; admin UI selector not wired |
| UX15 | Lobby fighter preview, glass HUD styling, soft effects (preview, telegraph shading, rounded glow shapes) | MODE01 | IMPLEMENTED, DEVICE CHECK PENDING | see git log | Unit, typecheck, lint, build run; visual check in a live lobby and iPad NOT RUN |; UX15 follow-up: embedded Inter font, slot text fit, dummy spawn off origin, preview faces camera, richer faces, every M1 strike effect


## Full-game engineering and game-experience review (2026-11-03)

Findings: [full review](reviews/full-game-review.md). Execution packets: [game improvement spec](reviews/game-improvement-spec.md). These are proposed implementation tasks, not completed fixes. Execute one ID per fresh session; preserve accepted amendments and the three-fighter scope.

| Task | Title | Depends on | Status | Commit | Test report |
|---|---|---|---|---|---|
| FR01 | Principal engineering and staff game UX review, reproduced defects and implementation packets | MODE01 | IN PROGRESS | | docs/test-results/FR01.md |
| GR00 | Restore trustworthy browser acceptance | FR01 | IN PROGRESS | | docs/test-results/GR00.md (create in slice) |
| GR01 | Active-session revocation and expiry | FR01 | DONE | 2dad92e | docs/test-results/GR01.md |
| GR02 | Occupant-safe detached projectile attribution | GR01 | DONE | 6186c1a | docs/test-results/GR02.md |
| GR03 | Reconnect, reload and page lifecycle | GR01 | IMPLEMENTED, DEVICE CHECK PENDING | 23389f0 | docs/test-results/GR03.md |
| GR04 | Authoritative snapshot-time prediction | GR02 GR03 | IMPLEMENTED, DEVICE CHECK PENDING | 8d5ef28 | docs/test-results/GR04.md |
| GR05 | One gameplay input gate | GR03 | IMPLEMENTED, DEVICE CHECK PENDING | d1487cf | docs/test-results/GR05.md |
| GR06 | Held keyboard Jump and finisher parity | GR05 | IMPLEMENTED, DEVICE CHECK PENDING | 8ed2823 | docs/test-results/GR06.md |
| GR07 | Used skills, charge and evasive status | GR05 | IMPLEMENTED, DEVICE CHECK PENDING | 16d94d5 | docs/test-results/GR07.md |
| GR08 | Durable round results and live objective | GR03 GR05 | IMPLEMENTED, DEVICE CHECK PENDING | d54cd08 | docs/test-results/GR08.md |
| GR09 | Graphics recovery and failed-load cleanup | GR05 | IMPLEMENTED, DEVICE CHECK PENDING | e779f9d | docs/test-results/GR09.md |
| GR10 | Routine log privacy | FR01 | DONE | 423e3ba | docs/test-results/GR10.md |
| GR11 | HUD text budget and overlay hierarchy | GR05 GR07 GR08 | IMPLEMENTED, DEVICE CHECK PENDING | 392da80 | docs/test-results/GR11.md |
| GR12 | Clear entry routes and fighter preview | GR03 GR11 | IMPLEMENTED, DEVICE CHECK PENDING | 9f00420 | docs/test-results/GR12.md |
| GR13 | Bounded ground navigation for bots | GR02 | DONE | 1ec97b1 | docs/test-results/GR13.md |
| GR14 | Role-aware bot tactics and charging | GR07 GR13 | DONE | 2f432df | docs/test-results/GR14.md (create in slice) |
| GR15a | Confirmed-hit practice lesson | GR05 GR07 GR11 | IMPLEMENTED, DEVICE CHECK PENDING | c99b1a7 | docs/test-results/GR15a.md |
| GR15b | Confirmed-block practice lesson | GR15a | IMPLEMENTED, DEVICE CHECK PENDING | PENDING_HASH | docs/test-results/GR15b.md |
| GR15c | Telegraph-evasion practice lesson | GR15b | TODO | | docs/test-results/GR15c.md (create in slice) |
| GR15d | Current contract index and physical acceptance | GR00–GR14 GR15a–c QD01 | BLOCKED | | docs/test-results/GR15d.md (create in slice); missing two physical iPads and two human players; implementation prerequisites also pending |
