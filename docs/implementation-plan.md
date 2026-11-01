# Elemental Battlegrounds implementation plan (post T15)

Version 1, 2026-11-01. Base commit: `f0c1ac9` (T01 to T15). Owner decisions applied: T18 split
(`docs/decisions/0001-split-t18.md`), `claude/busy-faraday-hqbvp3` merged into `main`.

This is the single execution document for the next agent sessions. Findings and evidence live in
`docs/reviews/T01-T15-review.md`. Authority order is unchanged (AGENTS.md): user requirements, then `docs/spec.md`,
then this plan. Every number in this plan is quoted from the spec section named next to it. If this plan and the spec
disagree, the spec wins; record the conflict in `docs/decisions/` and stop.

## 1. Where the score goes

Current score: **68 / 100** (review section 9). Target: **95**. The path is below. Points for a packet count only when
its done-condition holds and its test report holds real, pasted command output.

| Dimension | Weight | Now | After waves 1 to 3 (agents) | After wave 4 (human iPad session) | Packets that move it |
|---|---|---|---|---|---|
| Architecture and authority | 20 | 17 | 19 | 19 | R10, R17, T18a to T18c module ownership |
| Spec fidelity of built scope | 25 | 18 | 24 | 24 | R02 to R09, R11, T16, T17 |
| Test rigor | 20 | 14 | 19 | 20 | R12, R13, R14, R18, A13, A15, A18 |
| Verification honesty and process | 15 | 10 | 14 | 15 | R01 verify output, R15, ledger, sequential sessions |
| Build and repo hygiene | 10 | 4 | 9 | 9 | R01, R15 |
| Progress toward playable P0 | 10 | 5 | 9 | 10 | T18a to T18e |
| **Total** | **100** | **68** | **94** | **97** | |

The last points need the D02, D04 and D08 rows run on both physical iPads by a person (section 7). No agent can earn
them, and AGENTS.md forbids recording them as passed when they were not run. Expect 93 to 94 from agent work alone,
and 95 or more after the iPad session.

## 2. Execution waves (one task per session, strictly in this order)

| Wave | Tasks | Purpose | Exit check |
|---|---|---|---|
| 1 Foundation | R01, R15, R17 | The gate works on a fresh clone; real lint; Node 24; tick pipeline extracted | `pnpm verify` exit 0 in a fresh clone on Node 24.22.2 |
| 2 Correctness | R02, R03, R04, R05, R06, R07, R09, R10, R11, R08 | Close every spec deviation found at T15 | All packet tests pass; no change to section 15 table numbers |
| 3a First playable | T18a, R14, T18b | Two browsers fight with eight Vanguard moves | Playwright two-context match passes |
| 3b Content | T16, T17, R12, R18 | Full P0 kits, respawn and FFA, two-client proof for every move | A13, A15, A18 pass; kit matrix passes; latency matrix report |
| 3c Product | T18c, R13, T18d, T18e | Full section 6 journey and the P0 gate | T18e report with every row PASS, FAIL or NOT RUN |
| 4 Human | iPad session (section 7) | Physical evidence | D02, D04, D08 recorded by a person |

Run waves 1 and 2 before any T16 or T18 work. Within a wave, keep the listed order. It is chosen so no packet edits
a file that a later packet in the same wave depends on.

## 3. Rules for every session (Sonnet 5.5 Low and Sol 6.1 Low)

1. Start: `git pull origin main`, then read AGENTS.md, this plan's packet, and the files listed in it. Do not read
   or edit other files unless a compile error points there.
2. Check the packet's prerequisites in `docs/tasks.md`. If one is not DONE, stop and report BLOCKED with its ID.
3. Write the failing tests first, using the test names in the packet, then the code.
4. Never change a number from spec sections 7, 10, 11 or 15. If a test needs a different number, the code is wrong.
5. Do not add a dependency unless the packet names it. Pin exact versions, update the lockfile and record them in
   `docs/dependencies.md`.
6. Finish: `pnpm verify` (defined in R01) must exit 0. Paste its full tail into `docs/test-results/<ID>.md`, together
   with the packet test names and pass counts. Update the ledger row: status, short commit hash, report path.
7. One commit per packet, message prefixed `<ID>:`. Push to `main` only after the gate passes.
8. If an installed library API differs from this plan, follow the installed API, write
   `docs/decisions/NNNN-<topic>.md`, and keep the behavior the plan asks for.
9. Report: changed behavior, executed checks with real output, limitations, NOT RUN items. Stop around 50 steps and
   hand off in 2 to 3 lines.

## 4. Fix packets

### R01 Clean-checkout gate and a real linter (wave 1, do first)

- Problem: `apps/client/tsconfig.tsbuildinfo`, `apps/server/tsconfig.tsbuildinfo`, `packages/shared/tsconfig.tsbuildinfo`
  and `apps/client/dist-types/**` are tracked. `tsc -b` trusts the tracked tsbuildinfo, skips emitting
  `packages/shared/dist`, and the client then fails with TS6305. Also, `pnpm lint` only checks import boundaries.
- Files: `.gitignore`, the tracked artifacts, root `package.json`, NEW `eslint.config.js`, `docs/dependencies.md`.
- Do:
  1. `git rm -r --cached apps/client/dist-types` and `git rm --cached -- '*.tsbuildinfo'`.
  2. Add `*.tsbuildinfo` and `dist-types/` to `.gitignore`.
  3. Add ESLint with typescript-eslint: `eslint`, `@eslint/js` and `typescript-eslint`, exact versions, checked
     against TypeScript 7.0.2 peers. Rules: `recommendedTypeChecked`, plus
     `@typescript-eslint/no-floating-promises: error` and
     `no-restricted-globals: ["error", "setTimeout", "setInterval"]` for `apps/server/src/sim/**`,
     `apps/server/src/kits/**` and `apps/server/src/rooms/**`. If typescript-eslint does not support TypeScript 7.0.2,
     record it in a decision record, keep the boundary script, and add a grep check for `setTimeout` and `setInterval`
     in those folders instead.
  4. Root scripts: `"lint": "node ops/scripts/lint-boundaries.mjs && eslint ."` and
     `"verify": "pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm content:validate"`.
  5. Fix lint errors in touched files only. Put pre-existing errors in a temporary `ignores` list, named file by file,
     in the R01 report.
- Done: a fresh clone runs `pnpm install --frozen-lockfile && pnpm verify` with exit 0. Paste the output.

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

#### Code: R02 `queryTargets` (apps/server/src/sim/AbilityRunner.ts)

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

#### Code: R03 single offensive buffer (NEW apps/server/src/sim/OffensiveBuffer.ts)

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

#### Code: R04 `armorOf` (apps/server/src/sim/AbilityRunner.ts)

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

#### Code: R05 shape anchors (apps/server/src/sim/AbilityRunner.ts shapeOverlaps)

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

#### Code: R06 forward-dash attack (NEW apps/server/src/sim/DashAttack.ts)

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

#### Code: R07 turnRate (AbilityRunner.collect and Movement)

```ts
// ActiveCast: aimYaw becomes mutable.
const maxStep = (cast.def.turnRate * Math.PI / 180) / 60;      // radians per tick
const want = this.host.requestedYaw?.(id) ?? cast.aimYaw;      // NEW host hook: Movement's desired facing this tick
cast.aimYaw = rotateToward(cast.aimYaw, want, maxStep);        // NEW shared math: shortest arc, clamp to maxStep
```

- Movement: add `facingOverrideOf(id)`, used exactly like `dashOverride`. While a cast is live it returns
  `cast.aimYaw`, so the body never turns faster than the hitbox.
- Put `rotateToward` in `packages/shared/src/math.ts` and unit test the wrap-around at ±π.

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

#### Code: R08 owner-only state (apps/server/src/state/PlayerSchema.ts)

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

### R09 Protocol details

1. `ActionResult.seq` must be the seq of the packet that carried the edge. Add `seq` to `QueuedEdge` in
   `net/ValidateInput.ts` and use it in `ArenaRoom.sendActionResult`.
2. Event IDs must be `roomEpoch:serverTick:counter` (spec §21). `roomEpoch` = random uint32 chosen in `onCreate`.
3. `FixedClock.isOverloaded` is never called. In `onAuth`, refuse with `ROOM_FULL` while overloaded and log one
   structured warning (spec §21: "Stop accepting new players while overloaded").
- Tests: an edge in seq 7 followed by seq 8 without edges returns `seq: 7`. Overload refusal is a unit test with an
  injected clock.

#### Code: R09.1 edge seq (apps/server/src/net/ValidateInput.ts)

```ts
export interface QueuedEdge { edge: Edge; arrivalTick: number; seq: number }
// accept(): this.queue.push({ edge: e, arrivalTick: tick, seq: p.seq });
// ArenaRoom.sendActionResult gains a `seq` parameter; every caller passes q.seq.
```

### R10 One owner for the fighter kit (before T17)

- Defect: the kit is stored in `AbilityRunner.kits`, `AwakeningSystem.kits` and `PlayerSchema.kitId`. T17 kit change
  will update one of them and forget another.
- Do: add `kitId` to `Fighter` (set in `CombatSystem.add`). Delete both private maps. `AbilityRunner.kitOf` and
  `AwakeningSystem` read `fighter.kitId`. `PlayerSchema.kitId` is published from the fighter in `publishAction`.
- Test: change the kit at respawn (fixture). Abilities, awakening threshold and replicated kit all switch together.

#### Code: R10 one kit owner

```ts
// ActionMachine.Fighter: kitId: KitId;   createFighter(entityId, lifeId, tick, kitId)
// CombatSystem.add(entityId, lifeId, tick, kitId)
// AbilityRunner: delete kits map; defFor(f, slot) uses this.registry.slotted(f.kitId, f.form, slot); kitOf(id) reads combat.get(id)?.kitId
// AwakeningSystem: delete kits map and setKit; request() reads f.kitId; gain() uses a.kitId
// ArenaRoom.onReady: combat.add(..., m.data.kitId); remove abilities.setKit and awakening.setKit
```

### R11 Knockback direction (one shared function)

- Spec §21: "Knockback replaces velocity components using the hit origin's horizontal direction; if zero distance,
  use attacker forward." Today M1 and abilities push along the attacker facing or the cast aim, in two code paths.
- Do: one `launchVector(origin, target, attackerYaw, forward, up)` in `sim/Knockback.ts`. Direction =
  normalize(target.xz − origin.xz), falling back to attacker forward when the length is below 1e-6. Use it from
  `M1System.launches`, `AbilityRunner.launches` and `releaseVictim`. For capture releases, the origin is the captor.
- Test: a target standing 90° to the side of an sv.b2 caster is pushed sideways, away from the caster.

#### Code: R11 knockback vector (NEW apps/server/src/sim/Knockback.ts)

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

### R12 Wire tests for every shipped move (spec §16 "two clients observing the same result")

- Today over the wire: sv.b3, sv.b4, td.b1, sv.a2 and sv activation only.
- Add `tests/integration/kit-matrix.test.ts` with a table of `{ moveId, setup, expectHp, expectAction }` covering
  sv.b1 (A09 landing on the real Rapier floor), sv.b2, td.b2 (drag stops at `wall.0`), td.b3, td.b4, sv.a1, sv.a3,
  sv.a4 and td activation. Both clients assert identical `hp100` and `action` for the victim at the same
  `serverTick`. Fixture placement through the server body API is allowed, as in the existing tests.
- Add **A15**: the victim disconnects while captured by td.b1. No stuck capture; after the reservation expires the
  seat is released and the captor is in recovery.

#### Code: R12 wire matrix fixture shape (tests/integration/kit-matrix.test.ts)

```ts
interface Row { move: MoveId; kit: KitId; setup: (h: Harness) => Promise<void>;
  edge: { kind: "skillDown"; slot: 1 | 2 | 3 | 4 } | { kind: "awaken" };
  expectVictimHp100: number; expectVictimAction: Action; waitTicks: number }
// for each row: two real RoomClient connections (tests/fixtures/harness.ts), place bodies via the server body API,
// send the edge through PointerRouter + IntentSampler, wait waitTicks of serverTick, then assert on BOTH clients'
// replicated state at the same serverTick. Never read server memory for the assertion.
```

### R13 Browser layout evidence for T07

- The §27 definition of done requires "a layout screenshot at the target viewport". `@playwright/test` is pinned, but
  `tests/browser/` does not exist.
- Add `tests/browser/layout.spec.ts`: Chromium at 1024×768 and 1180×820. Assert the §7 fixture centres (attack
  (932,578), jump (948,688), dash (844,658), block (842,563), skills (377|467|557|647, 704)) within 1 px. Assert no
  overlap and 48 px minimum targets. Save screenshots to `docs/test-results/`.
- Use the preinstalled Chromium (`/opt/pw-browsers/chromium`); do not run `playwright install`.

### R14 Prediction against the real collider (before T18b)

- T08 tests use a fake collision function and ignore `ackInputTick`. After R08, replace the fake with the shared
  Rapier world from `islands.v1.json`. Anchor replay on the owner `ackInputTick`. Add one real-client test where
  client and server positions agree within 0.1 m after 120 ticks of scripted input with a wall contact.

### R15 Node 24 run and decision records (wave 1)

1. Install Node 24.22.2 (`.node-version`). Run `pnpm verify` and record the result in `docs/dependencies.md`, then set
   `engines.node` to `"24.22.2"`. If Node 24 cannot be installed in the environment, record NOT RUN and keep
   `engines` unchanged. Never claim it.
2. Write `docs/decisions/0002` to `0005`, one each, with old value, new value, reason, affected IDs and test
   impact:
   - 0002: default captures allow ordinary third-party damage (spec §12 vs §13; the §13 reading wins).
   - 0003: an interrupted activation keeps the meter (the spec is silent).
   - 0004: the M1 chain gap is measured from the end of recovery (§11 says only "Gap >54 ticks").
   - 0005: the downslam ragdoll lasts 72 ticks (not listed in §11).
3. Keep the ledger format introduced at `f0c1ac9`: allowed statuses only, short hashes, open items in Notes.

### R17 Extract the tick pipeline from ArenaRoom (wave 1)

- Problem: `ArenaRoom.stepTick` hand-wires combat, M1, abilities, awakening, movement, launches and publishing in one
  method that grows with every task. The spec §21 order exists only as comments there.
- Files: NEW `apps/server/src/sim/TickPipeline.ts`, `apps/server/src/rooms/ArenaRoom.ts`.
- Do: move the body of `stepTick` and `resolveM1` into `TickPipeline.step(tick, seats)` with one private method per
  §21 phase, called in this fixed order:
  `expire` → `drainIntents` → `leaseClear` → `actionTransitions` → `locomotion` → `queries` → `resolve` → `afterHits`
  (launches, meter, handler results) → `deathsAndRespawns` → `publish`.
  `ArenaRoom` keeps transport only: auth, join, drop, reconnect, leave, messages. Behavior must be identical.
- Done: the whole existing suite passes unchanged. No test file changes are allowed in this packet, so the refactor
  is proven by the old tests.

### R18 Latency matrix on loopback (wave 3b)

- Spec §26 asks for A01, A07, A08, A12, A15 and A20 at RTT 20/80/150/250 ms with jitter. Real loss shaping needs the
  network layer; delay and jitter do not.
- Files: NEW `tests/fixtures/LatencyProxy.ts`, NEW `tests/integration/latency-matrix.test.ts`.
- Do: a TCP proxy in Node `net` that forwards WebSocket bytes in order, delaying each chunk by RTT/2 plus a uniform
  jitter. Order is never broken, because WebSocket runs over TCP (§26: "do not simulate unordered delivery").
  Run A01, A07, A08 and A20 through it at 20, 80, 150 and 250 ms RTT with 0 and 40 ms jitter. Assert the
  authoritative results are identical to the 0 ms run: same HP, same casts, no duplicates.
- Record packet loss rows (1 and 3 percent) as NOT RUN with the reason: needs OS-level shaping.

## 5. Specification tasks with pre-flight notes

These rows add pitfalls and framework hooks to spec §27. They do not replace the spec cards. Split each kit task into
`.1` to `.4`, one move per commit (spec §25).

### T16 Duelist awakening (after R02, R04, R05)

| Move | Spec §15 values | Framework to reuse | Pitfall |
|---|---|---|---|
| td.a1 Cascade Chain | 8/5/16, cd 510; damage [4,4,4,4,10] at capture+[0,8,16,24,32]; release +33, R60 F5 U4; all target states | `makeSequenceHandler` (kits/td/sequence.ts), `armor: "onHit"` after R04 | The capture hit is index 0. Do not double-count it as one of the five damage hits. |
| td.a2 Deepfall | 16/5/30, once per form, 69 HP at capture+72; release +78, R90 F4 U12; area 4 m, 20 HP, U, noncounterable, R60 F6 U4, once; max 4 total | sequence handler with `cinematic: true`; `armor: "startup"`; area through `queryTargets` with a sphere shape | The original victim cannot take the area damage. A miss spends the use. LOS through `host.blocked`, as for the R05 Ocean Surge fix. |
| td.a3 Split Tide | 16/18/24, cd 840; probes at offsets 0 and 17: 12 HP stun 30, then 26 HP R72 F10 U4 | default scheduler with `hitOffsets [0,17]`; `onCommit` sets `cast.armorUntil = activeEnd` | First probe missed: the second still deals 26. A first hit interrupted by armorBreak prevents the second (generation token already does this; assert it). |
| td.a4 Riptide Pursuit | 12/30/30, cd 570; close branch if a target within 2 m at commit: [8,22] at +0,+36; else dash 18 m/s up to 30 ticks: 27 at +36; release +37, R72 F8 U5 | §16 dash sweep: sphere r 0.6 at capsule centre +0.2 Y, previous to next centre; `host.moveTogether` for wall stop | The branch is fixed at commit. Caster armor only after capture. The P1 second-target chain stays out of T16 (it is T24). |

The form timer (2940 ticks) and Ocean Surge already exist (T14). Add **form expiry during a capture** to the
mandatory matrix (A14 pattern).

Open owner question: the Duelist finisher heal passive (spec §15, last paragraph of the Duelist awakening card) has
no task in §27, and T22 is P1. Recommended: implement it in T17, where the KO pipeline and per-life reward registry
live, and record it as decision 0006.

### T17 Respawn and FFA (after R10)

- `RespawnSystem` (NEW `apps/server/src/sim/RespawnSystem.ts`):
  - Respawn 180 ticks after death (`COMBAT.respawnTicks`). Before choosing, apply §10: reject anchors within 2 m of
    an occupied capsule or inside an active hostile hit region; choose the anchor farthest from the nearest living
    enemy; ties go to the lowest anchor ID.
  - If no anchor qualifies, retry for 60 ticks, then pick the farthest and grant standard protection.
  - Replace `ArenaRoom.chooseSpawn` with this system.
- Void and boundary: y < −25 or horizontal radius > 90 m means one KO per life (§10).
- Scoring (§6):
  - A KO is 1 point. A ring-out credits the most recent hostile attacker within 480 ticks, otherwise nobody.
  - Assist: at least 20 damage within the previous 480 ticks, when someone else gets the KO.
  - Store damage attribution per victim life and trim entries older than 480 ticks (§13).
- Kit change (§6):
  - In combat, the new kit applies at the next respawn.
  - Out of combat (480 ticks without dealing or taking damage), it applies now, resetting meter and cooldowns.
  - It never heals and never consumes an awakening for a benefit.
- Tests:
  - A13: lethal hit plus another hit in the same tick gives one KO, one reward and no negative HP.
  - A18: deterministic spawn choice and the fallback path.
  - Ring-out credit, assist threshold at 19.99 vs 20 HP, kit change in and out of combat, protection cancelled by an
    offensive request.

### T18a Scene and fighter views (after R01)

- Files: `apps/client/src/scene/GameScene.ts`, `FighterView.ts`, `EffectsPool.ts` (empty pool with `dispose()`),
  `main.ts`.
- Build the island colliders from `assets/maps/islands.v1.json` as simple original meshes (boxes, rounded slabs).
- One capsule-and-box FighterView per player with distinct original colors per kit. Interpolate remote players from
  `SnapshotBuffer` at 100 ms delay (§22). Show the action as text above the head for testing.
- WebGL2 check at boot. Without WebGL2, show the readable message with Retry (§6).
- Tests:
  - Unit: create and dispose 10 times, then `renderer.info.memory.geometries` and the listener count return to the
    baseline.
  - Playwright: page loads, canvas visible, no console errors.

### T18b Client input and prediction loop (after T18a, R08, R14)

- Files: `apps/client/src/app/GameLoop.ts` (NEW), `input/KeyboardRouter.ts` (NEW, §11 keys), wiring in `main.ts`.
- Frame loop:
  1. `PointerRouter` and `KeyboardRouter` feed `IntentSampler`, which sends to `RoomClient` at 30 Hz, with edges sent
     immediately within the rate bucket.
  2. `Prediction` steps the local player at 60 Hz using the shared Rapier world.
  3. `CameraRig` follows. Render.
- Pointer release on blur, visibility change and orientation change (§8).
- Tests: Playwright with two browser contexts against a real test server. Context A walks to B, holds Attack and
  completes the four-hit chain. Both contexts read B's HP from replicated state and must agree.
- Save a screenshot at 1024×768 to `docs/test-results/T18b.png`.

### T18c App flow, lobby and HUD (after T18b, T14)

- Files: `app/AppFlow.ts`, `ui/Lobby.ts`, `Hud.ts` wiring.
- §6 journey: Welcome with Arel and Nora presets as labels only; invite fragment consumed and removed (existing
  `consumeInviteFragment`); session and join-ticket exchange; fighter select showing only P0 kits; Ready.
- Error states ROOM_FULL, INVITE_INVALID, VERSION_MISMATCH, SERVER_OFFLINE and ASSET_FAILED, each with plain text and
  Retry or Back. Retry uses bounded exponential delay.
- HUD bound to replicated fields:
  - hp100, cooldownEndTicks (one decimal under 10 s, ceiling seconds above), meter percent with "Ready", form timer.
  - Rejection text from `ActionResult`, 0.7 s, rate limited (§9).
  - Stillpoint remaining time for the owner only.
- Tests: Playwright for each error state with a stubbed HTTP response, plus the happy path to Ready.

### T18d Practice room and onboarding (after T18c, T17)

- `apps/server/src/rooms/PracticeRoom.ts`: same tick pipeline (R17), one stationary dummy, guard and ragdoll toggles,
  and `awakening.meterEnabled = false` (§6).
- Tutorial steps (move, turn, hold attack, hold block, dash, four skills, awaken) are each confirmed by a server event.
  The client never completes a step locally.
- Test: a Playwright run completes every step. Practice damage never changes FFA scores.

### T18e P0 playable gate

- Two browser clients complete all 16 slotted moves and both awakenings, using the R12 matrix through the UI.
- Write `docs/test-results/T18e.md`: every §25 ID in P0 scope plus D01 to D09, each PASS, FAIL or NOT RUN.
- D02, D04 and D08 stay NOT RUN until section 7 is done by a person.
- Status: IMPLEMENTED (DEVICE CHECK PENDING) until then.

## 6. Session handoff template

```
Task: <ID> <title> (docs/implementation-plan.md)
Base: main at <hash>. Prerequisites DONE: <ids>.
Allowed files: <from the packet>. Excluded: everything else; no package upgrades.
Done: packet tests pass; pnpm verify exit 0 (output pasted); docs/test-results/<ID>.md; ledger row updated.
Report: changed behavior, executed checks, limitations, NOT RUN items.
```

## 7. Human iPad session (wave 4, about 45 minutes, both iPads)

Needs: the Mac Studio server running T18e on the home network, and both iPads in landscape in Safari. Record the
model, the iPadOS version and the visible viewport in `docs/test-results/device-<date>.md`.

| ID | Do | Pass when |
|---|---|---|
| D01 | Open at full screen, then in split view | All buttons inside the safe area, no overlap; rotate panel shows when too small |
| D02 | Move, drag the camera, hold Attack and press Jump on the fourth hit, for 30 seconds | No stuck input; fourth hit becomes the uppercut |
| D04 | Hold Block, open the app switcher, return | No stuck guard or movement; reconnect or neutral state is visible |
| D05 | Rotate, change browser chrome | Layout recalculates; no inherited pointer |
| D08 | Die during Orbit Collapse, then open Settings | Camera returns; no invisible UI; no permanent invulnerability |
| D09 | Ten-minute match, then ten lobby and game cycles | No crash; smooth play; no slowdown at the end |

Write what was seen, not what was expected. A row not done stays NOT RUN.
