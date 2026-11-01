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
| T12 | Vanguard base | T11 | DONE | 46a193c 812929c ebdf0a0 2c6ff88 653894e | docs/test-results/T12.md | Ember Orb reflect acceptance waits for T19. Wire tests: R12 |
| T13 | Duelist base | T11 | DONE | ea963db 1f315a3 557018b 2cdffcd aa9916b feef664 | docs/test-results/T13.md | Projectile reflect A10 A19 wait for T19. Wire tests: R12 |
| T14 | Awakening system | T12 T13 | DONE | a403214 | docs/test-results/T14.md | Ocean Surge line of sight: R05. HUD: T18c |
| T15 | Vanguard awakening | T14 | DONE | afee336 b4a53b5 9595eff 7fc484b d0fd5ca f0c1ac9 | docs/test-results/T15.md | Skybreak and beam anchors: R05. Owner status: R08 |
| T16 | Duelist awakening | T14 R02 R04 R05 | TODO | | | |
| T17 | Respawn and FFA | T10 T14 R10 | TODO | | | Add A13 A18 |
| T18a | Scene and fighter views | R01 R17 T05 | TODO | | | decisions/0001 |
| T18b | Client input and prediction loop | T18a R08 R14 | TODO | | | decisions/0001 |
| T18c | App flow, lobby and HUD | T18b T14 | TODO | | | decisions/0001 |
| T18d | Practice room and onboarding | T18c T17 | TODO | | | decisions/0001 |
| T18e | P0 playable gate | T15 T16 T17 T18d R12 R13 | TODO | | | D02 D04 D08 on both iPads |
| T19 | Charge and projectile system | T18e | TODO | | | |
| T20 | Artificer base | T19 | TODO | | | |
| T21 | Artificer awakening | T20 | TODO | | | |
| T22 | Passives | T21 | TODO | | | |
| T23 | Props and wall context | T18e T19 | TODO | | | |
| T24 | Duelist P1 variants | T16 | TODO | | | |
| T25 | Original art pipeline | T18e | TODO | | | |
| T26 | Effects audio and camera | T21 T23 T25 | TODO | | | |
| T27 | Settings and layout editor | T07 T18e | TODO | | | |
| T28 | Production hosting | T04 T18e | TODO | | | |
| T29 | Security hardening | T22 T28 | TODO | | | |
| T30 | Performance pass | T24 T26 T27 | TODO | | | |
| T31 | Fidelity calibration | T18e T27 | TODO | | | |
| T32 | Release candidate | T29 T30 T31 | TODO | | | |

## Review fix packets (docs/implementation-plan.md section 4)

| Task | Title | Depends on | Status | Commit | Test report | Notes |
|------|-------|-----------|--------|--------|-------------|-------|
| R01 | Clean-checkout gate, real lint | none | DONE | ddc63ad | docs/test-results/R01.md | ESLint skipped (TS7 unsupported): decisions/0002 |
| R02 | Captured victims hit-eligible | R01 | TODO | | | Blocks T16 |
| R03 | Single offensive buffer | R01 | TODO | | | |
| R04 | Armor startup and onHit | R01 | TODO | | | Blocks T16 |
| R05 | Shape anchors and area line of sight | R01 | TODO | | | Blocks T16 |
| R06 | Forward-dash hitbox | R01 | TODO | | | |
| R07 | turnRate during casts | R01 | TODO | | | |
| R08 | Replicated cooldowns and owner state | R01 | TODO | | | Blocks T18b |
| R09 | Protocol details and overload gate | R01 | TODO | | | |
| R10 | One owner for the fighter kit | R01 | TODO | | | Blocks T17 |
| R11 | Shared knockback vector | R01 | TODO | | | |
| R12 | Two-client matrix for every move, A15 | R02 R03 R04 R05 R06 | TODO | | | |
| R13 | Browser layout evidence | R01 | TODO | | | |
| R14 | Prediction on the real collider | R08 | TODO | | | |
| R15 | Node 24 run and decision records | R01 | DONE | 9e8246a | docs/test-results/R15.md | Decisions numbered 0003-0006 (0002 taken by R01) |
| R17 | Tick pipeline extraction | R01 | DONE | 84cf316 | docs/test-results/R17.md | Wave 1 |
| R18 | Latency matrix on loopback | R12 | TODO | | | Wave 3b |
