# FB03 Medium bot between easy and hard

Owner request 2026-11-04: "Adjust medium so it is in between easy and hard." Easy (FB02) and hard are unchanged. All values are D local design choices (`BOT_PARAMS.medium` in `apps/server/src/sim/SparringBrain.ts`), applied by `decideMedium` as a shaping layer over the existing GR14 medium policy (roles, ranges, charge 60 ticks unchanged; no conflict). Randomness is the same pure `botRandom` hash (no `Math.random`, no timers, integer ticks).

| Parameter | Old medium | New medium | Easy (ref) |
|---|---|---|---|
| `moveScale` | 1 | 0.8 | 0.55 |
| Reaction to a new target | none | 12 ticks (realised as one idle 15 tick decision) | 30 |
| Swing rhythm | held M1 whenever in reach | 45 tick cycle: basic attack for at most 2 consecutive decisions (maxChain 2), then 1 decision without | 90, single swing |
| Whiff rate (off-angle swing) | 0 | 0.15 (0.2 first tried; lowered to land the damage ratio) | 0.40 |
| Aim error | 0 | +-10 deg | +-25 |
| Block when attacked in reach | always | 0.25 of decisions | 0 (hard: always) |
| Skill use (castSlot kept) | every ready decision | 0.85 | 0.08 |
| Pursuit | unlimited | give up after 360 ticks, wander | 180 |
| Wander | none | 60-120 tick segments, 0.05 chance, half idle / half walk | 0.25 |

Skill rate was raised 0.5 -> 0.85 and wander chance 0.1 -> 0.05 while tuning, and the rest decision no longer retreats, so the integration ratio reaches the owner's band.
