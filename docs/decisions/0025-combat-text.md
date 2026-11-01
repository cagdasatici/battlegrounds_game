# 0025 Combat text (FX2)

Status: accepted. Slice FX2.

## Conflict
Spec section 9 says damage numbers default off. The owner requires damage numbers, power callouts and a KO feed
(explicit user requirement, authority 1). Text is always paired with colour, which satisfies "colour reinforced with text".

## Decision
- `CombatText` is a DOM overlay (pooled elements, at most 24 active) fed only by `CombatBus` events, projected to screen
  each animation frame. `CombatTextFormat.ts` is pure and holds the text, colour, life and filter rules.
- Settings schema v2 adds `damageNumbers` (default true) and `combatText` ("all" | "mine" | "off", default "all").
  Version 1 saves migrate by filling both defaults; the storage key prefix is unchanged.
- Cast text needs the move label, so only ability ids with an `AbilityDef.label` show cast pills. Events with no label
  (m1 steps, dash) show none. Events carrying lifeId 0 are not relied on.
- Reduced Motion: text fades without rising. Timing is wall clock presentation only; nothing feeds the simulation.

## Consequences
`tests/unit/settings-store.test.ts` and `tests/browser/settings.spec.ts` each had one assertion on the schema version
updated from 1 to 2.
