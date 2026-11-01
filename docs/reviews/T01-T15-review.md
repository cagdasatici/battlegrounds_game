# T01 to T15 architecture and implementation review

Reviewed: 2026-11-01, at commit `f0c1ac9` (branch `claude/busy-faraday-hqbvp3`, T01 to T15 complete).
Reviewer role: staff engineer, architect and product owner. Read against `docs/spec.md` (the PDF text) and `AGENTS.md`.

## 1. Verdict

The server core is sound and close to the contract. The fixed 60 Hz tick, integer deadlines, generation-token
cancellation, serial hit resolution, single-owner capture registry and strict zod validation are all present and
well tested (456 tests). No client damage path exists. No `setTimeout` or `setInterval` drives combat.

It is **not yet a safe base for T16 to T18**. Four defects will corrupt later kits, one breaks the fresh-checkout
build gate, and the replicated state and wire tests are thinner than the spec requires. Fix R01 to R06 before T16.

## 2. Gate results on a clean checkout (executed, not copied from reports)

`git clean -fdx`, `pnpm install --frozen-lockfile`, Node 22.23.4, pnpm 10.28.0:

| Command | Result |
|---|---|
| `pnpm typecheck` | **FAIL, exit 2** (TS6305). See R01 |
| `pnpm lint` | pass (`boundaries ok`; import boundaries only, no ESLint) |
| `pnpm test` | pass, 23 files, 456 tests |
| `pnpm build` | pass |
| `pnpm content:validate` | pass, 12 abilities |
| Node 24.22.2 (pinned in `.node-version`) | NOT RUN anywhere |
| Playwright / browser tests | none exist |
| Physical iPad | NOT RUN (correctly recorded) |

Acceptance IDs with a test today: A01 to A09, A14, A16, A17, A20. Not yet covered: A10 to A13, A15, A18, A19
(A10, A11, A12, A19 belong to P1; A13, A18 to T17; **A15 is in reach now and missing**).

## 3. What is right (keep it)

- `ActionMachine`: orthogonal action/form fields, exclusive deadlines, `generation` bump on every cancel.
- `HitResolver`: deterministic sort (toi, attacker, cast counter, hit index), serial apply, invulnerability before
  counter before guard, damage clamped in hundredths, one KO per life.
- `CaptureRegistry` plus `invariantViolations()` and the 4000-tick fuzz: no orphan captures.
- `AbilityRunner`: named handlers, strict `AbilityDef` schema, registry validator, cast state per instance.
- Stillpoint Reversal uses its own `lethalCounterUntil` field, so it survives base actions as the spec requires.
- Meter: actual damage only, nothing while Awakened, blocked and overkill excluded.
- Reports record limitations and NOT RUN honestly.

## 4. Process findings

1. **Parallel worktrees without integration gates.** T12 and T13 were built in sibling worktrees and merged by hand
   (`feef664`). The T12 report also shows a test flake caused by a shared machine. Rule from now on: one task per
   session, sequential on one branch, full gate run after every merge.
2. **Ledger does not follow AGENTS.md.** Commits are "see git log" instead of hashes. Statuses such as
   "DONE (Ember Orb reflect acceptance pending T19)" are not valid values. Fix in R15.
3. **`main` is at T04.** Eleven tasks live only on a `claude/*` branch. Merge to `main` after R01 passes; this is
   the owner's decision.
4. **Every report claims `pnpm typecheck` passes**, but it only passes after deleting tracked build output locally
   (T11 and T12 say so). A gate that only passes on the agent's machine is not a gate.

## 5. Fix packets (execute in this order)

Each packet is one session, one commit, prefixed `R0x:`. Before starting: read the files listed. After finishing:
run `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm content:validate` when data changed. Write
`docs/test-results/R0x.md` with the actual command output. Never change a spec number; every value below comes from
the cited section.

### R01 Clean-checkout build gate (blocker, do first)

- Problem: `apps/client/tsconfig.tsbuildinfo`, `apps/server/tsconfig.tsbuildinfo`, `packages/shared/tsconfig.tsbuildinfo`
  and `apps/client/dist-types/**` are tracked. `tsc -b` trusts the tracked tsbuildinfo, skips emitting
  `packages/shared/dist`, and the client then fails with TS6305.
- Files: `.gitignore`, the tracked artifacts, `package.json`.
- Do:
  1. `git rm -r --cached apps/client/dist-types` and `git rm --cached -- '*.tsbuildinfo'`.
  2. Add `*.tsbuildinfo` and `dist-types/` to `.gitignore`.
  3. Add a root script `"verify": "pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm content:validate"`.
- Done when: in a fresh clone, `pnpm install --frozen-lockfile && pnpm verify` exits 0. Paste that output.

### R02 Captured victims are hit-eligible for third parties (blocker for T16)

- Spec §13: a default capture "makes the victim immune to third party capture but not ordinary third party damage".
  Only a cinematic capture shields the victim. The resolver already does this (`CaptureRegistry.shieldsFrom`).
- Defect: `queryTargets` in `apps/server/src/sim/AbilityRunner.ts` skips any `Captured` fighter unless
  `allowCaptured` is set. M1 candidates do not skip them. So an M1 can hit a Current Bind victim and an ability
  cannot. The T13 "third party" test injects a raw candidate and never goes through `queryTargets`.
- Do:
  1. In `queryTargets`, delete the `Captured` skip. Delete the `allowCaptured` option.
  2. Add `QueryOptions.excludeCaptured?: boolean`. Set it in exactly these places: every capture probe
     (`kits/td/sequence.ts` probe, `kits/sv/cinematicGrab.ts`), and sv.b4 Rising Pillar (spec §15: "a target already
     captured by another attacker is ineligible"). `tryCapture` already refuses a captured victim; the filter only
     keeps a losing probe from consuming the `maxTargets` budget.
- Tests (`tests/unit/td-base.test.ts`, new cases using the real handlers, not injected candidates):
  - td.b1 captures B; third fighter C casts sv.b2 on B: B takes the flurry damage, capture continues, release at +43.
  - sv.a4 Orbit Collapse captures B; C casts sv.b2: B takes 0 (`shielded`).
  - sv.b4 against a captured target: no hit, cooldown still spent.

### R03 One offensive input buffer, not two (blocker)

- Spec §12: "Buffer one offensive edge for 6 ticks; replace with the most recent edge, tie by lowest action number."
- Defect: `M1System` keeps `pressTick` and `AbilityRunner` keeps `buffers`. Both can be pending, so a busy fighter
  can fire a skill and then an M1 that was pressed earlier.
- Do:
  1. Add `apps/server/src/sim/OffensiveBuffer.ts`: per entity `{ kind: "m1" } | { kind: "skill"; slot; edgeId }`
     plus `tick`. `set()` replaces whatever is there. On a same-tick tie keep the lower action number from the
     §12 priority list (skill slots rank above M1).
  2. `M1System.update` and `AbilityRunner.skillDown` / `consumeBuffer` read and write that single buffer. Keep
     `bufferable: false` (Mirror Current) and "never buffer awakening, dash, recast or counter stance".
  3. A replaced skill edge must still get its `ActionResult` (accepted false, reason `STATE`), so the client clears
     its pending outline.
- Tests: during recovery, skill press at t then attack press at t+2: only M1 commits. Reverse order: only the skill
  commits. Same tick: the skill wins. Expiry at exactly 7 ticks drops the entry.

### R04 Armor semantics for `startup` and `onHit` (blocker for T16)

- Defect: `armorOf` treats `onHit` as armored through startup and active. That is a guess (T11 report). No current
  definition uses the field; T16 will.
- Spec: "startup" armor covers the windup. `onHit` means armor begins when the cast first damages or captures
  (Furnace Ray: "gain armor after first confirmed damage through active end"; the captures: "caster armor on capture").
- Do (in `AbilityRunner.armorOf` and `afterResolve`):
  - `startup`: armored while `tick < cast.activeStart`.
  - `onHit`: not armored until a result of this cast has outcome `hit` (damage above 0) or `captured`. From that tick,
    armored while `tick < cast.activeEnd` (capture handlers already extend `activeEnd`).
  - Handlers that need other windows keep using `cast.armorUntil`. T16 Split Tide ("startup armor through active
    end") sets `armorUntil = activeEnd` in `onCommit`.
- Tests: each mode at the boundary ticks (activeStart−1, activeStart, first-hit tick, activeEnd−1, activeEnd).

### R05 Area and shape anchors follow §16 exactly

- Defects:
  1. `shapeOverlaps` centres every box 0.2 m above the caster. Spec §16: "Skybreak's box is width 20, height 8,
     depth 24, centred 12 m forward and **2 m** above caster centre." Today Skybreak spans −3.8 to +4.2 m vertically
     instead of −2 to +6 m.
  2. Beams start at the capsule centre. Spec §16: "Beams begin **0.6 m forward** of capsule centre **+0.4 m Y**."
  3. The Ocean Surge burst (`sim/Awakening.ts collect`) has no static line-of-sight test. Spec §16: "All spherical
     area attacks ... use 3D distance and static line of sight. No target is hit across an island slab."
- Do:
  1. Add `QueryOptions.boxCentreY?: number` (default 0.2) and `QueryOptions.beamOrigin?: { forward: number; up: number }`
     (default `{ forward: 0.6, up: 0.4 }` for every beam). Keep these in handler code, not in `AbilityDef`, so the
     content hash does not change.
  2. `kits/sv/groundWave.ts` passes `boxCentreY: 2`. `kits/sv/longBeam.ts` measures `beamLengthOf` and the near/far
     8 m split from the beam origin.
  3. In `Awakening.collect`, skip a target when `host.blocked(casterCentre, targetCentre)` is true. The host already
     has `blocked`; add it to `AwakeningHost`.
- Tests: Skybreak hits a target 5.5 m above the caster and misses one 3 m below. A wall between Ocean Surge and a
  target inside 5 m: no damage.

### R06 Forward-dash hitbox is missing

- Spec §11: forward dash, 18 ticks at 22 m/s, "last 3 ticks have M1 sized hitbox; 4 HP, stun 24". `COMBAT.dash.forward`
  already holds `hitTicks: 3, damage: 4, stunTicks: 24`. Nothing produces these candidates, and the T10 report does
  not list the gap.
- Do: add `apps/server/src/sim/DashAttack.ts` with `candidates(tick, fighters, poseOf, occluded)`. Emit for a
  fighter whose `dash.kind === "forward"` and `tick >= actionStartTick + 15 && tick < actionEndTick`. Use the M1 box
  (`m1Overlaps` with variant null), `block: "B"`, `counterable: true`, `damage100: 400`,
  `reaction: { kind: "stun", ticks: 24 }`, `maxHitsPerTarget: 1`, and `castCounter` from `requestDash` (already
  incremented). At 22 m/s the dash moves 0.37 m per tick, less than the 1.8 m box depth, so a per-tick overlap
  cannot tunnel; state that in a code comment. Merge the candidates into `ArenaRoom.resolveM1`.
- Tests: hit on dash tick 15, none on tick 14, one hit only across ticks 15 to 17, blocked from the front, side dash
  never hits. Real-client case: add one assertion to `tests/integration/combat.test.ts`.

### R07 Enforce `turnRate` during casts

- Spec §14: `turnRate = 0` after commit unless the card says otherwise. sv.b2 (90 deg/s) is the only P0 card with a
  non-zero value; Furnace Ray and others follow in P1.
- Defect: `ActiveCast.aimYaw` is frozen at commit and Movement still turns the body freely (540 deg/s). The hitbox
  and the visible body point in different directions.
- Do:
  1. Make `ActiveCast.aimYaw` mutable. Each tick in `AbilityRunner.collect`, before candidates, rotate it toward the
     requested yaw by at most `turnRate * π / 180 / 60` radians. The requested yaw is the facing that Movement would
     choose this tick (camera yaw with facing lock on, otherwise movement direction).
  2. While a cast runs, Movement sets body `facingYaw = cast.aimYaw` (an override, like `dashOverride`).
  3. With `turnRate === 0` the body facing is locked for the whole cast.
- Tests: sv.b2 with a constant request 180° away rotates exactly 90° after 60 ticks. sv.b1 does not rotate at all.

### R08 Replicated state required by §20 and §22

- Missing public fields: `cooldownEndTicks[4]` (absolute ticks, slot order of the current form).
- Missing owner-only fields: `ackSeq`, `ackInputTick`, `epoch`, `pendingKit`, `evasiveEndTick`, `chargeStartTick`,
  plus the Stillpoint Reversal remaining ticks (spec §15: "the counter status is private to the owner").
- Installed `@colyseus/schema@5.0.43` exports `StateView` and the `view()` annotation. Per AGENTS.md, write a
  10-line smoke test of the installed API first. Then add an `OwnerSchema` child under `@view()` and call
  `client.view.add(...)` for that player's owner record in `onJoin` and again in `onReconnect`.
- Tests (real clients): client A receives its own `ackSeq` growing; client B never receives A's owner record.
  `cooldownEndTicks[2]` equals the accept tick plus 600 after sv.b3.
- Unblocks: T08 replay anchoring on `ackInputTick` and the HUD cooldown display.

### R09 Protocol details

1. `ActionResult.seq` must be the seq of the packet that carried the edge. Add `seq` to `QueuedEdge` in
   `net/ValidateInput.ts` and use it in `ArenaRoom.sendActionResult`.
2. Event IDs must be `roomEpoch:serverTick:counter` (spec §21). `roomEpoch` = random uint32 chosen in `onCreate`.
3. `FixedClock.isOverloaded` is never called. In `onAuth`, refuse with `ROOM_FULL` while overloaded and log one
   structured warning (spec §21: "Stop accepting new players while overloaded").
- Tests: an edge in seq 7 followed by seq 8 without edges returns `seq: 7`. Overload refusal is a unit test with an
  injected clock.

### R10 One owner for the fighter kit (before T17)

- Defect: the kit is stored in `AbilityRunner.kits`, `AwakeningSystem.kits` and `PlayerSchema.kitId`. T17 kit change
  will update one of them and forget another.
- Do: add `kitId` to `Fighter` (set in `CombatSystem.add`). Delete both private maps. `AbilityRunner.kitOf` and
  `AwakeningSystem` read `fighter.kitId`. `PlayerSchema.kitId` is published from the fighter in `publishAction`.
- Test: change the kit at respawn (fixture). Abilities, awakening threshold and replicated kit all switch together.

### R11 Knockback direction (one shared function)

- Spec §21: "Knockback replaces velocity components using the hit origin's horizontal direction; if zero distance,
  use attacker forward." Today M1 and abilities push along the attacker facing or the cast aim, in two code paths.
- Do: one `launchVector(origin, target, attackerYaw, forward, up)` in `sim/Knockback.ts`. Direction =
  normalize(target.xz − origin.xz), falling back to attacker forward when the length is below 1e-6. Use it from
  `M1System.launches`, `AbilityRunner.launches` and `releaseVictim`. For capture releases, the origin is the captor.
- Test: a target standing 90° to the side of an sv.b2 caster is pushed sideways, away from the caster.

### R12 Wire tests for every shipped move (spec §16 "two clients observing the same result")

- Today over the wire: sv.b3, sv.b4, td.b1, sv.a2 and sv activation only.
- Add `tests/integration/kit-matrix.test.ts` with a table of `{ moveId, setup, expectHp, expectAction }` covering
  sv.b1 (A09 landing on the real Rapier floor), sv.b2, td.b2 (drag stops at `wall.0`), td.b3, td.b4, sv.a1, sv.a3,
  sv.a4 and td activation. Both clients assert identical `hp100` and `action` for the victim at the same
  `serverTick`. Fixture placement through the server body API is allowed, as in the existing tests.
- Add **A15**: the victim disconnects while captured by td.b1. No stuck capture; after the reservation expires the
  seat is released and the captor is in recovery.

### R13 Browser layout evidence for T07

- The §27 definition of done requires "a layout screenshot at the target viewport". `@playwright/test` is pinned, but
  `tests/browser/` does not exist.
- Add `tests/browser/layout.spec.ts`: Chromium at 1024×768 and 1180×820. Assert the §7 fixture centres (attack
  (932,578), jump (948,688), dash (844,658), block (842,563), skills (377|467|557|647, 704)) within 1 px. Assert no
  overlap and 48 px minimum targets. Save screenshots to `docs/test-results/`.
- Use the preinstalled Chromium (`/opt/pw-browsers/chromium`); do not run `playwright install`.

### R14 Prediction against the real collider (before T18)

- T08 tests use a fake collision function and ignore `ackInputTick`. After R08, replace the fake with the shared
  Rapier world from `islands.v1.json`. Anchor replay on the owner `ackInputTick`. Add one real-client test where
  client and server positions agree within 0.1 m after 120 ticks of scripted input with a wall contact.

### R15 Ledger and runtime hygiene

1. `docs/tasks.md`: real short hashes (T12: `46a193c 812929c ebdf0a0 2c6ff88 653894e`, T13: `ea963db 1f315a3 557018b
   2cdffcd aa9916b feef664`, T14: `a403214`, T15: `afee336 b4a53b5 9595eff 7fc484b d0fd5ca`; fill T01 to T11 from
   `git log`). Status values only: TODO, IN PROGRESS, BLOCKED, DONE, IMPLEMENTED (DEVICE CHECK PENDING). Put pending
   items in a Notes column.
2. Run `pnpm verify` once on Node 24.22.2 (`.node-version`), record the result in `docs/dependencies.md`, then set
   `engines.node` to `24.22.2`. If Node 24 is not available, record NOT RUN; do not claim it.

## 6. Spec conflicts to record as decision records (`docs/decisions/`)

Do not silently change code for these; write the record, then follow it.

1. Default capture and third-party damage: §12 says "only where the capture handler permits", §13 says default
   captures allow ordinary third-party damage. The T09 choice (allow) is correct; R02 makes the abilities follow it.
2. Interrupted activation keeps the meter (T14 choice). The spec is silent. Record it as D.
3. M1 chain gap measured from the end of recovery (T10). §11 says only "Gap >54 ticks". Record it as D.
4. Downslam ragdoll 72 ticks (T10, not listed in §11). Record it as D.

## 7. Before starting T16 to T18

- T16 depends on R02, R04 and R05 (Cascade Chain armor on capture, Split Tide armor window, Deepfall area line of
  sight). Do not start T16 before those three are merged.
- T17 depends on R10 (kit change) and should add A13 and A18.
- T18 depends on R08, R12, R13 and R14. Its D02, D04 and D08 rows stay NOT RUN until two physical iPads run them.

## 8. Handoff template for each packet session

```
Task: R0x <title> (docs/reviews/T01-T15-review.md section 5)
Base: claude/busy-faraday-hqbvp3 at <hash>. Prerequisites merged: <ids>.
Allowed files: <from the packet>. Excluded: everything else; no package upgrades.
Done: packet tests pass; pnpm verify exit 0 (paste output); docs/test-results/R0x.md; ledger updated.
Report: changed behavior, executed checks, actual limitations, NOT RUN items.
```
