# Hosted sparring implementation plan

Planning baseline: main at b6c9e56, 1 November 2026. All BOT rows are TODO. This is an additive local design (D) for spec section 6. Keep Play and the private Practice tutorial available. The existing tutorial's guard/ragdoll controls, refill and meter rules belong there. Hosted sparring uses ordinary FFA combat and room-local scoring. Art, effects, T21 and public hosting are independent of the feature.

## Player journey and limits

An adult-invited player opens **Host sparring**, chooses their playable fighter, then adds or removes up to three opponents. Default to one Medium bot. Each row has an Easy / Medium / Hard selector. Start creates a private match and freezes the roster atomically. After joining, the host may copy a guest link if a human slot remains. A fresh guest follows that link, enters a display name, chooses a playable fighter and joins this running match. Friends need not be present at Start. An authenticated host can practice alone without creating a link. Zero bots permits a friends-only room. Changing the roster requires ending the match and creating another.

Four total fighters including bots, humans and reserved reconnect seats. One live hosted match per host session. No public directory. Guest authority is limited to joining its issuing match. Only an ordinary adult-invited session may host, mint a guest link or end its own match. There is no global admin role. Preserve normal host reconnect for 20 seconds. Explicit host Leave, revoked/expired host session, exhausted reconnect grace or failure to join within 60 seconds of creation closes the match, invalidates links, clears reservations and returns guests to Welcome. Server restart ends hosted matches. Disconnect cleanup must work even when there are no connected clients.

## Contracts frozen by BOT0

All network records below are strict, with no additional keys. Use the current display name, kit, content hash, session, origin and CSRF validators. Local IDs and bearer secrets are distinct. Generate room codes as `sp-` plus 32 lowercase random hex digits. Register a separate Colyseus room name `sparring`. A code alone grants no access.

| Operation | Request | Success |
|---|---|---|
| POST /api/sparring | { bots: Difficulty[] } (0–3, ordered) | 201 { roomCode: string } |
| POST /api/sparring/link | { roomCode: string } | 201 { token: string, expiresAt: number } |
| POST /api/sparring/redeem | { token: string, displayName: string } | 201 { roomCode: string, csrfToken: string } and room-scoped HttpOnly guest cookie |
| POST /api/sparring/end | { roomCode: string } | 204 |
| POST /api/join-ticket | existing request/response | existing single-use ticket for the authenticated host or matching guest |

Difficulty wire literals are `easy`, `medium`, `hard`. The copy URL is configured game origin plus `/#spar=<token>`. Strip the fragment on read, keep token in memory only until redemption, and show a selectable link if clipboard access fails. Reuse the existing login fragment and cookie for ordinary invitations. Use a separate `eb_spar_guest` cookie for scoped guests, same flags as the session cookie. Bind guest CSRF and tickets to the guest session. For sparring choose the ordinary session only if it owns the requested match, else use its matching guest. General endpoints never authorize a guest cookie. For authenticated page reload use GET /api/sparring/guest to recover {roomCode,csrfToken} from that cookie only while its reservation or membership is valid.

Create/link/end and ticket issuance require allowed origin, matching session/CSRF, and the existing 1 KiB body limit. Redeem requires allowed origin and the session-route IP rate limit. Apply ticket-route limiter policy to host mutations. Token is 32 random bytes, hashed at rest, single use, wall-time TTL 10 minutes. Store hosted match state in memory on the single server. Minting replaces the previous unused link. Reserve the host slot on creation. Redeem consumes the link and reserves one available human slot in one synchronous transaction before issuing credentials. Expire an unjoined guest reservation after 60 seconds. Repeated ticket requests for the same principal share one reservation and cannot admit duplicate simultaneous fighters. On failure release provisional resources. Return 401 for invalid credentials/link, 403 for origin/CSRF/authority, 400 for schema errors, 409 for full/closed/already-hosting, 429 for rate limits. Never expose tokens in telemetry, screenshots or public player state.

## Bot behavior

Use Stone Vanguard for all bots, labeled Bot 1, Bot 2, Bot 3 in roster order. Bots fight the nearest living, connected, ready enemy including other bots. Break ties by numeric entity ID. Idle with neutral input when no enemy exists. Decisions read visible poses/actions and their own cooldowns only. At a decision tick face the target, approach at walk speed outside 2 m, stop and hold attack within 2 m. Medium/Hard may block instead when the target is visibly attacking within 3 m. Hard prioritizes a legal slot 1 cast within 2 m over its basic attack when not guarding. Hold decisions until the next sample, emit skill edges once with increasing IDs. Easy decides every 30 ticks, Medium every 15, Hard every 6. First decision is one full interval after spawn/respawn. All use ordinary HP, damage, cooldown, guard, stun, capture and respawn. Recheck ground on the proposed step each tick. Neutralize movement at an unsupported edge or solid obstacle. Map-wide pathfinding is outside this first version. Bots can fight on continuous reachable ground.

### TypeScript boundary for the three parallel lanes

BOT0 exports these types from `@eb/shared/sparring`. The directory owns its internal storage and the client owns its DOM. These are the only bot and setup data shapes either integration lane may assume.

```ts
export type Difficulty = "easy" | "medium" | "hard";
export type SparringConfig = { bots: Difficulty[] };
export type SparringPoint = { x: number; z: number };
export interface BotObservation {
  tick: number;
  spawnTick: number;
  selfId: number;
  self: SparringPoint;
  slot1Ready: boolean;
  enemies: ReadonlyArray<SparringPoint & {
    id: number; alive: boolean; connected: boolean; ready: boolean; attacking: boolean;
  }>;
}
export interface BotDecision {
  targetId: number | null;
  attackHeld: boolean;
  blockHeld: boolean;
  approach: boolean;
  castSlot1: boolean;
  yaw: number;
}
export interface SparringSetupActions {
  start(config: SparringConfig, kitId: "sv" | "td"): Promise<void>;
  copyLink(): Promise<string>;
  end(): Promise<void>;
}
```

BOT1 exports `decideBot(difficulty: Difficulty, observation: BotObservation, previousDecision: BotDecision): BotDecision`. Neutral defaults are null target, four false flags and zero yaw. Between samples clear castSlot1 (edge), retain the held flags. Reset to neutral if the target dies or disconnects. Use existing movement yaw convention. BOT3 exports `mountSparringSetup(root: HTMLElement, actions: SparringSetupActions): () => void`. copyLink obtains a fresh URL. The view owns clipboard write, fallback and disposal. Kit choices for this slice are sv and td even if T21 merges concurrently.

## Dispatch and ownership

All paths are repository-relative. One row per session. BOT0 merges first. BOT1, BOT2 and BOT3 can then run on separate branches with disjoint production and test files. BOT4 integrates the server after BOT1 and BOT2. BOT4C connects the client after BOT3, using the frozen HTTP contract and a local transport fixture. These integration lanes can overlap. BOT5 needs both. Before either integration lane, check open work on main.ts, ArenaRoom.ts and TickPipeline.ts (especially FX0/FX1). Wait for conflicting changes to land and rebase. Independent lanes can proceed while that happens. Only the integrator updates the shared ledger after each merge. Each lane writes its own docs/test-results/BOTn.md. Use the Node version pinned by the repo, pnpm verify and the targeted offline checks below. Physical device checks stay NOT RUN until performed.

| ID and commit subject | Files owned | Deliverable and offline acceptance |
|---|---|---|
| BOT0 — Define hosted sparring contracts | packages/shared/src/sparring.ts, tests/unit/sparring-contract.test.ts | Export Difficulty, the exact route schemas above, SparringConfig, and pure view/decision types. Export BotObservation with tick, spawnTick, selfId, self position, slot1Ready and enemies (id, position, alive, connected, ready, attacking). Positions are world-space x/z metres. Export BotDecision with targetId (number or null), attackHeld, blockHeld, approach, castSlot1 and yaw. Validate all three difficulties, 0 and 3 bots, reject 4, unknown fields, invalid literals and malformed codes. Freeze exports before releasing lanes. |
| BOT1 — Implement deterministic sparring opponents | apps/server/src/sim/SparringBrain.ts, tests/unit/sparring-brain.test.ts | Export decideBot(difficulty, observation, previousDecision). Test ordered traces, reaction delay and reset on new life, distance boundaries, equal-distance tie, death/disconnect, attack/guard priority, repeated calls between decisions and legal hard cast. No transport or physics imports. |
| BOT2 — Implement private sparring membership | apps/server/src/auth/SparringDirectory.ts, tests/unit/sparring-directory.test.ts | Implement room creation, single-use links, scoped membership, host/guest reservations and lifecycle above with injected time. Expose create/link/redeem/authorizeJoin/connected/dropped/left/end/sweep operations. Test replay, replacement, expiry boundaries, cross-room and guest authority, competing last-seat redeems, duplicate admission, host grace and cleanup. No HTTP registration in this lane. |
| BOT3 — Build host setup and guest invite controls | apps/client/src/ui/SparringSetup.ts, tests/browser/sparring-setup.spec.ts | Standalone mount function receiving DOM root plus injected start, copyLink and end callbacks. Return dispose(). Test default, each difficulty, add/remove limits, fighter choice, solo start, pending double-click, retry after failure, link fallback and disposal with local browser fixture. No edits to main.ts or live network. |
| BOT4 — Connect hosted sparring to authoritative rooms | apps/server/src/{createServer.ts,http/sessionRoutes.ts,http/sparringRoutes.ts,auth/Services.ts,rooms/ArenaRoom.ts,rooms/SparringRoom.ts,sim/TickPipeline.ts} and tests/integration/sparring.test.ts | Wire BOT1 and BOT2. Feed bots through PipelineSeat input at the fixed tick before drain, no synthetic Client. Keep human authentication, reconnect and owner messages in the human seat map. Publish and score each bot once. Check real collider support before moving. Register hosted rooms with the existing ticket verification and prevent direct SDK joins, duplicate room creation and ready bypass. Real clients cover host plus bot, fresh guest, guest auth isolation, full reservations, simultaneous admission, host reconnect/close, per-life KO/respawn, interruption, no score bleed, old FFA/dummy regression. |
| BOT4C — Connect the sparring client journey | apps/client/src/{main.ts,app/AppFlow.ts,net/RoomClient.ts}, tests/unit/sparring-flow.test.ts | Wire setup, scoped fragment redemption, guest CSRF, kit choice and existing Ready flow. Use a fake transport for request ordering, double-click suppression, route errors, host/guest leave, reload and cleanup. Keep FX subscriptions intact. |
| BOT5 — Verify hosted sparring journeys | tests/browser/sparring-flow.spec.ts, docs/test-results/BOT5.md | Browser journeys on localhost: solo Easy, mixed Medium/Hard, zero bots with fresh guest, copy/join with two isolated contexts, full room, expired link, host ends and rehosts. Assert replicated attack/HP change and shared outcome; observe all three tiers in deterministic fixtures. Run existing browser suite. Record real device status, including touch selectors and a ten-minute match on both iPads when available. |

Stop and report the exact conflict if the merged contract differs from these schemas, the integration requires changing an active lane's files, a change would bypass combat/auth checks, or an offline gate fails twice for the same cause. Keep the built-in dummy and ordinary adult invite journey in the regression suite. No deployment or invitation delivery is part of these slices.
