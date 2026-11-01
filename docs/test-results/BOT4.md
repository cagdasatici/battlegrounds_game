# BOT4 — Authoritative room integration

Date: 1 November 2026. Node v26.10.0 locally (repo pin is 24.22.2; pnpm warned, nothing failed).
Prerequisites: BOT1 and BOT2 merged to main (831a8e8).

## Delivered

- `apps/server/src/rooms/SparringRoom.ts`: `sparring` room extending ArenaRoom. Bots are PipelineSeats
  (via the new `pipelineSeats()` hook) fed with `decideBot` before the input drain at the fixed tick;
  they are never Colyseus clients. Humans stay in the normal seat map with ticket auth, reconnect
  and owner messages. Each bot is scored once per life by the ordinary pipeline.
- Movement safety: each tick the proposed 0.6 m step rechecks real ground (raycast), step/drop
  height and a blocked segment; unsupported or blocked steps are neutralised.
- `apps/server/src/http/sparringRoutes.ts`: POST /api/sparring, /link, /redeem, /end and GET
  /api/sparring/guest, per the frozen contract. Hosted join tickets go through the existing
  `/api/join-ticket` (ordinary session only if it owns the match, else the matching guest cookie;
  CSRF checked against that principal; a guest cookie never authorizes any other room or route).
- Rooms are created by the create route only (one-use creation grant), so SDK `create` /
  `joinOrCreate` cannot open one; `autoDispose` is off so a failed foreign join cannot close a match.
- Match lifetime: the room sweeps the directory once a second from the sim tick (works with zero
  clients). Host Leave, revoked session, exhausted 20 s grace, 60 s unjoined reservation and the end
  route all close the room and disconnect guests.
- Small shared edits: `AuthServices.sparring`, `SparringDirectory.isOpen`, ArenaRoom hooks
  (`resolveIdentity`, `pipelineSeats`, protected `poseOf`), exported helpers in `sessionRoutes.ts`.

## Checks executed

| Check | Result |
|---|---|
| pnpm typecheck | pass |
| pnpm lint | pass (boundaries, timers) |
| pnpm test | 1274 passed, 1 skipped, 2 todo (91 files; 1 skipped file pre-existing) |
| pnpm build | pass |
| pnpm content:validate | pass |
| tests/integration/sparring.test.ts | 8/8 real HTTP + Colyseus clients |

Covered: host plus bot (bot damages host, no synthetic client, bot has no owner record); fresh guest
with scoped cookie, reload recovery, authority isolation, duplicate admission 409; four-seat limit
and single-use link under simultaneous redeem; direct SDK create/join refusal, wrong/foreign tickets,
duplicate hosting, schema/CSRF errors; host Leave, end route, revoked session; unjoined and
dropped-host expiry with an injected clock; ring-out KO then respawn with deaths counted once and a
fresh scoreboard in a second match. The existing FFA and practice suites pass unchanged.

## Limits (not claimed)

- Interruption of a bot mid-attack and bot-vs-bot fights are not asserted by a dedicated test.
- Bots do no pathfinding; they only move on continuous reachable ground.
- Four-fighter performance is BOT5. Physical iPad checks: NOT RUN.
