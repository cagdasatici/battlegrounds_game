# Backlog v3 — stability, situational awareness and solo practice

Source: [review 2026-11-03](reviews/2026-11-03-principal-and-ux-review.md). Baseline main 2220911.
Executor profile: Sonnet 5.5 Low / Sol 6.1 Light. One slice per session. Follow AGENTS.md.

## Rules for every slice

1. Read AGENTS.md, this slice, and every file listed under **Files** before editing. Touch no other file except
   `docs/tasks.md` and the slice's test report.
2. Write the listed tests first; confirm they fail for the stated reason; then implement.
3. Run, in order: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Run `pnpm test:browser` only when the
   slice lists a browser spec. Record real output in the test report. Never claim a result you did not see.
4. Commit with the given subject plus the attribution line. Push with `git push -u origin HEAD`.
5. Update the slice row in `docs/tasks.md`: status, commit hash, report path. Client-visible slices end as
   `IMPLEMENTED (DEVICE CHECK PENDING)` with "iPad NOT RUN".
6. **Stop and report** (do not improvise) whenever a slice says so, or when an unlisted existing test fails.
7. New client presentation goes in a new module under `apps/client/src/ui/` with a pure layout function and a thin DOM
   class. `apps/client/src/main.ts` only constructs, wires and disposes it inside `enterMatch` via `matchCleanups`.
8. Presentation may use render time (`performance.now()`) for fades. It must never change gameplay state.

## Order

REL01 → REL02 → UX11 → UX12 → UX13 → BOT6 → UX14 → HYG01. OPEN01 and MODE01 wait for owner approval.

---

## REL01 — Contain tick exceptions

**Why:** one throw inside `TickPipeline.step` currently has no handler (review E1).
**Commit:** `REL01: contain tick exceptions and fault the room cleanly`
**Files:** `apps/server/src/rooms/ArenaRoom.ts`, `apps/server/src/main.ts`, `packages/shared/src/protocol.ts` (read
only, for close-code style), new `tests/integration/rel01-tick-fault.test.ts`.

### Behaviour

- In `ArenaRoom`, add a public field `faulted = false` and wrap the body of `stepTick`:

```ts
  /** One logical 60 Hz tick (spec sections 12 and 21 order lives in TickPipeline). */
  stepTick(tick: number): void {
    if (this.faulted) return;
    try {
      this.pipeline.step(tick);
    } catch (e) {
      this.faulted = true;
      log("error", "tick fault: room closed", { room: this.roomId, tick, error: e instanceof Error ? e.name : "unknown" });
      for (const c of this.clients) c.leave(4500);
      void this.disconnect();
    }
  }
```

- Log the error **name only** (no message, no stack in production logs: messages may embed state). Add one more line
  `if (process.env.NODE_ENV !== "production") console.error(e);` directly after the `log` call.
- In `apps/server/src/main.ts`, after the signal handlers, add:

```ts
process.on("uncaughtException", (e) => {
  log("error", "uncaught exception: shutting down", { error: e.name });
  void server.gracefullyShutdown(true).finally(() => process.exit(1));
});
process.on("unhandledRejection", (r) => {
  log("error", "unhandled rejection", { error: r instanceof Error ? r.name : typeof r });
});
```

- Client: in `apps/client/src/net/RoomClient.ts`, find the leave/close-code handling. If close code 4500 is not
  already mapped, map it to the existing generic "connection lost" path. Do not add new UI. If no close-code mapping
  exists at all, **stop and report** instead of inventing one.

### Tests (`tests/integration/rel01-tick-fault.test.ts`)

Use the same server bootstrap helper as `tests/integration/open-join.test.ts` (read it first and copy its setup).

1. Two real clients join one arena room. Monkey-patch the room instance's `pipeline.step` to throw on the next call.
   Assert both clients receive leave code 4500 within 2 s, and `room.faulted === true`.
2. A second room created before the fault keeps advancing `state.serverTick` after the first room faults.
3. Unit: calling `stepTick` on a faulted room does not call `pipeline.step` (spy count unchanged).

---

## REL02 — Reuse entity ids

**Why:** `entityId` is `uint8` and only increments (review E2).
**Commit:** `REL02: allocate the lowest free entity id per room`
**Files:** `apps/server/src/rooms/ArenaRoom.ts`, `apps/server/src/rooms/BotArenaRoom.ts`,
`apps/server/src/rooms/PracticeRoom.ts`, new `tests/unit/entity-id-alloc.test.ts`,
new `tests/integration/rel02-entity-reuse.test.ts`.

### Behaviour

- Add to `ArenaRoom` (replaces the `nextEntityId` field; delete that field):

```ts
  /** Lowest id in 1..255 not used by a replicated player. entityId is uint8 on the wire (PlayerSchema). */
  protected allocEntityId(): number {
    for (let id = 1; id <= 255; id++) if (!this.state.players.has(String(id))) return id;
    throw new Error("ROOM_FULL");
  }
```

- Replace every `this.nextEntityId++` with `this.allocEntityId()`: `ArenaRoom.onJoin`, `BotArenaRoom.addBots`,
  `PracticeRoom` (dummy). Use `rg -n nextEntityId apps tests` and fix all hits; there must be zero left.
- Ordering: in `BotArenaRoom.addBots`, call `allocEntityId()` and `this.state.players.set(...)` before allocating the
  next bot, so two bots in one call never get the same id (the existing code already sets before the next loop
  iteration; keep it that way).
- `lifeId` stays room-unique via `lifeSeq` — do not reuse lifeIds. That is what keeps stale combat events for a
  reused entity id from matching (client `CombatBus` compares lifeId). Add above `protected lifeSeq = 0;`:
  `// TODO(REL02): lifeId is uint16; lifeSeq wraps after 65,535 lives in one room instance. Widen if rooms become long-lived.`

### Tests

1. Unit (`entity-id-alloc.test.ts`): construct the state map directly through a tiny test subclass exposing
   `allocEntityId`; with ids {1,2,4} present returns 3; with 1..255 present throws `ROOM_FULL`.
2. Integration (`rel02-entity-reuse.test.ts`): in a practice room, send the existing practice bot-count message to
   set 3 bots and then 0 bots, 100 times. Assert every `entityId` in `state.players` is ≤ 255 and unique, and the
   human's own entityId is unchanged. Read `PracticeRoom.ts` for the message name and payload; do not guess.
3. Integration: client A joins (id 1), client B joins (id 2), A leaves, C joins → C gets id 1; B's HP and owner
   view are unaffected; a `hit` event sent to A's old lifeId is ignored by C's `CombatBus` (assert through the debug
   snapshot `eventCounts` or a direct `CombatBus` unit test, whichever the existing tests already use).

---

## UX11 — Nameplates, enemy HP and off-screen arrows

**Why:** players cannot see enemy health or off-screen threats (review X1, X2).
**Commit:** `UX11: world nameplates with HP and off-screen fighter arrows`
**Files:** new `apps/client/src/ui/Nameplates.ts`, `apps/client/src/main.ts` (wiring only),
new `tests/unit/nameplates.test.ts`, new `tests/browser/ux11-nameplates.spec.ts`.

### Pure layout (copy this API exactly)

```ts
export interface V3 { x: number; y: number; z: number }
export interface PlateFighter { id: string; name: string; hpFrac: number; pos: V3; local: boolean; alive: boolean; kitId: string }
export type Projected = { x: number; y: number; depth: number };
export type PlateOut =
  | { kind: "plate"; id: string; name: string; hpFrac: number; left: number; top: number; kitId: string }
  | { kind: "arrow"; id: string; left: number; top: number; angleRad: number; kitId: string };

/** Metres above capsule centre where the plate anchors. D value. */
export const PLATE_HEAD_OFFSET = 1.35;
/** Pixels between an arrow and the safe-area edge. D value. */
export const ARROW_MARGIN = 40;
export const NEAR = 0.1;

export function plateLayout(fighters: readonly PlateFighter[], project: (p: V3) => Projected, W: number, H: number): PlateOut[]
```

Rules, in order, per fighter:
1. Skip `local` and `!alive`.
2. `q = project({ x: pos.x, y: pos.y + PLATE_HEAD_OFFSET, z: pos.z })`.
3. If `q.depth > NEAR && |q.x| <= 1 && |q.y| <= 1`: plate at `left = (q.x + 1) / 2 * W`, `top = (1 - q.y) / 2 * H`.
4. Else arrow: `sx = q.x * W / 2`, `sy = -q.y * H / 2`; if `q.depth <= NEAR` then `sx = -sx; sy = -sy`;
   if `sx === 0 && sy === 0` then `sy = H / 2` (straight down = behind). `s = Math.min((W / 2 - ARROW_MARGIN) / Math.abs(sx || 1e-9), (H / 2 - ARROW_MARGIN) / Math.abs(sy || 1e-9))`;
   `left = W / 2 + sx * s`, `top = H / 2 + sy * s`, `angleRad = Math.atan2(sy, sx)`.
5. Output order equals input order.

### DOM class

`export class Nameplates { constructor(parent: HTMLElement, doc: Document); update(outs: readonly PlateOut[]): void; dispose(): void }`
- Pool one element per id; remove elements whose id is absent from `outs`. `pointer-events:none` on everything.
- Plate: name (12 px, 600, white, 1 px black text-shadow) above a 64×6 px bar; fill width `hpFrac*100%`; fill colour
  `#3fae6a` above 0.5, `#e8b84a` above 0.25, else `#e0503a`. Element `transform: translate(-50%,-100%)`.
- Arrow: 22 px CSS triangle rotated by `angleRad`, tinted by kit: `sv #c9a26b`, `td #4fb3e8`, `ea #ff7a3d`,
  fallback `#ffffff`. `data-plate` and `data-arrow` attributes carry the id (tests query them).

### Wiring in `enterMatch`

- Construct after `hud`: `const plates = new Nameplates(document.body, document); matchCleanups.push(() => plates.dispose());`
- In the existing `capFrame` rAF callback, after `captureCam.update(...)`, call:

```ts
      const rect = readSafeRect(window, probe);
      plates.update(plateLayout([...players().values()].map((p) => ({
        id: String(p.entityId), name: p.displayName, hpFrac: (p.hp100 ?? 0) / 10000,
        pos: { x: p.x / 100, y: p.y / 100, z: p.z / 100 }, local: p.owner !== undefined,
        alive: p.action !== "Dead" && p.ready !== false, kitId: p.kitId,
      })), (v) => R.projectPoint(cam.pose, v, g.camera.aspect), rect.W, rect.H));
```
  If `cam` or `probe` is declared after `capFrame` in the file, move only the `capFrame` declaration below them; do
  not reorder anything else. If projected plates are offset by the safe-area origin, add `rect.x0`/`rect.y0` to
  `left`/`top` inside `update`, not in `plateLayout`.
- Practice dummy gets a plate like any other fighter (that is useful). No setting toggle in this slice.

### Tests

Unit (`nameplates.test.ts`, use a stub `project`):
1. In-view fighter → one plate at the expected pixel.
2. `depth < 0` → arrow; `left`/`top` within `[ARROW_MARGIN-1, W-ARROW_MARGIN+1]` × `[ARROW_MARGIN-1, H-ARROW_MARGIN+1]`.
3. Point far right (x = 5) → arrow on the right edge (`left ≈ W - ARROW_MARGIN`).
4. Local and dead fighters produce nothing.
5. `Nameplates.update` twice with an id removed → its element is gone (use jsdom/happy-dom the same way existing
   UI unit tests do; check `tests/unit` for the pattern first).

Browser (`ux11-nameplates.spec.ts`): copy the two-context setup from the existing p0-gate spec. With both fighters
facing each other, assert one `[data-plate]` exists in each page. Set camera yaw by π via the existing debug hook
`__eb.setCameraYaw`; assert a `[data-arrow]` appears. Screenshot to the repo-root `test-results/` folder (gitignored),
not `docs/test-results/`.

---

## UX12 — Damage direction and low-HP state

**Why:** the local victim gets almost no "you are being hit, from there" signal (review X2, X3).
**Commit:** `UX12: damage direction arcs and low-health vignette`
**Prerequisite:** UX11 (reuses its arrow math).
**Files:** `apps/client/src/ui/Nameplates.ts` (export helper only), new `apps/client/src/ui/DamageCues.ts`,
`apps/client/src/main.ts` (wiring), new `tests/unit/damage-cues.test.ts`.

### Behaviour

- Extract step 4 of `plateLayout` into an exported pure function `edgePoint(q: Projected, W: number, H: number): { left: number; top: number; angleRad: number }`
  and make `plateLayout` call it. UX11 tests must still pass unchanged.
- `DamageCues` (pure part): `export function cueAngle(q: Projected): number` returns `edgePoint(q, 2, 2).angleRad`
  for any `q` (in view or not: the arc always sits on the edge facing the attacker).
- DOM part `class DamageCues { constructor(parent, doc); hit(angleRad: number, heavy: boolean, nowMs: number); frame(nowMs: number, hpFrac: number, reducedMotion: boolean); dispose() }`:
  - Up to 4 arcs live at once (drop oldest). Each arc: a 260 px wide, 24 px tall radial-gradient band
    (`rgba(224,80,58,0.85)` to transparent) placed on the screen edge at `angleRad`, rotated to face the centre.
    Opacity 1 → 0 linear over 600 ms (900 ms when `heavy`).
  - Low-HP vignette: full-screen `box-shadow: inset 0 0 120px rgba(160,0,0,A)` where A = 0 when `hpFrac > 0.3`,
    else `0.35 + 0.15 * sin(nowMs / 160)`; with `reducedMotion` A = 0.4 constant.
- Wiring: `bus.on` handler already filters events targeting the local player. Add: on `e.kind === "hit"` with a
  defined `e.actorId !== e.targetId`, look up the actor in `players()`, project its position with the same lambda as
  UX11 and call `cues.hit(cueAngle(q), e.hitClass === "heavy", performance.now())`. Call `cues.frame(...)` in
  `capFrame` with the local `hp100 / 10000` and `settings.get().reducedMotion`.

### Tests

1. `cueAngle` for an attacker straight behind (`depth < 0`, x = 0, y = 0) points down (`angleRad ≈ π/2`).
2. Attacker to the right in view → angle ≈ 0.
3. `DamageCues.hit` ×5 → 4 arc elements; after `frame(now + 1000)` → 0 arcs.
4. Vignette alpha is 0 at hpFrac 0.31 and constant 0.4 at hpFrac 0.1 with reducedMotion.

---

## UX13 — Radial cooldown rings and ready pulse

**Why:** cooldowns are 10 px text (review X4).
**Commit:** `UX13: radial cooldown sweep and ready pulse on skill buttons`
**Files:** `apps/client/src/ui/HudFormat.ts`, `apps/client/src/ui/Hud.ts`, `apps/client/src/main.ts` (one field),
`tests/unit/hud-format.test.ts` (extend; if the file has another name, find it with `rg -l cooldownLabel tests`).

### Behaviour

- Add to `HudFormat.ts`:

```ts
/** 0 = ready, 1 = just used. Clamped; `totalTicks <= 0` means no cooldown. */
export function cooldownFraction(endTick: number, nowTick: number, totalTicks: number): number {
  if (totalTicks <= 0) return 0;
  return Math.min(1, Math.max(0, (endTick - nowTick) / totalTicks));
}
```
- Add `cooldownFracs?: readonly number[]` to `HudState` (in `Hud.ts`). In `main.ts` `drawHud`, compute
  `cooldownFracs: skillDefinitions(kit, form).map((d, i) => cooldownFraction(me?.cooldownEndTicks?.[i] ?? 0, now, d.cooldown))`
  using `skillDefinitions` from `apps/client/src/ui/SkillInfo.ts`.
- In `Hud.render`, for boxes whose id starts with `skill` and index `i` (`Number(b.id.slice(5)) - 1`; confirm the id
  format in `HudFormat`/`hudModel` first): set `el.style.backgroundImage = conic-gradient(#0009 ${f*360}deg, transparent 0)`
  layered over the existing background colour when `f > 0`; clear it when `f === 0`.
- Ready pulse: when a slot's fraction goes from > 0 to 0 between renders, add class `eb-ready-pulse` for 400 ms
  (one CSS keyframe in `apps/client/src/ui/experience.css`: scale 1 → 1.12 → 1, border white). Skip the animation
  when settings `reducedMotion` is true (pass it in `HudState` as `reducedMotion?: boolean`).
- Keep the existing seconds text; raise its font to 13 px when the box is ≥ 64 px wide.
- Raise `hudTimer` from 100 ms to 50 ms. Nothing else about the interval changes.

### Tests

1. `cooldownFraction`: (end 120, now 60, total 120) = 0.5; past end = 0; total 0 = 0; before cast (end > now+total) = 1.
2. Hud unit (DOM): render with `cooldownFracs [0.5,0,0,0]` → `skill1` has a conic-gradient background image,
   `skill2` has none.
3. Render `[0.1,…]` then `[0,…]` → `skill1` has class `eb-ready-pulse`.

---

## BOT6 — Bots that use the whole kit

**Why:** bots are always Stone Vanguard and only walk, guard, M1 and slot 1 (review X5).
**Commit:** `BOT6: bots rotate kits and use dash, all four skills and awakening deterministically`
**Files:** `packages/shared/src/sparring.ts`, `apps/server/src/sim/SparringBrain.ts`,
`apps/server/src/rooms/BotArenaRoom.ts`, `tests/unit/sparring-brain.test.ts`, every file listed by
`rg -ln castSlot1 apps packages tests` (17 references at review time), new `tests/integration/bot6-full-kit.test.ts`.

### Contract change (`packages/shared/src/sparring.ts`)

Replace `castSlot1: boolean` in `BotDecision` with `castSlot: 0 | 1 | 2 | 3 | 4` (0 = none) and add
`dash: boolean; awaken: boolean; retreat: boolean`. Replace `slot1Ready: boolean` in `BotObservation` with
`slotsReady: readonly [boolean, boolean, boolean, boolean]` and add `meterFull: boolean`. Update the `neutral()`
helpers in both `SparringBrain.ts` and `BotArenaRoom.ts`.

### Decision rules (`decideBot`; keep it pure, no `Math.random`)

Keep the existing interval, reaction-delay and target-selection code unchanged. Let `k = Math.floor(age / interval)`
(the decision index). After computing `target`, `distanceSquared`, `inReach` (≤ 4) and `blockHeld` as today:

| Difficulty | Rule (first match wins) |
|---|---|
| all | `awaken = meterFull && difficulty !== "easy" && distanceSquared <= 36` |
| hard | target attacking and `distanceSquared <= 9` and `k % 2 === 1` → `dash = true; retreat = true; blockHeld = false` |
| medium, hard | `inReach` and not blocking → `castSlot` = first ready slot scanning from `1 + (k % 4)` cyclically; hard scans all 4, medium scans only slots 1 and 2 |
| easy | `inReach` and `slotsReady[0]` and `k % 3 === 0` → `castSlot = 1` |
| all | otherwise as today: `attackHeld = inReach && !blockHeld && castSlot === 0`; `approach = !inReach && !blockHeld && !retreat` |

When `retreat` is true, the room moves the bot **away** from the target for that decision (negated move vector).

### Room changes (`BotArenaRoom.ts`)

- Kit rotation: in `addBots`, set `const kit = P0_KITS[index % P0_KITS.length]` (import from `@eb/shared/protocol`)
  and use it for `p.kitId` and `this.combat.add(...)`.
- Observation: `slotsReady` = for slot 1..4, `f.action === "Idle" && def && (f.cooldowns.get(def.id) ?? 0) <= tick`
  where `def = this.abilities.registry.slotted(f.kitId, f.form, slot)`. **Exclude Ember Artificer Base slot 3**
  (charge hold): always `false` for `f.kitId === "ea" && f.form === "Base" && slot === 3`, with comment
  `// TODO(BOT6): charge-hold casts need skillDown/skillUp timing; bots skip ea Base slot 3.`
- `meterFull = f.meter100 >= meterRequired100(f.kitId)` (import from the module `Awakening.ts` uses).
- Edges, pushed exactly like the existing slot-1 edge: `castSlot > 0` → `{ kind: "skillDown", slot: castSlot }` followed by
  an immediate `{ kind: "skillUp", slot: castSlot }` with the next edge id **only if** the existing slot-1 path
  already sends skillUp somewhere; if it does not, send only skillDown as today. `dash` → `{ id, kind: "dash" }`,
  `awaken` → `{ id, kind: "awaken" }`. Movement for dash/retreat: `moveX = Math.sin(d.yaw); moveZ = Math.cos(d.yaw)`
  (negation of the approach vector), and the existing ledge-safety check still applies.
- Bot display names: `Bot ${index + 1}` stays. (Kit is visible from the model and UX11 arrow tint.)

### Tests

Unit (`sparring-brain.test.ts`; keep every existing case, rename `castSlot1` assertions to `castSlot`):
1. Hard, enemy attacking at distance 2, odd `k` → `dash && retreat && !blockHeld`; even `k` → `blockHeld`.
2. Hard, in reach, slots `[false,true,true,false]`, `k = 0` → `castSlot = 2`; `k = 2` → `castSlot = 3`.
3. Medium never casts slot 3 or 4.
4. Easy never dashes, blocks or awakens.
5. `meterFull` and distance 5 → `awaken` for medium/hard; distance 7 → no awaken.
6. Determinism: the same observation sequence yields byte-identical decisions twice (`JSON.stringify`).

Integration (`bot6-full-kit.test.ts`, real Colyseus client in a sparring or bot arena room with 3 hard bots):
1. `state.players` bot kits are `sv`, `td`, `ea`.
2. Run 3,600 ticks (60 s) with the human idle near the bots (use the existing tick-driving helper from
   `tests/integration/sparring-*.test.ts`). Collect `cast` events: assert at least 3 distinct `moveId` values per
   bot kit and at least one bot `dash` (read how dash is observable in existing tests; if it is not observable,
   assert via `action` sampling and say so in the report).
3. No bot stays in a charge/cast action > 600 ticks. If this fails, **stop and report**.

---

## UX14 — KO screen and scoreboard

**Why:** death overlay and scoreboard are plain text (review X6).
**Commit:** `UX14: KO card with killer details, respawn ring, quick fighter change and tabular scoreboard`
**Files:** `apps/client/src/ui/Hud.ts`, `apps/client/src/ui/HudFormat.ts`, `apps/client/src/main.ts`,
`apps/client/src/ui/experience.css`, Hud unit tests.

### Behaviour

- Extend `HudState.respawn` to `{ by: string; byKit: string; byHpFrac: number | null; seconds: number; frac: number }`.
  In `main.ts`, on the `ko` event store `actorId`; in `drawHud` fill `byKit` from `KIT_LABEL[actor.kitId]`, `byHpFrac`
  from the actor's current `hp100 / 10000` (null for "the arena"), and `frac = respawn remaining / COMBAT.respawnTicks`.
- KO card (replaces the text in `this.death`): centred card, title `Knocked out`, line `by ${by} · ${byKit}`, a 64 px
  HP bar for the killer when `byHpFrac !== null` with caption `${Math.round(byHpFrac*100)} HP left`, a 72 px ring
  (`conic-gradient`) driven by `frac` with the seconds number inside, and a `Change fighter` button
  (`data-ko-kit="1"`, min 44×200 px, `pointer-events:auto`) that calls the existing `onFighter` path (open the kit
  menu). The background wash stays.
- Scoreboard: build a real `<table>` (`thead`: Player, KO, Deaths, Assists) instead of `textContent`; numbers
  right-aligned with `font-variant-numeric: tabular-nums`; the local row bold with a left accent bar; rows sorted by
  KO desc, then deaths asc (check `scoreboardRows` already sorts; if so keep its order).
- Rebuild DOM only when the content key changes (same pattern as `kitKey`).

### Tests

1. Hud DOM: respawn state with `byHpFrac 0.34` → card contains `34 HP left` and a `[data-ko-kit]` button.
2. `byHpFrac null` → no killer bar.
3. Scoreboard renders a `table` with N+1 rows, local row has class `self`.
4. Clicking `[data-ko-kit]` invokes the fighter callback (spy).

---

## HYG01 — Stop tests from rewriting committed evidence

**Why:** routine runs dirty 30+ tracked files (review E4); stale `SPARRING_GUIDE_AVAILABLE` flag (E9).
**Commit:** `HYG01: write test artefacts to test-results unless EB_EVIDENCE=1`
**Files:** new `tests/browser/harness/evidence.ts`, every file from `rg -ln "docs/test-results" tests`,
`apps/client/src/main.ts` (lines 41-42 only).

- `evidence.ts`:

```ts
import path from "node:path";
import { mkdirSync } from "node:fs";
/** Evidence goes to docs/test-results only when EB_EVIDENCE=1 (slice reports); otherwise to gitignored test-results/. */
export function evidenceDir(root: string): string {
  const dir = process.env.EB_EVIDENCE === "1" ? path.join(root, "docs/test-results") : path.join(root, "test-results/evidence");
  mkdirSync(dir, { recursive: true });
  return dir;
}
```
- Replace each hard-coded `path.join(root, "docs/test-results")` (and inline `docs/test-results/...` paths) with
  `evidenceDir(root)`. Unit/integration tests that *read* committed reports (not write) stay untouched — check each
  hit; if a test reads and writes the same file, **stop and report**.
- Add one line to AGENTS.md under "Run pnpm typecheck…": `Set EB_EVIDENCE=1 only when refreshing a slice's evidence.`
- `main.ts`: confirm the Host sparring action is reachable in the welcome flow (`rg -n "Host sparring\|hostSparring" apps/client/src`).
  If it is, set `SPARRING_GUIDE_AVAILABLE = true` and delete the TODO; if not, leave both and say so in the report.
- Do not commit the currently modified evidence files; run `git checkout -- docs/test-results` **only after** asking
  the owner in the report whether those regenerated files should be kept. (Stop and report point.)
- Test: run `pnpm test` and `pnpm test:browser` without the env var; `git status --short docs/test-results` is empty.

---

## OPEN01 — Open-join session survives an IP change (OWNER DECISION REQUIRED)

**Conflict:** decision 0050 binds open sessions to the source-IP hash. Review E3 recommends dropping that binding
because Cloudflare Access already authenticates the person and the HttpOnly cookie identifies the browser.
**Do not implement until the owner records a new decision file approving it.**

Implementation once approved (`apps/server/src/http/sessionRoutes.ts`): in `/api/open-session`, reuse the existing
session when `existing && token && existing.displayName === parsed.data.displayName` (drop the `ipHash` comparison),
and update `existing.ipHash = ipHash`. Test: same cookie, new `x-forwarded-for` → 200 and same session id; a ticket
issued afterwards joins the same seat during the reconnect window.

## MODE01 — Optional "first to N KOs" rounds (OWNER DECISION REQUIRED)

**Conflict:** spec FFA rule says no timed round. MODE01 keeps open FFA as the default and adds an opt-in round
setting for hosted sparring and bot rooms only. **Needs a spec amendment decision before any code.**
Outline for the follow-up spec (not executable yet): room option `roundTarget: 0 | 5 | 10` (0 = endless);
server ends the round when any `kills` reaches the target, sets `state.phase = "roundOver"` for 600 ticks, freezes
inputs, broadcasts a `roundOver` event with standings, then resets `kills/deaths/assists` and respawns everyone.
Client shows a results card with a Rematch countdown. Tests: target reached → phase change at that tick, inputs
ignored during roundOver, scores reset, no damage events during roundOver.

## QD01 playtest additions

Add to the QD01 recording sheet: (1) "Did hits feel like they connected?" (hit stun off, decision 0049);
(2) "Could you tell how hurt the other player was?" (before/after UX11); (3) "Did you know who hit you?" (UX12).
