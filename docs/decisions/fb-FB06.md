# FB06 Thumb-arc skill layout

Owner choice 2026-11-04 ("Option A"): the default touch layout puts skills 1 to 4 on an arc around the Attack (Strike) button instead of a bottom-centre row. This overrides the section 7 skill row and Awaken bar centres (D values). Joystick, Attack, Jump, Dash, Block and Aim are unchanged.

| Item | Old | New |
|---|---|---|
| Skill shape / size | rect 82s x 60s | circle 80s (hit target floored at 48 px) |
| Skill position | (W/2 + (i-2.5)*90s, H-64s) | centre = Attack - 185s * (sin t, cos t), t = 10 + 29*(i-1) degrees from straight up toward the left |
| Order | left to right | 1 = top (nearest the thumb's resting sweep), 4 = lowest left, above and clear of Block |
| Awaken | 320s x 44s at (W/2, H-126s) | 200s x 44s, right-aligned 8s from the right edge, 8 px above the arc top (slides left of the scoreboard button on short screens) |
| Left-handed | skills and Awaken stayed centred | skills and Awaken mirror with the side cluster (health bar stays centred) |

Radius 185s is needed at compact widths too: Block sits 91s from Attack, so a skill on the arc needs radial room of 57 px at s = 0.78 (more with 80s circles). The 29 degree step keeps chords above 70 px (circle 62 + 8 gap) at s = 0.78. The old compact pitch rule no longer applies.

Migration: no change needed. Stored profiles hold only per-control edits (`controls: {}` for defaults), so players without edits get the arc and players with edits keep them; an edit that is unsafe against the new neighbours falls back to the default arrangement via `resolveLayout`. Schema version unchanged.

Tests: `tests/unit/touch-shell.test.ts` and `tests/unit/layout-edit.test.ts` (fixture, no overlap at 1024x768, 1180x820, 800x600, 700x420, inset, left-handed mirror); `tests/browser/layout.spec.ts`, `hud-readability.spec.ts`. Physical iPad: NOT RUN.
