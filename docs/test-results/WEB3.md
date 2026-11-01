# WEB3 test report: room list and one-tap join

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only).

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| pnpm test | PASS: 95 files passed, 1 skipped; 1311 tests passed, 1 skipped, 2 todo (includes tests/unit/room-list.test.ts, 9 tests, and tests/integration/room-list.test.ts, 8 tests) |
| pnpm build | PASS |
| playwright tests/browser/room-list.spec.ts | PASS (3 tests, Chromium) |
| playwright sparring-setup, flow, onboarding-flow specs (regression) | PASS (15 tests) |

Real-client integration coverage: 401 without session; 403 foreign origin; strict response schema with no session id or display name; practice never listed; arena counts follow real seats (0, 4 of 4, 3 after a leave); full arena join-ticket returns 409 ROOM_FULL; two simultaneous joins for the last arena seat admit one; unlisted sparring never listed; listed sparring listed only once the host is connected, counts only (keys: roomCode, name, kind, players, capacity, bots); unlisted match join returns 409; signed-in guest joins a listed match and reaches the room, cannot end it; two simultaneous joins for the last sparring seat admit one (other 409); strict-schema 400s for create(listed) and join, 401 unauthenticated, 403 bad CSRF/origin, 409 own match; ordinary FFA and practice regression.

Behaviour notes: `GET /api/rooms` uses the ticket limiter (20 per minute per session); the room panel refreshes every 10 s while open. Arena join-ticket now returns 409 ROOM_FULL when the room already holds its capacity (earlier the ticket was issued and the socket join failed).

Not run: physical iPad check of the room list and one-tap join: NOT RUN.
