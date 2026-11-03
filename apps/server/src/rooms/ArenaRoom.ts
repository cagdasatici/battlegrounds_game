import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  ChangeKitMessageSchema, ClientMessage, JoinOptionsSchema, MAX_CLIENTS, P0_KITS, PATCH_RATE_MS,
  PROTOCOL_VERSION, PingMessageSchema, RECONNECT_SECONDS, ReadyMessageSchema, ROUND_OVER_TICKS, ServerMessage, TICK_RATE,
  type RoundOverMessage, type RoundTarget, type ActionResult, type CombatEvent, type KitId, type WelcomeMessage,
} from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { computeContentHash } from "@eb/shared/config/content";
import { ArenaState } from "../state/ArenaSchema.js";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { FixedClock } from "../sim/FixedClock.js";
import { World } from "../sim/World.js";
import { MovementSystem, type HorizontalOverride } from "../sim/Movement.js";
import { CombatSystem } from "../sim/Combat.js";
import { OffensiveBuffer } from "../sim/OffensiveBuffer.js";
import { M1System, type M1Pose } from "../sim/M1.js";
import { ProjectileSystem } from "../sim/Projectiles.js";
import { UrnSystem } from "../sim/Urns.js";
import { ContextSystem } from "../sim/ContextMoves.js";
import { AbilityRunner, type ReflectRequest, type AbilityHost, type SkillOutcome } from "../sim/AbilityRunner.js";
import { AwakeningSystem } from "../sim/Awakening.js";
import { RespawnSystem, pickSpawn, type Pt } from "../sim/RespawnSystem.js";
import { TickPipeline, type PipelineSeat } from "../sim/TickPipeline.js";
import { ALL_HANDLERS, buildKitRegistry } from "../kits/index.js";
import type { HitResult } from "../sim/HitResolver.js";
import { locomotionLocked, intentsSuppressed } from "../sim/ActionMachine.js";
import { NEUTRAL_MOVE, type MoveIntent } from "@eb/shared/movement";
import { ARENA, type MapVec3 } from "@eb/shared/config/arena";
import { quantizeCm, quantizeYaw } from "@eb/shared/schema";
import { InputChannel } from "../net/ValidateInput.js";
import { TokenBucket } from "../net/RateLimits.js";
import { InvalidMessageGuard } from "../net/InvalidMessageGuard.js";
import { originOk } from "../http/securityHeaders.js";
import type { AuthServices } from "../auth/Services.js";
import { log } from "../ops/StructuredLog.js";
import { roomDirectory } from "./RoomDirectory.js";

/** Set once by createGameServer. Kept off Colyseus options so clients can never override it. */
let authServices: AuthServices | null = null;
/** Test hook: lets tests shorten the 20 s reservation. Production keeps the spec value. */
export const roomTuning = { reconnectSeconds: RECONNECT_SECONDS as number };

/** Live arena rooms (including subclasses), so the server lifecycle sweep and revocation can reach them. */
const liveRooms = new Set<ArenaRoom>();
export function liveArenaRooms(): ReadonlySet<ArenaRoom> { return liveRooms; }

/** Close code for a seat whose auth session was revoked or expired. */
export const AUTH_REVOKED_CLOSE = 4401;

export function setArenaAuth(a: AuthServices | null): void { authServices = a; }

export interface Seat {
  sessionAuthId: string; // internal; never replicated or logged
  entityId: number;
  input: InputChannel;
  pendingKit: KitId | null; // owner-only; applied at next respawn (T17)
  readyBucket: TokenBucket;
  pingBucket: TokenBucket;
  invalid: InvalidMessageGuard;
}

export class ArenaRoom extends Room {
  override maxClients: number = MAX_CLIENTS;
  override state = new ArenaState();
  override maxMessagesPerSecond = 90;

  faulted = false;
  /** Decision 0054: first-to-N KOs; 0 = endless. Only hosted sparring and bot rooms ever set it. */
  roundTarget: RoundTarget = 0;
  /** Tick at which the results phase ends; null outside roundOver. */
  private roundOverUntil: number | null = null;
  roomCode = "";
  readonly sim = new FixedClock();
  private readonly contentHash = computeContentHash();
  protected seats = new Map<string, Seat>(); // by Colyseus sessionId
  private seatByAuth = new Map<string, string>(); // auth session id -> colyseus sessionId
  /** Open reconnection reservations by Colyseus sessionId; rejecting one cancels the reserved seat. */
  private reservations = new Map<string, { reject: Function }>();
  // TODO(REL02): lifeId is uint16; lifeSeq wraps after 65,535 lives in one room instance. Widen if rooms become long-lived.
  protected lifeSeq = 0;
  private lastTickMs = 0;
  world: World | null = null;
  movement: MovementSystem | null = null;
  readonly combat = new CombatSystem();
  readonly respawns = new RespawnSystem();
  /** One offensive buffer per room, shared by M1 and skills (spec 12). */
  private readonly offensiveBuffer = new OffensiveBuffer();
  readonly m1 = new M1System(this.offensiveBuffer);
  readonly awakening: AwakeningSystem = new AwakeningSystem(this.abilityHost());
  /** T19: detached projectiles (spec 13, 15); advanced only by the tick pipeline, cleared on dispose. */
  readonly projectiles: ProjectileSystem = new ProjectileSystem(this.abilityHost());
  readonly abilities: AbilityRunner = new AbilityRunner(buildKitRegistry(), ALL_HANDLERS, this.abilityHost(), this.offensiveBuffer);
  /** T23: eight server owned urns and the context move selector (wall attack, pickup, throw, sv.x1 to sv.x3). */
  readonly urns = new UrnSystem(ARENA.urnAnchors.map((a) => [a[0], a[1], a[2]] as MapVec3));
  readonly contexts: ContextSystem = new ContextSystem(this.abilities, this.urns, this.abilityHost());
  private eventSeq = 0;
  /** Random uint32 chosen per room (spec 21 event ids). */
  roomEpoch = Math.floor(Math.random() * 0x100000000);
  /** Wall clock for overload checks; tests inject a fake. */
  wallNow: () => number = () => performance.now();
  protected readonly pipeline: TickPipeline = new TickPipeline({
    state: this.state, combat: this.combat, m1: this.m1, abilities: this.abilities, awakening: this.awakening,
    projectiles: this.projectiles, urns: this.urns, movement: () => this.movement, world: () => this.world, seats: () => this.pipelineSeats(), beforeDrain: (tick) => this.beforeDrain(tick), extraBodies: () => this.extraBodyIds(),
    poseOf: (id) => this.poseOf(id), respawn: this.respawns, nextLifeId: () => ++this.lifeSeq,
    sendActionResult: (sid, seat, edgeId, seq, tick, ok, reason, castId) => this.sendActionResult(sid, seat, edgeId, seq, tick, ok, reason, castId),
    broadcastEvent: (tick, kind, actor, target, lifeId, moveId, dmg, extra) => this.broadcastEvent(tick, kind, actor, target, lifeId, moveId, dmg, extra),
  });

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    this.roomCode = typeof options?.roomCode === "string" ? options.roomCode : "";
    if (this.roomCode === "") throw new Error("ROOM_CODE_REQUIRED");
    roomDirectory.register(this.roomCode, this.roomId);
    liveRooms.add(this);
    this.patchRate = PATCH_RATE_MS;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.contentHash = this.contentHash;
    this.combat.onRelease = (rel, tick) => {
      const victim = this.combat.get(rel.capture.victimId);
      this.broadcastEvent(tick, "release", rel.capture.captorId, rel.capture.victimId, victim?.lifeId ?? 0, rel.capture.moveId);
    };
    this.contexts.enabled = true; // P1 context moves (spec 13: P0 disables the wall branch)
    this.m1.contextHook = (f, tick, req) => this.contexts.decide(f, tick, req);
    this.world = await World.create();
    this.movement = new MovementSystem(this.world);
    this.lastTickMs = performance.now();
    this.setSimulationInterval(() => this.onSchedulerTick(), 1000 / TICK_RATE);

    this.onMessage(ClientMessage.input, (client, raw) => this.onInput(client, raw));
    this.onMessage(ClientMessage.ready, (client, raw) => this.onReady(client, raw));
    this.onMessage(ClientMessage.changeKit, (client, raw) => this.onChangeKit(client, raw));
    this.onMessage(ClientMessage.ping, (client, raw) => this.onPing(client, raw));
    this.onMessage(ClientMessage.leave, (client) => { void client.leave(); });
    // No arbitrary client events: everything else is dropped.
    this.onMessage("*", (client) => { this.noteInvalid(client, "unknown_type"); });
  }

  override async onAuth(_client: Client, options: unknown, context?: { headers?: Headers }): Promise<{ authId: string; displayName: string }> {
    // Spec 24: Origin allowlist on the WebSocket upgrade. Browsers always send Origin; a present foreign Origin is refused.
    // A missing Origin is a non-browser client; it still needs a one use ticket bound to this room.
    if (authServices && originOk(context?.headers?.get("origin"), authServices.config.allowedOrigins) === "foreign") {
      log("warn", "websocket origin refused", { room: this.roomId });
      throw new Error("AUTH_FAILED");
    }
    if (this.sim.isOverloaded(this.wallNow())) {
      log("warn", "room overloaded: refusing new player", { room: this.roomId, overloads: this.sim.overloads });
      throw new Error("ROOM_FULL");
    }
    const auth = authServices;
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!auth || !parsed.success) throw new Error("AUTH_FAILED");
    const o = parsed.data;
    // Consume first: a failed comparison also burns the ticket.
    const hit = auth.tickets.consume(o.ticket, {
      roomName: this.roomName, roomCode: o.roomCode, contentHash: o.contentHash, protocolVersion: o.protocolVersion,
    });
    if (!hit || o.contentHash !== this.contentHash) throw new Error("AUTH_FAILED");
    if (this.roomCode !== "" && o.roomCode !== this.roomCode) throw new Error("AUTH_FAILED");
    const session = auth.sessions.getById(hit.sessionId);
    if (!session) throw new Error("AUTH_FAILED");
    if (this.seatByAuth.has(session.id)) throw new Error("SEAT_TAKEN");
    return { authId: session.id, displayName: session.displayName };
  }

  override onJoin(client: Client, _options: unknown, auth: { authId: string; displayName: string }): void {
    const entityId = this.allocEntityId();
    const p = new PlayerSchema();
    p.entityId = entityId;
    p.lifeId = 0;
    p.displayName = auth.displayName;
    p.hp100 = COMBAT.hp100Max;
    p.connected = true;
    this.state.players.set(String(entityId), p);
    this.attachOwnerView(client, p);
    const now = performance.now();
    this.seats.set(client.sessionId, {
      sessionAuthId: auth.authId, entityId, input: new InputChannel(now), pendingKit: null,
      readyBucket: new TokenBucket(2, 2, now), pingBucket: new TokenBucket(1, 2, now), invalid: new InvalidMessageGuard(),
    });
    this.seatByAuth.set(auth.authId, client.sessionId);
    this.sendWelcome(client);
    log("info", "player joined", { room: this.roomId, entity: entityId });
  }

  /** Unexpected disconnect: keep the avatar, neutralize input, reserve the seat for 20 s of wall time. */
  override async onDrop(client: Client): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
    p.connected = false;
    seat.input.neutralize();
    this.urns.drop(seat.entityId); // a disconnected holder never keeps an urn (spec 15)
    try {
      const reservation = this.allowReconnection(client, roomTuning.reconnectSeconds);
      this.reservations.set(client.sessionId, reservation);
      await reservation;
    } catch {
      // Reservation expired or was cancelled: Colyseus now calls onLeave.
    } finally {
      this.reservations.delete(client.sessionId);
    }
  }

  override onReconnect(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
    // Recheck the session: an expired or revoked one gets neither welcome nor resume.
    if (!this.seatSessionValid(seat)) { seat.input.neutralize(); client.leave(AUTH_REVOKED_CLOSE); return; }
    p.connected = true;
    this.attachOwnerView(client, p);
    seat.input.renewEpoch(performance.now()); // old epoch packets are now stale
    this.sendWelcome(client);
    log("info", "player reconnected", { room: this.roomId, entity: seat.entityId });
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    // Releases every capture held by or on this player (captor gets 18 ticks recovery).
    this.combat.remove(seat.entityId, this.sim.tick);
    this.m1.remove(seat.entityId);
    this.abilities.remove(seat.entityId);
    this.urns.drop(seat.entityId);
    this.awakening.remove(seat.entityId);
    this.respawns.forget(seat.entityId);
    this.movement?.remove(seat.entityId);
    this.state.players.delete(String(seat.entityId));
    this.seatByAuth.delete(seat.sessionAuthId);
    this.seats.delete(client.sessionId);
    log("info", "player left", { room: this.roomId, entity: seat.entityId });
  }

  /** Ordinary seats carry the session id; hosted-sparring seats carry a scoped principal that the directory owns. */
  private seatSessionValid(seat: Seat): boolean {
    const svc = authServices;
    if (!svc || seat.sessionAuthId.startsWith("spar:")) return true;
    return svc.sessions.getById(seat.sessionAuthId) !== null;
  }

  /** Auth ids of ordinary (non-sparring) seats with whether their socket is currently connected. */
  seatedSessions(): { authId: string; connected: boolean }[] {
    const out: { authId: string; connected: boolean }[] = [];
    for (const [sid, seat] of this.seats) {
      if (seat.sessionAuthId.startsWith("spar:")) continue;
      out.push({ authId: seat.sessionAuthId, connected: !this.reservations.has(sid) });
    }
    return out;
  }

  /** Ends the seat bound to an auth session: neutralize input, cancel any reconnect reservation, close with 4401. Other seats are untouched. */
  revokeAuthSession(authId: string): void {
    const sid = this.seatByAuth.get(authId);
    if (sid === undefined) return;
    const seat = this.seats.get(sid);
    if (!seat || seat.sessionAuthId !== authId) return;
    seat.input.neutralize();
    const reservation = this.reservations.get(sid);
    if (reservation) { (reservation.reject as (r: unknown) => void)(false); return; } // onDrop's catch ends, Colyseus then calls onLeave
    const client = this.clients.find((c) => c.sessionId === sid);
    if (client) client.leave(AUTH_REVOKED_CLOSE); // consented close; onLeave runs the normal cleanup
  }

  override onDispose(): void {
    liveRooms.delete(this);
    roomDirectory.unregister(this.roomId);
    this.seats.clear();
    this.seatByAuth.clear();
    this.combat.dispose();
    this.m1.dispose();
    this.abilities.dispose();
    this.projectiles.clear();
    this.urns.clear();
    this.awakening.dispose();
    this.respawns.clear();
    this.movement?.dispose();
    this.world?.dispose();
    this.movement = null;
    this.world = null;
  }

  protected authServices(): AuthServices | null { return authServices; }
  protected pipelineSeats(): ReadonlyMap<string, PipelineSeat> { return this.seats; }
  protected beforeDrain(_tick: number): void {}

  // ---- internals ----
  /** Lowest id in 1..255 not used by a replicated player. entityId is uint8 on the wire (PlayerSchema). */
  protected allocEntityId(): number {
    for (let id = 1; id <= 255; id++) if (!this.state.players.has(String(id))) return id;
    throw new Error("ROOM_FULL");
  }

  protected playerOf(seat: Seat): PlayerSchema | undefined {
    return this.state.players.get(String(seat.entityId));
  }

  /** Owner-only record is visible only to the owning client (R08). Idempotent: add() on a reused view is a no-op. */
  private attachOwnerView(client: Client, p: PlayerSchema): void {
    client.view ??= new StateView();
    client.view.add(p.owner);
  }

  private sendWelcome(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const msg: WelcomeMessage = {
      epoch: seat.input.epoch, serverTick: this.sim.tick, tickRate: TICK_RATE, contentHash: this.contentHash,
    };
    client.send(ServerMessage.welcome, msg);
  }

  private onSchedulerTick(): void {
    const now = performance.now();
    const elapsed = now - this.lastTickMs;
    this.lastTickMs = now;
    this.sim.advance(elapsed, (tick) => this.stepTick(tick), now);
  }

  /** One logical 60 Hz tick (spec sections 12 and 21 order lives in TickPipeline). */
  stepTick(tick: number): void {
    if (this.faulted) return;
    try {
      if (this.roundOverUntil !== null) { this.stepRoundOver(tick); return; }
      this.pipeline.step(tick);
      this.checkRoundEnd(tick);
    } catch (e) {
      this.faulted = true;
      log("error", "tick fault: room closed", { room: this.roomId, tick, error: e instanceof Error ? e.name : "unknown" });
      if (process.env.NODE_ENV !== "production") console.error(e);
      for (const c of this.clients) c.leave(4500);
      void this.disconnect();
    }
  }

  /** Decision 0054: the round ends the tick any player's kills reach the target. */
  private checkRoundEnd(tick: number): void {
    if (this.roundTarget === 0) return;
    const standings = [...this.state.players.values()].map((p) => ({
      entityId: p.entityId, displayName: p.displayName, kills: p.kills, deaths: p.deaths, assists: p.assists,
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.entityId - b.entityId);
    if ((standings[0]?.kills ?? 0) < this.roundTarget) return;
    this.state.phase = "roundOver";
    this.roundOverUntil = tick + ROUND_OVER_TICKS;
    const msg: RoundOverMessage = { tick, roundTarget: this.roundTarget, resumesAtTick: this.roundOverUntil, standings };
    this.broadcast(ServerMessage.roundOver, msg);
  }

  /** Frozen results phase: inputs are dropped and no hit resolution runs, so no damage events exist. Integer ticks only. */
  private stepRoundOver(tick: number): void {
    for (const seat of this.pipelineSeats().values()) seat.input.neutralize();
    this.state.serverTick = tick;
    if (tick >= this.roundOverUntil!) this.startNextRound(tick);
  }

  /** Resets the scoreboard and puts every ready fighter on a fresh life at a spec section 10 spawn. */
  private startNextRound(tick: number): void {
    this.roundOverUntil = null;
    this.projectiles.clear();
    for (const p of this.state.players.values()) { p.kills = 0; p.deaths = 0; p.assists = 0; }
    const mv = this.movement, w = this.world;
    if (mv && w) {
      const placed: Pt[] = [];
      const seats = [...this.pipelineSeats().values()].sort((a, b) => a.entityId - b.entityId);
      for (const seat of seats) {
        const id = seat.entityId, f = this.combat.get(id), p = this.state.players.get(String(id));
        if (!f || !p) continue;
        if (seat.pendingKit) { f.kitId = seat.pendingKit; seat.pendingKit = null; }
        p.owner.pendingKit = "";
        const lifeId = ++this.lifeSeq;
        this.combat.respawn(id, tick, lifeId);
        this.m1.reset(id); this.abilities.reset(id); this.awakening.reset(id); this.urns.drop(id);
        const [ax, ay, az] = pickSpawn(w.map.spawnAnchors, placed, [], placed).anchor.position;
        placed.push({ x: ax, z: az });
        mv.add(id, [ax, (w.groundHeight(ax, az) ?? ay) + ARENA.capsule.centreAboveSurface, az], Math.atan2(ax, az));
        p.lifeId = lifeId;
        this.respawns.complete(id, tick);
        this.pipeline.publishBody(id);
        this.broadcastEvent(tick, "respawn", id, id, lifeId);
      }
    }
    this.pipeline.republish(tick);
    this.state.phase = "playing";
  }

  /** Entities simulated without a seat (the practice dummy) whose bodies are still published each tick. */
  protected extraBodyIds(): readonly number[] { return []; }

  private abilityHost(): AbilityHost {
    // Lazy: the projectile system is built from this very host, so its members are resolved on first use.
    const self = this;
    return {
      get projectiles() { return self.projectiles; },
      get projectileSpawner() { return self.projectiles; },
      get urns() { return self.urns; },
      nearWall: (x, y, z) => this.world?.nearVerticalCollider([x, y, z], COMBAT.capsule.radius, COMBAT.capsule.halfHeight, COMBAT.wall.targetGap) ?? false,
      get projectileReflector() { return { reflect: (req: ReflectRequest) => self.projectiles.reflectWith(req) }; },
      sweepSphere: (a, b, r) => this.world?.sweepSphere([a[0], a[1], a[2]], [b[0], b[1], b[2]], r) ?? null,
      hold: (id, slot, tick) => this.pipeline.holdOf(id, slot, tick),
      aimPitch: (id) => this.pipeline.pitchOf(id),
      combat: this.combat,
      pose: (id) => this.poseOf(id),
      blocked: (a, b) => !!this.world && this.world.segmentBlocked([a[0], a[1], a[2]], [b[0], b[1], b[2]]),
      requestedYaw: (id) => this.pipeline.requestedYawOf(id),
      launch: (id, vx, vy, vz) => this.movement?.setVelocity(id, vx, vy, vz),
      moveTogether: (ids, dx, dz) => this.movement?.moveTogether(ids, dx, dz) ?? { dx: 0, dz: 0 },
      wallContact: (id, tick) => this.movement?.get(id)?.wallHitTick === tick,
      surfaceHeight: (x, z) => this.world?.groundHeight(x, z) ?? null,
    };
  }

  private poseOf(id: number): M1Pose | undefined {
    const b = this.movement?.get(id);
    const p = this.movement?.position(id);
    return b && p ? { x: p[0], y: p[1], z: p[2], facingYaw: b.state.facingYaw, grounded: b.state.grounded } : undefined;
  }

  private broadcastEvent(tick: number, kind: CombatEvent["kind"], actor: number, target: number | undefined,
    lifeId: number, moveId?: string, damage100?: number, extra?: { hitClass?: "light" | "heavy"; targetHp100?: number }): void {
    const e: CombatEvent = { eventId: `${this.roomEpoch}:${tick}:${++this.eventSeq}`, tick, kind, actorId: String(actor), lifeId };
    if (target !== undefined) e.targetId = String(target);
    if (moveId) e.moveId = moveId;
    if (damage100 !== undefined) e.damage100 = damage100;
    if (extra?.hitClass) e.hitClass = extra.hitClass;
    if (extra?.targetHp100 !== undefined) e.targetHp100 = extra.targetHp100;
    this.broadcast(ServerMessage.combatEvent, e);
  }

  private sendActionResult(sessionId: string, seat: PipelineSeat, edgeId: number, seq: number, tick: number, accepted: boolean, reason?: ActionResult["reason"], castId?: string): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    const msg: ActionResult = { epoch: seat.input.epoch, seq, edgeId, accepted, tick };
    if (reason) msg.reason = reason;
    if (castId) msg.castId = castId;
    client.send(ServerMessage.actionResult, msg);
  }

  /** First spawn: the spec section 10 rule (RespawnSystem.pickSpawn) with no retry window; later spawns run in the tick pipeline. */
  protected chooseSpawn(): MapVec3 {
    const w = this.world!;
    const occupied: Pt[] = [];
    for (const s of this.pipelineSeats().values()) {
      const f = this.combat.get(s.entityId), p = this.movement?.position(s.entityId);
      if (p && f && f.action !== "Dead") occupied.push({ x: p[0], z: p[2] });
    }
    const pick = pickSpawn(w.map.spawnAnchors, occupied, [], occupied).anchor.position;
    const surface = w.groundHeight(pick[0], pick[2]) ?? pick[1];
    return [pick[0], surface + ARENA.capsule.centreAboveSurface, pick[2]];
  }

  /** Spec 24: ten invalid messages in ten seconds disconnect the client. Logs the category only. */
  protected noteInvalid(client: Client, category: string): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    if (seat.invalid.record(performance.now())) {
      log("warn", "client dropped for invalid messages", { room: this.roomId, category });
      client.leave(4000);
    }
  }

  private onInput(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const reason = seat.input.accept(raw, this.sim.tick, performance.now());
    if (reason === "RATE_LIMIT") log("warn", "input rate limited", { room: this.roomId, entity: seat.entityId });
    if (reason === "MALFORMED") this.noteInvalid(client, "input_malformed");
  }

  private onReady(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ReadyMessageSchema.safeParse(raw);
    if (!m.success || m.data.contentHash !== this.contentHash || !P0_KITS.includes(m.data.kitId)) { this.noteInvalid(client, "ready_invalid"); return; }
    if (p.ready) return;
    p.kitId = m.data.kitId;
    p.ready = true;
    p.lifeId = ++this.lifeSeq; // room-unique so events can identify a victim life
    p.hp100 = COMBAT.hp100Max;
    this.combat.add(seat.entityId, p.lifeId, this.sim.tick, m.data.kitId);
    this.respawns.startLife(seat.entityId, this.sim.tick);
    if (this.movement) {
      this.movement.add(seat.entityId, this.chooseSpawn());
      this.pipeline.publishBody(seat.entityId);
    }
    if (this.state.phase !== "roundOver") this.state.phase = "playing";
  }

  private onChangeKit(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ChangeKitMessageSchema.safeParse(raw);
    if (!m.success || !P0_KITS.includes(m.data.kitId)) { this.noteInvalid(client, "changeKit_invalid"); return; }
    if (!p.ready) p.kitId = m.data.kitId;
    else {
      // Applied by the tick pipeline at the next respawn, or once 480 ticks pass without dealing or taking damage.
      const same = this.combat.get(seat.entityId)?.kitId === m.data.kitId;
      seat.pendingKit = same ? null : m.data.kitId;
      p.owner.pendingKit = same ? "" : m.data.kitId;
    }
  }

  private onPing(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !seat.pingBucket.take(performance.now())) return;
    const m = PingMessageSchema.safeParse(raw);
    if (!m.success) { this.noteInvalid(client, "ping_invalid"); return; }
    client.send(ServerMessage.pong, { nonce: m.data.nonce, serverMs: Date.now(), serverTick: this.sim.tick });
  }
}
