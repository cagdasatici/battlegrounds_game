# 0021 Presentation events and the client combat bus

Status: accepted (FX0).

- **Contract.** `CombatEvent` gains optional `hitClass` ("light" | "heavy") and `targetHp100`, and `CombatEventKind`
  gains `"heal"` (emitted by T22 later; nothing emits it in FX0). No field is renamed or removed.
- **hitClass.** Set by the TickPipeline mapping block on `"hit"` only: heavy when `damage100 >= 1000`, the move is the
  `m1.4.finisher`, or the attacker's form is Awakened; otherwise light. `targetHp100` is the victim HP after damage.
  Both are computed on the server; clients never decide them.
- **Casts.** Every accepted commit already emits `"cast"` with `moveId` (M1 update, skillDown and buffered skills,
  awakening, contextual moves all pass through those paths). No emit was added.
- **Bus.** `apps/client/src/app/CombatBus.ts` subscribes once to `ServerMessage.combatEvent`, deduplicates by `eventId`
  (ring of 512), drops events whose `lifeId` is older than the subject's replicated life (target, else actor), then fans
  out. `fx/index.ts` `registerPresentation` attaches HitFx, CombatText and Sfx (stubs until FX1, FX2, FX3).
- **Rule.** Presentation never feeds back into simulation: no timers that decide damage, no client hit decisions.
