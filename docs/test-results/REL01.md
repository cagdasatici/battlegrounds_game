# REL01 — tick fault containment

2026-11-03. Implemented per backlog-v3, with owner-approved extension to client main.ts because RoomClient has no close-code mapper. Code 4500 reuses the existing leave-to-welcome flow in every mode; no new UI. Handler unsubscribes during match cleanup.

Server marks the room faulted, logs only the error name in structured logs (development additionally prints the exception), closes clients with 4500, and disposes the room. Subsequent ticks do nothing. Added process exception/rejection handlers as specified.

Executed:
- Regression before implementation: 2 tests failed for uncaught pipeline throw / pipeline called despite faulted flag.
- Regression after implementation: 2 passed, including two real WebSocket clients receiving 4500 and a separate room continuing to advance.
- pnpm typecheck: PASS.
- pnpm lint: PASS.
- pnpm test: PASS; 120 files passed, 1 skipped; 1641 tests passed, 2 skipped, 2 todo; 171.83 s.
- pnpm build: PASS (includes assets:audit).
- git diff --check: PASS.

Sandbox initially denied loopback/tsx IPC; successful runs used escalated execution. Environment Node 26.10.0 differs from requested 24.22.2. Browser and physical iPad checks NOT RUN; leave-to-welcome wiring reviewed and typechecked, not browser exercised. Existing modified evidence excluded from this commit. No content data changed.
