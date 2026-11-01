# 0024 Hit impact effects

Status: accepted. Slice FX1.

## Decision
- `HitFx` listens to the `CombatBus` only (confirmed server events). It never reacts to predicted local input.
- A pure table (`planFor`) maps `hit` (light or heavy by `hitClass`), `block`, `counter`, `heal` and `ko` to particles, a
  victim flash, hitstop and camera shake, exactly as in docs/backlog-v2.md FX1. `cast`, `capture`, `release` and
  `respawn` have no impact effect.
- `EffectsPool` is one `InstancedMesh` (one draw call) with 200, 600 or 1000 particles for low, medium and high. Rings
  and the shield arc are built from particles, so no second geometry is needed. The pool is a ring over its slots, so
  a full pool overwrites the oldest particle. `GameScene.setQuality` configures it; the same tier is a no-op.
- `FighterView.flash(color, ms, level)` multiplies the body emissive by the flash setting and fades it over `ms` of
  render time. `freeze(frames)` stops the animation mixer for N render frames. Both are visual only.
- `CameraRig.shake(amplitude, ms)` multiplies by the fixed scale 0.25 (spec section 9 default) and does nothing under
  Reduced Motion (`CameraRig.reducedMotion`, updated from settings). Shake offsets only the camera position, never the pivot.
- Event `position` is metres (same as FX2). Without one, the effect uses the target's replicated position / 100, y + 0.3.
- `PresentationDeps` gained optional `effects`, `fighters` and `shake`.

## Deviations and limits
- The camera-shake scale is a constant, not a user setting, to avoid a settings schema change (v2 stays). Add a slider
  only with a migration when requested.
- Events without a `position` and an unknown target spawn nothing.
- Hitstop freezes the mixer only; positions and interpolation continue (backlog rule 9).
- Shield arc faces the attacker's replicated position, not the victim's facing yaw, because the client has no victim yaw on the bus.
