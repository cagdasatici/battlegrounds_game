# ART1 follow-up — east spawn-to-bridge route

Date: 2026-11-01. Prerequisite: ART1 implemented (4c5f8c3), CC0 source decision 0023 accepted.
Status: IMPLEMENTED (DEVICE CHECK PENDING).

Sage meadow variation and warm wear replace the green slab treatment. Broadleaf trees frame the east bridge;
west pines create a contrasting skyline. Rock shelves support off-footprint trees. Low MegaKit fern/flower/stone
clusters line the east deck margins; no collider, spawn, bridge lane or centre glyph changes.

Executed on macOS, Node 26.10.0 (repository requests 24.22.2; engine warning), Chromium SwiftShader:

- `pnpm typecheck`: PASS.
- `pnpm lint`: PASS.
- `pnpm exec vitest run tests/unit/arena-visuals.test.ts`: PASS, 6 tests. Collider AABBs, deterministic dressing,
  landmark crown clearance, low cover below 0.15 m, margin clearance, CC0 provenance and asset size.
- `EB_ART_TAG=route pnpm exec playwright test tests/browser/arena-screens.spec.ts`: PASS, 4 tests.
  Loaded environment ready; two overview sizes, spawn route and reverse gameplay views.
- `pnpm assets:build`: PASS; manifest and provenance regenerated.
- `pnpm build`: PASS, including `assets:audit` (37 entries, 6,327,708 bytes). Existing bundle size warning remains.
- `pnpm content:validate`: PASS, unchanged map hash 6361e0b51fe4a072, 22 colliders, 8 spawns, 36 abilities.

| Capture | Calls | Triangles |
|---|---:|---:|
| Overview 1024x768 | 70 | 128664 |
| Overview 1180x820 | 72 | 128880 |
| East spawn route | 68 | 145892 |
| Reverse | 46 | 123948 |

All measured frames are within 120 calls / 150,000 triangles. Earlier dense iterations exceeded budget and were
reduced; final captures overwrite those iterations. Reviewed ART1-route-route.png, ART1-route-reverse.png,
ART1-route-route-low.png and overview captures. Trees frame the forward view without covering fighters; reverse
view keeps fighters clear, with trees outside the camera crop. Low quality retains the broadleaf frame.

Physical iPad Safari, frame rate and memory: NOT RUN. This is a static scene art check, not a network/combat performance test.
