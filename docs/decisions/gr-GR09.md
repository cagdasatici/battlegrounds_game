# GR09 decision: graphics recovery is a UI lifecycle

- `GraphicsLifecycle` listens on the one active game canvas. Loss: preventDefault, close the GR05 `graphics` gate reason (holds released, neutral packet), cancel the capture track, stop `GameScene.render` renderer calls. The room stays connected; HP and protection are untouched.
- Restore: three.js restores its own GL state; the scene discards particles/glow/projectile/urn views and interpolation buffers, the loop re-syncs from replicated state. Input reopens after one drawn frame and an owner `serverTick` newer than at restore. No hit/KO replay. A held key needs a fresh press.
- 5,000 ms wall-clock timer from loss shows `Graphics could not recover.` with Reload (`location.reload()`, GR03 session recovery) and Leave (`flow.back()`). A late restore still recovers.
- `loadAssets` builds renderer/scene/lifecycle locally and publishes to the session only on success; failure or disposal disposes the scene/renderer and removes the canvas.
- No new production debug API. Tests use the browser `WEBGL_lose_context` extension.
