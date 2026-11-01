# 0014 Ember Artificer base rules (T20)

Date: 2026-11-01. Status: recorded while implementing T20; reversible by a later spec edit. All numbers are D unless the
spec 15 card states them. Handlers: `apps/server/src/kits/ea/*`. Definitions: `packages/shared/src/config/kits/ea.ts`.
(0010 is T19, 0011 T28, 0012 T24, 0013 T27, so 0014 is the next free number.)

## Conflicts and gaps, with the smallest rule chosen
1. **Ember Orb is shipped, not duplicated.** `ea.b3` moves from the T19 test rig into `EA_DEFS` with the same numbers
   (decision 0010 item 1). `tests/fixtures/projectileRig.ts` now derives `ORB_SPEC`/`orbDef()` from the shipped
   definition, and its registry replaces a same id definition instead of adding a second one. The old "ea stays empty"
   assertion became "ea ships exactly ea.b1 to ea.b4". The T19 tests run unchanged against the shipped ability.
2. **Furnace Drop timing.** The table says startup 18 and the card says "rises with velocity +10 for 18 ticks". The rise is
   the startup: vertical velocity +10 m/s is written every startup tick (about 2.7 to 3 m after gravity), the descent
   point is fixed at activeStart, and "within 48 active ticks" is the `active` value. No separate rise phase exists.
3. **Furnace Drop aim.** "Aims toward a point up to 8 m ahead" has no input spec. The point is 8 m ahead on the commit aim
   (no turnRate is given, so the aim does not turn), shortened by a straight sphere sweep at the first wall, at standing
   height over `surfaceHeight` (12 m below the caster when there is no floor). The descent pitch is at least 11.5
   degrees down so a higher target cannot make the drop climb. Horizontal motion uses the swept `moveTogether` (a wall
   stops it and the caster keeps falling); vertical velocity is written per tick; gravity is never modified, so an
   interruption or the 48 tick expiry returns to plain gravity from the next tick. A caster still grounded at activeStart
   (ceiling) counts as the ground contact. The impact sphere (r 4) takes at most 4 targets (spec 15 gives none; D).
4. **Vent Rush two phases.** The card says a target "may take only the larger of the two phases". Front (15, 24 on a
   ragdolled target) is always at least rear (10), so the rule is implemented as: front first, rear only for reserved targets
   the front query did not select. A blocked or countered front hit still counts as the front phase. The cast ledger limit
   is one hit per target (`maxHitsPerTarget 1`), so a duplicated phase is also refused by the resolver. Rear targets are
   reserved at activeStart (line of sight at that tick) and need no second check at travel end.
5. **Vent Rush recast and travel end.** "A second press after 6 active ticks" is `tick >= activeStart + 6` (six active
   ticks have fully elapsed). A recast, a wall stop, floor contact (air) or the 24th travel tick is the travel end; the
   front blast resolves on that tick and the cast is retimed (active ends next tick, 24 tick recovery). A press during
   startup, earlier active ticks, after the travel ended or in recovery is answered `STATE` and never buffered
   (the framework routes any same slot press of a running recast move to `onRecast`).
6. **Vent Rush air branch needs pitch.** The server only held yaw. `AbilityHost.aimPitch` (optional) now reads the validated
   packet pitch (`TickPipeline.pitchOf`). Camera pitch is positive when looking down, so the aim elevation is its negative,
   clamped to +-45 degrees, sampled once at commit. If the caster is airborne at activeStart the horizontal step is
   cos(e)/3 m and the vertical velocity 20 sin(e) m/s; the first grounded tick after the first travel tick ends travel
   (floor collision). A grounded start ignores pitch.
7. **Cinder Array reactions.** The card gives only the final hit (R72 F3 U9). Intermediate hits use stun 12 (the same D
   choice as `sv.b2`); an already ragdolled victim keeps its ragdoll (reaction none). Air targets use the standing table.
   The branch (standing or ragdoll table) is stored per victim life at the first candidate and never re-read. The vertical
   hold covers `activeStart <= tick < activeEnd` (the card says "through active ticks"; startup falls normally).
8. **Selectability.** `P0_KITS` is unchanged: the Artificer is still not selectable in the lobby (`room.test.ts` asserts it). T20 wire tests switch the seat's `Fighter.kitId` on the server after the normal
   ready handshake; that fixture is the only way to cast `ea.*` over the wire until the kit is opened.
9. **Out of scope and untouched.** Finisher heal values for the Artificer, the cooldown-reset passive, meter gain values
   beyond the shared resolver, awakening (T21), passives (T22), client visuals and art. `Awakening` still returns INVALID for
   the `ea` kit (its activation is T21).
