# FB08 Environment visual quality pass

Owner request 2026-11-04: "improve quality of the environment." Client rendering only; colliders, spawns, ledges and server data are untouched (visual meshes still one per collider id).

## Drafts and picks (SwiftShader screenshots, 1180x820, `FB08_VARIANT` query on the art harness)
- Sky: v0 original; v1 adds a mid-sky stop plus warm haze peaking towards the painted sun; v2 teal zenith with stronger white haze. Picked v1: v2 washed out the upper third and fought the island greens; v1 keeps a deep zenith and the fog colour still matches the horizon.
- Island rock: v0 smooth blend; v1 eight strata bands with warm/cool shift; v2 six stronger bands. Picked v1 (v2 looked noisy at gameplay distance). Side faces face away from the sun and the toon ramp darkens them, so bands read mainly on the underside and at 1180x820 only subtly on the lit side; a limit, not solved here.
- Bridge planks: v0 3-step tone; v1 seeded per-plank lightness plus mid-span wear. Picked v1. No geometry bevel was added (colliders and triangle budget unchanged for bridges).
- Island edge: pale cream-green strip (0xc4d68e, 0.32 m wide) drawn inside the collider on outer edges only (segments next to another island are skipped; the first draft drew pitch-like lines across overlaps and was rejected). Telegraphs use dark red fills with pale yellow/white edges, so the green-leaning strip is not confusable.
- Lighting already had a warm sun, cool rim fill, hemisphere light and fighter contact blobs; left unchanged.

## Added
- `EnvPalette.ts`: pure deterministic helpers (sky, strata, planks, cloud alpha mask, mote placement), unit-tested.
- Cloud shell (256x128 procedural alpha, DataTexture, no files) inside the sky dome: +1 draw call.
- 28 instanced drifting rocks (`deco.motes`): +1 draw call. Both hidden on low; ambient bob and cloud drift stop under reduced motion (OS preference or the in-game setting, `GameScene.reducedMotion`) and are render-loop only.

## Budget (renderer.info, harness)
See `docs/test-results/FB08.md`. Low equals baseline draw calls; medium/high +2. No texture files added.
