import { matchMaker, type Client } from "colyseus";
import type { Edge } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { ARENA } from "@eb/shared/config/arena";
import type { BotDecision, BotObservation, Difficulty, SparringConfig } from "@eb/shared/sparring";
import { SPARRING_ROOM_NAME } from "@eb/shared/sparring";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { InputChannel } from "../net/ValidateInput.js";
import { isAlive } from "../sim/ActionMachine.js";
import { decideBot } from "../sim/SparringBrain.js";
import type { PipelineSeat } from "../sim/TickPipeline.js";
import type { SparringPrincipal } from "../auth/SparringDirectory.js";
import type { AuthServices } from "../auth/Services.js";
import { log } from "../ops/StructuredLog.js";
import { ArenaRoom, getArenaAuth } from "./ArenaRoom.js";
import { roomDirectory } from "./RoomDirectory.js";


/** One-use creation grants. Only the authenticated create route can mint one, so an SDK joinOrCreate cannot open a room. */
interface Grant { config: SparringConfig; hostId: string }
const grants = new Map<string, Grant>();
const rooms = new Map<string, SparringRoom>();

export function grantSparringRoom(roomCode: string, config: SparringConfig, hostId: string): void {
  grants.set(roomCode, { config: { bots: [...config.bots] }, hostId });
}
export function revokeSparringGrant(roomCode: string): void { grants.delete(roomCode); }

/** Disconnects every client and disposes the room for a closed match. Safe when the room never existed. */
export function closeSparringRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (room) room.closeMatch();
  else {
    const id = roomDirectory.get(roomCode);
    if (id) void matchMaker.getLocalRoomById(id)?.disconnect();
  }
}

/** Guest principals travel in tickets as `guest:<id>`; host tickets carry the plain session id. */
export const GUEST_TICKET_PREFIX = "guest:";

interface BotSeat extends PipelineSeat {
  difficulty: Difficulty;
  decision: BotDecision;
  lifeId: number;
  spawnTick: number;
}

const NEUTRAL: BotDecision = { targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot1: false, yaw: 0 };
const STEP_LOOKAHEAD_M = 0.6;
const MAX_STEP_DELTA_M = 0.5;
const SWEEP_EVERY_TICKS = 60;
const BOT_KIT = "sv" as const;

/**
 * Hosted sparring room (docs/sparring-plan.md): the ordinary arena pipeline with up to three server-driven Vanguard
 * bots and membership enforced by the SparringDirectory. Bots are PipelineSeats fed before the input drain; they
 * are never Colyseus clients. Humans keep the normal seat map, reconnect and owner messages.
 */
export class SparringRoom extends ArenaRoom {
  private readonly bots = new Map<string, BotSeat>();
  private readonly members = new Map<string, SparringPrincipal>(); // Colyseus sessionId -> principal
  private hostId = "";
  private closing = false;

  protected override pipelineSeats(): ReadonlyMap<string, PipelineSeat> {
    if (this.bots.size === 0) return this.seats;
    return new Map<string, PipelineSeat>([...this.seats, ...this.bots]);
  }

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const code = typeof options?.roomCode === "string" ? options.roomCode : "";
    const grant = grants.get(code);
    if (!grant || !getArenaAuth()?.sparring.isOpen(code)) throw new Error("SPARRING_NOT_AUTHORIZED");
    grants.delete(code);
    // The match, not the client count, owns this room's lifetime: a failed foreign join must not dispose it.
    this.autoDispose = false;
    await super.onCreate(options);
    this.hostId = grant.hostId;
    this.maxClients = 4 - grant.config.bots.length;
    rooms.set(code, this);
    grant.config.bots.forEach((d, i) => this.spawnBot(i, d));
  }

  protected override resolveIdentity(sessionId: string, auth: AuthServices): { authId: string; displayName: string } {
    const principal = principalOfTicket(sessionId);
    let member;
    try { member = auth.sparring.authorizeJoin(principal, this.roomCode); } // throws unless this match admitted it
    catch { throw new Error("AUTH_FAILED"); }
    if (principal.kind === "guest") return { authId: sessionId, displayName: member.displayName };
    const session = auth.sessions.getById(principal.id);
    if (!session) throw new Error("AUTH_FAILED");
    return { authId: sessionId, displayName: session.displayName };
  }

  override onJoin(client: Client, options: unknown, auth: { authId: string; displayName: string }): void {
    const svc = getArenaAuth();
    if (!svc) throw new Error("AUTH_FAILED");
    const principal = principalOfTicket(auth.authId);
    // Atomic claim in the same synchronous step as seat creation; a duplicate admission throws and is refused.
    svc.sparring.connected(principal, this.roomCode, client.sessionId);
    this.members.set(client.sessionId, principal);
    super.onJoin(client, options, auth);
  }

  override async onDrop(client: Client): Promise<void> {
    const principal = this.members.get(client.sessionId);
    if (principal) getArenaAuth()?.sparring.dropped(principal, this.roomCode, client.sessionId);
    await super.onDrop(client);
  }

  override onReconnect(client: Client): void {
    const principal = this.members.get(client.sessionId);
    try {
      if (principal) getArenaAuth()?.sparring.connected(principal, this.roomCode, client.sessionId);
    } catch {
      void client.leave(4001);
      return;
    }
    super.onReconnect(client);
  }

  override onLeave(client: Client): void {
    const principal = this.members.get(client.sessionId);
    this.members.delete(client.sessionId);
    super.onLeave(client);
    if (!principal) return;
    const dir = getArenaAuth()?.sparring;
    dir?.left(principal, this.roomCode, client.sessionId);
    // The host leaving (explicitly or after the grace period) closes the match for everyone.
    if (principal.kind === "host") {
      try { dir?.end(principal, this.roomCode); } catch { /* already closed or session revoked */ }
      this.closeMatch();
    }
  }

  override onDispose(): void {
    const dir = getArenaAuth()?.sparring;
    if (dir && this.hostId) {
      try { dir.end({ kind: "host", id: this.hostId }, this.roomCode); } catch { /* already closed */ }
    }
    if (rooms.get(this.roomCode) === this) rooms.delete(this.roomCode);
    grants.delete(this.roomCode);
    this.bots.clear();
    this.members.clear();
    super.onDispose();
  }

  closeMatch(): void {
    if (this.closing) return;
    this.closing = true;
    void this.disconnect();
  }

  /** Runs from the simulation tick (once a second) so it works with zero connected clients. Closes every match the directory ended. */
  private sweep(): void {
    const dir = getArenaAuth()?.sparring;
    if (!dir) return;
    for (const code of dir.sweep()) closeSparringRoom(code);
    if (!dir.isOpen(this.roomCode)) this.closeMatch();
  }

  override stepTick(tick: number): void {
    if (tick % SWEEP_EVERY_TICKS === 0) this.sweep();
    for (const bot of this.bots.values()) this.driveBot(bot, tick);
    super.stepTick(tick);
  }

  // ---- bots ----
  private spawnBot(index: number, difficulty: Difficulty): void {
    const entityId = this.nextEntityId++;
    const p = new PlayerSchema();
    p.entityId = entityId;
    p.lifeId = ++this.lifeSeq;
    p.displayName = `Bot ${index + 1}`;
    p.kitId = BOT_KIT;
    p.hp100 = COMBAT.hp100Max;
    p.connected = true;
    p.ready = true;
    this.state.players.set(String(entityId), p);
    this.combat.add(entityId, p.lifeId, this.sim.tick, BOT_KIT);
    this.respawns.startLife(entityId, this.sim.tick);
    const seat: BotSeat = {
      entityId, input: new InputChannel(performance.now()), pendingKit: null,
      difficulty, decision: { ...NEUTRAL }, lifeId: p.lifeId, spawnTick: this.sim.tick,
    };
    this.bots.set(`bot:${entityId}`, seat);
    if (this.movement) {
      this.movement.add(entityId, this.chooseSpawn());
      this.pipeline.publishBody(entityId);
    }
    this.state.phase = "playing";
    log("info", "sparring bot added", { room: this.roomId, entity: entityId, difficulty });
  }

  /** Converts one tick of the pure decision into the same held input and edges a client would send. */
  private driveBot(bot: BotSeat, tick: number): void {
    const f = this.combat.get(bot.entityId);
    const body = this.movement?.get(bot.entityId);
    const pos = this.movement?.position(bot.entityId);
    const input = bot.input;
    input.lastInputTick = tick; // the server keeps the lease alive; it is not a remote packet
    if (!f || !body || !pos || !isAlive(f)) {
      input.neutralize();
      bot.decision = { ...NEUTRAL };
      return;
    }
    if (f.lifeId !== bot.lifeId) { bot.lifeId = f.lifeId; bot.spawnTick = tick; bot.decision = { ...NEUTRAL }; }
    const enemies: Array<BotObservation["enemies"][number]> = [];
    for (const o of this.combat.all()) {
      if (o.entityId === bot.entityId) continue;
      const p = this.movement?.position(o.entityId);
      const schema = this.state.players.get(String(o.entityId));
      if (!p || !schema) continue;
      enemies.push({
        id: o.entityId, x: p[0], z: p[2], alive: isAlive(o), connected: schema.connected, ready: schema.ready,
        attacking: o.action === "Windup" || o.action === "Active",
      });
    }
    const slot1 = this.abilities.registry.slotted(f.kitId, f.form, 1);
    const observation: BotObservation = {
      tick, spawnTick: bot.spawnTick, selfId: bot.entityId, self: { x: pos[0], z: pos[2] },
      slot1Ready: !!slot1 && (f.cooldowns.get(slot1.id) ?? 0) <= tick, enemies,
    };
    const d = decideBot(bot.difficulty, observation, bot.decision);
    bot.decision = d;
    const walk = d.approach && this.groundAhead(pos, d.yaw);
    input.held = {
      moveX: walk ? -Math.sin(d.yaw) : 0, moveZ: walk ? -Math.cos(d.yaw) : 0, yaw: d.yaw, pitch: 0,
      attackHeld: d.attackHeld, blockHeld: d.blockHeld, jumpHeld: false, runHeld: false, chargeHeldSlot: 0,
    };
    // Facing otherwise only follows movement; a bot standing in reach must still face its target.
    if (d.targetId !== null && f.action === "Idle") body.state.facingYaw = d.yaw;
    if (d.castSlot1) {
      const edge: Edge = { id: ++input.lastEdgeId, kind: "skillDown", slot: 1 };
      input.queue.push({ edge, arrivalTick: tick, seq: input.lastReceivedSeq });
    }
  }

  /** Rechecks real collider support on the proposed step: ground present, no cliff or step, no solid in the way. */
  private groundAhead(pos: readonly [number, number, number], yaw: number): boolean {
    const w = this.world;
    if (!w) return false;
    const nx = pos[0] - Math.sin(yaw) * STEP_LOOKAHEAD_M;
    const nz = pos[2] - Math.cos(yaw) * STEP_LOOKAHEAD_M;
    const ground = w.groundHeight(nx, nz, pos[1] + 1, 4);
    if (ground === null) return false;
    const support = pos[1] - ARENA.capsule.centreAboveSurface;
    if (Math.abs(ground - support) > MAX_STEP_DELTA_M) return false;
    return !w.segmentBlocked([pos[0], pos[1], pos[2]], [nx, pos[1], nz]);
  }
}

function principalOfTicket(sessionId: string): SparringPrincipal {
  return sessionId.startsWith(GUEST_TICKET_PREFIX)
    ? { kind: "guest", id: sessionId.slice(GUEST_TICKET_PREFIX.length) }
    : { kind: "host", id: sessionId };
}

export { SPARRING_ROOM_NAME };
