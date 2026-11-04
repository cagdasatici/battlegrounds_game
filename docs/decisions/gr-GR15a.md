# GR15a decision: confirmed-hit practice lesson

- Wire: `PROTOCOL_VERSION` 3 -> 4 (new client message `practiceDrill` plus four owner fields `drillId`, `drillState`, `drillStartTick`, `drillSuccessTick`). Single constant, client and server move together. Runtime input envelope `v:1` untouched.
- `practiceDrill` is registered only in `PracticeRoom`, shares its existing 4/s bucket, strict schema `{action: start|retry|exit, drill: "hit"}`. No client success message exists.
- Success source: `TickPipeline.onResolvedHits(tick, frozenSummaries)` (attacker, target, move, outcome, damage100), consumed by `DrillTracker`. Requires outcome `hit`, damage>0, attacker = the player, target = the dummy, an `m1.*` move. Casts, blocks, counters, bot hits do not count. Completes once; `retry` re-arms, `exit` clears.
- Authority conflict recorded: the spec places the dummy at (0,0,0) and the player at (0,0,3). The existing probe (PracticeRoom comment) shows (0,0) is an island seam that shakes the body, so the lesson keeps the dummy's home (0,-1) and places the player 3 m away at (0,2), preserving the 3 m separation and mutual facing.
- Start/retry reset: bots cleared via existing `clearBots`, guard/ragdoll toggles forced off (and ignored while a lesson exists), both fighters respawned through the same combat/m1/abilities/awakening reset used by round restart, spawn protection cleared so the dummy is hittable at once. Private to the practice room.
- The seven-step tutorial and its owner fields are untouched; lessons are a separate "Combat lessons" section.
