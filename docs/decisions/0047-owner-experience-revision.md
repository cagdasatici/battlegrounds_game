# 0047 — Owner experience revision

2026-11-02. Authority: owner's seven-item revision and explicit “go”.

Execute UX01–UX07 sequentially in this session; this explicitly supersedes the
one-task-per-session default. Preserve one implementation slice at a time.

UX01 shares the existing authoritative hosted-bot pipeline with admin arena
rooms. 0–3 bots reserve seats inside the existing four-fighter limit. Room bot
config is immutable while running; close/recreate changes opponents.
UX02 extends section 6 practice, at the owner's explicit request: retain the
stationary dummy/tutorial and permit 0–2 active bots, keeping total fighters ≤4.
Bots ignore the dummy when selecting targets. Bots use ordinary physics/hits;
no client may claim damage or positions. Existing practice meter rules remain.
UI/art choices below are local design choices, not reference-game facts.

UX04 wires existing settings into runtime. Quick Use off casts ordinary skills
on release; held-release skills still begin on press. Auto run uses the section
13 six-tick/hysteresis thresholds; otherwise double-forward requests running.
An optional strict `facingLock` boolean extends input packets (older senders
remain valid); server locomotion applies at most 720 degrees/s and ability
facing overrides retain precedence. No client positions/damage are accepted.
Graphics displays the effective tier and software-renderer cap. Unrelated
setting changes no longer reset adaptive-quality windows. Original synthesized
ambient music consumes one low-priority voice inside the existing 16-voice cap,
uses an independent gain, and stops on visibility suspension/leave/disposal.

UX06 supersedes decision 0019's blanket X-rotation flip. Hanging shoulder and
hip rotations now use the authored sign; elbow/knee hinges and upright torso
retain their previous sign. The old test selected either hand and could pass
on the guarding hand while the striking hand travelled backward. The new test
requires the designated hand/foot to reach at least 0.2 m ahead of the chest at
contact, and checks hinge direction in local limb space (world Z is invalid for
raised/crouched limbs). Strike torso twist and Ember guard were adjusted to
retain forward reach and a compact shield. No authoritative damage/timing edits.
Animation clips now carry presentation phase markers and follow replicated
Windup/Active/Recovery windows; a stalled long windup cannot reach contact.
Rounded core shapes and elbow seams increase the local art allocation for Tide
and Ember to ≤5,500 medium / ≤3,000 low triangles, within the existing ≤8,000 /
≤3,000 project caps. The obsolete pre-QF02/QF03 no-increase assertions are updated.
