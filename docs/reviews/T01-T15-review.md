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

### R16 Plan gap: the client renders nothing, and no task owns the scene before T18

- Fact: `apps/client/src/main.ts` is 21 lines and only prints "Preparing arena". `GameScene`, `FighterView`,
  `EffectsPool`, `Lobby`, `AppFlow`, `KeyboardRouter` and `SettingsStore` (spec §18 tree) do not exist. `Hud`,
  `Prediction`, `SnapshotBuffer` and `CameraRig` exist but are not connected to anything.
- Spec §27 gives T18 only "AppFlow, PracticeRoom, onboarding, tests". In practice T18 would carry the whole client:
  scene, lobby, fighter selection, HUD wiring, prediction loop and practice room. That is several thousand lines,
  far above the 500-line task limit, and it is the first point where a person can play.
- Product consequence: after 15 tasks nobody can see or play anything. Control spacing, the reason §27 schedules an
  early playtest, cannot be judged yet.
- Do (a scope decision for the owner, then a ledger change): split T18 before starting it:
  - T18a `GameScene` + `FighterView` with original geometric placeholders, interpolating remote players from
    `SnapshotBuffer`.
  - T18b input loop: `PointerRouter` → `IntentSampler` → `RoomClient`, plus `Prediction` on the local player and
    `CameraRig`.
  - T18c `AppFlow` + `Lobby` (Welcome, invite exchange, fighter select, Ready, the §6 error states) and the `Hud`
    wired to replicated fields.
  - T18d `PracticeRoom` + onboarding.
  - T18e the P0 gate (two clients complete all moves; D02, D04, D08 recorded as NOT RUN until done on the iPads).
- Recommended order: run T18a and T18b right after R01 to R06, before T16 and T17. The first visual playtest then
  happens with eight moves instead of sixteen, which is what §27 intends.

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

## 9. Quality assessment (score out of 100)

Scored at `f0c1ac9` against the spec's own definition of done. Each line comes from evidence in this review.

| Dimension | Weight | Score | Evidence |
|---|---|---|---|
| Architecture and authority model | 20 | 17 | Fixed tick, generation tokens, serial resolver, capture registry, pure shared modules, no client damage path. Minus: kit stored in three places (R10); `ArenaRoom.stepTick` is becoming the place where every system is wired in by hand. |
| Spec fidelity of implemented scope | 25 | 18 | 12 moves match their tables. Minus: captured-victim eligibility (R02), two buffers (R03), shape anchors and Ocean Surge through walls (R05), forward-dash hit missing (R06), turnRate (R07), missing replicated fields (R08). |
| Test rigor | 20 | 14 | 456 deterministic tests, exact tick boundaries, damage sums asserted, fuzz with invariants. Minus: 7 of 12 moves have no two-client test, A15 missing, no browser tests, one "third party" test bypasses the path it claims to test. |
| Verification honesty and process | 15 | 10 | NOT RUN items recorded honestly, limitations listed. Minus: every report claims a typecheck that fails on a fresh clone, ledger lacks hashes and uses invalid statuses, parallel worktrees merged by hand. |
| Build and repo hygiene | 10 | 4 | Exact pins and lockfile present. Minus: fresh-clone typecheck fails, build output committed, lint is not a linter, pinned Node 24 never run, `main` 11 tasks behind. |
| Delivery progress toward a playable P0 | 10 | 5 | 15 of 18 P0 tasks done in about 2 hours. Minus: nothing renders and nobody can play yet; T18 as written is too large (R16). |
| **Total** | **100** | **68** | |

How to read 68: the foundation is good, and it is better than typical agent output on the hard part (authoritative
combat). The score is held down by fixable defects and gaps in verification evidence, not by architecture. After R01
to R06 and R15, the expected score is about 78. After R08, R12 to R14 and a split T18 that renders a playable
build, about 85. Above 90 needs the physical iPad checks, which no agent can run.

## 10. Code-level implementation details

These snippets match the code at `f0c1ac9`. They are the intended shape, not paste-ready patches. Names in
backticks exist today unless marked NEW.

### R02 `queryTargets` (apps/server/src/sim/AbilityRunner.ts)

```ts
export interface QueryOptions {
  filter?: (target: Fighter, pose: AbilityPose) => boolean;
  maxLength?: number;
  excludeCaptured?: boolean;          // NEW, replaces allowCaptured
  shape?: Shape; range?: number; targetStates?: readonly TargetState[];
  boxCentreY?: number;                // NEW (R05), default 0.2
  beamOrigin?: { forward: number; up: number }; // NEW (R05), default { forward: 0.6, up: 0.4 }
}

// inside the loop, replace
//   if (t.action === "Captured" && !opts.allowCaptured) continue;
// with
if (opts.excludeCaptured && host.combat.captures.isCaptured(t.entityId)) continue;
// A cinematic capture is still refused later by HitResolver (outcome "shielded"); do not duplicate that rule here.
```

Callers that must pass `excludeCaptured: true`: the probe branch in `kits/td/sequence.ts makeSequenceHandler`,
`kits/sv/cinematicGrab.ts`, and `kits/sv/launcher.ts` (it currently uses the default `meleeCandidates`, so give it a
`candidates(c)` that calls `queryTargets(c, { excludeCaptured: true })`).

Note: `targetStateOf()` returns "standing" or "air" for a Captured fighter. That is correct here; do not add a fourth
state.

### R03 single offensive buffer (NEW apps/server/src/sim/OffensiveBuffer.ts)

```ts
export type Buffered =
  | { kind: "m1"; tick: number }
  | { kind: "skill"; slot: 1 | 2 | 3 | 4; edgeId: number; tick: number };

/** Lower number = higher priority (spec 12): skill slot 1..4 rank 2..5, M1 rank 7. */
const rank = (b: Buffered): number => (b.kind === "skill" ? 1 + b.slot : 7);

export class OffensiveBuffer {
  private readonly byEntity = new Map<number, Buffered>();
  /** Returns the replaced skill edge (so the room can answer it STATE), or null. */
  set(entityId: number, next: Buffered): Buffered | null {
    const cur = this.byEntity.get(entityId);
    if (cur && cur.tick === next.tick && rank(cur) <= rank(next)) return next.kind === "skill" ? next : null;
    this.byEntity.set(entityId, next);
    return cur && cur.kind === "skill" ? cur : null;
  }
  take(entityId: number, tick: number, window: number): Buffered | null {
    const b = this.byEntity.get(entityId);
    if (!b) return null;
    this.byEntity.delete(entityId);
    return tick - b.tick > window ? null : b;   // window = COMBAT.bufferTicks (6)
  }
  peek(entityId: number): Buffered | undefined { return this.byEntity.get(entityId); }
  drop(entityId: number): void { this.byEntity.delete(entityId); }
  clear(): void { this.byEntity.clear(); }
}
```

Wiring:
- Construct one instance in `ArenaRoom` and pass it to both `M1System` and `AbilityRunner`.
- `M1System.update`: on a rising edge while not Idle, call `buffer.set(id, { kind: "m1", tick })`. Delete
  `ChainState.pressTick`. A held attack while Idle still commits directly. Only presses are buffered.
- `AbilityRunner.skillDown`: replace `this.buffers.set(...)` with `buffer.set(...)`. Answer a returned replaced edge
  with `rejected / STATE`.
- At the Recovery to Idle boundary (top of the per-seat input step in `stepTick`), call `buffer.take(...)` once and
  dispatch to M1 or the skill. Remove `AbilityRunner.consumeBuffer` and `buffers`.
- Clear the entity's entry on death, respawn and leave. This is where `AbilityRunner.reset` and `M1System.reset` are
  called today.

### R04 `armorOf` (apps/server/src/sim/AbilityRunner.ts)

```ts
private armorOf(cast: ActiveCast, tick: number): boolean {
  if (tick < cast.armorUntil) return true;
  switch (cast.def.armor) {
    case "startup": return tick < cast.activeStart;
    case "onHit": return cast.data.firstHitTick !== undefined && tick < cast.activeEnd;
    default: return false;
  }
}
// in afterResolve, before calling the handler's onResults:
for (const r of list) {
  if ((r.outcome === "hit" && r.damage100 > 0) || r.outcome === "captured") {
    cast.data.firstHitTick ??= tick;
  }
}
```

The tick on which the first hit lands is not armored (the hit resolved before armor existed). From the next tick it
is. Test exactly that boundary.

### R05 shape anchors (apps/server/src/sim/AbilityRunner.ts shapeOverlaps)

Add two trailing parameters, `boxCentreY = 0.2` and `beamOrigin = { forward: 0.6, up: 0.4 }`.
- Box: `const cy = a.y + boxCentreY;`
- Beam: shift the attacker reference before measuring.
  `const ox = a.x + fx * beamOrigin.forward, oz = a.z + fz * beamOrigin.forward, oy = a.y + beamOrigin.up;`
  Measure `fwd`, `right` and the vertical gap from `(ox, oy, oz)`.
- `queryTargets` passes `opts.boxCentreY` and `opts.beamOrigin` through.
- `longBeam.beamLengthOf` starts its bisection ray at the same origin.
- Line-of-sight checks stay centre to centre.

Ocean Surge (`apps/server/src/sim/Awakening.ts`):

```ts
export interface AwakeningHost {
  readonly combat: CombatSystem;
  pose(id: number): { x: number; y: number; z: number; facingYaw: number; grounded: boolean } | undefined;
  blocked(a: readonly [number, number, number], b: readonly [number, number, number]): boolean; // NEW
}
// in collect(), before near.push(...):
if (this.host.blocked([ap.x, ap.y, ap.z], [tp.x, tp.y, tp.z])) continue;
```

`ArenaRoom.abilityHost()` already provides `blocked`, so the same object satisfies both interfaces.

### R06 forward-dash attack (NEW apps/server/src/sim/DashAttack.ts)

```ts
const D = COMBAT.dash.forward;               // ticks 18, hitTicks 3, damage 4, stunTicks 24
export function dashCandidates(tick: number, fighters: readonly Fighter[],
  poseOf: (id: number) => M1Pose | undefined, occluded: (a: M1Pose, t: M1Pose) => boolean): HitCandidate[] {
  const out: HitCandidate[] = [];
  for (const a of fighters) {
    if (a.action !== "Dash" || a.dash?.kind !== "forward") continue;
    if (tick < a.actionStartTick + D.ticks - D.hitTicks || tick >= a.actionEndTick) continue;
    const ap = poseOf(a.entityId); if (!ap) continue;
    for (const t of fighters) {
      if (t.entityId === a.entityId || t.action === "Dead") continue;
      const tp = poseOf(t.entityId);
      if (!tp || !m1Overlaps(ap, tp, null) || occluded(ap, tp)) continue;
      out.push({ attackerId: a.entityId, attackerGeneration: a.generation, castCounter: a.castCounter,
        hitIndex: 0, toi: 0, targetId: t.entityId, moveId: "dash.forward", originX: ap.x, originZ: ap.z,
        block: "B", counterable: true, armorBreak: false, damage100: D.damage * 100,
        reaction: { kind: "stun", ticks: D.stunTicks }, maxHitsPerTarget: 1 });
    }
  }
  return out;
}
```

Also:
- `CombatSystem.pruneLedger` already keeps the entry while `f.dash !== null`, so deduplication across the 3 ticks
  works.
- `m1Overlaps` uses `facingYaw`. During a dash that equals the dash direction only when the dash was forward, which
  is the only kind that hits.

### R07 turnRate (AbilityRunner.collect and Movement)

```ts
// ActiveCast: aimYaw becomes mutable.
const maxStep = (cast.def.turnRate * Math.PI / 180) / 60;      // radians per tick
const want = this.host.requestedYaw?.(id) ?? cast.aimYaw;      // NEW host hook: Movement's desired facing this tick
cast.aimYaw = rotateToward(cast.aimYaw, want, maxStep);        // NEW shared math: shortest arc, clamp to maxStep
```

- Movement: add `facingOverrideOf(id)`, used exactly like `dashOverride`. While a cast is live it returns
  `cast.aimYaw`, so the body never turns faster than the hitbox.
- Put `rotateToward` in `packages/shared/src/math.ts` and unit test the wrap-around at ±π.

### R08 owner-only state (apps/server/src/state/PlayerSchema.ts)

```ts
import { Schema, ArraySchema, defineTypes, view } from "@colyseus/schema";
export class OwnerSchema extends Schema {
  ackSeq = 0; ackInputTick = 0; epoch = 1; pendingKit = ""; evasiveEndTick = 0; chargeStartTick = 0;
  lethalCounterRemaining = 0;
}
// PlayerSchema gains:  cooldownEndTicks = new ArraySchema<number>(0, 0, 0, 0);  (uint32)
//                      owner = new OwnerSchema();  tagged with view() so only clients whose view contains it receive it
// ArenaRoom.onJoin / onReconnect:  client.view ??= new StateView(); client.view.add(player.owner);
```

- Check the exact decorator form and `client.view` property against the installed 0.18.10 / 5.0.43 typings before
  writing code. AGENTS.md forbids assuming an API from documentation.
- Publish `cooldownEndTicks[i]` from `fighter.cooldowns.get(registry.slotted(kit, fighter.form, i+1)?.id)` in
  `publishAction`.

### R09.1 edge seq (apps/server/src/net/ValidateInput.ts)

```ts
export interface QueuedEdge { edge: Edge; arrivalTick: number; seq: number }
// accept(): this.queue.push({ edge: e, arrivalTick: tick, seq: p.seq });
// ArenaRoom.sendActionResult gains a `seq` parameter; every caller passes q.seq.
```

### R10 one kit owner

```ts
// ActionMachine.Fighter: kitId: KitId;   createFighter(entityId, lifeId, tick, kitId)
// CombatSystem.add(entityId, lifeId, tick, kitId)
// AbilityRunner: delete kits map; defFor(f, slot) uses this.registry.slotted(f.kitId, f.form, slot); kitOf(id) reads combat.get(id)?.kitId
// AwakeningSystem: delete kits map and setKit; request() reads f.kitId; gain() uses a.kitId
// ArenaRoom.onReady: combat.add(..., m.data.kitId); remove abilities.setKit and awakening.setKit
```

### R11 knockback vector (NEW apps/server/src/sim/Knockback.ts)

```ts
export function launchVector(ox: number, oz: number, tx: number, tz: number, attackerYaw: number,
  forward: number, up: number): { vx: number; vy: number; vz: number } {
  let dx = tx - ox, dz = tz - oz;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) { dx = -Math.sin(attackerYaw); dz = -Math.cos(attackerYaw); } else { dx /= len; dz /= len; }
  return { vx: dx * forward, vy: up, vz: dz * forward };
}
```

Downslam and the uppercut keep their pure vertical vectors (forward 0), so A03 is unchanged.

### R12 wire matrix fixture shape (tests/integration/kit-matrix.test.ts)

```ts
interface Row { move: MoveId; kit: KitId; setup: (h: Harness) => Promise<void>;
  edge: { kind: "skillDown"; slot: 1 | 2 | 3 | 4 } | { kind: "awaken" };
  expectVictimHp100: number; expectVictimAction: Action; waitTicks: number }
// for each row: two real RoomClient connections (tests/fixtures/harness.ts), place bodies via the server body API,
// send the edge through PointerRouter + IntentSampler, wait waitTicks of serverTick, then assert on BOTH clients'
// replicated state at the same serverTick. Never read server memory for the assertion.
```
