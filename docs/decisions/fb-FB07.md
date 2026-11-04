# FB07 Edge-aware shortened dash

Date: 2026-11-04. Owner request: shorter dash when at an edge or at risk of falling. All values are D (local design choices).

| Value | D | Why |
|---|---|---|
| Path sample step | 0.2 m | Footprint ring (capsule radius 0.35, 8 points) catches gaps wider than about 0.3 m |
| Margin | 0.5 m | Stop this far short of the last grounded sample |
| Coast reserve | 1.0 m | Measured: unclamped ground dash travels 7.57 m vs 6.6 m dash |
| Max drop | 1.0 m | Ground lower than the start surface by more is a fall |

Rule: `safeTravelDistance` (packages/shared/src/dashSafety.ts, pure) samples from the body along the dash direction to
`remaining travel + coast + margin`; at the first sample without ground under the full footprint the allowed travel is
`lastGood - coast - margin` (min 0). TickPipeline.dashOverride re-evaluates every tick over the remaining ticks and scales
the dash velocity, so integer ticks, cooldown, i-frames, damage and hit windows are untouched. Ground probe is the
existing `World.walkableTop` (no ledge probe existed; BotNavigation already uses it).
Scope: movement dash (forward/side/back/evasive, all use `f.dash`) and Vent Rush (ea.b2, grounded casts only, via
`AbilityHost.safeTravel`). Not clamped: Undertow Spiral (td.b2, drags a victim), air Vent Rush, knockback/launch (setVelocity).
Client prediction does not simulate dashes (Prediction.ts: Dash is NO_LOCOMOTION), so no client change.
TODO: add Vent Rush integration test; add safe-distance preview to the bot brain if bots should also dash less near edges.
