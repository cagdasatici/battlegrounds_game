# 0051 Double jump

Status: accepted. Explicit user requirement ("add a double jump"); task DJ01. Design fixed by the user; no alternatives were evaluated.

- Rule: while airborne (after a ground jump or after walking off a ledge past the coyote window) one extra jump per airtime, triggered by the existing jump input. Charge resets only when the body is grounded again. Vertical velocity is SET to 0.85 x the ground jump speed (6.8 m/s), never added, so falling fast and rising fast both give the same result. Horizontal velocity and air control are unchanged.
- Numbers (D, local design values) in packages/shared/src/config/combat.ts: `DOUBLE_JUMP_VELOCITY_SCALE = 0.85`, `DOUBLE_JUMP_COUNT = 1`.
- Implementation: one shared function, `integrateMovement` in packages/shared/src/movement.ts, used by the server MovementSystem and by client Prediction. `MoveState.airJumpsUsed` is the charge; `MoveIntent.airJumpBlocked` is derived by the server from authoritative state (never read from a client packet). The packet schema is unchanged: the existing `jump` edge is the intent.
- Not allowed (press ignored, never buffered): any action other than Idle (windup, active, recovery, guard, awakening), Dash, Stunned, Ragdolled (covers launched), Captured, Dead. Stunned/Ragdolled/Captured/Dead/Dash were already dropped before movement; Idle-only is the new gate for the air jump. The existing ground-jump 6 tick buffer is unchanged and an air press does not enter it as an air jump.
- Prediction: the client mirrors the gate with its last replicated action (`GameLoop.stepOne`), so a disagreement only exists for the few ticks of an action change and is handled by the existing reconcile path.
- Replication: public player field `airJumpUsed` (true after the air jump until landing). Clients animate from it: rig flip (`FighterView.tuck`), element ring burst, short synthesized sound (`airJump` in audio/synth.ts). Remote and local fighters use the same replicated edge, so the local effect trails the press by one round trip.
- Bots: unchanged (they never send jump).
- Limits: visuals and sound are unverified on a physical iPad (NOT RUN). The flip is a whole-rig rotation, not an authored limb clip.
