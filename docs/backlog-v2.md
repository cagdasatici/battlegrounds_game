# Backlog v2: playtest feedback and remaining work (2026-11-01)

Status: PLAN ONLY. Nothing here is implemented. Written for execution by Sonnet 5.5 Low and Sol 6.1 Low.
Base for every slice: `origin/main` at or after `aaafc3f`. Read AGENTS.md, then this file's "Rules for every slice",
then only your own slice.

## 1. Playtest feedback and where it lands

| # | Owner feedback | Covered by the old backlog? | Root cause found in code | New slice |
|---|---|---|---|---|
| 1 | Arms look wrong, like walking backwards | No | `packages/shared/src/rig.ts` poses use the opposite X rotation sign from the rig convention (model faces -Z, eyes at z = -0.108). Knees bend forward (`kneeL: 1.2`), elbows bend backward (`elbowL: -1.7`), and leans and crouches are mirrored. | B1 |
| 2 | Two clients disagree on how fighters look; one fighter shows white | No | `apps/client/src/app/GameLoop.ts:158` builds a `FighterView` once, the first time a player is seen, from `toKit(p.kitId)`. It never rebuilds when `kitId` changes later (lobby ready, `changeKit`, late replication), so each client keeps whatever kit it saw first. | B2 |
| 3 | Environment graphics need much higher quality | No. T25 is closed with box-built procedural art. | `ArenaView.ts` builds the whole arena from primitive boxes and cones in code | ART0 (decision), ART1 |
| 4 | Characters need higher quality | No | Fighters are merged boxes and capsules with rigid 100% bone weights (`FighterModel.ts`) | ART2 |
| 5 | Fight effects: red/green, text showing which power was used | Partly. T26 asks for hit cues and pooled effects; there is no ability text, and spec section 9 says "Damage numbers default off". | `EffectsPool.ts` is an empty stub. The client listens to `combatEvent` only for KO and respawn (`main.ts:205`). | FX0, FX1, FX2, FX3, FX4-sv, FX4-td, FX4-ea, FX5 |
| 6 | Characters should move faster | No | `COMBAT.movement` sets walk 5, run 8, guard 2, acceleration 45 (all D values) | SPD1 |

Also open: **T23 is on `origin/studio/t23` but not on `main`.** Slice M0 merges it.

## 2. Remaining work: every slice, by wave and lane

Lanes are file-ownership groups. **Slices in the same wave never edit the same file**, so they can run at the same time
on different machines and merge cleanly. "Where" is a recommendation. **Studio** means real-GPU visual work: it needs
screenshots on this Mac, uses `EB_CHROMIUM`, and the owner places asset files there. **Cloud** means server, logic or DOM
work; the default `/opt/pw-browsers/chromium` exists there.

| Wave | Slice | Title | Where | Depends on | Size | Decision # |
|---|---|---|---|---|---|---|
| 0 | M0 | Merge T23 into main | Owner | none | S | none |
| 1 | B1 | Fix limb bend and facing in the rig | Studio | M0 | S | 0019 |
| 1 | B2 | Fighter view follows kit changes | Studio | M0 | S | none |
| 1 | SPD1 | Faster movement | Cloud | M0 | S | 0020 |
| 1 | FX0 | Combat event contract and presentation bus | Cloud | M0 | M | 0021 |
| 1 | T21 | Artificer awakening (existing spec row) | Cloud | M0 | L | 0022 |
| 1 | ART1 | Environment art upgrade | Studio | ART0 answered | L | 0023 |
| 2 | FX1 | Hit impact effects, victim flash, hitstop, shake | Studio | FX0 | M | 0024 |
| 2 | FX2 | Combat text: damage numbers, power callouts, KO feed | Cloud | FX0 | M | 0025 |
| 2 | FX3 | Audio bus and original synthesized sounds | Cloud | FX0 | M | 0026 |
| 2 | ART2 | Character art upgrade | Studio | B1 | L | 0027 |
| 2 | T22 | Passives (existing spec row) | Cloud | T21 | M | 0028 |
| 3 | FX4-sv | Stone Vanguard ability effects | Studio | FX1 | M | none |
| 3 | FX4-td | Tide Duelist ability effects | Cloud | FX1 | M | none |
| 3 | FX4-ea | Ember Artificer ability effects | Studio | FX1 T21 | M | none |
| 3 | FX5 | Capture camera tracks and reduced motion | Cloud | FX1 | S | 0029 |
| 3 | T29 | Security hardening (existing spec row) | Cloud | T22 | M | 0030 |
| 4 | T30 | Performance pass (existing spec row) | Studio | ART1 ART2 FX4-* | M | 0031 |
| 4 | DEV1 | iPad device check session (owner-run checklist) | Owner | T30 | M | none |
| 5 | T32 | Release candidate (existing spec row) | Cloud | T29 T30 T31 DEV1 | M | none |

The old T26 is retired: FX0 to FX5 replace it (decision 0021 records the split). T31 is done.

Each wave is fully parallel:
- Wave 1 runs up to 6 agents: 3 Studio (B1, B2, ART1) and 3 Cloud (SPD1, FX0, T21).
- Wave 2 runs 5: Studio FX1 and ART2, Cloud FX2, FX3 and T22.
- Wave 3 runs 5.

A slice may start as soon as its own dependencies are merged; it does not have to wait for the whole wave.

### Shared hot files (the reason for the lanes)
- `docs/tasks.md`: each slice edits only its own row. Merge conflicts there are expected and trivial; keep both rows.
- `assets/manifest.json` (and the regenerated glTF files): B1, ART1 and ART2 each regenerate them. After merging any of
  these, run `pnpm assets:build` once on the merged tree and commit `Assets: regenerate manifest after merge`.
- `apps/client/src/main.ts`: only FX0 edits it in waves 1 and 2. FX1, FX2 and FX3 hook in through FX0's bus.

## 3. Rules for every slice

1. Start every shell with `export PATH="$HOME/.local/node24/bin:$PATH"`. Never edit `pnpm-lock.yaml` and never add
   packages. `three/examples/jsm/*` loaders already ship inside the installed `three` package and are allowed.
2. Branch: Studio `studio/<slice-id-lowercase>`, Cloud `claude/<slice-id-lowercase>`, cut from `origin/main`. Push only
   that branch (`git push -u origin HEAD`). Never push to main. Studio worktrees live inside the project, never directly
   in `~/Projects`: `git worktree add .worktrees/<slice-id-lowercase> -b studio/<slice-id-lowercase> origin/main`.
   `.worktrees/` and `vendor-src/` are gitignored. When the slice is pushed, remove the worktree with
   `git worktree remove .worktrees/<slice-id-lowercase>`.
3. Edit only the files your slice lists under "Owns". If you need any other file, **stop and report** which file and why.
4. Decision record: `docs/decisions/<number>-<slug>.md` using the number in the table. Do not use another number.
5. Before committing, run `pnpm verify` (must exit 0) and `pnpm test:browser`. On a Mac, set
   `EB_CHROMIUM=$(ls -d ~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/* | head -1)`.
   Run `pnpm assets:audit` if you touched `assets/`. Write `docs/test-results/<ID>.md` with real results only. Any
   iPad check is `NOT RUN`.
6. Update only your row in `docs/tasks.md`. Add rows for new IDs under a new heading `## Backlog v2 slices`, in
   table order. A finished code slice with pending iPad checks is `IMPLEMENTED (DEVICE CHECK PENDING)`.
7. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
8. **Stop and report** instead of guessing when: a listed test fails twice for the same reason, the fix needs a file
   outside "Owns", a value in this file contradicts docs/spec.md in a way not listed here, or you reach about 50 steps.
9. Presentation never feeds back into simulation: no setTimeout damage, no client-side hit decisions, and every
   effect is driven by a confirmed server `combatEvent` or replicated state.

---

## M0 Merge T23 into main (owner)
`git checkout main && git pull && git merge --no-ff origin/studio/t23`. Two conflicts are expected. In `docs/tasks.md`
keep both T23 and T31 rows. In `tests/unit/projectile.test.ts`, if T20 removed the "ea stays empty until T20"
test, delete T23's edited version of it too. Then run `pnpm verify`. If it fails, stop and report. If it passes,
`git push origin main`.

---

## B1 Fix limb bend and facing in the rig (Studio, decision 0019)
**Problem.** Fighters face -Z, so the eyes sit at z = -0.108 in `fighterDesign.ts`. Under the rig convention
(`rig.ts:7-9`), a positive X rotation swings a hanging limb toward -Z (forward), but the poses were authored with the
opposite sign. Knees bend forward, elbows bend backward, a "forward" lean leans back and a crouch kicks the thighs
behind. Together this reads as walking backwards.

**Owns.** `packages/shared/src/rig.ts`, `tests/unit/rig-pose.test.ts` (new), `assets/fighters/*.gltf`,
`assets/manifest.json` (regenerated only), `docs/decisions/0019-rig-x-rotation-sign.md`, `docs/test-results/B1.md`.

**Steps.**
1. Write `tests/unit/rig-pose.test.ts` first. It must fail on the current code. Using forward kinematics over the
   `BONES` rest offsets (`boneRestWorld` plus pose rotations), assert for every clip from `buildKitClips(kit)`, every
   kit and every keyframe:
   - (a) Knee: the ankle's z is never less than the knee-hip line's z by more than 0.02 m. The shin never swings in
     front of the thigh line.
   - (b) Elbow: the hand is never more than 0.02 m behind (+Z of) the shoulder-elbow line.
   - (c) For `m1.1` to `m1.4` at their active key, the striking hand's z is less than the chest z minus 0.25. The
     punch lands in front.
   - (d) For `dashFront`, the head z is less than the hips z. It leans forward.
2. Run the test and confirm it fails on (a), (b) and (d).
3. Fix in one place: in `buildClip` (the function that turns a `Pose` into tracks), negate the X component of every
   bone rotation before building the quaternion. Do not edit the individual pose tables.
4. Re-run the test. If it passes, go on. If any invariant still fails after the single negation, **stop and report**
   which clip and bone, and do not hand-tune poses.
5. Run `pnpm assets:build` to regenerate the glTF files and the manifest, then `pnpm assets:audit`.
6. Take a Playwright screenshot of a walking fighter in practice (reuse the T25 screenshot test pattern) and attach its
   path in B1.md.

**Done.** The four invariants pass for all three kits and `pnpm verify` exits 0.
**Commit.** `B1: fix rig X rotation sign so knees, elbows and leans bend the right way`

---

## B2 Fighter view follows kit changes (Studio)
**Problem.** `GameLoop.syncState` calls `scene.addFighter(key, toKit(p.kitId))` only the first time it sees `key`. A
player whose `kitId` changes afterwards (lobby ready, `changeKit` from the HUD, or `kitId` arriving after the first
patch) keeps the old model forever on that client, so two clients can render the same player differently.

**Owns.** `apps/client/src/app/GameLoop.ts`, `apps/client/src/scene/GameScene.ts` (only `addFighter` and a new
`kitOf(id)` getter), `tests/unit/gameloop-kit.test.ts` (new), `tests/browser/kit-sync.spec.ts` (new),
`docs/test-results/B2.md`.

**Steps.**
1. Reproduce first. Open two Playwright contexts. Context A joins with `?kit=sv`, context B with `?kit=td`. Read each
   page's views through the existing debug hook if one exists (`rg -n "__eb|debug" apps/client/src`). If none exists,
   add `window.__ebViews = () => [...]` (id, kitId), exposed only when `debug=1`, in `GameScene.ts`. Record in B2.md
   which kit each page shows for each player and which one rendered "white".
2. Fix in `syncState`. Keep `Map<string, KitId>` `knownKit`. If `p.kitId` is not a valid `KitId`, skip creating the
   view this tick, so that no default is guessed. If the kit differs from `knownKit.get(key)`, call `addFighter` again;
   it already disposes the old view. Remove `toKit`'s silent fallback if it has one, and log once at debug level
   instead.
3. Unit test with a fake scene: a player appears with `""`, then `"sv"`, then `"td"`. Expect no view for `""`, one
   build for `sv`, a rebuild for `td`, and exactly one dispose.
4. The browser test asserts that both pages report the same `kitId` for every player and that it equals the server
   state, both after join and after B sends `changeKit`.

**Done.** Both tests pass, and both pages agree after join and after a kit change.
**Commit.** `B2: rebuild fighter view when replicated kit changes; never guess a kit`

---

## SPD1 Faster movement (Cloud, decision 0020)
**Owner requirement:** "characters should move a bit faster". This overrides the D values in spec section 11 (authority
1). Combat timing, dashes, projectiles and hitboxes do not change.

| Value (`COMBAT.movement`) | Old | New |
|---|---|---|
| walk | 5 | 7 |
| run | 8 | 11 |
| guard | 2 | 3 |
| acceleration | 45 | 70 |

**Owns.** `packages/shared/src/config/combat.ts` (the `movement` block only), `apps/client/src/scene/FighterAnim.ts`,
tests that assert the old numbers, `docs/decisions/0020-faster-movement.md`, `docs/test-results/SPD1.md`.

**Steps.**
1. Change the four values.
2. In `FighterAnim.ts`, replace `RUN_SPEED = 6` with `(COMBAT.movement.walk + COMBAT.movement.run) / 2`, which gives
   9, so walking at 7 does not show the run clip.
3. Find every test asserting 5, 8, 2 or 45 (`rg -n "walk|run|acceleration" tests`) and update it to read from
   `COMBAT` rather than literals.
4. If a combat test fails for reasons other than the literal speed (for example a chase or range test), **stop and
   report**.
5. Add an entry to docs/spec.md section 29 "deviations": "Movement speeds raised by owner request, decision 0020".

**Done.** Server prediction and client prediction both use the new values (both import `COMBAT`), and
`tests/unit/movement*` passes at the new numbers.
**Commit.** `SPD1: raise walk/run/guard speed and acceleration by owner request`

---

## FX0 Combat event contract and presentation bus (Cloud, decision 0021)
This slice is the shared foundation that lets FX1, FX2 and FX3 run in parallel without touching the same files.

**Owns.** `packages/shared/src/protocol.ts` (the `CombatEvent` block and its runtime schema only),
`apps/server/src/sim/TickPipeline.ts` (the event-mapping block around line 306 only),
`apps/server/src/rooms/ArenaRoom.ts` (`broadcastEvent` only), `apps/client/src/main.ts` (the `combatEvent` handler only),
new files `apps/client/src/app/CombatBus.ts`, `apps/client/src/fx/index.ts`, `apps/client/src/fx/HitFx.ts`,
`apps/client/src/fx/CombatText.ts` and `apps/client/src/fx/Sfx.ts` (the last three are stubs),
`tests/unit/combat-bus.test.ts`, `tests/integration/fx0-events.test.ts`, `docs/decisions/0021-presentation-events.md`,
`docs/test-results/FX0.md`. T21 must not edit these blocks during wave 1. This rule goes in the T21 prompt.

**Contract.** Add optional fields to `CombatEvent`, without renaming or removing any:
```ts
hitClass?: "light" | "heavy";   // on "hit": heavy when damage100 >= 1000, or the move is an m1 finisher, or form is Awakened
targetHp100?: number;           // on "hit" and "heal": victim HP after the event
kind: ... | "heal";             // added to CombatEventKind; emitted by T22 later, never invented here
```
Every accepted ability commit must already emit `"cast"` with `moveId`. Verify this. If a slotted, awakened or
contextual move commits without a `"cast"` event, add the emit in the TickPipeline mapping block.

**Client bus.** `CombatBus` subscribes once to `ServerMessage.combatEvent` and deduplicates by `eventId`, keeping a
ring buffer of the last 512. It ignores events whose `lifeId` is older than the target's current life, then fans out
to listeners. `fx/index.ts` exports
`registerPresentation(bus, deps: { scene, camera, players, settings, localId })`, which calls `HitFx.attach`,
`CombatText.attach` and `Sfx.attach`. Each stub returns a no-op disposer. `main.ts` calls `registerPresentation` once
per match and pushes its disposer into `matchCleanups`. Keep the existing KO and respawn handling, moved onto the bus.

**Tests.**
- Unit: a duplicate `eventId` is delivered once, a stale life is dropped, and dispose unsubscribes.
- Integration with 2 real clients: one hits the other, and both receive the same `eventId` with `hitClass`,
  `targetHp100` and `moveId` set.

**Commit.** `FX0: combat event fields, deduplicating client bus and presentation stubs`

---

## FX1 Hit impact effects (Studio, decision 0024)
**Intent (core game feel).** Every confirmed contact must read instantly, and differently for each outcome, on both
screens.

**Owns.** `apps/client/src/fx/HitFx.ts`, `apps/client/src/scene/EffectsPool.ts`, `apps/client/src/scene/FighterView.ts`
(only adding the `flash(color, ms)` and `freeze(frames)` methods), `apps/client/src/scene/CameraRig.ts` (only adding
`shake(amplitude, ms)`), `tests/unit/hitfx.test.ts`, `tests/browser/hitfx.spec.ts`, decision 0024, `docs/test-results/FX1.md`.

| Event | Particles at `position` (fallback: target chest, y + 0.3) | Victim flash | Other |
|---|---|---|---|
| hit, light | 10 white-orange sparks (`#ffd9a0`), 0.25 s | red `#ff3b3b`, 90 ms | none |
| hit, heavy | 24 red-orange sparks (`#ff6a2a`) plus an expanding ring of 1.2 m radius, 0.35 s | red, 140 ms | hitstop: attacker and victim `freeze(4)`; camera `shake(0.35, 180)` if the local player is involved |
| block | cyan shield arc `#5fd8ff` in front of the victim, 0.2 s | none | small `shake(0.1, 80)` for the local player only |
| counter | gold burst `#ffcc33` plus a ring | gold, 160 ms on the countered attacker | `freeze(6)` on both |
| heal | 12 green motes `#4dff88` rising 1 m, 0.6 s | green, 200 ms | none |
| ko | dust puff and a light column, no gore | none | none |

**Rules.**
- `EffectsPool` becomes a real pool. Pre-allocate per quality: low 200, medium 600, high 1000 particles in one
  `InstancedMesh` (one draw call). Each particle has an expiry in render seconds. When the pool is full, drop the
  oldest decorative particle.
- `flash` multiplies the body material's emissive by `settings.flashLevel`.
- `freeze` sets the mixer `timeScale` to 0 for N render frames. It is visual only and never touches positions or
  ticks.
- `shake` multiplies by the camera-shake setting (default 0.25) and is disabled under Reduced Motion.
- Effects are triggered only by bus events, never by predicted local input.

**Tests.**
- Unit: pool cap, expiry and dispose; the flash amount scales with `flashLevel`; Reduced Motion produces zero shake.
- Browser: in practice, hit the dummy and assert the pool's `activeCount > 0` and the victim's `flashing === true`
  within 2 frames of the event.

**Commit.** `FX1: pooled hit, block, counter, heal and KO impact effects with flash, hitstop and shake`

---

## FX2 Combat text: damage numbers, power callouts, KO feed (Cloud, decision 0025)
**Owner requirement** overrides spec section 9's "Damage numbers default off" (authority 1). Text always comes with
colour, which satisfies the "colour reinforced with text" rule.

**Owns.** `apps/client/src/fx/CombatText.ts`, `apps/client/src/fx/CombatTextFormat.ts` (new, pure),
`apps/client/src/app/SettingsStore.ts` (adding keys and a schema version bump with migration),
`apps/client/src/ui/Settings.ts` (two controls), `tests/unit/combat-text-format.test.ts`,
`tests/unit/settings-migrate.test.ts`, `tests/browser/combat-text.spec.ts`, decision 0025, `docs/test-results/FX2.md`.

**Behaviour.** A DOM overlay with pooled elements, at most 24 active, positioned each frame by projecting world to
screen.

| Trigger | Text | Colour and style | Where | Life |
|---|---|---|---|---|
| hit | `-N` (N = damage100 / 100, one decimal only if fractional) | red `#ff4d4d`; heavy is 1.4x size and bold | above the victim's head, rising 0.6 m | 0.9 s |
| heal | `+N` | green `#4dff88` | above the target | 0.9 s |
| block | `BLOCK` | `#9fd8ff` | above the victim | 0.7 s |
| counter | `COUNTER!` | gold `#ffcc33`, bold | above the counterer | 1.0 s |
| cast | the move's shipped label (`AbilityDef.label`, for example "Ember Orb") | pill in the caster kit's accent colour, white text | above the caster; the local player's own casts also show bottom-centre | 1.2 s |
| ko | `A KO'd B · <move label>` | white on a dark pill | KO feed at top right, max 4 lines | 4 s |
| local player hit from outside the screen | red edge arc toward the attacker | 40% opacity | screen edge | 0.5 s |

**Settings.** Bump the schema version.
- `damageNumbers: boolean`, default `true`.
- `combatText: "all" | "mine" | "off"`, default `"all"`. `"mine"` shows only events where the local player is the
  actor or target.

The migration fills defaults for older saves. Under Reduced Motion, text fades without rising. Only bus events
create text; predicted casts never do.

**Tests.**
- Unit, format: damage rounding, heavy styling, the label lookup for every shipped ability ID (no ID without a label),
  and the `"mine"` filter.
- Unit: settings migration from the previous version.
- Browser: hitting the dummy shows `-3` red text, and casting a skill shows its label.

**Commit.** `FX2: damage numbers, power callouts, block/counter words and KO feed`

---

## FX3 Audio bus and original synthesized sounds (Cloud, decision 0026)
**Owns.** `apps/client/src/fx/Sfx.ts`, `apps/client/src/audio/AudioBus.ts` (new), `apps/client/src/audio/synth.ts` (new,
pure parameter tables), `tests/unit/audio-bus.test.ts`, decision 0026, `docs/test-results/FX3.md`.

**Rules (spec section 23).**
- Unlock the AudioContext on the Play button.
- At most 16 one-shots at a time. Priority: hits on the local player, then nearby major abilities, then everything
  else. Steal the lowest-priority, oldest voice.
- Distance attenuation reaches 0 at 45 m.
- One `DynamicsCompressorNode` on the master bus. The effects and music sliders come from settings.
- Deduplication is inherited from the bus.

**Sounds.** All sounds are generated with WebAudio oscillators, noise buffers and envelopes. No sample files and no
recordings; this makes them original by construction. Each kind gets one distinct recipe: light hit, heavy hit, block,
counter, heal, KO, and a cast sound per element (stone = low noise thud, water = filtered noise swell, heat = rising saw
with a crackle).

**Tests.** Unit with a fake AudioContext: the voice cap, priority stealing, attenuation at 0, 22.5 and 45 m, and no
sound before unlock. Mark browser audio audibility `NOT RUN`; it needs a person to listen.

**Commit.** `FX3: audio bus with voice cap, attenuation and synthesized original combat sounds`

---

## FX4-sv / FX4-td / FX4-ea Ability effects per kit (Studio, Cloud, Studio)
These are three independent slices with identical structure. FX4-ea also needs T21.

**Owns (per kit, where `<kit>` is sv, td or ea).** New file `apps/client/src/fx/kits/<kit>.ts`, one line registering it
in `apps/client/src/fx/index.ts` (expect a trivial merge conflict on that line), `tests/unit/fx-<kit>.test.ts`,
`docs/test-results/FX4-<kit>.md`.

**For every shipped `<kit>.*` ability.**
- Windup telegraph, keyed on the replicated action `Windup` and its `moveId`. Area moves get a ground decal sized from
  the ability definition's shape (`radius` or `box`). Projectiles get a charging glow at the hand. The telegraph is
  never hidden by quality scaling.
- Active effect keyed on the action `Active`.
- Impact effect keyed on a bus `hit` with that `moveId`. Use the FX1 pool.
- Element language from spec section 23: stone uses fans and circular fractures, water uses ribbon arcs, heat uses
  rings and heat particles.
- Each effect has an expiry, and nothing covers the full screen.

**Test.** For every shipped ability ID of the kit, the module returns a recipe (no missing IDs), and every recipe's
particle count fits the low-quality cap.

**Commit.** `FX4-<kit>: windup telegraphs, active and impact effects for every <kit> ability`

---

## FX5 Capture camera and reduced motion (Cloud, decision 0029)
**Owns.** `apps/client/src/scene/CameraRig.ts` (a new `playTrack` method; FX1's `shake` stays as is),
`apps/client/src/fx/CaptureCam.ts` (new), `tests/unit/capture-cam.test.ts`, decision 0029, `docs/test-results/FX5.md`.

**Behaviour.** This implements spec section 9's "cinematic". A captured participant gets a short original camera
track, ≤1.2 s, orbiting 30° with the distance eased to 4.5 m. Other players keep normal control. Cancel immediately on
death, respawn, disconnect, menu or dispose. Reduced Motion turns tracks off.

**Tests.** Every cancel trigger works, and Reduced Motion produces no track.

**Commit.** `FX5: capture camera tracks with full cancel rules`

---

## ART0 Art source decision (owner, before ART1 and ART2)
The art is currently built in code from primitive shapes, so it can only improve so far that way. The owner picks one:
- **A (recommended for the environment).** Use CC0 3D packs for the environment (static meshes: terrain pieces, rocks,
  trees, ruins, props). The owner downloads them; agents must not download files. They go under
  `assets/vendor/<pack>/` with each pack's license file, and the manifest records license CC0, author and source URL.
  This is a large quality jump at low risk, because static meshes need no rigging.
- **B (recommended for characters).** Keep the code rig and its 84 authored clips, but replace the boxes with smooth,
  higher-resolution generated meshes: blended skin weights at joints, rounded proportions, cloth and armour layers,
  and generated textures (the subject of ART2). Imported character packs would need clip retargeting for every ability,
  which is too risky for low-effort agents.
- **C.** Commissioned or hand-authored DCC models later. This is out of the agent scope.

ART1 assumes A and ART2 assumes B. If the owner rejects A, ART1 falls back to a code-built upgrade: higher-subdivision
terrain, vertex-noise colour, instanced foliage, a water plane and a sun disc.

**ART0 resolved (owner, 2026-11-01): A for the environment, B for the characters.**
- **Primary pack (on disk, verified).** Quaternius "Stylized Nature MegaKit", the free Standard tier, CC0 1.0. It is
  at `~/Projects/battlegrounds_game/vendor-src/Stylized Nature MegaKit[Standard]/`, with 68 `.gltf` files in `glTF/`, the shared PNGs in
  `Textures/`, and the license in `License_Standard.txt`. Use this pack for trees, plants, flowers and rocks.
  `vendor-src/` is gitignored and exists only on the Studio, so ART1 must run on the Studio.
- **Secondary pack (on disk, verified).** Kenney "Nature Kit" 2.1, CC0. It is at `~/Projects/battlegrounds_game/vendor-src/kenney_nature-kit/`,
  with 329 `.glb` files in `Models/GLTF format/` and the license in `License.txt`. Use this pack for terrain edges,
  cliffs, bridges, fences and camping props where the Quaternius pack has no equivalent. Do not mix the two styles on
  the same object type.
- The folder names contain spaces and brackets, so always quote the paths.
- **What ART1 copies into the repo.** The ART1 agent copies only the models it uses into `assets/vendor/<pack>/`,
  together with the pack's license or readme file. The copied subset must stay within the ≤15 MB P0 asset budget.
  The full zips are never committed.
- **Recording each model.** Each copied file gets a manifest entry with license `CC0-1.0`, the author (`Quaternius` or
  `Kenney`), the pack page as `sourceURL`, and `creationMethod: "third-party CC0 pack"`. This means T25's statement in
  decision 0015 #8 ("no third-party material") no longer holds for environment art; record that in decision 0023.
- **When to stop.** If `~/Projects/battlegrounds_game/vendor-src/Stylized Nature MegaKit[Standard]/glTF/` contains no `.gltf` files, ART1
  stops and reports.

## ART1 Environment art upgrade (Studio, decision 0023)
**Owns.** `apps/client/src/scene/ArenaView.ts`, `apps/client/src/scene/EnvAssets.ts` (new, loads glTF files with
`three/examples/jsm/loaders/GLTFLoader.js`), `apps/client/src/scene/GameScene.ts` (only the lights block, the sky, and
optional bloom on high quality), `assets/vendor/**`, `assets/manifest.json`, `ops/scripts/build-art.ts` (only the vendor
manifest entries), `tests/unit/arena-visuals.test.ts`, `tests/browser/arena-screens.spec.ts`, decision 0023,
`docs/test-results/ART1.md`.

**Rules.**
- One visual mesh per collider stays exactly aligned. The test compares each collider's AABB with its mesh AABB
  within 0.05 m.
- Dressing (trees, rocks, ruins) goes only outside the walkable area or on the tops of non-walkable colliders, and is
  instanced.
- Budgets: ≤120 draw calls and ≤150k visible triangles on medium, ≤15 MB total P0 assets.
- Bloom and SSAO are allowed only on high quality. Low quality has no full-screen post-processing.
- Loading is asynchronous but finishes before Play is enabled. On a load failure, fall back to the current code-built
  arena and log once.

**Tests.** The collider alignment test, a budget test that reads `renderer.info` in the browser after the first
frame, and before/after screenshots at 1024x768 and 1180x820.

**Commit.** `ART1: environment art from CC0 packs with exact collider alignment and budgets`

## ART2 Character art upgrade (Studio, decision 0027, after B1)
**Owns.** `packages/shared/src/fighterDesign.ts`, `apps/client/src/scene/FighterModel.ts`,
`apps/client/src/scene/FighterView.ts` (keep FX1's `flash` and `freeze` methods and every public method),
`ops/scripts/build-art.ts`, `assets/fighters/*`, `assets/manifest.json`, `tests/unit/fighter-model.test.ts`, decision
0027, `docs/test-results/ART2.md`.

**Rules.**
- Same rig, same clip IDs and the same 1.8 m capsule footprint. The test bounds mesh extents to the capsule plus 0.25 m.
- Mesh parts:
  - Rounded boxes: 2-3 segments with beveled edges.
  - Limbs: tapered capsules with ≥12 radial segments.
  - Joints: two-bone blended weights over a 0.06 m band at elbows, knees, shoulders and hips, so there are no gaps when
    bent. Test this at 90° knee and elbow flexion.
  - Hands: palms plus a thumb.
  - Faces: brows and a mouth.
  - Each kit gets distinct armour and cloth layers.
- Generated textures: a 512² `DataTexture` per kit holding the colour atlas, with a 1024 maximum.
- Each kit keeps a silhouette readable at 20 m: unique shoulder and back shapes and an accent glow.
- Budget: ≤8k triangles per fighter on medium, with a ≤3k triangle low-quality level of detail.

**Tests.** Extents, joint-gap invariant, triangle budget per quality, `assets:audit`, and before/after screenshots.

**Commit.** `ART2: smooth skinned fighter meshes with blended joints, textures and LOD`

---

## Existing spec rows still open
For each of these, the spec row in docs/spec.md section 27 plus AGENTS.md is the full spec. The additions below apply
on top.
- **T21 Artificer awakening (Cloud, decision 0022).** Add to the prompt: "Do not edit the FX0-owned blocks in
  `protocol.ts`, the TickPipeline event mapping or `ArenaRoom.broadcastEvent`. Emit events through the existing
  helper." Also make Artificer selectable in the lobby (`P0_KITS` and the lobby list) once a3/a4 exist, and add the
  missing clips to `abilityClipIds`.
- **T22 Passives (Cloud, decision 0028).** Emit `kind: "heal"` events (FX0 contract) for every heal.
- **T29 Security hardening (Cloud, decision 0030).** Spec row only.
- **T30 Performance pass (Studio, decision 0031).** Measures with the new art and effects. The adaptive quality
  controller from spec section 24 is part of it.
- **DEV1 iPad device session (owner).** One sitting with both iPads that runs D01 to D10 from docs/spec.md section 26
  and the O01 to O08 rows in `docs/reference-observations.md`, and records results in `docs/test-results/DEV1.md`. Every
  `IMPLEMENTED (DEVICE CHECK PENDING)` row can then move to DONE.
- **T32 Release candidate (Cloud).** Spec row only.
