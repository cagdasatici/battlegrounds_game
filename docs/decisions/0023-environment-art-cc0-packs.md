# 0023 Environment art from CC0 packs

Status: accepted (ART1; owner chose option A in ART0, 2026-11-01).

- **Third-party material is now allowed for environment art.** This supersedes decision 0015 #8 ("no third-party
  material") for the environment only. Fighters stay project-original.
- **Source.** Quaternius "Stylized Nature MegaKit" (Standard), CC0 1.0, copied from the Studio's `vendor-src/` into
  `assets/vendor/quaternius-stylized-nature/`: 7 models (CommonTree_1, Pine_1, TwistedTree_2, Bush_Common,
  Rock_Medium_1..3), their `.bin` files, the 3 bark and 3 leaf textures, the shared rock texture and the license.
  Textures were downscaled to 512 px (3.5 MB in total instead of 37 MB). The Kenney Nature Kit was not needed: the
  Quaternius pack already covers rocks, trees and bushes, and the two styles are not mixed.
- **Manifest.** Each file has an `environment` entry: license `CC0-1.0`, author `Quaternius`, the pack page as source,
  creationMethod `third-party CC0 pack` (schema in `packages/shared/src/art.ts` extended accordingly).
- **Alignment.** Collider meshes stay code-built, one per collider id, and are asserted to match the collider AABB
  within 0.05 m (`tests/unit/arena-visuals.test.ts`). To satisfy that, ground and cap overhang was reduced from 0.07
  to 0.04 m per side, bridge beams were lifted 0.05 m, rail end posts moved inward, and bridge corner posts moved to a
  separate `deco.posts` mesh.
- **Dressing.** `planDressing` is deterministic and places props only outside all walkable footprints (rim boulders
  on island flanks, a tree, bush and rock per distant islet) or on the top face of a pillar. Props are `InstancedMesh`
  per model part, toon materials sharing the scene ramp.
- **Loading.** `GameScene.loadEnvironment()` runs inside `loadAssets`, so Play is not enabled until it settles. On
  failure it logs one `[env]` warning and the code-built arena (including its code-built islet trees) stays.
- **Not done.** Bloom and SSAO on high quality were not added (optional in the task); Low quality has no post-processing.
