# 0027 Smooth skinned fighter meshes (ART2)

Status: accepted (ART2; owner chose option B in ART0, 2026-11-01).

- **Same rig, same clips, same capsule.** `rig.ts` is untouched. Every pass of every kit stays within the 1.8 m capsule
  plus 0.25 m (|x|, |z| <= 0.60 m, |y| <= 1.15 m); `tests/unit/fighter-model.test.ts` asserts it for medium and low.
  Three ember rings were pulled inward (z 0.42 to 0.34 m, smaller radius) to meet that bound.
- **Parts.** `box` is now a rounded box (2 segments per side, beveled, analytic normals). New `limb` shape is a tapered
  capsule (12 radial segments medium, 8 low) with a small muscle bulge. Hands are a beveled palm plus a thumb capsule;
  heads are rounded, with brows and a mouth (the old eyes sat 6 mm inside the head and are now in front of it).
  Each kit gained a layer: Stone Vanguard tassets and back slab, Tide Duelist scarf and long cape, Ember Artificer
  apron and shoulder plates.
- **Joint blending.** Limbs are skinned to two bones over `JOINT_BAND` = 0.06 m (0.03 m each side of the joint) at
  shoulders, elbows, hips and knees. The upper and lower limb meet at the joint plane with identical rings and 50/50
  weights, so posed rings coincide (gap < 5 mm at 90 degrees, tested on both sides and both bend directions, with a
  pinch check that the ring keeps at least 60% of its radius). Adjacent limb radii must match at the joint; the test
  caught a 6 mm mismatch on the Tide Duelist arm that is now fixed.
- **Textures.** `makeKitAtlas(kit)` generates a 512 px RGBA `DataTexture` per kit: a 4x4 grid of 128 px cells, one per
  palette slot, with gradient, grain and slot patterns. The body material uses it as `map`; the glTF export keeps
  vertex colours (`assets:audit` forbids embedded textures, and `art-gltf.ts` is outside this slice). The pixel data is
  cached per kit; each rig owns and disposes its own texture object.
- **Level of detail.** `buildFighterGeometry(kit, pass, lod)`. Low drops fine parts (brows, mouth, thumb), uses 1
  segment boxes, 8-sided limbs and a coarser outline. The outline hull always uses the cheap detail. `FighterRig.setLod`
  swaps geometry in place (still 3 draw calls). `FighterView.setShadows(false)`, which GameScene already calls on the
  low quality tier, switches to the low level of detail; this avoids editing `GameScene.ts`.
- **Budgets (body + glow + outline).** Medium 3.3k to 4.3k triangles (cap 8k); low 1.6k to 2.1k (cap 3k).
