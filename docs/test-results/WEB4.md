# WEB4 test report: admin API and login

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only).

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS |
| pnpm test | PASS: 97 files passed, 1 skipped; 1326 tests passed, 1 skipped, 2 todo (includes tests/unit/admin-auth.test.ts, 4 tests, and tests/integration/admin.test.ts, 11 tests) |
| pnpm build | PASS |

Coverage: disabled without a hash (404, public announcement still served); wrong password 401, strict body 400, foreign origin 403, sixth attempt in a minute 429 (even with the right password); cookie flags (HttpOnly, SameSite=Strict, Path=/api/admin, Secure, 2 h) and 1 KiB body limit 413; every route rejects missing cookie, ordinary player cookie, missing/wrong CSRF, foreign origin and missing origin on non-GET; admin cookie rejected on /api/rooms, /api/csrf, /api/join-ticket; status, invites (link once, list and revoke never expose tokens, link works), sessions (prefix only, revoke, unknown 404), rooms (create, public listing name, unlist, join, delete, sparring list/unlist/close, unknown 404), announcement (set, public read, clear, expiry, length, strictness), logout; no password, hash, cookie or invite token in any log line. Unit: scrypt round trip, idle (30 min) and absolute (2 h) expiry, lockout after 8 failures for 15 min, env parsing without echoing values.

Limitations: admin sessions and admin-created rooms are in memory (a server restart signs the admin out and drops created rooms; TODO in Services.ts). The 20 per hour global login limit is covered by construction (RateLimiter) but not exercised by a test. Same-origin GETs may omit Origin (browser behaviour); mutations require an allowed Origin. Admin screens are WEB5. Operator steps (ADMIN_PASSWORD_HASH via ops/scripts/admin-hash.ts) not yet documented in the hosting guide.
