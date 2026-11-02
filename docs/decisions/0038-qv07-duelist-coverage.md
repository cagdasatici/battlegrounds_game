# 0038 QV07 Duelist coverage (delegated design calls)

Owner delegated design decisions to the orchestrator (decision 0033). Ratings are capture-based assessments, delegated, not a human sign-off.

1. Water language per move: ribbons, rings and spiralling droplets (aqua, deep blue, foam). All pooled particles; no geometry. Recipe totals stay under the 100 particle low cap.
2. Capture events: the server reports a capture as kind `capture` (damage 0), not `hit`. `TdFx` now maps `capture` to the move's hit cue as a 0 damage hit (b1 wrap, b3 swirl, a2 water column, a4 wrap). td.b2 is excluded so its existing first-hit ribbon (QV04) is preserved.
3. Damage tiers choose the layer: b1 0/400/800, b4 600/1600, a1 400/1000, a2 0/2000/6900, a3 1200/2600, a4 0/800/2200. Thresholds come from the ability definitions, not from client input.
4. Mirror Current (td.b4): the stance is a replicated Active action (not a hidden status like sv.a1), so observers see a standing ring for the 60 tick window. A confirmed `counter` event whose target is currently in Active td.b4 flares the ring. An absorbed or expired stance (action no longer Active) shows nothing. Projectile reflection feedback stays with the ORB2 projectile view.
5. Split Tide (a3) and Riptide Pursuit (a4) use the QV05 sustain hook. a3 draws one crescent per scheduled probe (+0, +17), the second wider. a4 draws a lunge ring at Active start and a spray trail only while the replicated position moves, so the close branch (no travel) shows only the lunge, the ranged dash shows a trail (up to 9 m, 30 ticks). Trail needs a position memory, added as optional `px/pz` on the sustain state.
6. Elevated Undertow Spiral: the landed elevated branch (24 HP final) adds a 14 particle landing burst on top of the unchanged slam splash. The cast itself is not distinguishable on the observer, so no separate elevated warning. td.b2 active/ribbon behaviour preserved.
7. Awakening: `td.activate` plays a rising blue column and ground ring once; the burst's hits (20 HP, 5 m, up to 4 victims) splash each victim (10 particles each).
8. `frameOf` moved from sv.ts to `fx/kits/common.ts` for reuse (no behaviour change).
9. Evidence uses a synthetic fixture (server phase and broadcast events); real-input miss/block/counter through real clients stay with existing server integration tests.
