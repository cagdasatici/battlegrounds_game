# 0055 FX01 hit-stop scope (conflict with 0049 documented)

Status: accepted (interim).

- Conflict: decision 0049 (explicit owner requirement) disabled the generic on-hit freeze; the FX01 request asks for a 2 to 5 frame visual hit-stop on impacts.
- Rule chosen: the generic freeze for basic strikes (M1, dash attack) stays off, exactly as 0049 says. FX01 adds a presentation-only animation freeze (FighterView.freeze, 2 to 5 render frames, both fighters) only for slotted ability hits (`sv|td|ea.[ba][1-4]`), beast-form hits and KOs. It never touches the simulation, `HIT_STUN`, stun lengths, cooldowns or damage, and it is off under Reduced Motion.
- When `HIT_STUN.enabled` is true (legacy test mode) FX01 skips its own freeze so the two never stack.
- Revisit: if the owner wants no freeze at all, set `freezeFrames` to 0 in `selectHitFx` (apps/client/src/fx/Fx01.ts); one line.
