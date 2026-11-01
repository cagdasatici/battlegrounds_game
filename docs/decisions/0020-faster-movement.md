# 0020 Faster movement (SPD1)

Date: 2026-11-01. Status: owner decision.

## Conflict
Spec section 11 sets walk 5, run 8, guard 2, acceleration 45 (all D values). The owner said characters should move a bit faster. Explicit user requirements outrank the spec (AGENTS.md authority order).

## Rule chosen
`COMBAT.movement`: walk 7, run 11, guard 3, acceleration 70. Combat timing, dashes, projectiles and hitboxes are unchanged. Server and client prediction both import `COMBAT`. The client run-clip threshold is now `(walk + run) / 2` = 9, so walking at 7 does not show the run clip.

## Risks
Faster movement shortens chase times and may shift range balance; no balance playtest has been run.
