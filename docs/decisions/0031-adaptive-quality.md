# 0031 Adaptive quality controller (T30)

Status: accepted. Slice T30 (partial). Spec section 24.

## Decision
- `apps/client/src/app/AdaptiveQuality.ts` is a pure controller fed one frame interval (ms) per rendered frame through
  `LoopDeps.onFrameTime` (GameLoop). It samples 120 frame windows; p90 above 28 ms for two consecutive windows drops one
  tier; p90 below 18 ms for 30 s of consecutive windows raises one; at least 15 s between changes. Time is the sum of the
  frame intervals, so tests replay exact traces.
- The player's quality setting is the ceiling and "low" is the floor. Changing the setting resets the controller to that
  tier. A software renderer stays pinned to low (ceiling low), as before.
- A frame interval of 1000 ms or more (hidden tab, stall) restarts the window and is not counted as slow.
- The controller only calls `GameScene.setQuality`. Simulation rate, prediction and hit detection are untouched.
- The frame interval is the rAF delta, a proxy for frame time; it cannot see GPU time beyond what vsync pacing exposes.

## Limits
- Server tick p95/p99, network KB/s, client heap trend, load size and four player stress were not measured in this slice.
- Draw call and triangle budgets with final ART2 and FX art were not re-measured: the browser specs hardcode a
  Chromium path that does not exist on this machine.
