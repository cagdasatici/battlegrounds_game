# 0032 Close-combat height assist (QC01)

Status: accepted. Owner decision 2026-11-02: "Add height assist"; no automatic side switching; pass condition (opponent head plus one shoulder visible in at least 5 of 6 views) and the 0.25 m torso radius unchanged.

## Decision (D values, presentation only)
- While the existing close-combat latch is set (opponent within 2.5 m, hidden, released above 3 m), the pivot and boom rise by `CLOSE_COMBAT.assistHeight` = **0.5 m**, together with the 0.55 m camera-right shoulder offset (kept at 0.55 m).
- View direction (yaw and pitch) is unchanged, so aim stays server-consistent; boom length is unchanged.
- Eased linearly over 0.15 s. Reduced Motion: constant, no easing, while a target exists.
- Rise is sphere-cast upward from the base pivot with the existing cast radius and clearance; a ceiling clamps at once.

## Sweep (pure model, `CameraRig` + `framingOk`, pitch 0, 4:3, opponent 1.5/1.9/1.7 m ahead as in the centre/wall/bridge fixtures, views passing out of 6 for on-axis / camera-right 0.3 m / camera-left 0.3 m)
| height | offset 0.55 | offset 1.0 |
|---|---|---|
| 0.0 to 0.3 | 0/6/0 | 0/6/0 |
| 0.4 | 4/6/4 | 4/6/0 |
| 0.5 | 6/6/6 | 6/6/2 |
| 0.6 to 1.1 | 6/6/6 | 6/6/2 |
| 1.2 | 6/6/6 | 6/6/4 |
| 1.3 to 1.5 | 6/6/6 | 6/6/6 |
Offset 0.8 m matched 0.55 m at heights 0.0 to 1.5 in an earlier coarser sweep (pitch variants), so a larger offset does not help the left stance; 0.55 m with 0.5 m is the smallest passing pair. A wider coarse sweep (pitch 0, 0.15, -0.1; distances 1.5 and 1.7) needed 1.5 m, so the margin depends on pitch: re-check with a pitched real fight in the device pass.

## Evidence
Real-client gate `tests/browser/quality-camera.spec.ts` at 0.5 m / 0.55 m: aligned 6/6, right 6/6, left 6/6 (`docs/test-results/QC01/camera-metrics.json`).
