# ORB2 — replicated Ember Orb rendering

2026-11-01. Prerequisites: T19 projectile replication (107e90d, 83feef4), T20 shipped orb (cef3142, eaff0cd), T21 selectable Artificer (b4e72a5, bbcda67). Existing device limitations do not block desktop presentation work.

Persistent orb meshes read the replicated projectile map through GameLoop. Centimetre positions/velocities use the existing 100 ms SnapshotBuffer interpolation and bounded extrapolation. Reflection clears incoming trajectory history and changes the shell to cyan; full charge increases visual size. Server removal/zero lifetime removes the mesh. Loop shutdown clears views and scene disposal releases shared geometry/materials. No gameplay authority or timing changes.

Executed checks:
- pnpm typecheck — PASS.
- pnpm lint — PASS (boundary and timer checks).
- pnpm test tests/unit/projectile-views.test.ts tests/unit/game-loop.test.ts — 11 PASS.
- pnpm test tests/unit/projectile.test.ts tests/integration/projectile.test.ts tests/integration/ea-base.test.ts — 53 PASS.
- pnpm test:browser tests/browser/projectile.spec.ts — PASS, two independent Chromium contexts with SwiftShader and real Colyseus connections. Both scene meshes advance, reflect with replicated owner/count, reverse flight, and disappear at server lifetime expiry. Browser fixture spawns/reflects through the real server projectile system, rather than testing manual charge/counter timing. Screenshots: ORB2-flight-a.png, ORB2-flight-b.png, ORB2-reflected.png. Scene samples: ORB2-playwright.json.
- pnpm build — PASS, including assets:audit; existing bundle-size warning.
- git diff --check — PASS.

Initial sandbox runs could not bind local servers/tsx IPC; rerun with approved access. Initial browser fixture coordinate/camera errors were corrected before the passing run. Commands ran on Node 26.10.0; pinned Node 24.22.2 was NOT RUN. Build and checks used the working tree, which also contains unrelated owner edits excluded from this commit. No data or shipped asset changes. Physical iPad/Safari checks: NOT RUN.
