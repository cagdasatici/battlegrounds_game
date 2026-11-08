# RP01 compact HUD

The compact layout follows spec §7 and uses a safe CSS viewport height below 560 px. Combat requires a landscape viewport and at least 480 × 290 safe CSS px. The existing 48 px touch target floor, 8 px gap, control positions and per-profile settings rules apply.

The compact objective and cast lines use 12 px text. They start below the default Awakening target with an 8 px clearance and move down to clear an edited Awakening target in the header. Compact width is capped at 240 px and reduced at narrow widths to leave room for the skill cluster. The sparring Beast banner uses a 144 px strip 120 px below the safe top, inset 8 px on the joystick side. These are local design values. Regular-height objective and cast offsets stay at 68 and 92 px from the safe top. The regular-height Beast banner retains its placement.

Visual viewport changes recompute the HUD and pointer layout together. The rotate prompt shares its portrait condition with the existing input gate. Rendering quality continues to use the saved ceiling and frame-time samples, with the existing Low cap for software rendering.
