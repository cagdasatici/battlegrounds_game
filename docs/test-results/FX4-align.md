# FX4-align — directional attacks and terrain warnings

Implementation: `2c31554`. Prerequisites FX4-sv, FX4-td and FX4-ea present.
Kit effects use the same forward vector as authoritative ability targeting.
Each windup marker and fracture chip samples the highest collider top below the
cast centre at that marker's position. Samples over open air are omitted.

Checks on Node 24.22.2:
- Typecheck and lint passed. Production build and asset audit passed with the existing chunk-size warning.
- 22 focused FX tests passed, including four cardinal headings, mixed pillar and island elevations, and open air.
- 107 ability, projectile, arena geometry and arena visual tests passed.
- Playwright two-player match passed in 31.5 s in isolated Chromium contexts with SwiftShader. A temporary observer on the defender's EffectsPool recorded 30 accepted Gravel Flurry chips. Every velocity projected positively onto the attacker-to-defender approach direction (minimum 9.92 m/s). The normal combo, skill, HP agreement and console checks passed.
- Physical iPad and crowded four-fighter performance checks: NOT RUN.
