# Agent dispatch board · 1 November 2026

Read this board before using the original wave numbers in [backlog v2](backlog-v2.md). Those numbers describe dependencies at project start. The board below distinguishes work that already exists from work available to assign. Gameplay requirements remain in [the specification](spec.md), detailed FX/T packets in [backlog v2](backlog-v2.md), and BOT packets in [the sparring plan](sparring-plan.md).

## Current handoff

Verified remote main at `e6f1202` on 1 November. ART2, T21, T22, all FX0–FX5 work (including all three FX4 kits), and T29 security hardening are merged. FX4-sv landed at `2cbc0d0` and FX4-ea at `b07be69`. Let their assigned agent finish any verification handoff. T30 performance is in progress with its existing owner, including changes to apps/client/src/main.ts. The BOT and HELP plans are already on main. Start each new slice in its own clean worktree from main containing its merged prerequisites.

## Dispatch for two or three agents

Nine feature slices remain, followed by DEV1 physical acceptance and T32 release. The rows show one feasible staffing order, not synchronized sprints. Move an agent forward when its own prerequisites have merged. Each ID is a separate session. While T30 is active it consumes one slot.

| Stage | Two agents total | Three agents total |
|---|---|---|
| T30 still running | T30 + BOT0. When BOT0 merges, use the free lane for BOT1. | T30 + BOT0 + HELP1. After BOT0, use available lanes for BOT1 and BOT2. |
| After existing owners finish | If starting fresh: BOT0 + HELP1, then BOT1 + BOT2. Skip slices already finished above. | Once BOT0 lands: BOT1 + BOT2 + BOT3. If HELP1 is still running, start BOT3 when a slot opens. |
| Integration | After BOT1 and BOT2, pair BOT4 with BOT3. Then run BOT4C in the client lane. Fit HELP2 into the first free client window after HELP1. | BOT4 server + BOT4C client may overlap. Use a spare slot for unfinished HELP1. HELP2 uses the client window immediately before or after BOT4C. |
| Acceptance | BOT5 after BOT4 and BOT4C. Then DEV1 on both iPads and T32. | Same gates. Reserve one owner for DEV1. |

| ID | One-agent assignment | Required before start |
|---|---|---|
| BOT0 | Freeze the shared room, difficulty and setup contracts. | DONE: f8a66a5; full verification passed. See docs/test-results/BOT0.md. |
| HELP1 | Build and fixture-test standalone touch and keyboard instructions. | Ready now. Independent of T30 and BOT0. |
| BOT1 | Implement Easy, Medium and Hard bot decisions. | BOT0 |
| BOT2 | Implement guest links, membership, seat limits and reservations. | BOT0 |
| BOT3 | Build and fixture-test pre-match host controls. | BOT0 |
| BOT4 | Integrate bots and scoped guests into authoritative rooms. Exercise the new routes against the merged T29 protections. | BOT1 + BOT2 |
| BOT4C | Wire the host/guest screens and room connection. | BOT3; reserve main.ts. |
| HELP2 | Add How to play to Welcome and connect Try practice to the existing guided tutorial. | HELP1; reserve main.ts. |
| BOT5 | Verify solo and invited sparring with real browser contexts; include a four-fighter performance check against the T30 baseline when available. | BOT4 + BOT4C |
| DEV1 | Owner tests both iPads, including guide, bots, four-fighter performance, remote invite/QR and T31 observations. Record tested device, OS and results. | T30 + BOT5 + HELP2 for this release; reachable host for remote checks. |
| T32 | Assemble release evidence and report unresolved exceptions. | T29 (merged), T30, DEV1 and T31 calibration evidence. |

Give T30, BOT4C and HELP2 separate editing windows for apps/client/src/main.ts. BOT3 owns a standalone component and can proceed during any of those windows. Serialize full network/browser suites on a shared machine when fixed ports collide. Keep physical checks NOT RUN until exercised. Never send invitations or deploy as part of a coding slice.

## HELP1 · Build standalone player instructions

**Commit subject:** `HELP1: add touch and keyboard how-to-play guide`. Own apps/client/src/ui/HowToPlay.ts, tests/browser/how-to-play.spec.ts and docs/test-results/HELP1.md. Read apps/client/src/input/KeyboardRouter.ts, apps/client/src/input/ControlLayout.ts, apps/client/src/ui/PracticeFormat.ts and apps/client/src/ui/Lobby.ts. No shared entry-point edits.

Export `mountHowToPlay(root: HTMLElement, options: { sparringAvailable: boolean; onClose: () => void; onPractice: () => void }): () => void`. Open at “How to play” with Touch and Keyboard buttons, Touch selected initially. Include the objective (“Knock out fighters to score. You return after a knockout.”), starting an invited match, choosing a fighter and pressing Ready. Use shipped fighter/move labels from the lobby helpers. Explain stick movement, dragging open space to look, holding Strike and Guard, Dash, Jump, skills 1–4, and awakening when the meter is ready. List WASD, left mouse, F, Q, Space, 1–4, G, Shift facing lock and Esc menu. Keep touch guidance independent of left/right-handed layout. Offer “Try practice” and “Back”. Include “Practice uses a stationary dummy. Try Guard or Ragdoll while you learn.” When sparringAvailable is true also show “Host sparring to fight bots. Choose Easy, Medium or Hard for each bot before Start. Copy a guest link if a human seat is free.”

Use a fixture with injected callbacks. Test both input modes, each action mapping, actual selectable kit labels, sparring text absent/present, one callback per activation, keyboard navigation, both landscape viewport sizes and repeated mount/dispose. Run pnpm verify and the targeted browser spec. Stop and report if an instruction contradicts the implemented input router or requires a control change.

## HELP2 · Connect onboarding to the existing player journey

**Commit subject:** `HELP2: connect welcome instructions to guided practice`. Own apps/client/src/main.ts, apps/client/src/ui/Lobby.ts, tests/browser/onboarding-flow.spec.ts and docs/test-results/HELP2.md. Add “How to play” on Welcome before authentication. Open the HELP1 view without a network request. Back restores Welcome and focus to its launcher. Try practice invokes the existing authenticated Practice flow exactly once, preserving invitation handling and normal errors. Leave Practice returns through the existing Welcome path. The guide is always replayable. Use the existing tutorial hints, progression and completion message. No first-run storage or new tutorial state.

Advertise hosted sparring in the guide only when the actual Host sparring action is wired on the same build. Whichever of HELP2/BOT4C integrates second connects this boolean to that action's availability and exercises both paths. The two can be dispatched in either order but must have separate main.ts editing windows. The guide can ship with the flag false. Test unauthenticated open/back, keyboard focus restoration, invited guide → practice → first server-confirmed step → leave → reopen, and absence of duplicate listeners after three cycles. Run pnpm verify and pnpm test:browser with local clients. Record both physical iPads as NOT RUN pending DEV1. Stop and report if the integration would change auth or require accepting client-reported progress.

## Paste into a fresh agent session

> Implement only [ID] from docs/agent-dispatch.md and its linked packet. Start from the coordinator's base containing the planning docs and merged prerequisites. Check the ledger and active owners first. If already implemented, a prerequisite is missing, or another agent owns a required file, stop and report the ID, path and blocking branch. Use one worktree. Run the packet checks, record actual results in docs/test-results/[ID].md and report the commit, tests and newly unblocked IDs. Keep physical iPad checks NOT RUN until performed.
