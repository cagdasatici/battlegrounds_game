# ART1 Environment art from CC0 packs

Date: 2026-11-01. Environment: macOS, Chromium 1248 with SwiftShader WebGL (software), not a device.

| Check | Result |
|---|---|
| Collider alignment (`tests/unit/arena-visuals.test.ts`, 22 colliders, 0.05 m) | PASS |
| Dressing outside walkable ground or on pillar tops | PASS |
| Asset manifest CC0 and P0 budget | PASS: 4.81 MB total (cap 15 MB) |
| renderer.info medium, 1180x820, after load | 66 calls, 92,744 triangles (cap 120 / 150,000) |
| renderer.info medium, 1024x768, after load | 64 calls, 92,528 triangles |
| Before (code-built) | 57 calls, 41,420 triangles |
| Screenshots | `ART1-before-*.png`, `ART1-after-*.png` at 1024x768 and 1180x820 |
| Load failure fallback | Implemented (one `[env]` warning); not exercised by an automated test: NOT RUN |
| High quality bloom / SSAO | NOT IMPLEMENTED (optional) |
| Physical iPad frame rate and memory | NOT RUN |

Budgets were read after the first frames with the three fighters present (`tests/browser/arena-screens.spec.ts`).
