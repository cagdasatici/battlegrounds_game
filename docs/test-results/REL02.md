# REL02 — reuse entity ids

2026-11-03. Prerequisite REL01: 33a08b4.

ArenaRoom allocates the lowest unused id in 1..255 and throws ROOM_FULL on exhaustion. Humans, bots and practice dummy all use the allocator. Each player is inserted before the next allocation. Life ids retain their room-wide sequence; documented the pre-existing uint16 limit. No nextEntityId references remain in apps or tests.

Spec conflict resolved using the existing strict protocol: practice accepts at most TWO bots, not the three requested by the backlog's test. Tested 130 add/remove cycles (260 bot allocations) instead of 100 three-bot cycles. The test fixture lifts only the practice command rate bucket so the stress test runs quickly; messages still traverse real sockets and schema validation. Production capacity and rate limits are unchanged.

Executed:
- Regression before implementation: 4 failures, including invalid uint8 id after churn and new occupant receiving 3 instead of freed id 1.
- Focused regression after implementation: 4 passed, 13.88 s. Covers allocator hole/exhaustion, practice churn, human id stability, owner-view isolation, HP preservation, room-unique new life, and real combat messages dropping an old-life event while accepting a current-life event through CombatBus.
- pnpm typecheck: PASS.
- pnpm lint: PASS.
- pnpm test: PASS; 122 files passed, 1 skipped; 1645 tests passed, 2 skipped, 2 todo; 171.59 s.
- pnpm build: PASS (includes assets:audit; existing large-chunk warning).
- git diff --check: PASS.

Browser and physical iPad checks NOT RUN. No new client presentation, content data or assets. Environment Node 26.10.0 differs from requested 24.22.2. Existing modified evidence files excluded from commits.
