# 0028 Passives and heal events (T22)

Date: 2026-11-01. Status: recorded while implementing T22; reversible by a later spec edit. Numbers come from spec 15 and 16
unless marked D. Registry: `packages/shared/src/config/passives.ts`. Pipeline: `TickPipeline.payKillReward`.

## Rules chosen
1. **Reward registry.** `killRewardFor(kit, moveId)` is the single table: Tide Duelist heals (b1 35, b2 30, b3 20, b4 40,
   a1/a2/a3 50, a4 zero), Ember Artificer cooldown reset. `finisherHeal100` now reads the registry. Sonic Vanguard has no kill
   reward; its heals stay per ability (Skybreak 60, Horizon Break full or far heal, Stillpoint Reversal, cinematic grab).
2. **One per victim life.** The existing `RespawnSystem.claimReward(victimLifeId)` is the gate for both rewards. It is claimed
   only for the scorer who is also the lethal hitter, so a ring-out pays nobody. The killer must be alive and of the same life
   as a detached projectile's owner. A new victim life is a new claim; a dead life stays spent. Later phases of the same cast
   and a second attacker on the same tick land on a corpse and pay nothing.
3. **Artificer reset (spec 16).** A lethal hit by an `ea` fighter whose move is ea.b1 to ea.b4, ea.a1 or ea.a2 sets the
   cooldown end tick of ea.b1 to b4, ea.a1 and ea.a2 to the current tick, only when it is still in the future. The killing
   move's own bucket is included (D). ea.a3, ea.a4, basic attacks, dash, evasive and context moves neither trigger nor are reset
   (spec 16 and the R08 conflict note). Once-per-form bits (`awakenedUsedMask`), the evasive and dash buckets are untouched.
   A reset is not a heal and emits no event (D: the FX0 event shape has no reset kind).
4. **One heal path.** `CombatSystem.heal(fighter, amount100, moveId, tick)` is the only place HP is restored (finisher,
   Awakening completion heals, the sv grab, wave, beam and counter heals). It ignores dead fighters and non positive amounts,
   clamps at 10000 and returns the HP actually restored. The `ea.activate` and `td.activate` heals (40 HP) go through it too.
5. **Heal event (FX0 contract unchanged).** `CombatSystem.onHeal` is set by the `TickPipeline` constructor and calls the
   existing `broadcastEvent` helper: `kind "heal"`, `actorId` and `targetId` both the healed fighter (self heal), `lifeId` the
   healed life, `moveId` the source (`td.b1`, `sv.a3`, `ea.activate`), `damage100` the HP restored (D: reuses the existing
   field instead of adding one) and `targetHp100` the HP after the heal. A heal that restores 0 HP (already full) emits nothing.
   The heal event of a finisher is sent before the `ko` event of the same tick.

## Not done
No new FX consumer of `heal` (FX2 and FX3 own that), no client change, no passive regeneration (spec 10).
