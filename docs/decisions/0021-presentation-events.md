# 0021 Presentation events and the retirement of T26

Status: accepted. Slice FX0.

## Decision
- Old task T26 (Effects audio and camera) is retired and split into slices FX0 to FX5 (docs/backlog-v2.md).
- `CombatEvent` gains optional `hitClass` ("light" | "heavy") and `targetHp100` (victim HP after the event), and
  `CombatEventKind` gains `"heal"` (emitted by T22 later, never by FX0). No existing field is renamed or removed.
- `hitClass` is "heavy" when `damage100 >= 1000`, the move is an m1 finisher (`m1.4.finisher`), or the attacker is
  Awakened; otherwise "light". Computed on the server in `TickPipeline.reportHit`; `targetHp100` is the victim HP after
  damage is applied.
- Every accepted skill, awakening and m1 commit already emits `"cast"` with `moveId` (`reportSkill`, buffered consume,
  m1 start, recast). Dash is not an ability commit and emits no `"cast"`; its hits carry `moveId` such as `dash.forward`.
- Client: `CombatBus` is the single `combatEvent` subscription. It deduplicates by `eventId` (ring of 512), drops events
  whose `lifeId` is older than the subject's current life, and fans out. `registerPresentation` attaches the HitFx,
  CombatText and Sfx stubs (no-op disposers) and is cleaned up with the match. KO and respawn handling moved onto the bus.
- Presentation never feeds back into simulation (backlog rule 9).

## Consequences
FX1, FX2 and FX3 each edit only their own file in `apps/client/src/fx/`.
