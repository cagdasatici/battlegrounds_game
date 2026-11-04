# GR04 decision: prediction anchored on snapshot serverTick

- Replay anchor is `snapshot.serverTick`; `ackInputTick` is diagnostic only. History is keyed by estimated server tick; entries at or before serverTick are discarded; at most 12 following ticks replay. Spec section 22.
- Owner locomotion fields added to `OwnerSchema`: grounded, lastGroundedTick (int32), jumpPressTick (int32), jumpedSinceGrounded, airJumpsUsed (uint8). Published in `TickPipeline.publishBody` with the pose, after physics. They replace prediction state wholesale at correction and respawn.
- Dash, Windup, Active, Recovery, Awakening: authoritative pose only, no speculative locomotion. Guard and Idle predict. No ability-motion predictor.
- Old snapshots inside an epoch (serverTick lower than the last applied) are ignored. Smoothing thresholds 0.1 m / 2 m unchanged.
- `PROTOCOL_VERSION` 1 -> 2 (wire addition). Runtime input envelope `v:1` unchanged. Mismatch tests now derive from the constant.
