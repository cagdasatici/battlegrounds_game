# WEB5 test report: admin app screens

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only).

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| pnpm test | PASS: 101 files passed, 1 skipped; 1345 tests passed, 1 skipped, 2 todo (adds admin-api 4 tests, admin-static 1 test) |
| pnpm build | PASS (admin entry emitted as assets/admin-*; none listed in asset-manifest.json) |
| playwright tests/browser/admin.spec.ts + install.spec.ts | PASS: 8 of 8 |

Coverage: login failure and success; Status; Invites (double-click creates one, link shown once, gone after Done, screen change and reload, revoke); Players (empty, list, revoke); Rooms (create, unlist, list, close); Announcement (publish, public read, clear); error state; 401 returns to Login and removes the nav; Status polling stops after leaving the screen; /admin served no-store; service worker bypasses admin paths.

Limitations: screen DOM states are covered in a real browser rather than a DOM unit test (no DOM library, no new dependencies). Not run on a physical iPad (NOT RUN). QR code for invites not implemented (optional in the plan). Admin sessions remain in memory (WEB4).
