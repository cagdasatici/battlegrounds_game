# 0009 Practice room rules (T18d)

Date: 2026-11-01. Status: recorded while implementing T18d; reversible by a later spec edit.

## Conflict
Spec section 6 says practice "meters never affect FFA" and asks the tutorial to make the player "awaken", and the plan
sets `awakening.meterEnabled = false` for practice. With meter gain off, hits can never fill the meter, so the
awaken step could never be reached through play.

## Rules chosen (all server side, none from the spec's numeric registry)
1. Meter gain from hits stays disabled in practice. When the tutorial reaches the awaken step, the server fills
   that player's meter to the kit threshold once (`meterRequired100`). The client cannot request it.
2. The dummy is a seatless fighter in the same tick pipeline. Below 40 HP it is refilled to full at the start of a tick
   so a practice session never ends in a knockout; a single hit that removes more than 60 HP still kills it, and
   the normal respawn path applies.
3. Toggles: "guard" holds the dummy's guard; "ragdoll" re-applies a 90 tick ragdoll whenever the dummy is idle. Both are
   applied by the server from a strict `practice` message `{ guard, ragdoll }`.
4. Practice is private per session. The join-ticket route derives the room code (`practice-` plus 16 characters of the
   session id) and returns it as optional `roomCode`; the client uses it in the join options. One seat per room.
5. Tutorial steps are confirmed from simulation state (distance walked 3 m, 90 degrees turned, two M1 starts, 30
   ticks of guard, Dash action, all four base slots cast, Awakened form), in order. D values; not verified facts.

## Impact
No change to the content hash, section 15 numbers or the FFA room. HTTP join-ticket response gains an optional field.
OwnerSchema gains four owner-only fields (tutorialStep, tutorialSkillMask, dummyGuard, dummyRagdoll).
