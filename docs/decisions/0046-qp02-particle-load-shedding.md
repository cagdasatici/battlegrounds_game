# 0046 Peak combat load shedding (QP02)

Status: accepted (owner delegated design to the orchestrator). Slice QP02. Builds on 0031 (adaptive controller) and 0024 (pool).

## Decision
- Order of reductions follows the plan: (1) nonessential particle density, (2) decorative cover. Step 2 already exists: the low tier hides `deco.cover` (a single merged mesh, so it cannot be thinned by count) and keeps `deco.coverLow`. No new cover code.
- Step 1 is new, in `EffectsPool.spawn`: above 60% fill (`SHED_HALF`) every second non-essential spawn is dropped, above 85% (`SHED_ALL`) none is admitted. Counter based, deterministic, no randomness. `Particle.essential` (default false) exempts a particle; it still overwrites the oldest slot only when the pool is totally full.
- Essential: Furnace Ray / Solar Vent body, sheath and flares (`fx/kits/ea.ts`), and the `floodFx` test hook. Warning geometry, the orb and silhouettes are meshes, not pool particles, and are untouched. Server ticks and timing are untouched.
- `AdaptiveQuality` thresholds are unchanged (hysteresis already: two bad windows to drop, 30 s good to raise, 15 s gap); new unit tests pin burst, sustained overload, recovery and non-flapping traces. They are synthetic traces, not measurements.
- Bottleneck check: server tick and bytes are far inside budget under peak combat, so no server change. Browser frame time on SwiftShader is raster bound and says nothing about an iPad.

## Test fixes (real defects in the Q01 long workload, root cause)
- The block step ran while the guest was respawn protected or still Ragdolled (no block event is possible); each cycle now waits out protection, swings only at a guest that is up, and retries. The dash step now re-presses until a Dash is observed.
