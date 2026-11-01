import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import {
  ChangeKitMessageSchema, ClientMessage, JoinOptionsSchema, MAX_CLIENTS, P0_KITS, PATCH_RATE_MS,
  PROTOCOL_VERSION, PingMessageSchema, RECONNECT_SECONDS, ReadyMessageSchema, ServerMessage, TICK_RATE,
  type ActionResult, type CombatEvent, type KitId, type WelcomeMessage,
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
import { AbilityRunner, type AbilityHost, type SkillOutcome } from "../sim/AbilityRunner.js";
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
import type { AuthServices } from "../auth/Services.js";
import { log } from "../ops/StructuredLog.js";
import { roomDirectory } from "./RoomDirectory.js";

/** Set once by createGameServer. Kept off Colyseus options so clients can never override it. */
let authServices: AuthServices | null = null;
/** Test hook: lets tests shorten the 20 s reservation. Production keeps the spec value. */
export const roomTuning = { reconnectSeconds: RECONNECT_SECONDS as number };

export function setArenaAuth(a: AuthServices | null): void { authServices = a; }

interface Seat {
  sessionAuthId: string; // internal; never replicated or logged
  entityId: number;
  input: InputChannel;
  pendingKit: KitId | null; // owner-only; applied at next respawn (T17)
  readyBucket: TokenBucket;
  pingBucket: TokenBucket;
}

export class ArenaRoom extends Room {
  override maxClients = MAX_CLIENTS;
  override state = new ArenaState();
  override maxMessagesPerSecond = 90;

  roomCode = "";
  readonly sim = new FixedClock();
  private readonly contentHash = computeContentHash();
  private seats = new Map<string, Seat>(); // by Colyseus sessionId
  private seatByAuth = new Map<string, string>(); // auth session id -> colyseus sessionId
  private nextEntityId = 1;
  private lifeSeq = 0;
  private lastTickMs = 0;
  world: World | null = null;
  movement: MovementSystem | null = null;
  readonly combat = new CombatSystem();
  readonly respawns = new RespawnSystem();
  /** One offensive buffer per room, shared by M1 and skills (spec 12). */
  private readonly offensiveBuffer = new OffensiveBuffer();
  readonly m1 = new M1System(this.offensiveBuffer);
  readonly awakening: AwakeningSystem = new AwakeningSystem(this.abilityHost());
  readonly abilities: AbilityRunner = new AbilityRunner(buildKitRegistry(), ALL_HANDLERS, this.abilityHost(), this.offensiveBuffer);
  private eventSeq = 0;
  /** Random uint32 chosen per room (spec 21 event ids). */
  roomEpoch = Math.floor(Math.random() * 0x100000000);
  /** Wall clock for overload checks; tests inject a fake. */
  wallNow: () => number = () => performance.now();
  private readonly pipeline: TickPipeline = new TickPipeline({
    state: this.state, combat: this.combat, m1: this.m1, abilities: this.abilities, awakening: this.awakening,
    movement: () => this.movement, world: () => this.world, seats: () => this.seats,
    poseOf: (id) => this.poseOf(id), respawn: this.respawns, nextLifeId: () => ++this.lifeSeq,
    sendActionResult: (sid, seat, edgeId, seq, tick, ok, reason, castId) => this.sendActionResult(sid, seat, edgeId, seq, tick, ok, reason, castId),
    broadcastEvent: (tick, kind, actor, target, lifeId, moveId, dmg) => this.broadcastEvent(tick, kind, actor, target, lifeId, moveId, dmg),
  });

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    this.roomCode = typeof options?.roomCode === "string" ? options.roomCode : "";
    if (this.roomCode === "") throw new Error("ROOM_CODE_REQUIRED");
    roomDirectory.register(this.roomCode, this.roomId);
    this.patchRate = PATCH_RATE_MS;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.contentHash = this.contentHash;
    this.combat.onRelease = (rel, tick) => {
      const victim = this.combat.get(rel.capture.victimId);
      this.broadcastEvent(tick, "release", rel.capture.captorId, rel.capture.victimId, victim?.lifeId ?? 0, rel.capture.moveId);
    };
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
    this.onMessage("*", () => undefined);
  }

  override async onAuth(_client: Client, options: unknown): Promise<{ authId: string; displayName: string }> {
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
    const entityId = this.nextEntityId++;
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
      readyBucket: new TokenBucket(2, 2, now), pingBucket: new TokenBucket(1, 2, now),
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
    try {
      await this.allowReconnection(client, roomTuning.reconnectSeconds);
    } catch {
      // Reservation expired or was cancelled: Colyseus now calls onLeave.
    }
  }

  override onReconnect(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p) return;
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
    this.awakening.remove(seat.entityId);
    this.respawns.forget(seat.entityId);
    this.movement?.remove(seat.entityId);
    this.state.players.delete(String(seat.entityId));
    this.seatByAuth.delete(seat.sessionAuthId);
    this.seats.delete(client.sessionId);
    log("info", "player left", { room: this.roomId, entity: seat.entityId });
  }

  override onDispose(): void {
    roomDirectory.unregister(this.roomId);
    this.seats.clear();
    this.seatByAuth.clear();
    this.combat.dispose();
    this.m1.dispose();
    this.abilities.dispose();
    this.awakening.dispose();
    this.respawns.clear();
    this.movement?.dispose();
    this.world?.dispose();
    this.movement = null;
    this.world = null;
  }

  // ---- internals ----
  private playerOf(seat: Seat): PlayerSchema | undefined {
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
    this.pipeline.step(tick);
  }

  private abilityHost(): AbilityHost {
    return {
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
    lifeId: number, moveId?: string, damage100?: number): void {
    const e: CombatEvent = { eventId: `${this.roomEpoch}:${tick}:${++this.eventSeq}`, tick, kind, actorId: String(actor), lifeId };
    if (target !== undefined) e.targetId = String(target);
    if (moveId) e.moveId = moveId;
    if (damage100 !== undefined) e.damage100 = damage100;
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
  private chooseSpawn(): MapVec3 {
    const w = this.world!;
    const occupied: Pt[] = [];
    for (const s of this.seats.values()) {
      const f = this.combat.get(s.entityId), p = this.movement?.position(s.entityId);
      if (p && f && f.action !== "Dead") occupied.push({ x: p[0], z: p[2] });
    }
    const pick = pickSpawn(w.map.spawnAnchors, occupied, [], occupied).anchor.position;
    const surface = w.groundHeight(pick[0], pick[2]) ?? pick[1];
    return [pick[0], surface + ARENA.capsule.centreAboveSurface, pick[2]];
  }

  private onInput(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const reason = seat.input.accept(raw, this.sim.tick, performance.now());
    if (reason === "RATE_LIMIT") log("warn", "input rate limited", { room: this.roomId, entity: seat.entityId });
  }

  private onReady(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ReadyMessageSchema.safeParse(raw);
    if (!m.success || m.data.contentHash !== this.contentHash || !P0_KITS.includes(m.data.kitId)) return;
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
    this.state.phase = "playing";
  }

  private onChangeKit(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const p = seat && this.playerOf(seat);
    if (!seat || !p || !seat.readyBucket.take(performance.now())) return;
    const m = ChangeKitMessageSchema.safeParse(raw);
    if (!m.success || !P0_KITS.includes(m.data.kitId)) return;
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
    if (!m.success) return;
    client.send(ServerMessage.pong, { nonce: m.data.nonce, serverMs: Date.now(), serverTick: this.sim.tick });
  }
}
