# 0052 — VIS01 visual overhaul

Date: 2026-11-02. Authority: owner explicitly requested the full visual pass in one session, commit to main and push. This overrides the usual per-slice scope confirmation for this session. VIS01 is one presentation task, with UX10c, UX05, UX06 and DJ01 already implemented; the latest gameplay changes in c10e626 are retained.

Local art decisions (D): compact translucent rim-lit flashes replace solid additive balls; special hits add a directional fan rather than another explosion. Thin shockwaves, tapered streaks, curved water/flame trails and bounded dynamic lights preserve the fighter silhouette. Beam particles have explicit heading and anisotropic scale; legacy timing, server cover clipping and pool limits remain in force. Fault Strike's contact particles last 0.16 seconds instead of 0.5 seconds and no longer cover the victim's torso. The shared debris pool uses diffuse lighting.

The arena gains a flush radial stone court, flagstone routes, pillar inlays, irregular rock outcrops, distant suspended spires and a sun. Colours, sky gradient and directional/fill lighting are revised. Fighters retain their rigs, animations, collision extents and kit silhouettes, with thinner ink outlines, quieter fabric textures, facial planes, swept hair, soles and costume trim. Fine details use the existing low-detail primitives to stay within the current per-kit triangle allocations; Low omits them.

All geometry is original procedural work. No dependencies, downloaded artwork, physics, combat rules, movement or server authority changed. Original generated fighter assets and the manifest are regenerated with the existing art tool. Draw-call and triangle caps are unchanged (120 / 300k); physical iPad checks remain NOT RUN. This is an implementation and desktop visual review, not owner or device acceptance.

See docs/test-results/VIS01.md for executed checks, browser evidence and limitations.
