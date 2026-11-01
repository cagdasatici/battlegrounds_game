# Agent dispatch board · 1 November 2026

Read this board before using the original wave numbers in [backlog v2](backlog-v2.md). Those numbers describe dependencies at project start. The board below distinguishes work that already exists from work available to assign. Gameplay requirements remain in [the specification](spec.md), detailed FX/T packets in [backlog v2](backlog-v2.md), and BOT packets in [the sparring plan](sparring-plan.md).

## Coordinator handoff

Remote main was verified at `5bf2fac`. M0/T23, B1, B2, ART1, SPD1, FX0 and T21 are merged. T18d already supplies the stationary dummy and server-confirmed seven-step tutorial. T27 already supplies settings and layout editing. T28/T33a have local hosting and launcher evidence. T31 has calibration tooling and outstanding physical observations. T26 is the umbrella for the FX slices.

Two integration jobs already have code. Keep each with its current owner. Studio branch `studio/fx1-art2` at `7253e33` combines FX1 and ART2. Cloud branch `origin/claude/dazzling-goldberg-2xpty3` at `c41fb42` contains T22 and FX3. Review and merge into current main before releasing dependents. The Studio branch carries a separate FX0 history, so preserve the merged FX0 behavior and verify before merging. Check current branches and owners again before allocating FX2 or any apparently available row. An unpublished worktree on another machine cannot be discovered from Git.

The planning branch is local until shared. Give each agent a checkout containing this board, the sparring plan, and its merged code prerequisites. For remote workers, the coordinator must first make the planning documents available. Do not branch new implementation from the older planning baseline alone.

## One assignment per agent

Each row is a separate session. Read prerequisites as merged and verified on that agent's base. A row becoming ready does not require every other row above it to finish.

| ID | Give the agent this outcome | Can start when | Coordination |
|---|---|---|---|
| BOT0 | Freeze strict room, difficulty, setup and bot-decision contracts. | Planning docs available | Cloud. Unlocks three lanes. |
| HELP1 | Build the standalone How to play guide and test its content. | Planning docs available | Cloud. Independent of bots and effects. Packet below. |
| FX2 | Add damage text, move names and KO feed. | FX0 merged; confirm unclaimed | Cloud. Owns settings migration and combat text. |
| BOT1 | Implement deterministic Easy, Medium and Hard opponent decisions. | BOT0 | Cloud. Parallel with BOT2 and BOT3. |
| BOT2 | Implement scoped guest links, host membership and seat reservations. | BOT0 | Cloud. Parallel with BOT1 and BOT3. |
| BOT3 | Build and fixture-test the pre-match setup and copy-link controls. | BOT0 | Cloud. Parallel with BOT1 and BOT2. |
| HELP2 | Connect the guide to Welcome and the existing tutorial. | HELP1 | Client integration. Reserve main.ts or land before BOT4C. |
| BOT4 | Integrate bots, auth and room lifecycle on the server. | BOT1 + BOT2 | Can overlap BOT4C. Reserve sessionRoutes/ArenaRoom/TickPipeline against T29 and active combat changes. |
| BOT4C | Wire host/guest flows to the client and enable sparring help. | BOT3 | Can overlap BOT4. Rebase after any HELP2 or FX edit to main.ts. |
| BOT5 | Verify solo and invited sparring with real browser contexts. | BOT4 + BOT4C | Run on combined base. |
| FX4-sv | Ship Vanguard ability effects. | FX1 | Studio. Parallel kit files. |
| FX4-td | Ship Duelist ability effects. | FX1 | Cloud. Parallel kit files. |
| FX4-ea | Ship Artificer ability effects. | FX1 + T21 | Studio. Parallel kit files. |
| FX5 | Add capture camera tracks and reduced-motion behavior. | FX1 | Studio/Cloud with browser evidence. Reserve CameraRig against ongoing FX1 fixes. |
| T29 | Harden auth, rate limits and input boundaries. | T22 + T28 | Cloud. Prefer after BOT4 for a release containing hosted rooms. |
| T30 | Measure final art/effects, implement adaptive quality and verify budgets. | ART1 + ART2 + T24 + T27 + completed FX replacement for T26 | Studio. Include the four-fighter sparring case after BOT5 if shipping bots. |
| DEV1 | Run the physical acceptance and calibration checklist on both iPads. | T30; BOT5 + HELP2 if shipping those features | Owner. Record device, OS and actual results. Close only rows exercised successfully. |
| T32 | Assemble the release candidate and report remaining exceptions. | T29 + T30 + T31 calibration evidence + DEV1 | Include BOT5 and HELP2 evidence for this scope. |

The FX4 kit agents each own one registration in apps/client/src/fx/index.ts. The integrator keeps all three registrations and runs the combined tests. Serialize full browser/network suites on a shared host if their fixed ports collide. Shared docs/tasks.md rows can be reconciled by the coordinator. T28 remote HTTPS/WSS and T33a real invite/QR checks remain owner-operated device/hosting gates; obtain a reachable host before the remote portion of DEV1. Never send an invitation, purchase hosting or deploy as part of a coding slice.

## HELP1 · Build standalone player instructions

**Commit subject:** `HELP1: add touch and keyboard how-to-play guide`. Own apps/client/src/ui/HowToPlay.ts, tests/browser/how-to-play.spec.ts and docs/test-results/HELP1.md. Read apps/client/src/input/KeyboardRouter.ts, apps/client/src/input/ControlLayout.ts, apps/client/src/ui/PracticeFormat.ts and apps/client/src/ui/Lobby.ts. No shared entry-point edits.

Export `mountHowToPlay(root: HTMLElement, options: { sparringAvailable: boolean; onClose: () => void; onPractice: () => void }): () => void`. Open at “How to play” with Touch and Keyboard buttons, Touch selected initially. Include the objective (“Knock out fighters to score. You return after a knockout.”), starting an invited match, choosing a fighter and pressing Ready. Use shipped fighter/move labels from the lobby helpers. Explain stick movement, dragging open space to look, holding Strike and Guard, Dash, Jump, skills 1–4, and awakening when the meter is ready. List WASD, left mouse, F, Q, Space, 1–4, G, Shift facing lock and Esc menu. Keep touch guidance independent of left/right-handed layout. Offer “Try practice” and “Back”. Include “Practice uses a stationary dummy. Try Guard or Ragdoll while you learn.” When sparringAvailable is true also show “Host sparring to fight bots. Choose Easy, Medium or Hard for each bot before Start. Copy a guest link if a human seat is free.”

Use a fixture with injected callbacks. Test both input modes, each action mapping, actual selectable kit labels, sparring text absent/present, one callback per activation, keyboard navigation, both landscape viewport sizes and repeated mount/dispose. Run pnpm verify and the targeted browser spec. Stop and report if an instruction contradicts the implemented input router or requires a control change.

## HELP2 · Connect onboarding to the existing player journey

**Commit subject:** `HELP2: connect welcome instructions to guided practice`. Own apps/client/src/main.ts, apps/client/src/ui/Lobby.ts, tests/browser/onboarding-flow.spec.ts and docs/test-results/HELP2.md. Add “How to play” on Welcome before authentication. Open the HELP1 view without a network request. Back restores Welcome and focus to its launcher. Try practice invokes the existing authenticated Practice flow exactly once, preserving invitation handling and normal errors. Leave Practice returns through the existing Welcome path. The guide is always replayable. Use the existing tutorial hints, progression and completion message. No first-run storage or new tutorial state.

Advertise hosted sparring in the guide only when the actual Host sparring action is wired on the same build. Whichever of HELP2/BOT4C integrates second connects this boolean to that action's availability and exercises both paths. The two can be dispatched in either order but must have separate main.ts editing windows. The guide can ship with the flag false. Test unauthenticated open/back, keyboard focus restoration, invited guide → practice → first server-confirmed step → leave → reopen, and absence of duplicate listeners after three cycles. Run pnpm verify and pnpm test:browser with local clients. Record both physical iPads as NOT RUN pending DEV1. Stop and report if the integration would change auth or require accepting client-reported progress.

## Paste into a fresh agent session

> Implement only [ID] from docs/agent-dispatch.md and its linked packet. Start from the coordinator's base containing the planning docs and merged prerequisites. Check the ledger and active owners first. If already implemented, a prerequisite is missing, or another agent owns a required file, stop and report the ID, path and blocking branch. Use one worktree. Run the packet checks, record actual results in docs/test-results/[ID].md and report the commit, tests and newly unblocked IDs. Keep physical iPad checks NOT RUN until performed.
