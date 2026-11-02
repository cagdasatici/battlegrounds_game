# 0037 QF03 Ember Artificer silhouette choices

Status: accepted. 2026-11-02. The owner delegated design decisions to the orchestrator (see 0033); this is not a human sign-off.

## Decisions
- **Triangle budget is a hard cap.** The Artificer must not exceed its pre-QF03 counts (medium 4312, low 2024, three passes), base or Awakened. Result: medium 3888 base / 3920 Awakened, low 1808 / 1828 (the old orbiting rings, shoulder plates and round vents were removed to pay for the new parts). A unit test fails if any of the four numbers exceeds the old budget.
- **Compact torso**: chest shrunk to 0.40 x 0.34 x 0.24 and the idle stance hunches slightly forward under the pack.
- **Tapered furnace backpack**: three stacked boxes narrowing upward (0.40, 0.30, 0.20 wide) plus a chimney stack with a glowing mouth, so the back reads as a furnace rather than a rectangle.
- **Side vents**: dark louvre blocks with a glowing slit on each flank of the pack.
- **Insulated forearm guard**: the left forearm carries a large cream guard (0.22 x 0.30), the right a slim vented gauntlet, so the two arms differ.
- **Furnace Ray (ea.a3) vent-open key**: one extra key at 0.12 s before the unchanged 0.30 s windup and 0.42 s active keys. The torso rocks, the shoulders hunch and the pack tilts, before the arms extend. The rig has no flap bones, so "vents open" is shown by the pack tilt and the glowing side slits, not by a mechanical flap. Adding flap bones is out of scope (bone names and clip IDs stay fixed). A unit test checks the key time and that the hands have not reached toward the beam direction at that key.
- **Guard**: new Artificer guard overlay raises the insulated left forearm in front of the chest with a forward hunch.
- **Awakened**: two vent fins (glow cones, `awakened` flag, QF01 `setAwakened` path) rise from the flanks of the pack above the shoulders.
- Fins, stack and vents are not marked `small`, so they survive the low tier.

## Not done
- No Artificer-specific M1 re-authoring beyond the idle and guard overlay.
- Ratings are the delegated assessment in QF03.md, not a human sign-off.
