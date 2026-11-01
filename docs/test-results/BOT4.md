# BOT4 — Authoritative room integration

Date: 1 November 2026. Prerequisites: BOT1 fd80a2c, BOT2 e761c3a.

## Implemented behavior

- Registered private `sparring` rooms with the frozen create/link/redeem/end/guest HTTP contracts. Reused strict schemas, origin, CSRF, 1 KiB body limit and limiter policies. Ordinary credentials authorize hosting; guest cookies authorize only their issuing match. Single-use tickets bind room, protocol and content hash.
- Socket admission synchronously claims directory membership; simultaneous tickets cannot create two fighters. The existing room directory prevents duplicate room creation. Ordinary Ready validation remains mandatory for humans.
- Human transport seats remain separate from bot PipelineSeats. Stone Vanguard bots, named in roster order, submit held intent and increasing skill edges before the existing pipeline drains at 60 Hz. They use ordinary movement, combat, cooldowns, interruption, KO scoring and respawn. Public poses/actions and each bot's own cooldowns feed BOT1.
- Voluntary movement predicts the ordinary walk step and queries the loaded static collider world for capsule obstruction and ground support. No pathfinding or second physics scheduler. Combat displacement retains its existing rules.
- A wall-time membership sweep runs independently of connected clients; it closes expired/revoked/unjoined/dropped hosts and disposes rooms. Its timer is cleared on shutdown. Host end/leave closes guests, invalidates links and allows rehosting; reconnect retains the existing entity/life and renews its input epoch.
- Added an internal immutable directory lookup for integration; frozen network schemas and BOT1 exports are unchanged.

## Verification

Pinned runtime: Node 24.22.2, pnpm 10.28.0. Local sockets enabled for real-client tests.

- Initial targeted suite: PASS, 7 real-client tests.
- Expanded targeted suite: PASS, 9 real-client tests, including all tiers, interruption, KO/180-tick respawn, score isolation, fresh guest scope, reservations, concurrent admission, Ready validation, host reconnect, explicit end/rehost, revocation with no connected clients, collider edge/obstacle checks, bot respawn reaction delay, link/reservation/host grace expiry.
- Typecheck and lint: PASS before full verification.
- Full `pnpm verify`: PASS. Typecheck, lint, 92 files / 1,290 tests passed (2 existing TODOs), build, asset audit and content validation. Existing large-chunk build warning remains.
- `git diff --check`: PASS before full verification.

## Limitations

Physical iPad touch, clipboard, reconnect and ten-minute matches: NOT RUN.
BOT5 owns browser journey acceptance. Bots use direct approach on reachable continuous ground and intentionally stop at unsupported edges or solid obstacles; map-wide pathfinding is outside this slice.
