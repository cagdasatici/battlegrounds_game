import { Room, type Client } from "colyseus";
import {
  ChangeKitMessageSchema, ClientMessage, JoinOptionsSchema, MAX_CLIENTS, P0_KITS, PATCH_RATE_MS,
  PROTOCOL_VERSION, PingMessageSchema, RECONNECT_SECONDS, ReadyMessageSchema, ServerMessage, TICK_RATE,
  type ActionResult, type KitId, type WelcomeMessage,
} from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { computeContentHash } from "@eb/shared/config/content";
import { ArenaState } from "../state/ArenaSchema.js";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { FixedClock } from "../sim/FixedClock.js";
import { World } from "../sim/World.js";
import { MovementSystem, type HorizontalOverride } from "../sim/Movement.js";
import { CombatSystem } from "../sim/Combat.js";
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

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    this.roomCode = typeof options?.roomCode === "string" ? options.roomCode : "";
    if (this.roomCode === "") throw new Error("ROOM_CODE_REQUIRED");
    roomDirectory.register(this.roomCode, this.roomId);
    this.patchRate = PATCH_RATE_MS;
    this.state.protocolVersion = PROTOCOL_VERSION;
    this.state.contentHash = this.contentHash;
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
    seat.input.renewEpoch(performance.now()); // old epoch packets are now stale
    this.sendWelcome(client);
    log("info", "player reconnected", { room: this.roomId, entity: seat.entityId });
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    // Releases every capture held by or on this player (captor gets 18 ticks recovery).
    this.combat.remove(seat.entityId, this.sim.tick);
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
    this.movement?.dispose();
    this.world?.dispose();
    this.movement = null;
    this.world = null;
  }

  // ---- internals ----
  private playerOf(seat: Seat): PlayerSchema | undefined {
    return this.state.players.get(String(seat.entityId));
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

  /** One logical 60 Hz tick (spec sections 12 and 21 order, subset implemented so far). */
  stepTick(tick: number): void {
    const mv = this.movement;
    const grounded = (id: number): boolean => mv?.get(id)?.state.grounded ?? false;
    // Expiries before input intents.
    this.combat.expire(tick, grounded);
    const intents = new Map<number, MoveIntent>();
    for (const [sessionId, seat] of this.seats) {
      seat.input.expireLease(tick, COMBAT.inputLeaseTicks);
      const edges = seat.input.drain();
      const h = seat.input.held;
      const f = this.combat.get(seat.entityId);
      const body = mv?.get(seat.entityId);
      let jumpPressed = false;
      // Input priority: evasive/dash before jump (spec 12). Skills and M1 arrive with T10/T11.
      for (const q of edges) {
        if (q.edge.kind === "dash") {
          const r = f && body ? this.combat.requestDash(seat.entityId, tick, body.state.facingYaw, h.moveX, h.moveZ)
            : { ok: false as const, reason: "STATE" as const };
          this.sendActionResult(sessionId, seat, q.edge.id, tick, r.ok, r.ok ? undefined : r.reason);
        } else if (q.edge.kind === "jump") jumpPressed = true;
      }
      if (f) {
        this.combat.updateGuard(seat.entityId, tick, h.blockHeld, grounded(seat.entityId));
        if (intentsSuppressed(f) || locomotionLocked(f) || f.action === "Dash") jumpPressed = false;
      }
      const locked = !!f && (locomotionLocked(f) || f.action === "Dash");
      intents.set(seat.entityId, locked ? NEUTRAL_MOVE
        : { moveX: h.moveX, moveZ: h.moveZ, run: h.runHeld, guard: f?.action === "Guard" || h.blockHeld, jumpPressed });
    }
    if (mv) {
      mv.step(tick, (id) => intents.get(id) ?? NEUTRAL_MOVE, (id) => this.dashOverride(id));
      for (const seat of this.seats.values()) { this.publishBody(seat.entityId); this.publishAction(seat.entityId); }
    }
    this.state.serverTick = tick;
  }

  private dashOverride(id: number): HorizontalOverride | null {
    const d = this.combat.get(id)?.dash;
    return d ? { vx: d.dirX * d.speed, vz: d.dirZ * d.speed } : null;
  }

  private publishAction(entityId: number): void {
    const p = this.state.players.get(String(entityId));
    const f = this.combat.get(entityId);
    if (!p || !f) return;
    p.action = f.action;
    p.actionStartTick = f.actionStartTick;
    p.actionEndTick = Math.min(f.actionEndTick, 0xffffffff);
    p.moveId = f.moveId;
    p.hp100 = f.hp100;
    p.protectedUntilTick = f.protectedUntilTick;
  }

  private sendActionResult(sessionId: string, seat: Seat, edgeId: number, tick: number, accepted: boolean, reason?: ActionResult["reason"]): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    if (!client) return;
    const msg: ActionResult = { epoch: seat.input.epoch, seq: seat.input.lastReceivedSeq, edgeId, accepted, tick };
    if (reason) msg.reason = reason;
    client.send(ServerMessage.actionResult, msg);
  }

  private publishBody(entityId: number): void {
    const p = this.state.players.get(String(entityId));
    const b = this.movement?.get(entityId);
    const pos = this.movement?.position(entityId);
    if (!p || !b || !pos) return;
    const i16 = (v: number): number => Math.max(-32768, Math.min(32767, quantizeCm(v)));
    p.x = quantizeCm(pos[0]); p.y = quantizeCm(pos[1]); p.z = quantizeCm(pos[2]);
    p.vx = i16(b.state.vx); p.vy = i16(b.state.vy); p.vz = i16(b.state.vz);
    p.facingYaw = quantizeYaw(b.state.facingYaw);
  }

  /** First spawn anchor whose capsule is at least 2 m from every occupied capsule (spec section 10). */
  private chooseSpawn(): MapVec3 {
    const w = this.world!;
    const occupied = [...this.seats.values()].map((s) => this.movement?.position(s.entityId)).filter((p): p is MapVec3 => !!p);
    const anchors = w.map.spawnAnchors.map((a) => a.position);
    const pick = anchors.find((a) => occupied.every((o) => Math.hypot(o[0] - a[0], o[2] - a[2]) >= 2)) ?? anchors[0]!;
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
    this.combat.add(seat.entityId, p.lifeId, this.sim.tick);
    if (this.movement) {
      this.movement.add(seat.entityId, this.chooseSpawn());
      this.publishBody(seat.entityId);
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
    else seat.pendingKit = m.data.kitId; // applied at next respawn (T17)
  }

  private onPing(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat || !seat.pingBucket.take(performance.now())) return;
    const m = PingMessageSchema.safeParse(raw);
    if (!m.success) return;
    client.send(ServerMessage.pong, { nonce: m.data.nonce, serverMs: Date.now(), serverTick: this.sim.tick });
  }
}
