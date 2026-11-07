# WORLD01 Sunreach Coast and map selection

## What changed

- New map `coast` (collision id `coast.v1`, theme `coast`): a flat sand slab 108 x 88 m (top y = 0, so CRATER01 craters, Rapier and client prediction work unchanged), four boundary walls (role `guardrail`, ids `shore.*`) standing 1 m inside the slab edge, 8 palm trunks, 7 boulders and 4 driftwood logs as cover, 8 spawns, 8 urns and 4 beast anchors. Source: `packages/shared/src/config/worlds.ts`; artifact `assets/maps/coast.v1.json` (kept equal by `pnpm content:validate`).
- Water is an out-of-bounds boundary: the server collides with the shore walls and the client predicts with the same colliders, so a fighter is clamped at the waterline. The kill plane and boundary radius now come from the loaded map (`TickPipeline.voidKos`) instead of the grove constants.
- Map selection (server authoritative): `MapIdSchema` (registry membership, `Object.hasOwn`, so `__proto__` and `constructor` are refused) is part of `SparringCreateRequestSchema`, `SparringConfigSchema` and `AdminRoomCreateSchema`. `SparringDirectory` stores it, `SparringRoom` / `BotArenaRoom` set `ArenaRoom.mapId` before `onCreate`, which loads `assets/maps/<collisionMapId>.json`, re-seats the urns and replicates `state.mapId` and `welcome.mapId`. Default is `grove`.
- How a player picks a map: Welcome screen, Host sparring, "Map" select (Floating Grove, Sunreach Coast); admins pick it in the Rooms form. Guests joining a hosted or listed match get the host's map automatically (the scene swaps after the welcome message).
- Client: `apps/client/src/render/worlds/` (coastShape, Water shader, props, coastWorld, index). `GameScene.setWorld(map, colliders)` swaps lights, ground, props and environment layer without leaking resources (grove and coast swap tested three times with an equal resource count).
- Quality tiers: low hides decorative dune grass, clouds shell and motes, drops shadows; medium and high add shadows, tone mapping and denser ground cover (the beach scales the instanced grass down to 12 percent so the sand stays open).

## Executed checks (this Mac)

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass |
| `pnpm test` | 159 files passed, 1 skipped; 2012 tests passed (before the final doc edits) |
| `pnpm build`, `pnpm assets:build`, `pnpm assets:audit` | pass (47 manifest entries) |
| `pnpm content:validate` | pass: islands.v1 and coast.v1 equal their code definitions, validator clean |
| `tests/unit/maps.test.ts` | registry-wide: artifact equals code, colliders and spawns inside bounds, spawns 1.5 m clear of obstacles, urns clear, beast ring walkable, fighter pushed against every edge stays inside, craters accepted on ground / refused off it / lower fighter in the bowl, schema rejects unknown ids |
| `tests/integration/map-select.test.ts` | real server and clients: default grove; `coast` loads coast.v1, replicates `state.mapId`, welcome carries it, urns re-seated, fighters spawn on the beach; every registry map selectable; unknown ids refused |
| `tests/browser/world-maps.spec.ts` | Chromium with SwiftShader WebGL: no console or shader errors; triangles (SwiftShader render info) low 113 k, medium 184 to 192 k, high 247 to 255 k |
| `tests/browser/sparring-flow.spec.ts` | 4 passed, 1 failed: the "zero bots ... KO" test expects one human to KO another, but hosted sparring protects humans from each other (`SparringRoom.humansProtected = true`, unrelated to maps); not changed here |

Screenshots (medium tier, SwiftShader): `docs/test-results/WORLD-coast-overview.png`, `-sea.png`, `-shore.png`, `-north.png`; budgets in `WORLD-coast-budget.json`.

## Not run / limits

- Physical iPad check: NOT RUN. Real GPU frame timings: NOT RUN (the budgets above are triangle counts from a CPU rasteriser).
- The shore walls are `guardrail` colliders, so the wall-attack context move can trigger at the shore line (harmless, noted).
- Practice and open arena rooms always play the grove; the room list rows do not show the map.
- Dunes are visual only (outside the walls); the playable sand is flat by design.
