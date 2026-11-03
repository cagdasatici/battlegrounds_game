# OPEN01 test report: open-join session survives an IP change

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only). Decision: docs/decisions/0053-open-join-survives-ip-change.md.

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| tests/integration/open-join.test.ts | PASS: 8 of 8 (2 new) |
| pnpm test | PASS: 125 files passed, 1 skipped; 1671 tests passed, 2 skipped, 2 todo |
| pnpm build | PASS |

New tests (real clients, real server): same cookie with a new `cf-connecting-ip` returns 200 and the same session (same csrf token); the new address hash is not stored raw; a ticket issued afterwards is bound to the same session (room answers SEAT_TAKEN, no second seat) and the reconnection token resumes the same seat; a different displayName from a new address creates a new session.

Limitations: the backlog test said "x-forwarded-for"; the server trusts `CF-Connecting-IP` (loopback peer only), so the test varies that header. A fresh ticket during the reconnect window is refused (SEAT_TAKEN) by existing room behaviour; the seat resumes via the reconnection token. Not tested from a real phone changing networks (NOT RUN).
