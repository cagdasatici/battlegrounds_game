import type { Client } from "colyseus";
import RAPIER from "@dimforge/rapier3d-compat";
import { JoinOptionsSchema } from "@eb/shared/protocol";
import type { BotDecision, Difficulty } from "@eb/shared/sparring";
import { ARENA } from "@eb/shared/config/arena";
import { COMBAT } from "@eb/shared/config/combat";
import { integrateMovement } from "@eb/shared/movement";
import { ArenaRoom } from "./ArenaRoom.js";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { InputChannel, neutralIntent } from "../net/ValidateInput.js";
import type { PipelineSeat } from "../sim/TickPipeline.js";
import { decideBot } from "../sim/SparringBrain.js";
import { isAlive } from "../sim/ActionMachine.js";
import { sparringAuthId, sparringPrincipal } from "../http/sparringRoutes.js";
import { originOk } from "../http/securityHeaders.js";

const neutral = (): BotDecision => ({ targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot1: false, yaw: 0 });
interface BotSeat extends PipelineSeat {
  difficulty: Difficulty;
  decision: BotDecision;
  lifeId: number;
  spawnTick: number;
}

/** Private hosted FFA. Humans retain ordinary transport seats; bots never have synthetic clients. */
export class SparringRoom extends ArenaRoom {
  private readonly bots = new Map<string, BotSeat>();

  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const info = this.authServices()?.sparring.describe(options.roomCode ?? "");
    if (!info) throw new Error("MATCH_CLOSED");
    this.maxClients = 4 - info.bots.length;
    await super.onCreate(options);
    // Membership, rather than socket count, owns lifetime (including a completely disconnected host).
    this.autoDispose = false;
    info.bots.forEach((difficulty, index) => {
      const id = this.nextEntityId++;
      const p = new PlayerSchema();
      p.entityId = id; p.lifeId = ++this.lifeSeq; p.displayName = `Bot ${index + 1}`;
      p.kitId = "sv"; p.connected = true; p.ready = true; p.hp100 = COMBAT.hp100Max;
      this.state.players.set(String(id), p);
      this.combat.add(id, p.lifeId, this.sim.tick, "sv");
      this.respawns.startLife(id, this.sim.tick);
      this.movement!.add(id, this.chooseSpawn());
      this.bots.set(`bot:${id}`, { entityId: id, input: new InputChannel(0), pendingKit: null, difficulty,
        decision: neutral(), lifeId: p.lifeId, spawnTick: this.sim.tick });
      this.pipeline.publishBody(id);
    });
  }

  override async onAuth(client: Client, options: unknown, context?: { headers?: Headers }): Promise<{ authId: string; displayName: string }> {
    const svc = this.authServices();
    const parsed = JoinOptionsSchema.safeParse(options);
    if (!svc || !parsed.success || originOk(context?.headers?.get("origin"), svc.config.allowedOrigins) === "foreign"
      || this.sim.isOverloaded(this.wallNow())) throw new Error("AUTH_FAILED");
    const o = parsed.data;
    const ticket = svc.tickets.consume(o.ticket, { roomName: this.roomName, roomCode: this.roomCode,
      contentHash: this.state.contentHash, protocolVersion: this.state.protocolVersion });
    if (!ticket || o.roomCode !== this.roomCode || o.contentHash !== this.state.contentHash || o.protocolVersion !== this.state.protocolVersion) throw new Error("AUTH_FAILED");
    const principal = sparringPrincipal(ticket.sessionId);
    if (!principal) throw new Error("AUTH_FAILED");
    const membership = svc.sparring.authorizeJoin(principal, this.roomCode);
    const adult = principal.kind === "host" ? svc.sessions.getById(principal.id) : null;
    // Synchronous claim before returning to Colyseus: concurrent tickets cannot duplicate a seat.
    svc.sparring.connected(principal, this.roomCode, client.sessionId);
    return { authId: sparringAuthId(principal), displayName: adult?.displayName ?? membership.displayName };
  }

  override async onDrop(client: Client): Promise<void> {
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (principal) this.authServices()!.sparring.dropped(principal, this.roomCode, client.sessionId);
    await super.onDrop(client);
  }
  override onReconnect(client: Client): void {
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (!principal) { void client.leave(); return; }
    try { this.authServices()!.sparring.connected(principal, this.roomCode, client.sessionId); }
    catch { void client.leave(); return; }
    super.onReconnect(client);
  }
  override onLeave(client: Client): void {
    const svc = this.authServices()!;
    const principal = sparringPrincipal(this.seats.get(client.sessionId)?.sessionAuthId ?? "");
    if (principal) svc.sparring.left(principal, this.roomCode, client.sessionId);
    super.onLeave(client);
    if (!svc.sparring.describe(this.roomCode)) void svc.closeRoom(this.roomCode);
  }
  override onDispose(): void {
    this.bots.clear();
    super.onDispose();
  }
  protected override pipelineSeats(): ReadonlyMap<string, PipelineSeat> {
    return new Map<string, PipelineSeat>([...this.seats, ...this.bots]);
  }

  protected override beforeDrain(tick: number): void {
    const mv = this.movement, world = this.world;
    if (!mv || !world) return;
    const enemies = [...this.state.players.values()].map(p => {
      const f = this.combat.get(p.entityId), pos = mv.position(p.entityId);
      return { id: p.entityId, x: pos?.[0] ?? 0, z: pos?.[2] ?? 0, alive: !!f && isAlive(f), connected: p.connected,
        ready: p.ready, attacking: !!f && ["Windup", "Active"].includes(f.action) };
    });
    for (const bot of this.bots.values()) {
      const f = this.combat.get(bot.entityId), body = mv.get(bot.entityId), pos = mv.position(bot.entityId);
      bot.input.neutralize();
      if (!f || !body || !pos || !isAlive(f)) { bot.decision = neutral(); continue; }
      if (f.lifeId !== bot.lifeId) { bot.lifeId = f.lifeId; bot.spawnTick = f.actionStartTick; bot.decision = neutral(); }
      const def = this.abilities.registry.slotted(f.kitId, f.form, 1);
      bot.decision = decideBot(bot.difficulty, { tick, spawnTick: bot.spawnTick, selfId: bot.entityId,
        self: { x: pos[0], z: pos[2] }, enemies,
        slot1Ready: f.action === "Idle" && !!def && (f.cooldowns.get(def.id) ?? 0) <= tick }, bot.decision);
      const d = bot.decision;
      let moveX = d.approach ? -Math.sin(d.yaw) : 0, moveZ = d.approach ? -Math.cos(d.yaw) : 0;
      // Predict the ordinary walk step, including inertia, then query the actual static collider world.
      const step = integrateMovement({ ...body.state }, { moveX, moveZ, run: false, guard: d.blockHeld, jumpPressed: false }, tick);
      const nx = pos[0] + step.dx, nz = pos[2] + step.dz;
      let safe = world.capsuleOverlaps([nx, pos[1] + 0.06, nz], COMBAT.capsule.radius, COMBAT.capsule.halfHeight).length === 0;
      for (let i = 0; i < 8 && safe; i++) {
        const x = nx + Math.cos(i * Math.PI / 4) * COMBAT.capsule.radius;
        const z = nz + Math.sin(i * Math.PI / 4) * COMBAT.capsule.radius;
        const y = pos[1] - ARENA.capsule.centreAboveSurface + COMBAT.controller.stepHeight;
        const ground = world.rapier.castRay(new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 }),
          COMBAT.controller.stepHeight + COMBAT.controller.snapDown + 0.1, true, RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
        safe = ground !== null;
      }
      if (!safe) {
        moveX = 0; moveZ = 0;
        // Cancel voluntary drift only; knockback/capture movement retains ordinary combat semantics.
        if (f.action === "Idle" || f.action === "Guard") { body.state.vx = 0; body.state.vz = 0; }
      }
      if ((f.action === "Idle" || f.action === "Guard") && d.targetId !== null) body.state.facingYaw = d.yaw;
      bot.input.held = { ...neutralIntent(), moveX, moveZ, yaw: d.yaw, attackHeld: d.attackHeld, blockHeld: d.blockHeld };
      bot.input.lastInputTick = tick;
      bot.input.lastReceivedSeq++;
      if (d.castSlot1) {
        const id = ++bot.input.lastEdgeId;
        bot.input.queue.push({ edge: { id, kind: "skillDown", slot: 1 }, arrivalTick: tick, seq: bot.input.lastReceivedSeq });
      }
    }
  }
}
