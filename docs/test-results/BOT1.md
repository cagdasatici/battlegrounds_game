# BOT1 — Deterministic opponents

Date: 1 November 2026. Runtime: Node v24.22.2 (repository pin).
Prerequisite: BOT0 DONE, contracts f8a66a5 and completion verification c54850c.

## Delivered

- `apps/server/src/sim/SparringBrain.ts` exports the frozen pure `decideBot`
  boundary with no transport or physics imports or hidden per-bot state.
- Easy/Medium/Hard sample every 30/15/6 ticks relative to spawn, with a full
  initial delay on every life. Nearest living, connected, ready enemy wins;
  numeric entity ID breaks distance ties. Self is excluded.
- Bots face the target, approach outside 2 m and attack within 2 m. Medium/Hard
  guard visible attacks within 3 m; Hard otherwise prioritizes ready slot 1
  within 2 m. Held inputs and facing persist between samples, cast edges clear,
  and missing/dead/disconnected/unready targets immediately neutralize input.
- Coincident poses use neutral yaw zero. These are local design rules.

## Executed checks

- Focused `pnpm exec vitest run tests/unit/sparring-brain.test.ts`: PASS, 24 tests.
  Covers per-tier traces, spawn/respawn delays, eligibility, order-independent
  numeric ties, 2 m/3 m boundaries, guard/cast priority, cooldown readiness,
  held inputs, cast edges, target loss and movement yaw convention.
- `pnpm verify`: PASS, exit 0. Typecheck, lint, 89 test files / 1250 tests
  passed and 2 existing TODO tests, build, assets:audit and content:validate.
  Test duration: 170.94 seconds. Content hash: 6361e0b51fe4a072.
- Initial sandboxed verify failed because integration tests could not listen
  on local sockets (EPERM). The socket-enabled verification above passed.
- `git diff --check`: PASS. Existing large client bundle warning remains.

## Scope and limitations

BOT4 owns server integration: Stone Vanguard roster/names, PipelineSeat input,
increasing skill IDs, collider/edge checks, normal combat and respawn. BOT1 adds
only the pure brain and cannot demonstrate a playable opponent by itself.
Physical iPad checks: NOT RUN. No assets, data definitions or dependencies changed.
Status: implementation and offline gates complete. Per the sparring plan, the
integrator updates the shared task ledger after merge.

## Completion verification in this session

Re-reviewed the existing implementation against BOT0; no behavior changes needed.
Pinned Node 24.22.2: focused brain tests PASS (24); pnpm verify PASS
(typecheck, lint, 91 files / 1,281 tests passed with 2 existing TODOs, build, asset audit, content validation).
Sandbox socket attempt was interrupted after EPERM; socket-enabled run passed.
Physical checks NOT RUN. Completion implementation commit: fd80a2c.
