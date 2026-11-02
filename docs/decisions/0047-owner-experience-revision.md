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
