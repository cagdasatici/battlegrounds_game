# t24 Duelist P1 variants: rules chosen where the spec is silent

Date: 2026-11-01. Status: recorded while implementing T24; reversible by a later spec edit. All values are D.

## Conflicts and gaps
1. Spec 15 (Riptide Pursuit) says the close branch "may continue once toward a second distinct target within 6 m
   after release: 12 tick sweep, capture then 31 damage at +30", with a 150 tick cast cap, no recapture of a life and
   no cooldown reset. It does not give the sweep speed, the release tick of the second capture, whether the second
   capture is counterable or armored, or what "within 6 m" measures.
2. Spec 15 (Undertow Spiral) elevated branch: "lands before +48" does not say who must land. The T13 handler already
   implemented the branch behind a flag (P1_ELEVATED_SLAM, off in P0).
3. Spec 6/7 hide P1 content in P0; T24 is the task that enables the two Duelist variants.

## Rules chosen
- Undertow Spiral: the flag is now ON. Elevated = at commit the caster is at least 2 m above the surface under it
  (host.surfaceHeight); "lands" = the caster pose is grounded on any tick strictly between capture and +48; final damage
  24 instead of 14, once (the final hit index only). Landing on +48 or later does not count.
- Riptide chain (flag P1_RIPTIDE_CHAIN, ON), close branch only (the ranged branch never chains):
  - Chosen when the first victim is released alive: nearest probe-eligible fighter other than that victim, 3D centre
    distance (horizontal plus vertical capsule gap) at most 6 m, line of sight. No such fighter: no chain, normal recovery.
  - Sweep of 12 ticks (release+1 .. release+12) at 0.5 m per tick (6 m / 12) along the direction to the chosen target fixed at
    release, through host.moveTogether; a short step (wall) ends the dash for good. Capture test is the ranged branch sphere
    sweep (r 0.6 at centre +0.2 Y) against the capsule of any eligible fighter except the first victim; nearest wins.
  - The sweep capture is counterable, deals nothing, no armor during the sweep (the caster is re-entered into Active).
    Armor from the capture until the release. 31 HP at capture+30, noncounterable; release at capture+31 with the first
    release values (R72 F8 U5); recovery 30. A sweep miss goes to recovery when the window ends.
  - A life is never recaptured (the first victim id is excluded); at most two distinct victims per cast. Worst case
    cast length is 121 ticks (cap 150, checked at chain start and in a test). The cooldown is never touched.
  - If the first victim dies during the sequence there is no release and no chain.

## Not done
- No wire (two real client) matrix row for the chain: it needs a third fighter and the kit matrix is two-client. It is
  covered by tick-driven unit tests only. The elevated slam has no wire row either (needs a 2 m airborne start).
- Rock Splitting Fist missed-chop branch and the Martial Artist interaction are Vanguard / out of scope, not Duelist.
- T19 charge/projectile system is not needed by either variant.
