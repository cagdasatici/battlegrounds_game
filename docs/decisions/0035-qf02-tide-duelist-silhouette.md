# 0035 QF02 Tide Duelist silhouette choices

Status: accepted. 2026-11-02. The owner delegated design decisions to the orchestrator (see 0033); this is not a human sign-off.

## Decisions
- **Triangle budget is a hard cap, not a target.** The medium renderer budget is about 149k of 150k triangles in the bridge capture, so the Duelist must not exceed its pre-QF02 count (medium 3884, low 1976, three passes). New parts were paid for by removing others: the old wide back cape, the scarf-collar-only look, the front and rear skirts, the sash tail and the hair tie were removed. Result: medium 3776 (awakened 3808), low 1904 (1924). A unit test fails if either awakened or base exceeds the old counts.
- **Narrow shoulders** by shrinking the chest box (0.43 to 0.35 wide). Rig bone positions, capsule and clip IDs are unchanged.
- **Long asymmetric scarf**: collar ring kept, plus two tails (`scarfTailA` on the chest, `scarfTailB` on the spine) that trail down the left of the back. "Cloth follows the existing movement" is met by riding existing bones, because the rig has no cloth bones or simulation and adding either is out of scope.
- **Split hip panels**: a long left and a short right panel at the front plus one back panel, so the legs read between them.
- **Cross-body stance**: idle gets more chest/spine yaw across the hips, leading right shoulder forward, left arm swept back. A new Duelist `GUARD_OVERLAY` staggers the hips and twists the torso. Shared guard keeps its pose; only td gains an overlay.
- **Undertow Spiral anticipation**: one extra key at 0.12 s (scaled by tempo) before the unchanged 0.3 s windup and 0.42 s active keys. The leading right shoulder drops forward and the chest begins to turn. It reads as the shoulder initiating the spiral and cannot show a strike before the authoritative active phase (a unit test compares reach).
- **Awakened forked crest**: two glow cones above the brow splaying left and right, built only while Awakened using the existing `awakened` PartDef flag and `setAwakened` path from QF01. A third centre blade was dropped to stay in budget.
- Medium/low parity: the crest and scarf are not marked `small`, so they survive the low tier.

## Not done
- No Duelist-specific M1 re-authoring beyond the idle/guard overlay (same limit as QF01 for the Vanguard).
- Ratings are the orchestrator-delegated assessment in QF02.md, not a human sign-off.
