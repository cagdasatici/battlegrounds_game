# 0010 Settings and layout editor rules (T27)

Date: 2026-11-01. Status: recorded while implementing T27; reversible by a later spec edit. All numbers marked D are local design choices, not verified facts.

## Gaps in the spec, and the rule chosen
1. Spec section 9 lists the persisted settings but fixes ranges only for camera distance (3.5 to 10 m), layout size (0.85 to 1.30), opacity (0.35 to 0.90), volumes (0 to 1) and the flash default (0.3). Chosen (D): camera speed multiplier 0.5 to 2, flash level 0 to 1, quality low/medium/high. Defaults: Quick Use on (spec), flash 0.3 (spec), camera 6.5 m (spec), effects volume 0.8, music volume 0.5, opacity 0.9 (D).
2. "Size 0.85 to 1.30 times default" is applied per control (not one global scale); opacity is one value per layout profile. Visual size scales, the hit target keeps the 48 px floor from section 7.
3. "Left hand mirror" is the `handedness` setting. Mirroring swaps the side clusters (joystick, attack, jump, dash, block, aim, menu, fighter, scoreboard) about the safe rectangle centre. The skill strip, awakening bar and health bar stay centred.
4. "Per viewport class and local profile": two classes, wide (safe width at least 900 CSS px, the existing compact threshold) and compact. Profile is the local Arel/Nora label, stored under `eb.settings.v1.<label>` in localStorage (any other label maps to `default`). The label never authenticates anything. The store for a label is created when Settings is first opened in a page load and is rebuilt if the label changes.
5. Persisted positions are normalized to the safe rectangle (0 to 1 on each axis, control centre) so rotation and resize keep intent. Every use is re-validated with the section 7 rectangle test (inside the safe rect, 8 px separation, 48 px targets). If a stored layout is unsafe it falls back to the defaults (keeping handedness and opacity); if the mirrored default is itself unsafe, the unmirrored default is used.
6. Edits that overlap or leave the safe rectangle are rejected on drop and the button returns; during drag the outline turns red as feedback. The health bar is display only and is not editable.
7. Export/import is a strict, versioned (`v: 1`) JSON of the whole settings object. Size is capped at 8192 bytes (UTF-8 bytes), unknown keys at any level are rejected, and nothing is partially applied. Invitations are never part of the object.
8. While the panel is open, key events inside it do not reach the game keyboard router, and closing it blurs any focused panel control (otherwise Escape could be delivered to a hidden button).

## Not wired in this task
Stored but not yet consumed by gameplay or presentation (their consumers belong to other tasks): `quickUse` (selection mode), `autoRun`, `effectsVolume` and `musicVolume` (T26 audio), `quality` (T30), `reducedMotion` and `flashLevel` (T26 effects). Wired now: layout, handedness, camera speed, camera distance, initial facing lock.

## Impact
No server, protocol, content hash or combat change. `PointerRouter` gains a local `sensitivity` multiplier (default 1); `Lobby` gains an optional `settings` action; `Hud` gains a Settings button in the in-match menu.
