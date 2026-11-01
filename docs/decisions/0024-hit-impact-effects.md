# 0024 Hit impact effects

Status: accepted (FX1).

- **Trigger.** `HitFx` listens only to the FX0 `CombatBus`. Nothing is driven by predicted local input, and nothing
  here touches simulation, positions or ticks.
- **Pool.** `EffectsPool` keeps its disposer registry and gains one pre-allocated `InstancedMesh` of particles (one
  draw call): 200 low, 600 medium, 1000 high. When full, the particle furthest through its life is replaced. Time is
  render seconds, advanced by a per frame hook.
- **Table.** As in docs/backlog-v2.md FX1. Heavy hit: 24 sparks plus a 16 particle ring of 1.2 m radius. Counter: gold
  burst plus ring, gold flash on the countered attacker (the event actor). Block: 9 particle cyan arc between victim and
  attacker. Heal: 12 motes rising 1 m. KO: dust plus a light column. The server sends no `position` yet, so the
  fallback (victim capsule centre y + 0.3) is the normal path.
- **FighterView.** `flash(color, ms, level)` sets the body emissive colour and sets intensity to the `flashLevel`
  setting; `freeze(frames)` sets the mixer `timeScale` to 0 for N render frames; `flashing` is a debug getter.
- **Camera.** `CameraRig.shake(amplitude, ms)` adds a decaying offset to the camera position only. HitFx multiplies
  amplitude by the camera-shake setting, hard-coded to 0.25 (TODO: a real settings field), and skips it under
  Reduced Motion and when the local player is not involved.
- **Deviation from Owns (authorised by the coordinator).** HitFx could not reach fighter views, the camera rig or a
  frame callback through FX0's deps. Additive edits: `PresentationDeps` gains optional `viewFor`, `shake`, `onFrame`
  (`fx/index.ts`); `main.ts` passes `g.viewFor`, `cam.shake`, `g.onFrame` and exposes `fx` and per player `flashing` in
  the debug snapshot; `GameScene` gains `onFrame(fn)` run before drawing. FX0 is finished, so the wave conflict that
  restricted those files is gone. `HitFx.attach` returns a no-op when scene or settings are absent, because FX0's
  registerPresentation test passes null deps.
