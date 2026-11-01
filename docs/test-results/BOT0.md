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

## Completion verification

Completed 1 November 2026 on Node v24.22.2, with local socket access for the
real-client integration tests. Production contracts are unchanged from f8a66a5.

- `pnpm verify`: PASS, exit 0. Includes typecheck, lint, the complete unit and
  integration suite, production build, assets:audit and content:validate.
- Full suite: 88 files passed; 1226 tests passed, 2 existing TODO tests (packet
  loss 1% and 3%, not BOT0 acceptance). Duration: 171.42 seconds.
- `pnpm exec vitest run tests/unit/sparring-contract.test.ts`: PASS, 11 tests.
  Covers all difficulties, ordered 0/3 bot rosters, rejection of 4 bots, unknown
  and missing fields, invalid literals, malformed codes, credentials, display
  names and expiry values, plus the pure integration type boundary.
- assets:audit: PASS, 28 entries, 3 fighters, 93 clips, provenance complete.
- content:validate: PASS, hash 6361e0b51fe4a072, 22 colliders, 8 spawns,
  36 abilities.
- `git diff --check`: PASS.

### Resolution of the previous pending gate

The prior report classified silent aggregate runs as stalled and stopped them
before completion. This diagnosis was premature: cached integration file times
included roughly 94 and 171 seconds. The full verification above was allowed to
finish and passed without any runner or production-code change. The previous
sandbox EPERM failure was avoided by granting local socket access. BOT0 is DONE;
BOT1, BOT2 and BOT3 may use the frozen shared exports.

## Limitations

Physical iPad checks: NOT RUN. BOT0 adds only pure shared contracts and does not
claim device, network integration or playable hosted sparring acceptance.

The existing production build warning for a client chunk larger than 500 kB remains.
