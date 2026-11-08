import { TICK_RATE } from "@eb/shared/protocol";
import { COMBAT } from "@eb/shared/config/combat";
import { isAlive } from "./ActionMachine.js";
import type { AbilityHost } from "./AbilityRunner.js";
import type { HitCandidate, HitResult } from "./HitResolver.js";
import type { ReflectRequest } from "./AbilityRunner.js";
import type { ReflectableProjectile, ReflectableProjectiles, ReflectOutcome } from "./Reflect.js";
import type { Reaction } from "./ActionMachine.js";

/**
 * Authoritative projectile simulation (T19, spec 13, 15, 21). Pure server module: no timers, no DOM, no Three.js.
 *
 * - Advanced exactly once per logical tick by collect(), in the pipeline query phase, after cast handlers.
 * - Each tick sweeps a sphere from the previous to the next centre against static geometry (World.sweepSphere, a
 *   continuous cast, so thin cover cannot be tunnelled) and against every living fighter capsule except the owner.
 *   The earliest contact wins. Contact (wall or fighter) detonates the splash: every fighter within splashRadius
 *   with line of sight, direct target first then distance and entity id, capped at splashMax, receives exactly one
 *   candidate (direct and splash never stack).
 * - Detached (spec 15): a fired projectile keeps its owner life attribution when the owner dies, leaves or is
 *   interrupted. HitResolver does not tie projectile candidates to the owner's action generation.
 * - Reflection (spec 13): one reflection per projectile. The owner becomes the reflector, the heading turns toward
 *   the ORIGINAL owner's current position, damage is preserved and the projectile is never moved. A second
 *   attempt absorbs it. Counter stances reach reflect() from afterResolve; settle() then keeps a reflected
 *   projectile alive instead of consuming it.
 * - Max MAX_PROJECTILES live per room; spawn() returns null beyond that (spec 1845).
 * - Every projectile is removed on impact, expiry, absorb, clear() or room dispose.
 */
export const MAX_PROJECTILES = 32;
const CAP_R = COMBAT.capsule.radius;
const CAP_HALF = COMBAT.capsule.halfHeight;
/** Substeps used to bracket the first overlap on a tick; refined by bisection. */
const BRACKET_STEPS = 12;

export interface ProjectileSpawn {
  ownerId: number;
  /** GR02: occupant generation of ownerId at fire time; stays fixed when the owner leaves. */
  ownerOccupant: number;
  ownerLifeId: number;
  /** Owner cast counter at fire time; the cast id is `${ownerId}.${castCounter}`. */
  castCounter: number;
  moveId: string;
  x: number; y: number; z: number;
  /** Heading; normalised on spawn. */
  dirX: number; dirY: number; dirZ: number;
  speed: number;
  lifeTicks: number;
  maxRange: number;
  radius: number;
  splashRadius: number;
  splashMax: number;
  reflectable: boolean;
  arcAmplitude: number;
  arcSpan: number;
  chargeClass: "partial" | "full";
  damage100: number;
  chip100: number;
  block: "B" | "U";
  reaction: Reaction;
  launch?: { forward: number; up: number };
}

export interface Projectile extends ReflectableProjectile {
  castId: string;
  castCounter: number;
  ownerLifeId: number;
  moveId: string;
  spawnTick: number;
  vx: number; vy: number; vz: number;
  remainingTicks: number;
  reflectionCount: number;
  chargeClass: "partial" | "full";
  damage100: number;
  chip100: number;
  block: "B" | "U";
  reaction: Reaction;
  launch?: { forward: number; up: number };
  canReflect: boolean;
}

interface Internal extends Projectile {
  baseX: number; baseY: number; baseZ: number;
  dirX: number; dirY: number; dirZ: number;
  speed: number;
  maxRange: number;
  travelled: number;
  splashRadius: number;
  splashMax: number;
  arcAmplitude: number;
  arcSpan: number;
  lastStepTick: number;
  pendingImpact: boolean;
  reflectedTick: number;
  dead: boolean;
}

const clampN = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Distance from a point to a fighter capsule's vertical core segment. */
function distToCapsule(px: number, py: number, pz: number, cx: number, cy: number, cz: number): number {
  const dy = Math.max(0, (cy - py) - CAP_HALF);
  return Math.hypot(Math.hypot(px - cx, pz - cz), dy);
}

export class ProjectileSystem implements ReflectableProjectiles {
  private readonly live = new Map<number, Internal>();
  private nextId = 1;

  constructor(private readonly host: AbilityHost) {}

  get size(): number { return this.live.size; }

  /** Spawns a projectile at the given centre. Returns its id, or null when the room cap is reached. */
  spawn(s: ProjectileSpawn, tick: number): number | null {
    if (this.live.size >= MAX_PROJECTILES) return null;
    const len = Math.hypot(s.dirX, s.dirY, s.dirZ);
    if (!(len > 1e-9) || !Number.isFinite(len + s.x + s.y + s.z + s.speed)) return null;
    const dx = s.dirX / len, dy = s.dirY / len, dz = s.dirZ / len;
    const id = this.nextId++;
    const p: Internal = {
      id, ownerId: s.ownerId, ownerOccupant: s.ownerOccupant, x: s.x, y: s.y, z: s.z, radius: s.radius, reflectCount: 0,
      castId: `${s.ownerId}.${s.castCounter}`, castCounter: s.castCounter, ownerLifeId: s.ownerLifeId, moveId: s.moveId,
      spawnTick: tick, vx: dx * s.speed, vy: dy * s.speed, vz: dz * s.speed, remainingTicks: s.lifeTicks,
      reflectionCount: 0, chargeClass: s.chargeClass, damage100: s.damage100, chip100: s.chip100, block: s.block,
      reaction: s.reaction, ...(s.launch ? { launch: s.launch } : {}), canReflect: s.reflectable,
      baseX: s.x, baseY: s.y, baseZ: s.z, dirX: dx, dirY: dy, dirZ: dz, speed: s.speed, maxRange: s.maxRange, travelled: 0,
      splashRadius: s.splashRadius, splashMax: s.splashMax, arcAmplitude: s.arcAmplitude, arcSpan: s.arcSpan,
      lastStepTick: tick - 1, pendingImpact: false, reflectedTick: -1, dead: false,
    };
    this.live.set(id, p);
    return id;
  }

  /** Live projectiles in id order (read only view for replication and tests). */
  list(): readonly Projectile[] {
    return [...this.live.values()].sort((a, b) => a.id - b.id);
  }

  get(id: number): Projectile | undefined { return this.live.get(id); }

  private occupantOf(id: number): number { return this.host.occupantOf?.(id) ?? 0; }

  /** True when `id` is currently held by the very occupant that owns the projectile (GR02). */
  private isOwner(p: { ownerId: number; ownerOccupant: number }, id: number): boolean {
    return id === p.ownerId && this.occupantOf(id) === p.ownerOccupant;
  }

  // ---- reflection (spec 13) ----
  reflectable(): readonly ReflectableProjectile[] {
    return this.list().filter((p) => p.canReflect && !(p as Internal).dead);
  }

  reflect(projectileId: number, newOwnerId: number, newCastCounter: number, tick: number): ReflectOutcome {
    const p = this.live.get(projectileId);
    if (!p || p.dead || !p.canReflect || this.isOwner(p, newOwnerId)) return "rejected";
    if (p.reflectionCount >= 1) { this.live.delete(p.id); p.dead = true; return "absorbed"; }
    // GR02: aim at the original owner only while that very occupant still holds the id.
    const target = this.isOwner(p, p.ownerId) ? this.host.pose(p.ownerId) : undefined;
    let dx = -p.dirX, dy = -p.dirY, dz = -p.dirZ; // owner gone: send it back the way it came
    if (target) {
      const tx = target.x - p.x, ty = target.y - p.y, tz = target.z - p.z;
      const l = Math.hypot(tx, ty, tz);
      if (l > 1e-6) { dx = tx / l; dy = ty / l; dz = tz / l; }
    }
    p.ownerId = newOwnerId;
    p.ownerOccupant = this.occupantOf(newOwnerId);
    p.ownerLifeId = this.host.combat.get(newOwnerId)?.lifeId ?? 0;
    p.castCounter = newCastCounter;
    p.castId = `${newOwnerId}.${newCastCounter}`;
    p.reflectionCount = 1;
    p.reflectCount = 1;
    p.arcAmplitude = 0; // the lateral arc belongs to the original shot only
    p.baseX = p.x; p.baseY = p.y; p.baseZ = p.z;
    p.dirX = dx; p.dirY = dy; p.dirZ = dz;
    p.vx = dx * p.speed; p.vy = dy * p.speed; p.vz = dz * p.speed;
    p.reflectedTick = tick;
    return "reflected";
  }

  /** Shared reflection rule for counter stances (td.b4): the reflector's current cast counter becomes the new cast id. */
  reflectWith(req: ReflectRequest): boolean {
    const counter = this.host.combat.get(req.reflectorId)?.castCounter ?? 0;
    return this.reflect(req.projectileId, req.reflectorId, counter, req.tick) === "reflected";
  }

  // ---- simulation ----
  /** Advances every projectile one tick and returns hit candidates for contacts. Call once per tick. */
  collect(tick: number): HitCandidate[] {
    const out: HitCandidate[] = [];
    for (const p of this.list() as Internal[]) {
      if (p.dead || p.lastStepTick === tick) continue;
      p.lastStepTick = tick;
      const step = Math.min(p.speed / TICK_RATE, Math.max(0, p.maxRange - p.travelled));
      const nb = { x: p.baseX + p.dirX * step, y: p.baseY + p.dirY * step, z: p.baseZ + p.dirZ * step };
      const s = p.travelled + step;
      const [nx, ny, nz] = this.withArc(p, nb, s);
      const from: [number, number, number] = [p.x, p.y, p.z];
      const to: [number, number, number] = [nx, ny, nz];
      const tWall = this.host.sweepSphere?.(from, to, p.radius) ?? null;
      const direct = this.firstFighterContact(p, from, to, tWall ?? 1);
      const contactT = direct ? direct.t : tWall;
      p.remainingTicks -= 1;
      if (contactT === null) {
        p.vx = (nx - p.x) * TICK_RATE; p.vy = (ny - p.y) * TICK_RATE; p.vz = (nz - p.z) * TICK_RATE;
        p.x = nx; p.y = ny; p.z = nz;
        p.baseX = nb.x; p.baseY = nb.y; p.baseZ = nb.z;
        p.travelled = s;
        if (p.remainingTicks <= 0 || p.travelled >= p.maxRange - 1e-9) { this.live.delete(p.id); p.dead = true; } // expiry: no damage
        continue;
      }
      // Contact: the projectile rests at the impact point and detonates.
      p.x = from[0] + (to[0] - from[0]) * contactT;
      p.y = from[1] + (to[1] - from[1]) * contactT;
      p.z = from[2] + (to[2] - from[2]) * contactT;
      const cands = this.detonation(p, direct?.id ?? null, contactT);
      if (cands.length === 0) { this.live.delete(p.id); p.dead = true; continue; }
      p.pendingImpact = true;
      for (const c of cands) out.push(c);
    }
    return out;
  }

  /**
   * After serial resolution (and after afterResolve handlers had the chance to reflect): contacts are consumed,
   * except a projectile reflected on this very tick, which flies on with its new owner.
   */
  settle(tick: number, _results: readonly HitResult[]): void {
    for (const p of [...this.live.values()] as Internal[]) {
      if (!p.pendingImpact) continue;
      p.pendingImpact = false;
      if (p.reflectedTick === tick) continue;
      this.live.delete(p.id);
      p.dead = true;
    }
  }

  clear(): void { this.live.clear(); }

  private withArc(p: Internal, base: { x: number; y: number; z: number }, s: number): [number, number, number] {
    if (p.arcAmplitude <= 0 || p.arcSpan <= 0 || s >= p.arcSpan) return [base.x, base.y, base.z];
    const off = p.arcAmplitude * Math.sin((Math.PI * s) / p.arcSpan);
    // Right-hand horizontal vector of the heading.
    const hl = Math.hypot(p.dirX, p.dirZ);
    if (hl < 1e-9) return [base.x, base.y, base.z];
    const rx = -p.dirZ / hl, rz = p.dirX / hl;
    return [base.x + rx * off, base.y, base.z + rz * off];
  }

  /** Earliest overlap fraction (0..1) of the moving sphere with any hostile living fighter, or null. */
  private firstFighterContact(p: Internal, a: readonly number[], b: readonly number[], limit: number): { id: number; t: number } | null {
    let best: { id: number; t: number } | null = null;
    for (const f of this.host.combat.all()) {
      if (this.isOwner(p, f.entityId) || !isAlive(f)) continue;
      const tp = this.host.pose(f.entityId);
      if (!tp) continue;
      const reach = p.radius + CAP_R;
      const at = (t: number): number =>
        distToCapsule(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t, tp.x, tp.y, tp.z);
      let prev = 0;
      let hit: number | null = at(0) <= reach ? 0 : null;
      for (let i = 1; hit === null && i <= BRACKET_STEPS; i++) {
        const t = (i / BRACKET_STEPS) * limit;
        if (at(t) <= reach) {
          let lo = prev, hi = t;
          for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (at(m) <= reach) hi = m; else lo = m; }
          hit = hi;
        }
        prev = t;
      }
      if (hit === null) continue;
      if (!best || hit < best.t || (hit === best.t && f.entityId < best.id)) best = { id: f.entityId, t: hit };
    }
    return best;
  }

  private detonation(p: Internal, directId: number | null, toi: number): HitCandidate[] {
    const found: { id: number; dist: number; direct: boolean }[] = [];
    for (const f of this.host.combat.all()) {
      if (this.isOwner(p, f.entityId) || !isAlive(f)) continue;
      const tp = this.host.pose(f.entityId);
      if (!tp) continue;
      const isDirect = f.entityId === directId;
      const dist = distToCapsule(p.x, p.y, p.z, tp.x, tp.y, tp.z);
      if (!isDirect && dist > p.splashRadius) continue;
      if (!isDirect && this.host.blocked([p.x, p.y, p.z], [tp.x, tp.y, tp.z])) continue; // cover shields splash
      found.push({ id: f.entityId, dist, direct: isDirect });
    }
    found.sort((a, b) => Number(b.direct) - Number(a.direct) || a.dist - b.dist || a.id - b.id);
    const out: HitCandidate[] = [];
    for (const f of found.slice(0, p.splashMax)) {
      out.push({
        attackerId: p.ownerId, attackerGeneration: 0,
        // Negative: the hit ledger key is the projectile itself, so one projectile can never hit a target twice and
        // never collides with the owner's melee casts.
        castCounter: -p.id, hitIndex: 0, toi, targetId: f.id, moveId: p.moveId, originX: p.x, originZ: p.z,
        block: p.block, counterable: true, armorBreak: false, damage100: p.damage100, reaction: p.reaction,
        maxHitsPerTarget: 1, ...(p.launch ? { launch: p.launch } : {}),
        projectile: { id: p.id, reflectable: p.canReflect, ownerLifeId: p.ownerLifeId, ownerOccupant: p.ownerOccupant },
        ...(p.chip100 > 0 && p.block === "B" ? { chip100: p.chip100 } : {}),
      });
    }
    return out;
  }
}

