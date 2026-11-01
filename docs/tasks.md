# Task ledger

Status values: TODO, IN PROGRESS, BLOCKED, DONE, IMPLEMENTED (DEVICE CHECK PENDING).
Source: docs/spec.md section 27.

| Task | Title | Depends on | Status | Commit | Test report |
|------|-------|-----------|--------|--------|-------------|
| T01 | Bootstrap | none | DONE | see git log | docs/test-results/T01.md |
| T02 | Shared contracts | T01 | DONE | commit "T02:" in git log | docs/test-results/T02.md |
| T03 | Authentication | T02 | DONE | commit "T03:" in git log | docs/test-results/T03.md |
| T04 | Room lifecycle | T03 | DONE | commit "T04:" in git log | docs/test-results/T04.md |
| T05 | Arena colliders | T02 | DONE | commit "T05:" in git log | docs/test-results/T05.md |
| T06 | Movement | T04 T05 | DONE | commit "T06:" in git log | docs/test-results/T06.md |
| T07 | Touch shell | T02 | IMPLEMENTED (DEVICE CHECK PENDING) | commit "T07:" in git log | docs/test-results/T07.md |
| T08 | Camera and prediction | T06 T07 | IMPLEMENTED (DEVICE CHECK PENDING); real-client reconciliation test pending | commit "T08:" in git log | docs/test-results/T08.md |
| T09 | Combat states | T06 | DONE | commit "T09:" in git log | docs/test-results/T09.md |
| T10 | M1 and guard | T07 T09 | IMPLEMENTED (DEVICE CHECK PENDING) | commit "T10:" in git log | docs/test-results/T10.md |
| T11 | Ability framework | T09 | DONE | commit "T11:" in git log | docs/test-results/T11.md |
| T12 | Vanguard base | T11 | TODO | | |
| T13 | Duelist base | T11 | TODO | | |
| T14 | Awakening system | T12 T13 | TODO | | |
| T15 | Vanguard awakening | T14 | TODO | | |
| T16 | Duelist awakening | T14 | TODO | | |
| T17 | Respawn and FFA | T10 T14 | TODO | | |
| T18 | P0 playable gate | T15 T16 T17 | TODO | | |
| T19 | Charge and projectile system | T18 | TODO | | |
| T20 | Artificer base | T19 | TODO | | |
| T21 | Artificer awakening | T20 | TODO | | |
| T22 | Passives | T21 | TODO | | |
| T23 | Props and wall context | T18 T19 | TODO | | |
| T24 | Duelist P1 variants | T16 | TODO | | |
| T25 | Original art pipeline | T18 | TODO | | |
| T26 | Effects audio and camera | T21 T23 T25 | TODO | | |
| T27 | Settings and layout editor | T07 T18 | TODO | | |
| T28 | Production hosting | T04 T18 | TODO | | |
| T29 | Security hardening | T22 T28 | TODO | | |
| T30 | Performance pass | T24 T26 T27 | TODO | | |
| T31 | Fidelity calibration | T18 T27 | TODO | | |
| T32 | Release candidate | T29 T30 T31 | TODO | | |
