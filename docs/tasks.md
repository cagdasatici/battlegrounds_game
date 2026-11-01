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
| T21 | Artificer awakening | T20 | TODO | | | |
| T22 | Passives | T21 | TODO | | | |
| T23 | Props and wall context | T18e T19 | IMPLEMENTED (DEVICE CHECK PENDING) | 3a476b2 f59234b ce40158 591be2d 53997fe | docs/test-results/T23.md | decisions/0016. Wire: tests/integration/t23-urns, t23-wall, t23-gale tests. flow.spec T27 mirror check fails in browser run (client, untouched); iPad NOT RUN |
| T24 | Duelist P1 variants | T16 | IMPLEMENTED (DEVICE CHECK PENDING) | 65c11d6 c37d624 | docs/test-results/T24.md | decisions/0012-t24-duelist-p1-variants. Wire: tests/integration/t24-variants.test.ts (3 clients chain, elevated slam) |
| T25 | Original art pipeline | T18e | IMPLEMENTED (DEVICE CHECK PENDING) | d71a447 b17bed8 | docs/test-results/T25.md | decisions/0015. assets:audit passes (3 fighters, 84 clips). Fighters and arena rebuilt as original rigged toon art; glTF files verified but runtime builds the same rig in code. Before/after: T25-before*.png, T25-after*.png. iPad perf NOT RUN |
| ART1 | Environment art from CC0 packs | ART0 | IMPLEMENTED (DEVICE CHECK PENDING) | 4c5f8c3 | docs/test-results/ART1.md | decisions/0023. Quaternius CC0 props instanced outside walkable ground; collider meshes aligned within 0.05 m; 66 calls, 92.7k tris medium (SwiftShader). iPad perf NOT RUN |
| T26 | Effects audio and camera | T21 T23 T25 | TODO | | | |
| T27 | Settings and layout editor | T07 T18e | IMPLEMENTED (DEVICE CHECK PENDING) | 2281bc6 | docs/test-results/T27.md | decisions/0013. Playwright 34/34. D05 D06 NOT RUN. Several settings stored, not yet consumed |
| T28 | Production hosting | T04 T18e | IMPLEMENTED (DEVICE CHECK PENDING) | 3778216 | docs/test-results/T28.md | decisions/0011. Local build/serve/health/two-client verified; TLS, host, iPad remote checks NOT RUN (no host chosen) |
| T29 | Security hardening | T22 T28 | TODO | | | |
| T30 | Performance pass | T24 T26 T27 | TODO | | | |
| T31 | Fidelity calibration | T18e T27 | IMPLEMENTED (DEVICE CHECK PENDING) | 779475b | docs/test-results/T31.md | decisions/0017. Layout JSON + ledger done; all O01-O08 NOT RUN. test:browser: 1 intermittent T27 flow test failure |
| T33a | Owner ops kit: one-command start | T28 | IMPLEMENTED (DEVICE CHECK PENDING) | d3c3333 | docs/test-results/T33a.md | `pnpm play`; QR encoder + origin logic unit-tested; Tailscale path and iPad scan NOT RUN |
| T32 | Release candidate | T29 T30 T31 | TODO | | | |

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

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|------|-------|-----------|--------|--------|-------------|-------|
| FX0 | Combat event contract and presentation bus | M0 | IMPLEMENTED (DEVICE CHECK PENDING) | 8555409 | docs/test-results/FX0.md | decisions/0021. hitClass, targetHp100, heal kind; CombatBus dedup + stale-life drop; fx stubs. iPad NOT RUN |
| FX1 | Hit impact effects | FX0 | IMPLEMENTED (DEVICE CHECK PENDING) | 5dcec98 | docs/test-results/FX1.md | decisions/0024. Pooled sparks/rings, flash, hitstop, shake via bus. Browser run covers light hit only; iPad NOT RUN |
