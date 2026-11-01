# WEB1 test report: installable client and offline shell

Executed on macOS, Node v26.10.0 (repo wants 24.22.2; engine warning only).

| Check | Result |
|---|---|
| pnpm typecheck | PASS |
| pnpm lint | PASS (boundaries ok, timers ok) |
| pnpm test | PASS: 93 files passed, 1 skipped; 1294 tests passed, 1 skipped, 2 todo (includes tests/unit/sw-routing.test.ts, 4 tests, with a parity check against public/sw.js) |
| pnpm build | PASS (emits asset-manifest.json, sw.js stamped with build id) |
| playwright tests/browser/install.spec.ts | PASS (1 test, Chromium): manifest linked and valid, MIME application/manifest+json, sw.js no-cache with Service-Worker-Allowed /, worker controls page, reload with the real server stopped renders, /api/version fails offline (not served from cache), no /api or /healthz entries in caches, no worker/manifest CSP violations |

CSP: unchanged. Existing `worker-src 'self' blob:` and `default-src 'self'` already cover the worker and manifest.

Not run: physical iPad checks (Add to Home Screen, fullscreen, landscape): NOT RUN.
Limitations: no /api/version buildId comparison or update UI (WEB2). The service worker registers in production builds only. Pre-existing inline-style CSP console messages from app code were not touched.
