# 0036 QV06 Vanguard coverage (delegated design calls)

Owner delegated design decisions to the orchestrator (decision 0033). These are assessments from captures, not a human sign-off.

1. Fault Strike flash (carried from QI01): the 3 m footprint crack lies behind the victim at point blank, hidden from both fighters' cameras. The confirmed `hit` for sv.b1 now also draws a large bright flash (3 particles, size 1.3, life 0.5 s) plus 5 sparks at the victim. Crack life 0.45 s, settling fragments 1.6 s. No geometry added; pooled particles only.
2. Stillpoint Reversal stance (sv.a1 waiting status) is a private, unreplicated status. Observers get no stance cue (inventing one would leak hidden state); the owner keeps the HUD text. Cues are the replicated response (Active) and the 100 HP confirmed hit.
3. Awakening: action "Awakening" with moveId sv.activate now plays a recipe once (amber column, ground ring). Shared hook in `fx/kits/common.ts`; other kits have no activate recipe, so no change for them (QV07/QV08 add theirs).
4. Capture (damage 0) and release hits for sv.a4 and sv.x2 are told apart by `damage100 === 0` on the confirmed hit event.
5. Sustained cues (b2 volleys at the scheduled hit ticks, a3 beam every 3 ticks, cover clipped) reuse the QV05 sustain hook.
6. Reflection feedback for sv.b3 stays with the ORB2 projectile views; the palm cue is the swing only.
7. Evidence uses a synthetic fixture (server phase and broadcast hit events). Real-input miss/block/counter/interruption through real clients stay with existing server integration tests; only interruption of sustained moves is exercised here.
