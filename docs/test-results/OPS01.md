# OPS01 — production admin bootstrap

2026-11-02. Prerequisites: UX08, WEB4 and T28 implemented in task ledger.

Cause: admin:setup saved DATA_DIR/admin-password.hash; play loaded it, but production main.ts only accepted ADMIN_PASSWORD_HASH. Host inspection confirmed a mode-600 local hash and no environment hash. No password or hash was printed.

Production now loads that same private file before configuration validation. An explicit environment hash takes precedence; ADMIN_ENABLED=0 bypasses loading. Unreadable/unsafe files fail startup with a redacted configuration error (exit 78). Storage helpers now live in the server, re-exported by the setup script.

Executed with Node 24.22.2:
- pnpm typecheck: PASS.
- pnpm lint: PASS.
- pnpm vitest run tests/integration/admin-bootstrap.test.ts tests/integration/admin.test.ts tests/unit/admin-setup.test.ts tests/unit/t28-env.test.ts tests/unit/admin-auth.test.ts: PASS, 31 tests. Both actual play and actual production entry authenticate with the stored password and create an authenticated bot room.
- pnpm build: PASS, assets audit PASS. Existing large-bundle warning.

Sandbox socket restrictions required rerunning network tests and build outside the sandbox. No live release update or service restart performed. Physical iPad and actual owner password login: NOT RUN.
