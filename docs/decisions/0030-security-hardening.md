# 0030 Security hardening (T29)

Status: accepted. Slice T29. Spec section 24, probes A16 and A17.

## Decision
- Headers (apps/server/src/http/securityHeaders.ts), on API and static responses: CSP, `nosniff`, `Referrer-Policy:
  no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`. CSP: `default-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval'`, `style-src 'self'`, `img-src 'self' blob: data:`, `connect-src 'self' data: <ws origin>`,
  `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`. No unsafe-eval, no unsafe-inline.
  Exceptions, each needed by the shipped client: `wasm-unsafe-eval` (Rapier WebAssembly) and `connect-src data:`
  (GLTFLoader fetches base64 buffers embedded in glTF files). The inline `<style>` in index.html moved to src/base.css.
- Session exchange limits: 5 attempts per minute per source and 30 per minute globally (was 10 per source).
- WebSocket upgrade: `ArenaRoom.onAuth` (and so `PracticeRoom`) refuses a present Origin that is not on the allowlist.
  A missing Origin (non-browser client) is still allowed because the one use, room bound ticket is the credential.
- Ten invalid messages in ten seconds disconnect the client (`InvalidMessageGuard`); only the category is logged.
  Counted: malformed input packets, schema failures on ready, changeKit, ping and practice, and unknown message types.
- `SessionStore.purgeExpired` runs at start and every 24 h (main.ts). `ops/scripts/revoke-session.ts` revokes by id or
  unique prefix. `pnpm security:scan` flags private keys, bearer values, invite fragments and secret assignments.

## Limits
- Per-action buckets already existed (input, ready/changeKit, ping, practice) and are unchanged.
- No TLS termination here; that stays with T28 hosting.
- Input rate-limit rejections are not counted as invalid, so five finger bursts and reconnects are tolerated.
