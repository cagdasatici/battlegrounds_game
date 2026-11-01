# Playable-build assessment — 1 November 2026

Baseline: main at b6c9e56. Scores are engineering judgments of readiness for a private family playtest on the target iPads. Each dimension has equal weight. A score of 50 means a usable path with major gaps, 75 means a substantial playable path with important validation or polish outstanding, and 90 requires repeatable evidence under representative conditions. Enjoyment and competitive balance need human playtesting.

| Dimension | /100 | Reason |
|---|---:|---|
| Combat depth and rules | 86 | Vanguard and Duelist have base and awakened move sets, interrupts, counters, captures, KO and respawn. Real-client move coverage exists. Artificer base exists but the fighter is hidden on this baseline. T21 awakening and T22 passives remain outside main. |
| Multiplayer reliability | 82 | Server-owned combat, fixed ticks, scoped tickets, prediction and reconnect are implemented. R12 and R18 exercise real clients and injected latency. Loss at 1% and 3%, plus remote iPad play, remain unverified. |
| Controls and onboarding | 72 | Layout editing, handedness and a server-confirmed practice tutorial give a new player a path to learning the controls. Safari multitouch, interruption and rotation remain unverified on hardware. |
| Visual and combat feedback | 60 | ART1 reports 66 draw calls and 92,744 triangles at 1180×820 in desktop Chromium. The arena and fighter animation are present. Main lacks the planned hit effects, ability callouts and audio that help players understand a busy fight. |
| Match setup and replayable practice | 58 | The owner can start the server and generate an invite/QR. Humans can fight and the tutorial dummy can guard or ragdoll. No configurable attacking opponent or browser-based sparring host flow was found. |
| Verification and release readiness | 62 | Extensive offline and real-client coverage. T29 hardening, T30 performance and T32 release gate are open. Target-device frame pacing, remote HTTPS/WSS and both physical device checklists lack acceptance evidence. |
| **Overall** | **70** | Arithmetic mean of the six judgments. |

## Work remaining, accounting for concurrent agents

- Merged despite older backlog wording: T23, B1, B2 and ART1. Do not redispatch these from the backlog wave table.
- Visible outside main at inspection: ART2 at 5c302f6, FX0 at e66baac, FX1 with working-tree edits. A locally known remote branch contains T21 and SPD1 integration at 4c2226e. Verify merge ancestry before assigning or crediting any of these.
- Remaining product work includes T22, the FX2–FX5 lanes (including kit-specific effects), and settings consumers. Release work includes T29, T30, physical DEV1, T31 observations and T32. T28 local serving and T33a launcher evidence do not complete remote or physical acceptance.
- The original section 6 tutorial explicitly calls for a stationary dummy. Add hosted sparring as a separate room type. The new plan supports solo and invited play with the same authoritative bot implementation.

Evidence: [task ledger](../tasks.md), [follow-up backlog](../backlog-v2.md), [P0 move/device gate](../test-results/T18e.md), [network matrix](../test-results/R18.md), [layout checks](../test-results/T27.md), [environment measurements](../test-results/ART1.md), [owner launcher](../test-results/T33a.md), [hosted sparring plan](../sparring-plan.md).
