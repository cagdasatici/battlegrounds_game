# BOT0 — Freeze sparring contracts

Date: 1 November 2026. Runtime: Node v24.22.2 (repository pin).
Prerequisites: T18d (14ebb33, 7563d46, 3953a63, 28239f4) and T33a
(d3c3333) are implemented; their outstanding device checks do not affect these
pure shared contracts.

## Delivered

- `packages/shared/src/sparring.ts`: strict create/link/redeem/end/guest records,
  difficulty and ordered 0–3 bot config, room code and credential validators,
  inferred route types, exact pure bot observation/decision and setup types.
- Existing `@eb/shared/*` export resolves `@eb/shared/sparring`; verified through
  the server's tsx runtime. No package manifest or dependency change needed.
- `docs/sparring-plan.md` freezes export names and credential encoding using the
  existing auth helpers. HTTP 204 has no body; join-ticket contracts are reused.
- No room, HTTP route, bot logic, UI, deployment or invitation delivery added.

## Executed checks

- `pnpm exec vitest run tests/unit/sparring-contract.test.ts`: PASS, 11 tests.
- `pnpm exec vitest run tests/unit`: PASS, 60 files / 1078 tests.
- `pnpm typecheck`: PASS (via verify).
- `pnpm lint`: PASS (via verify).
- `pnpm build`: PASS, including assets:audit (28 entries, 3 fighters, 93 clips).
  Existing large client chunk warning remains.
- `pnpm content:validate`: PASS, content hash 6361e0b51fe4a072.
- `pnpm exec vitest run tests/integration/colyseus-smoke.test.ts --reporter=verbose`: PASS, one real-client join/ticking-state test.
- `git diff --check`: PASS.

Aggregate verification: NOT PASSED. Initial sandboxed verification on the
default Node 26 failed because local listening sockets were forbidden (EPERM).
Repeated on pinned Node 24 with socket access: the parallel run produced no test
results before it was stopped. The one-worker retry also produced no results
after more than two minutes. An aggregate run excluding the latency matrix
also stalled; the isolated smoke test above completed successfully. Stalled
runs were stopped. Per the sparring plan stop-and-report rule, no further
aggregate retries or unrelated runner changes were made. Root cause is not
established. BOT0 remains IN PROGRESS pending a completed aggregate gate;
focused acceptance, all unit tests, typecheck, lint, build and content validation
have passed.

## Limitations

Physical iPad checks: NOT RUN. BOT0 adds only pure shared contracts and does not
claim device, network integration or playable hosted sparring acceptance.
