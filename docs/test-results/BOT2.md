# BOT2 — Private sparring membership

Date: 1 November 2026. Prerequisite: BOT0 contracts f8a66a5, completed
verification c54850c. Runtime: Node v24.22.2.

## Delivered

`apps/server/src/auth/SparringDirectory.ts` implements a synchronous in-memory
membership directory with injected wall time and ordinary-session liveness.
It creates immutable bot rosters, reserves the host seat, permits one match per
host, replaces unused single-use links, and atomically redeems links into scoped
guest credentials and seats. Link and guest cookie bearers are stored as hashes.
No HTTP, room, UI, invitation delivery, deployment or dependencies were added.

The API exposes create/link/redeem/authorizeJoin/connected/dropped/left/end/sweep,
plus guest cookie recovery and a copied roster config. Typed failures carry
400/401/403/409 status codes for the later HTTP adapter. Host principals must
come from ordinary session authentication; guest principals come from guest().
Repeated ticket requests reuse the same reservation without extending expiry.
connected() claims a seat synchronously before any room-join await; a second
connection is rejected. Connection IDs protect against stale lifecycle calls.

BOT4 integration obligations:

- Validate origin, session, CSRF, body limits and rate limits in HTTP handlers;
  use the existing ticket store and never accept a client-supplied principal.
- Inject a non-touching ordinary session lookup (SessionStore.getById).
- Call sweep independently of connected clients; disconnect/dispose every
  returned closed room. Explicit host left/end also requires room disposal.
- Call connected after ticket consumption and before awaiting admission; pair
  failed admissions with left to release resources. dropped retains a seat for
  20 seconds. left is for an active connection; end handles authenticated host
  termination even while dropped.
- Host creation and guest redemption reservations expire at exactly 60 seconds;
  reconnect grace expires at exactly 20 seconds; links at exactly 10 minutes.
  Directory restart discards all credentials and memberships.

## Verification

- Focused directory suite: PASS, 16 tests. Covers config, owner/guest authority,
  replay/replacement, expiry boundaries, last-seat competition, repeat tickets,
  cross-room isolation, duplicate admission, stale lifecycle callbacks, host
  join/reconnect timeouts, explicit leave/end, revoked/expired session lookup,
  guest cleanup, restart and copied roster protection.
- Full `pnpm verify`: PASS, exit 0; typecheck, lint, 90 test files / 1262
  passing tests / 2 existing TODOs, build, assets:audit and content:validate.
  Duration: 171.22 seconds. The run also discovered concurrent BOT1 tests.
  Four additional parameterized capacity checks were added afterward and the
  focused 16-test suite was rerun successfully; production code is unchanged.
- assets:audit: PASS, 28 entries / 3 fighters / 93 clips.
- content:validate: PASS, hash 6361e0b51fe4a072.
- git diff --check: PASS. Existing client chunk-size build warning remains.

Physical iPad checks: NOT RUN. Real-client hosted sparring checks belong to
BOT4/BOT5; this slice provides only the independent auth directory.
