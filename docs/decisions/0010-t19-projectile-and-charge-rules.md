# 0010 Projectile and charge rules (T19)

Date: 2026-11-01. Status: recorded while implementing T19; reversible by a later spec edit. All numbers are D unless the
spec card states them.

## Conflicts and gaps, with the smallest rule chosen
1. **A10 and the Artificer kit.** A10 names Ember Orb, a T20 move. T19 ships the generic `chargeProjectile` handler, the
   `projectile` definition block (shared schema) and the projectile system, and does NOT add `ea.b3` to `EA_DEFS`
   (the kit stays empty and hidden until T20). A10 and A11 are proven with a test-only `ea.b3` definition carrying the
   spec 15 numbers (`tests/fixtures/projectileRig.ts`), through the real AbilityRunner, handler, ProjectileSystem and
   hit resolver. T20 must add the shipped definition; its own R12 wire row (real client casting Ember Orb) is T20 work.
   The T19 wire tests fire the shot with the same `ProjectileSystem.spawn` call the handler makes.
2. **A11 lease length.** The generic input lease clears holds when `tick - lastInputTick > 15`. A11 says missing input for
   15 ticks cancels the charge, so the charge check uses `>= inputLeaseTicks` (stale at exactly 15 missing ticks,
   still charging at 14). The generic clear is unchanged.
3. **Release by fresh packet or edge.** A charge is released by a `skillUp` edge, or by a fresh packet whose
   `chargeHeldSlot` no longer names the slot, or at the 180 tick cap. Hold length = release tick - commit tick;
   179 is partial, 180 or more is full. A lapsed lease is a cancel, never a release. A cancel returns the fighter to
   Idle at once (no recovery) with the cooldown already spent at commit.
4. **Chip.** The spec gives "B with chip 5" for a partial orb but no chip implementation existed. `HitCandidate.chip100`
   is applied on a blocked hit, clamped so a guard keeps at least 1 hundredth of HP (chip never kills), builds no meter
   and still costs the 6 tick blockstun.
5. **Detached attribution.** `resolveHits` no longer requires a live, uninterrupted attacker for projectile candidates;
   it keys on `projectile.ownerLifeId`. Meter gain requires the owner's life to be the same life; the finisher heal
   requires the same life. Kill credit and assists still name the owner entity.
6. **Ledger key.** Projectile candidates use `castCounter = -projectileId`, so one projectile can hit a target once and a
   reflected projectile never collides with the reflector's melee ledger entry (Rift Palm).
7. **Contact and splash.** Any contact (fighter or static) detonates. A static contact uses the same splash; splash
   targets need line of sight (cover shields), the direct target always counts, order is direct, distance, id, cap 4.
   Reaching range or life ends the flight silently. The sphere sweep is a continuous Rapier cast (`World.sweepSphere`)
   so thin cover cannot be tunnelled (A19); fighter contact is bracketed by 12 substeps plus bisection.
8. **Counter plus projectile.** Contact with a counter-open reflectable projectile is a `countered` candidate; the
   projectile survives resolution (pending impact) until `settle()` so `td.b4` can reflect it in `afterResolve`. A
   projectile not reflected on that tick is consumed. A second reflection absorbs it with no damage.
9. **Aim.** The orb flies on the horizontal aim yaw (no pitch), spawns 0.8 m ahead and 0.2 m above the capsule centre,
   pulled back to the first static contact. The arc swings right by 0.5 m * sin(pi s / 20) and is off after a reflection.
10. **Hooks for T20.** `input: "recast"` second presses reach `handler.onRecast` (accepted = started, ignored = STATE
    reject), and `handler.freezeVertical` plus `MovementSystem.step(..., holdVertical)` hold an airborne caster at zero
    vertical velocity. Only the generic hooks are tested here; Vent Rush and Cinder Array semantics are T20.
11. **Replication.** `ArenaState.projectiles` carries the spec 20 record; owner-only `chargeStartTick` is the commit tick
    while charging, else 0. The client does not render projectiles yet (no client change in T19).
