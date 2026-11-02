import RAPIER from "@dimforge/rapier3d-compat";
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
const neutral = (): BotDecision => ({ targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot1: false, yaw: 0 });
interface BotSeat extends PipelineSeat {
  difficulty: Difficulty;
  decision: BotDecision;
  lifeId: number;
  spawnTick: number;
}

/** One authoritative bot pipeline shared by arena, practice and hosted rooms. */
export class BotArenaRoom extends ArenaRoom {
  protected readonly bots = new Map<string, BotSeat>();
  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const difficulties = this.authServices()?.roomMeta.get(options.roomCode ?? "")?.bots ?? [];
    this.maxClients = 4 - difficulties.length;
    await super.onCreate(options);
    this.addBots(difficulties);
  }
  protected botTargetAllowed(_id: number): boolean { return true; }
  protected addBots(difficulties: readonly Difficulty[]): void {
    difficulties.forEach((difficulty, index) => {
      const id = this.nextEntityId++;
      const p = new PlayerSchema();
      p.entityId = id; p.lifeId = ++this.lifeSeq; p.displayName = `Bot ${index + 1}`;
      p.kitId = "sv"; p.connected = true; p.ready = true; p.hp100 = COMBAT.hp100Max;
      this.state.players.set(String(id), p);
      this.combat.add(id, p.lifeId, this.sim.tick, "sv");
      this.respawns.startLife(id, this.sim.tick);
      this.movement!.add(id, this.chooseBotSpawn(index));
      this.bots.set(`bot:${id}`, { entityId: id, input: new InputChannel(0), pendingKit: null, difficulty,
        decision: neutral(), lifeId: p.lifeId, spawnTick: this.sim.tick });
      this.pipeline.publishBody(id);
    });
  }
  protected chooseBotSpawn(_index: number): [number, number, number] { return this.chooseSpawn(); }
  protected clearBots(): void {
    for (const b of this.bots.values()) {
      this.combat.remove(b.entityId, this.sim.tick); this.m1.remove(b.entityId);
      this.abilities.remove(b.entityId); this.urns.drop(b.entityId); this.awakening.remove(b.entityId);
      this.respawns.forget(b.entityId); this.movement?.remove(b.entityId);
      this.state.players.delete(String(b.entityId));
    }
    this.bots.clear();
  }
  override onDispose(): void { this.bots.clear(); super.onDispose(); }
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
        self: { x: pos[0], z: pos[2] }, enemies: enemies.filter(e => this.botTargetAllowed(e.id)),
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
