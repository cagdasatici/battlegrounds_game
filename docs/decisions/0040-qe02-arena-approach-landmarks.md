# 0040 QE02 full arena art coverage

Status: accepted. 2026-11-02. Delegated by the owner to the orchestrator (see 0033); not a human sign-off.

## Decisions
1. **One landmark species per approach.** East keeps the approved flowering grove (CommonTree_1 gate pair plus a flowering hedge of Bush_Common_Flowers behind the far east rail so it is in the bridge sightline). North is a tall Pine_1 pair behind the far satellite plus a supporting flank pair and a cool-tinted slate rock group. West is a broad CommonTree_1 pair behind its satellite plus a warm-tinted rock group, with no flowers. South is a TwistedTree_2 pair behind its satellite over fern banks. TwistedTree_2 is reserved for the south: islets now alternate CommonTree_1 and Pine_1 only, which also frees triangle budget.
2. **Landmarks sit behind the far satellite, not beside the bridge.** Flank placements were outside the frame at gameplay distance; backdrop pairs bracket the sightline across the bridge. They never occlude a fighter because they are 20 m or more beyond melee distance. Every crown stays outside walkable ground (unit test, conservative radial bound).
3. **Boundary versus safe bridge.** A 0.5 m darker meadow band follows each outer island edge and stops 0.3 m short of each bridge mouth, where four flush stepping slabs (under 0.07 m, code-built, one tone per approach) mark the way. Slabs and band are original geometry, no new third party asset.
4. **Quiet centre kept; pillar ring varied.** Nothing is placed inside the 12 m clear circle. The four pillars now differ in boulder model, size, tint, base tone and moss height.
5. **Tiering.** `EnvPlacement.extra` marks supporting props; they live in the group `env.dressing.extra`, hidden on low by GameScene.setQuality (a 3-line change in GameScene.ts, outside the QE01 owned list, taken because the plan asks for tier gating and no other file can toggle it; QP02 owns GameScene and should absorb it). Low keeps core landmarks and, new, a sparse third of the ground tufts (`deco.coverLow`, about 1,300 triangles) so low no longer reads as bare plain. Dense tufts stay medium and up.
6. **Budget method.** Each (model, region) pair is its own InstancedMesh so the frustum culls approaches behind the camera (calls rise, triangles fall). Rim boulders were thinned by half and clouds use 8x5 spheres. SimplifyModifier ratio changes did not move counts for Twisted or RockPath (seam floor), so instance counts were the lever.
7. **Licences.** No new third party files. Reused Quaternius Stylized Nature MegaKit (CC0 1.0, `assets/vendor/quaternius-stylized-nature/License.txt`, already in the manifest): CommonTree_1, Pine_1, TwistedTree_2, Fern_1, Bush_Common_Flowers, Grass_Common_Short, Rock_Medium_1..3. Instance tints are a runtime colour multiplier, no edited asset.

## Rejected
- Spending RockPath_Round_Thin (about 2,250 triangles each) on every bridge mouth: code-built slabs cost about 40 triangles.
- Region-free single meshes per model: every visible instance draws, which pushed a spawn view past 150k.
