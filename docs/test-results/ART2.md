# ART2 Smooth skinned fighter meshes, textures and LOD

Date: 2026-11-01. Environment: macOS, Node 24, Chromium via Playwright with SwiftShader WebGL (software), not a device.

| Check | Result |
|---|---|
| `pnpm verify` (typecheck, lint, vitest, build, content:validate) | PASS, exit 0 |
| `pnpm test:browser` | PASS, 39 passed |
| `pnpm assets:audit` | PASS: 28 manifest entries, 3 fighters, 93 clips, 5,239,564 bytes (cap 15 MB) |
| Extents within capsule + 0.25 m, all passes, medium and low (`tests/unit/fighter-model.test.ts`) | PASS |
| Joint gap at 90 degree knee and elbow flexion, both sides and both bend directions, 3 kits | PASS (gap < 5 mm, ring keeps > 60% radius) |
| Limbs >= 12 radial segments, outward winding, weights sum to 1, two influences, 0.06 m band | PASS |
| 512 px atlas per kit (cap 1024), UVs inside the atlas | PASS |
| Triangles body+glow+outline, medium (cap 8,000) | sv 3,256; td 3,884; ea 4,312 |
| Triangles body+glow+outline, low (cap 3,000) | sv 1,588; td 1,976; ea 2,024 |
| LOD swap in place, 3 draw calls kept, geometry disposed once | PASS |
| Screenshots | before: `T25-after*.png` (previous fighters); after: `ART2-after.png`, `ART2-after-poses.png`, `ART2-after-low.png`, `ART2-after-game.png` |
| renderer.info after, 1180x820 | 53 calls, 103,048 triangles (arena from ART1 included; `ART2-render-info.json`) |
| Physical iPad frame rate and memory | NOT RUN |

Limitations: the glTF files stay vertex coloured (`assets:audit` forbids embedded textures and `art-gltf.ts` is outside
this slice), so the atlas is applied at runtime only. The low LOD is selected through `FighterView.setShadows(false)`
(low quality tier) because `GameScene.ts` is outside this slice. Frame rates under SwiftShader are not meaningful.
