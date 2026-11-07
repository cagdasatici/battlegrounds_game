import {
  BEAST, BEAST_ENTITY_ID, BEAST_KIT, BEAST_MOVES, beastHp100, beastLaunch, beastSpawnDelay, inBeastZone, pickBeastMove,
  type BeastMove,
} from "@eb/shared/config/beast";
import { ARENA, type MapVec3 } from "@eb/shared/config/arena";
import { quantizeCm, quantizeYaw } from "@eb/shared/schema";
import type { BeastSchema } from "../state/ArenaSchema.js";
import { InputChannel, neutralIntent } from "../net/ValidateInput.js";
import { applyReaction, beginCast, isAlive } from "./ActionMachine.js";
import type { CombatSystem } from "./Combat.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";
import type { MovementSystem } from "./Movement.js";
import type { PipelineSeat } from "./TickPipeline.js";
import type { RespawnSystem } from "./RespawnSystem.js";
import type { World } from "./World.js";

export interface BeastHuman { id: number; x: number; y: number; z: number; grounded: boolean }

export interface BeastHost {
  state: BeastSchema;
  combat: CombatSystem;
  respawns: RespawnSystem;
  movement: () => MovementSystem | null;
  world: () => World | null;
  nextLifeId: () => number;
  registerOccupant: (id: number) => number;
  releaseOccupant: (id: number) => void;
  /** Connected, living human fighters (never bots) with their server poses. */
  humans: () => readonly BeastHuman[];
  /** Deterministic uniform [0,1) for (index, salt); the room seeds it per room. */
  rand: (index: number, salt: number) => number;
  /** Optional observer for banners and logs. */
  onPhase?: (phase: "warning" | "spawned" | "defeated" | "left", tick: number) => void;
}

type Phase = "none" | "warning" | "alive" | "defeated";
const TAU = Math.PI * 2;

/**
 * BEAST01 server side. Owns the beast's lifecycle, brain and attack zones. It reuses the ordinary combat pipeline for
 * everything else: it is a combat fighter (so kits and M1 can hit it through a larger hurtbox), a pseudo seat (so the
 * movement system walks it from an input channel), and its attacks are HitCandidates resolved by the same HitResolver
 * (block, counter, protection, duplicate hit and interruption all apply). All timers are integer ticks.
 */
export class BeastSystem {
  readonly seat: PipelineSeat = { entityId: BEAST_ENTITY_ID, input: new InputChannel(0), pendingKit: null };
  private phase: Phase = "none";
  private nextSpawnTick: number;
  private spawnIndex = 0;
  private attackIndex = 0;
  private spawnedTick = 0;
  private restUntil = 0;
  private prevAction = "Idle";
  private lastHp = 0;
  private damageWindow: Array<{ tick: number; dmg: number }> = [];
  private anchor: MapVec3 = [0, 0, 0];
  private stall: { x: number; z: number; tick: number } | null = null;
  private sidestepUntil = 0;
  private sidestepSign = 1;
  private lastSafe: MapVec3 | null = null;

  constructor(private readonly host: BeastHost, startTick: number) {
    this.nextSpawnTick = startTick + beastSpawnDelay(host.rand(0, 1), true);
  }

  get active(): boolean { return this.phase === "alive"; }
  get currentPhase(): Phase { return this.phase; }
  get scheduledSpawnTick(): number { return this.nextSpawnTick; }

  /** Test seam: bring the next spawn forward. */
  spawnAt(tick: number): void { this.nextSpawnTick = tick; }

  /** Round reset or room teardown: the beast leaves without a defeat. */
  reset(tick: number): void {
    if (this.phase !== "none") this.leave(tick, "left");
    this.nextSpawnTick = Math.max(this.nextSpawnTick, tick + BEAST.warningTicks);
  }

  update(tick: number): void {
    const humans = this.host.humans();
    switch (this.phase) {
      case "none":
        if (tick >= this.nextSpawnTick) {
          if (humans.length === 0) this.nextSpawnTick = tick + 300; // wait until someone is there to fight it
          else this.startWarning(tick, humans);
        }
        break;
      case "warning":
        if (humans.length === 0) { this.phase = "none"; this.nextSpawnTick = tick + 600; this.publishNone(); break; }
        if (tick >= this.host.state.phaseEndTick) this.spawn(tick, humans);
        break;
      case "alive": this.think(tick, humans); break;
      case "defeated":
        if (tick >= this.host.state.phaseEndTick) { this.phase = "none"; this.publishNone(); }
        break;
    }
  }

  // ---- lifecycle ----
  private startWarning(tick: number, humans: readonly BeastHuman[]): void {
    let best: readonly number[] = BEAST.anchors[0]!, bestD = -1;
    for (const a of BEAST.anchors) {
      const d = Math.min(...humans.map((h) => Math.hypot(h.x - a[0], h.z - a[2])));
      if (d > bestD) { bestD = d; best = a; }
    }
    this.anchor = [best[0]!, best[1]!, best[2]!];
    this.phase = "warning";
    const s = this.host.state;
    s.phase = "warning"; s.phaseEndTick = tick + BEAST.warningTicks;
    s.x = quantizeCm(this.anchor[0]); s.y = 0; s.z = quantizeCm(this.anchor[2]);
    s.hp100 = 0; s.hpMax100 = 0; s.action = "Idle"; s.moveId = ""; s.walking = false;
    this.host.onPhase?.("warning", tick);
  }

  private spawn(tick: number, humans: readonly BeastHuman[]): void {
    const mv = this.host.movement(), w = this.host.world();
    if (!mv || !w) return;
    const [ax, , az] = this.anchor;
    const ground = w.groundHeight(ax, az) ?? 0;
    const hp = beastHp100(humans.length);
    const id = BEAST_ENTITY_ID;
    this.host.registerOccupant(id);
    const f = this.host.combat.add(id, this.host.nextLifeId(), tick, BEAST_KIT);
    f.hp100 = hp; f.armored = true; f.protectedUntilTick = tick + BEAST.spawnProtectionTicks;
    this.host.respawns.startLife(id, tick);
    mv.add(id, [ax, ground + ARENA.capsule.centreAboveSurface, az], Math.atan2(ax, az));
    this.phase = "alive"; this.spawnedTick = tick; this.restUntil = tick + 120; this.prevAction = "Idle";
    this.lastHp = hp; this.damageWindow = []; this.stall = null; this.sidestepUntil = 0; this.lastSafe = [ax, ground + ARENA.capsule.centreAboveSurface, az];
    this.host.state.hpMax100 = hp;
    this.host.onPhase?.("spawned", tick);
    this.publish(tick);
  }

  private removeEntity(tick: number): void {
    const id = BEAST_ENTITY_ID;
    this.host.combat.remove(id, tick);
    this.host.movement()?.remove(id);
    this.host.respawns.forget(id);
    this.host.releaseOccupant(id);
    this.seat.input.neutralize();
  }

  private leave(tick: number, kind: "left"): void {
    if (this.phase === "alive") this.removeEntity(tick);
    this.phase = "none";
    this.spawnIndex++;
    this.nextSpawnTick = tick + beastSpawnDelay(this.host.rand(this.spawnIndex, 1), false);
    this.publishNone();
    this.host.onPhase?.(kind, tick);
  }

  private defeat(tick: number): void {
    const pos = this.host.movement()?.position(BEAST_ENTITY_ID);
    this.removeEntity(tick);
    for (const h of this.host.humans()) {
      const hf = this.host.combat.get(h.id);
      if (hf) this.host.combat.heal(hf, BEAST.defeatHeal100, "beast.defeat", tick);
    }
    this.phase = "defeated";
    this.spawnIndex++;
    this.nextSpawnTick = tick + BEAST.defeatedTicks + beastSpawnDelay(this.host.rand(this.spawnIndex, 1), false);
    const s = this.host.state;
    s.phase = "defeated"; s.phaseEndTick = tick + BEAST.defeatedTicks; s.hp100 = 0; s.action = "Dead"; s.moveId = ""; s.walking = false;
    if (pos) { s.x = quantizeCm(pos[0]); s.y = quantizeCm(pos[1]); s.z = quantizeCm(pos[2]); }
    this.host.onPhase?.("defeated", tick);
  }

  // ---- brain ----
  private think(tick: number, humans: readonly BeastHuman[]): void {
    const { combat } = this.host;
    const mv = this.host.movement(), w = this.host.world();
    const f = combat.get(BEAST_ENTITY_ID), body = mv?.get(BEAST_ENTITY_ID), pos = mv?.position(BEAST_ENTITY_ID);
    this.seat.input.neutralize();
    if (!mv || !w || !f || !body || !pos) { this.phase = "none"; this.publishNone(); return; }
    if (!isAlive(f)) { this.defeat(tick); return; }
    if (tick - this.spawnedTick >= BEAST.lifetimeTicks || humans.length === 0) { this.leave(tick, "left"); return; }

    // Never carried: a launch from a kit or a drag cannot push it anywhere; keep gravity.
    body.state.vx = 0; body.state.vz = 0;
    if (w.walkableTop(pos[0], pos[2]) !== null) this.lastSafe = [pos[0], pos[1], pos[2]];
    else if (this.lastSafe && pos[1] > -5) { // pushed off by something unexpected: put it back on its last safe spot
      const p = { x: this.lastSafe[0], y: this.lastSafe[1], z: this.lastSafe[2] };
      mv.setPosition(BEAST_ENTITY_ID, [p.x, p.y, p.z]); body.state.vy = 0;
    }

    // Stagger: enough damage inside the window interrupts whatever it is doing.
    if (f.hp100 < this.lastHp) this.damageWindow.push({ tick, dmg: this.lastHp - f.hp100 });
    this.lastHp = f.hp100;
    this.damageWindow = this.damageWindow.filter((d) => tick - d.tick < BEAST.staggerWindowTicks);
    if (this.damageWindow.reduce((s, d) => s + d.dmg, 0) >= BEAST.staggerDamage100 && f.action !== "Stunned") {
      this.damageWindow = [];
      applyReaction(f, tick, { kind: "stun", ticks: BEAST.staggerTicks }, false);
    }
    if (f.action === "Idle" && this.prevAction !== "Idle") this.restUntil = tick + BEAST.restTicks;
    this.prevAction = f.action;

    let target: BeastHuman | undefined, bestD = Infinity;
    for (const h of humans) {
      const d = Math.hypot(h.x - pos[0], h.z - pos[2]);
      if (d < bestD || (d === bestD && target && h.id < target.id)) { bestD = d; target = h; }
    }
    if (!target) { this.publish(tick); return; }
    const yawTo = Math.atan2(-(target.x - pos[0]), -(target.z - pos[2]));

    let walking = false;
    if (f.action === "Idle") {
      body.state.facingYaw = turnToward(body.state.facingYaw, yawTo, BEAST.turnPerTick);
      if (tick >= this.restUntil) {
        const swipe = BEAST_MOVES["beast.swipe"];
        if (bestD <= swipe.reach - 1) {
          const crowd = humans.filter((h) => Math.hypot(h.x - pos[0], h.z - pos[2]) <= BEAST_MOVES["beast.slam"].reach).length;
          const move = BEAST_MOVES[pickBeastMove(this.attackIndex++, crowd)];
          beginCast(f, tick, move.id, move.startup, move.active, move.recovery, 0);
        } else walking = this.walk(tick, w, body.state.facingYaw, yawTo, pos);
      }
    } else if (f.action === "Windup" && f.cast) {
      const move = BEAST_MOVES[f.cast.moveId as keyof typeof BEAST_MOVES];
      if (move && tick - f.actionStartTick < move.trackTicks) body.state.facingYaw = turnToward(body.state.facingYaw, yawTo, BEAST.turnPerTick);
    }
    this.host.state.walking = walking;
    this.publish(tick);
  }

  /** Walks toward the target while keeping its whole footprint over walkable ground. Returns true when it moved. */
  private walk(tick: number, w: World, facing: number, yawTo: number, pos: MapVec3): boolean {
    // Progress watch: a pillar or wall in the way makes it sidestep for a moment.
    if (!this.stall) this.stall = { x: pos[0], z: pos[2], tick };
    else if (tick - this.stall.tick >= BEAST.stallTicks) {
      if (Math.hypot(pos[0] - this.stall.x, pos[2] - this.stall.z) < 0.6) { this.sidestepUntil = tick + BEAST.sidestepTicks; this.sidestepSign = -this.sidestepSign; }
      this.stall = { x: pos[0], z: pos[2], tick };
    }
    const base = tick < this.sidestepUntil ? yawTo + this.sidestepSign * Math.PI / 2 : yawTo;
    const top = w.walkableTop(pos[0], pos[2]);
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) {
      const yaw = base + off;
      const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      if (!footprintSafe(w, pos[0] + dx, pos[2] + dz, top)) continue;
      this.seat.input.held = { ...neutralIntent(), moveX: dx * BEAST.moveMagnitude, moveZ: dz * BEAST.moveMagnitude, yaw: facing };
      this.seat.input.lastInputTick = tick; this.seat.input.lastReceivedSeq++;
      return true;
    }
    return false;
  }

  // ---- hits ----
  candidates(tick: number): HitCandidate[] {
    if (this.phase !== "alive") return [];
    const f = this.host.combat.get(BEAST_ENTITY_ID), mv = this.host.movement();
    const pos = mv?.position(BEAST_ENTITY_ID), body = mv?.get(BEAST_ENTITY_ID);
    if (!f || !pos || !body || f.action !== "Active" || !f.cast) return [];
    const move: BeastMove | undefined = BEAST_MOVES[f.cast.moveId as keyof typeof BEAST_MOVES];
    if (!move || tick < f.cast.activeStart || tick >= f.cast.activeEnd) return [];
    const out: HitCandidate[] = [];
    for (const h of this.host.humans()) {
      if (move.groundedOnly && !h.grounded) continue;
      if (!inBeastZone(move, pos[0], pos[2], body.state.facingYaw, h.x, h.z)) continue;
      const tf = this.host.combat.get(h.id);
      if (!tf) continue;
      // Not lethal while BEAST.lethal is false: it leaves the human on at least 1 HP (100 hundredths).
      const damage100 = BEAST.lethal ? move.damage100 : Math.max(0, Math.min(move.damage100, tf.hp100 - 100));
      out.push({
        attackerId: BEAST_ENTITY_ID, attackerGeneration: f.generation, castCounter: f.castCounter, hitIndex: 0, toi: 0,
        targetId: h.id, moveId: move.id, originX: pos[0], originZ: pos[2], block: "B", counterable: true, armorBreak: true,
        damage100, reaction: { kind: "ragdoll", ticks: move.ragdollTicks }, maxHitsPerTarget: 1, chip100: move.chip100,
      });
    }
    return out;
  }

  launches(tick: number, results: readonly HitResult[]): Array<{ targetId: number; vx: number; vy: number; vz: number }> {
    const w = this.host.world(), mv = this.host.movement();
    if (!w || !mv) return [];
    const out: Array<{ targetId: number; vx: number; vy: number; vz: number }> = [];
    for (const r of results) {
      const c = r.candidate;
      if (c.attackerId !== BEAST_ENTITY_ID || r.outcome !== "hit" || r.killed) continue;
      const move = BEAST_MOVES[c.moveId as keyof typeof BEAST_MOVES];
      const v = this.host.combat.get(c.targetId), tp = mv.position(c.targetId);
      if (!move || !v || !tp || v.action !== "Ragdolled" || v.actionStartTick !== tick) continue;
      out.push({ targetId: c.targetId, ...beastLaunch((x, z) => w.walkableTop(x, z), move, c.originX, c.originZ, tp[0], tp[2]) });
    }
    return out;
  }

  /** True when a candidate would capture the beast (captures are discarded: a drag could carry it over an edge). */
  static capturesBeast(c: HitCandidate): boolean { return c.targetId === BEAST_ENTITY_ID && !!c.capture; }

  // ---- replication ----
  private publishNone(): void {
    const s = this.host.state;
    s.phase = "none"; s.hp100 = 0; s.hpMax100 = 0; s.action = "Idle"; s.moveId = ""; s.walking = false; s.phaseEndTick = 0;
  }

  private publish(tick: number): void {
    const s = this.host.state, f = this.host.combat.get(BEAST_ENTITY_ID);
    const mv = this.host.movement(), pos = mv?.position(BEAST_ENTITY_ID), body = mv?.get(BEAST_ENTITY_ID);
    if (!f || !pos || !body) return;
    s.phase = "alive";
    s.x = quantizeCm(pos[0]); s.y = quantizeCm(pos[1]); s.z = quantizeCm(pos[2]);
    s.facingYaw = quantizeYaw(body.state.facingYaw);
    s.hp100 = Math.max(0, Math.min(0xffff, f.hp100)); s.action = f.action; s.moveId = f.moveId;
    s.actionStartTick = f.actionStartTick; s.actionEndTick = Math.min(f.actionEndTick, 0xffffffff);
    void tick;
  }
}

function turnToward(cur: number, want: number, step: number): number {
  let d = (want - cur) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return Math.abs(d) <= step ? want : cur + Math.sign(d) * step;
}

/** The beast's whole body ring (footprintRadius) must be over ground at about the same height. */
function footprintSafe(w: World, x: number, z: number, here: number | null): boolean {
  const r = BEAST.footprintRadius;
  const ok = (px: number, pz: number): boolean => {
    const t = w.walkableTop(px, pz);
    return t !== null && (here === null || Math.abs(t - here) <= 0.5);
  };
  if (!ok(x, z)) return false;
  for (let k = 0; k < 8; k++) if (!ok(x + Math.cos((k * Math.PI) / 4) * r, z + Math.sin((k * Math.PI) / 4) * r)) return false;
  return true;
}
