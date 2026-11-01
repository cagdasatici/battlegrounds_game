# 0022 Ember Artificer awakening rules (T21)

Date: 2026-11-01. Status: recorded while implementing T21; reversible by a later spec edit. All numbers are D unless the
spec 15 card states them. Handlers: `apps/server/src/kits/ea/{arcDescent,cometLock,beams}.ts`. Definitions:
`packages/shared/src/config/kits/ea.ts`. Activation: `ACTIVATIONS.ea` in `apps/server/src/sim/Awakening.ts`.
(0014 is T20, 0016 T23, 0017 to 0018 calibration and LAN, 0019 to 0021 other slices; 0022 is this task.)

## Conflicts and gaps, with the smallest rule chosen
1. **Activation has two pulses.** The Awakening system supported one burst tick. `burst.atTick` became `burst.atTicks`
   (td: `[48]`, unchanged behaviour; ea: `[0, 72]`). Each pulse picks its own nearest 4 targets (the card says "maximum 4
   targets and one hit per pulse"); a target can take both pulses (32 HP in all). Pulse hit index is `pulse * 10 + rank`.
   Pulses are U, noncounterable, no armorBreak (the card does not give it; the caster has armor, victims are not armored
   unless they cast), R60 F4 U3. No invulnerability. Heal 40 and form 2820 ticks from completion follow the td pattern.
   The existing rule "meter is not gained during activation" already covers "caster cannot gain meter from activation".
2. **Arc Descent advance and reach.** 24 m/s is 0.4 m per active tick (18 ticks, 7.2 m). "Swept reach 8 m" is the advance
   plus a 0.6 m sweep sphere and the 0.35 m capsule radius (about 8.15 m). The sweep is the Riptide Pursuit ranged probe
   (nearest eligible fighter, one capture per cast). The initial hit is counterable; a counter makes it a miss and the
   miss branch runs. A capture that kills its victim counts as a capture: no miss branch ("no miss branch if a captured
   victim dies"). Hit damage is 15 at capture and 25 at +36 (40 in all), release +42 R84 F5 U8.
3. **Arc Descent miss windup and blast.** "Enter 30 tick vulnerable blast windup" is implemented as the cast staying Active
   with no armor for 30 ticks after the probe window (re-entered Active like td.a4's chain), blast on the 30th tick
   (`probeEnd + 30`), recovery 30 after it. Blast: sphere r 5 around the caster at the blast tick, 20 HP, U, noncounterable,
   R60 F5 U5, at most 4 targets (the card gives none). The blast is centred on the caster, who has moved 7.2 m, so a victim
   left behind the dash is outside it.
4. **Arc Descent interrupted windup.** "Emit one smaller radius 2 blast for 13 before cancellation" is implemented through
   `onIncoming`: a non-lethal `hit` or `captured` result on the caster that leaves it Stunned, Ragdolled or Captured during
   the windup queues one blast on the next tick (runner scratch + `globalCollect`, because the cast is cancelled by then).
   13 HP, radius 2, U, noncounterable, R36 F3 U3 (D), at most 4 targets, attacker generation read at emission. A lethal hit
   or a death leaves nothing queued. Reactions that leave the caster Active (armor never exists in the windup) emit nothing.
5. **Comet Lock.** 40 m/s is 2/3 m per tick for 24 active ticks (16 m). The caster is invulnerable from activeStart through
   the dash and, after a capture, through the release tick; startup and a miss recovery are vulnerable. The capture is
   non-cinematic (the card says "capture invulnerable" about the caster only), so third parties can still hit the victim.
   The capture hit and the branch: the victim's state (Ragdolled or not) is read when the capture candidate is built, before
   the capture overwrites it, and stored per victim; 50 HP standing or airborne, 30 HP ragdoll, at +54, release +60 R90 F3 U8.
   The splash uses 3D distance to the victim's position, 4 m, line of sight, nearest first, lowest id tie break, at most 3
   others (cast maximum 4 targets), B with chip 5, 20 HP, R72 F5 U6, noncounterable, hit index 0 so it resolves before the
   victim's damage of the same tick. The caster and the victim never take splash. Invulnerable targets are not eligible.
6. **Furnace Ray and Solar Vent are one pulsed beam shape** (`kits/ea/beams.ts`). Each pulse re-clips the beam at the first
   solid obstacle (the sv.a3 bisection helper), keeps targets forward of the caster, inside the clipped length and not
   occluded, nearest first, at most 4 distinct targets per cast. The hit index is the pulse index, so the per target cap is
   the pulse count and gives exactly 35 and 70 HP. Furnace Ray armor is the framework `onHit` armor (starts the tick after the
   first confirmed damage, ends at activeEnd). Its 1 m/s push and Solar Vent's 2 m/s push are definition launches, applied by
   the room only when the pulse stuns the victim (an armored victim is not pushed, as for every other stun launch).
   Vertical velocity is held at zero from commit through the last active tick (the card says "vertical velocity zero" without
   a window; holding it from commit keeps an airborne caster from falling out of its own beam during startup).
7. **Solar Vent details left open by the card.** moveScale 0 (the card is silent; Furnace Ray states movement zero), max 4
   targets, "within 10 m" is the horizontal distance from the caster at the pulse, evaluated per pulse. Once per form uses
   the framework bit set at commit, so a miss or an interruption spends the use. No wall trapping extra damage exists.
8. **Selectability.** `P0_KITS` now lists `ea` and the lobby shows it (the name `KIT_LABEL.ea` changed from "Ember Adept"
   to the shipped name "Ember Artificer", noted in decision 0015). The server accepts `ready` and `changeKit` for `ea`.
   The T20 wire fixture that switched the kit on the server stays valid. `abilityClipIds` and `MOVE_ARCHETYPE` already cover
   ea.a1 to ea.a4 and ea.activate; no change was needed (`pnpm assets:build` and `pnpm assets:audit` pass with 3 fighters
   and 93 clips).
9. **Out of scope and untouched.** Finisher heal, cooldown reset and other passives (T22), client visuals and effects for
   the Artificer (FX4-ea), the FX0 combat event contract blocks, and `COMBAT.movement` (SPD1). Events come from the existing
   event mapping, which already derives cast, hit, capture and release events from results.
