import RAPIER from "@dimforge/rapier3d-compat";
import type { BotDecision, Difficulty } from "@eb/shared/sparring";
import { ARENA } from "@eb/shared/config/arena";
import { COMBAT } from "@eb/shared/config/combat";
import { integrateMovement } from "@eb/shared/movement";
import { meterRequired100 } from "@eb/shared/awakening";
import { P0_KITS } from "@eb/shared/protocol";
import { ArenaRoom } from "./ArenaRoom.js";
import { PlayerSchema } from "../state/PlayerSchema.js";
import { InputChannel, neutralIntent } from "../net/ValidateInput.js";
import type { PipelineSeat } from "../sim/TickPipeline.js";
import { decideBot } from "../sim/SparringBrain.js";
import { isAlive } from "../sim/ActionMachine.js";
import { NAV, NavGrid } from "../sim/BotNavigation.js";
import { facesWithin60 } from "../sim/BotTactics.js";
const neutral = (): BotDecision => ({ targetId: null, attackHeld: false, blockHeld: false, approach: false, castSlot: 0, dash: false, awaken: false, retreat: false, yaw: 0, holdSlot: 0, releaseSlot: 0, losLost: 0 });
interface BotSeat extends PipelineSeat {
  difficulty: Difficulty;
  decision: BotDecision;
  lifeId: number;
  spawnTick: number;
  nav: BotNavState;
  /** GR14: kit and form the tactic state belongs to; any change clears it. */
  tacticKey: string;
}
/** GR13 per-bot route memory; voluntary walk intent only. */
interface BotNavState {
  path: number[]; wp: number; planTick: number; planTarget: [number, number] | null;
  progress: [number, number, number] | null; // x, z, tick of the last progress reference
  stalled: boolean;
}
const freshNav = (): BotNavState => ({ path: [], wp: 0, planTick: -Infinity, planTarget: null, progress: null, stalled: false });

/** One authoritative bot pipeline shared by arena, practice and hosted rooms. */
export class BotArenaRoom extends ArenaRoom {
  protected readonly bots = new Map<string, BotSeat>();
  /** Static topology, built once per room on first bot and released with it. */
  private navGrid: NavGrid | null = null;
  override async onCreate(options: { roomCode?: string }): Promise<void> {
    const meta = this.authServices()?.roomMeta.get(options.roomCode ?? "");
    const difficulties = meta?.bots ?? [];
    if (meta?.mapId) this.mapId = meta.mapId; // WORLD01: schema-validated against the registry when the room was created
    // Decision 0054: rounds only for rooms that contain bots; a botless open FFA room stays endless.
    this.roundTarget = difficulties.length > 0 ? meta?.roundTarget ?? 0 : 0;
    this.maxClients = 4 - difficulties.length;
    await super.onCreate(options);
    this.combat.isBot = (id) => [...this.bots.values()].some((b) => b.entityId === id);
    this.addBots(difficulties);
  }
  protected botTargetAllowed(_id: number): boolean { return true; }
  protected botsNeverWander(): boolean { return false; }
  protected addBots(difficulties: readonly Difficulty[], firstIndex = 0): void {
    difficulties.forEach((difficulty, i) => {
      const index = firstIndex + i;
      const id = this.allocEntityId();
      this.registerOccupant(id);
      const p = new PlayerSchema();
      p.entityId = id; p.lifeId = ++this.lifeSeq; p.displayName = `Bot ${index + 1}`;
      const kit = P0_KITS[index % P0_KITS.length]!;
      p.kitId = kit; p.connected = true; p.ready = true; p.hp100 = COMBAT.hp100Max;
      this.state.players.set(String(id), p);
      this.combat.add(id, p.lifeId, this.sim.tick, kit);
      this.respawns.startLife(id, this.sim.tick);
      this.movement!.add(id, this.chooseBotSpawn(index));
      this.bots.set(`bot:${id}`, { entityId: id, input: new InputChannel(0), pendingKit: null, difficulty,
        decision: neutral(), lifeId: p.lifeId, spawnTick: this.sim.tick, nav: freshNav(), tacticKey: `${kit}:Base` });
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
      this.releaseOccupant(b.entityId);
    }
    this.bots.clear();
  }
  override onDispose(): void { this.bots.clear(); this.navGrid = null; super.onDispose(); }
  protected override pipelineSeats(): ReadonlyMap<string, PipelineSeat> {
    return new Map<string, PipelineSeat>([...this.seats, ...this.bots]);
  }

  /**
   * GR13: unit walk direction along a bounded A* route, or [0, 0] when no route exists (stop safely, retry on the next
   * 30-tick opportunity). Returns null to keep the straight-line intent once the route is exhausted.
   */
  private routeStep(bot: BotSeat, tick: number, world: NonNullable<typeof this.world>, x: number, z: number, tx: number, tz: number): [number, number] | null {
    const grid = this.navGrid ??= NavGrid.build(world);
    const n = bot.nav;
    if (!n.progress) n.progress = [x, z, tick];
    else if (tick - n.progress[2] >= NAV.progressTicks) {
      n.stalled = Math.hypot(x - n.progress[0], z - n.progress[1]) < NAV.progressMin;
      n.progress = [x, z, tick];
    }
    if (tick - n.planTick >= NAV.replanTicks) {
      const wpPos = n.path[n.wp] === undefined ? null : grid.xz(n.path[n.wp]!);
      const invalid = wpPos !== null && Math.hypot(wpPos[0] - x, wpPos[1] - z) > 3;
      const moved = !n.planTarget || Math.hypot(n.planTarget[0] - tx, n.planTarget[1] - tz) >= NAV.retargetDistance;
      if (n.path.length === 0 || invalid || moved || n.stalled) {
        const plan = grid.plan(x, z, tx, tz);
        n.planTick = tick; n.stalled = false; n.planTarget = [tx, tz];
        // A failed plan stops the bot; a later opportunity retries. Never keep a path to a stale goal.
        n.path = plan.status === "ok" ? plan.nodes : []; n.wp = 0;
        if (plan.status !== "ok") return [0, 0];
      }
    }
    if (n.path.length === 0) return [0, 0];
    while (n.wp < n.path.length) {
      const [wx, wz] = grid.xz(n.path[n.wp]!);
      const dist = Math.hypot(wx - x, wz - z);
      if (dist > NAV.waypointRadius) return [(wx - x) / dist, (wz - z) / dist];
      n.wp++;
    }
    return null; // route finished: close the last metres in a straight line as before
  }

  protected override beforeDrain(tick: number): void {
    const mv = this.movement, world = this.world;
    if (!mv || !world) return;
    const enemies = [...this.state.players.values()].map(p => {
      const f = this.combat.get(p.entityId), pos = mv.position(p.entityId);
      return { id: p.entityId, x: pos?.[0] ?? 0, y: pos?.[1] ?? 0, z: pos?.[2] ?? 0, yaw: mv.get(p.entityId)?.state.facingYaw ?? 0, alive: !!f && isAlive(f), connected: p.connected,
        ready: p.ready, attacking: !!f && ["Windup", "Active"].includes(f.action) };
    });
    for (const bot of this.bots.values()) {
      const f = this.combat.get(bot.entityId), body = mv.get(bot.entityId), pos = mv.position(bot.entityId);
      bot.input.neutralize();
      if (!f || !body || !pos || !isAlive(f)) { bot.decision = neutral(); continue; }
      if (f.lifeId !== bot.lifeId) { bot.lifeId = f.lifeId; bot.spawnTick = f.actionStartTick; bot.decision = neutral(); bot.nav = freshNav(); }
      const key = `${f.kitId}:${f.form}`;
      if (key !== bot.tacticKey) { bot.tacticKey = key; bot.decision = neutral(); }
      // GR14: a move is ready only if Idle, off cooldown, form valid and its once-per-form bit is clear.
      const readyMove = (slot: 1 | 2 | 3 | 4): string => {
        const def = this.abilities.registry.slotted(f.kitId, f.form, slot);
        if (!def || f.action !== "Idle" || (f.cooldowns.get(def.id) ?? 0) > tick) return "";
        if (def.oncePerForm && (f.awakenedUsedMask & (1 << (slot - 1))) !== 0) return "";
        return def.id;
      };
      const readyMoves: [string, string, string, string] = [readyMove(1), readyMove(2), readyMove(3), readyMove(4)];
      const chargeStart = this.abilities.chargeStartOf(bot.entityId);
      const routeMemo = new Map<number, boolean>();
      const visible = enemies.filter(e => this.botTargetAllowed(e.id)).map(e => ({
        ...e, los: !world.segmentBlocked([pos[0], pos[1] + 0.5, pos[2]], [e.x, e.y + 0.5, e.z]),
        facingSelf: facesWithin60(e.yaw, e, { x: pos[0], z: pos[2] }),
      }));
      bot.decision = decideBot(bot.difficulty, { ...(this.botsNeverWander() ? { noWander: true } : {}), tick, spawnTick: bot.spawnTick, selfId: bot.entityId,
        self: { x: pos[0], z: pos[2] }, enemies: visible,
        slotsReady: [readyMoves[0] !== "", readyMoves[1] !== "", readyMoves[2] !== "", readyMoves[3] !== ""],
        meterFull: f.meter100 >= meterRequired100(f.kitId),
        tactics: {
          kitId: f.kitId, form: f.form === "Awakened" ? "Awakened" : "Base", grounded: body.state.grounded, readyMoves,
          chargeSlot: chargeStart > 0 ? 3 : 0, chargeStartTick: chargeStart,
          dashReady: f.action === "Idle" && (f.cooldowns.get("dash.back") ?? 0) <= tick,
          routeSafe: id => {
            let ok = routeMemo.get(id);
            if (ok === undefined) {
              const e = enemies.find(x => x.id === id);
              ok = !!e && (this.navGrid ??= NavGrid.build(world)).plan(pos[0], pos[2], e.x, e.z).status === "ok";
              routeMemo.set(id, ok);
            }
            return ok;
          },
          supported: id => { const e = enemies.find(x => x.id === id); return !!e && world.walkableTop(e.x, e.z) !== null; },
        } }, bot.decision);
      const d = bot.decision;
      let moveX = d.approach ? -Math.sin(d.yaw) : d.retreat ? Math.sin(d.yaw) : 0;
      let moveZ = d.approach ? -Math.cos(d.yaw) : d.retreat ? Math.cos(d.yaw) : 0;
      if (d.approach) {
        const target = enemies.find(e => e.id === d.targetId);
        const route = target ? this.routeStep(bot, tick, world, pos[0], pos[2], target.x, target.z) : null;
        if (route) { moveX = route[0]; moveZ = route[1]; }
      } else bot.nav.progress = null;
      // FB02: slower bots shrink the intent magnitude; physics and speed caps are untouched.
      moveX *= d.moveScale ?? 1; moveZ *= d.moveScale ?? 1;
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
      bot.input.held = { ...neutralIntent(), moveX, moveZ, yaw: d.yaw, attackHeld: d.attackHeld, blockHeld: d.blockHeld, chargeHeldSlot: d.holdSlot };
      bot.input.lastInputTick = tick;
      bot.input.lastReceivedSeq++;
      const push = (edge: { kind: "dash" | "awaken" } | { kind: "skillDown" | "skillUp"; slot: 1 | 2 | 3 | 4 }) => {
        const id = ++bot.input.lastEdgeId;
        bot.input.queue.push({ edge: { id, ...edge }, arrivalTick: tick, seq: bot.input.lastReceivedSeq });
      };
      // Press moves ignore skillUp; only a held charge (Ember Orb) reacts to the release edge.
      if (d.releaseSlot > 0) push({ kind: "skillUp", slot: d.releaseSlot as 1 | 2 | 3 | 4 });
      if (d.awaken) push({ kind: "awaken" });
      if (d.dash) push({ kind: "dash" });
      if (d.castSlot > 0) push({ kind: "skillDown", slot: d.castSlot as 1 | 2 | 3 | 4 });
    }
  }
}
