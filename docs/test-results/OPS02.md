# OPS02 — minimal background hosting verification

2026-11-02. Prerequisites: T28 implemented; OPS01 fc87481.

Existing owner host inspected without exposing env-file secrets:
- Game launchd job com.elementalbattlegrounds.server is loaded, has a PID, RunAtLoad and KeepAlive. It serves the separate .worktrees/prod checkout.
- GET http://127.0.0.1:2567/healthz: HTTP 200.
- AC system sleep is 0; automatic restart after power failure is 1.
- Tunnel system plist has RunAtLoad, KeepAlive and config-based named tunnel arguments. System launchd inspection confirmed state=running and a PID; last exit code was never exited.
- Source review: createGameServer registers room types without allocating simulations; RoomDirectory.ensure lazily creates and coalesces requests. Sparring lifetime remains deliberately membership-owned. No combat scheduler changes.

Executed with Node 24.22.2:
- pnpm vitest run tests/integration/t28-production.test.ts tests/integration/open-join.test.ts tests/integration/colyseus-smoke.test.ts: PASS, 12 tests; actual production HTTP and two real Colyseus clients, session/open-join and practice flows.
- pnpm typecheck, pnpm lint, pnpm build including assets audit: PASS during OPS01; OPS02 changes documentation only.

No new background software needed. No public deployment, restart, invitations, host settings or credentials changed. Reboot/FileVault login, physical iPad and owner-network first-spawn timing: NOT RUN. Existing unrelated screenshot/report modifications left untouched.
