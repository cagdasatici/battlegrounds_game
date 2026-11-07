import { ARENA } from "@eb/shared/config/arena";
import { GROVE_MAP } from "@eb/shared/config/maps";
import { COMBAT } from "@eb/shared/config/combat";

/** ARENA01: grid half extents come from the map definition (walkable reach plus a 2 m margin), 1 m cells, both ends included. */
const NAV_MARGIN = 2;
const NAV_HALF_X = Math.ceil(GROVE_MAP.bounds.maxX) + NAV_MARGIN, NAV_HALF_Z = Math.ceil(GROVE_MAP.bounds.maxZ) + NAV_MARGIN;
/** GR13 fixed grid: 1 m cells over the map bounds. */
export const NAV = {
  minX: -NAV_HALF_X, minZ: -NAV_HALF_Z, cols: 2 * NAV_HALF_X + 1, rows: 2 * NAV_HALF_Z + 1,
  maxExpansions: 4096, snapRadius: 2, waypointRadius: 0.35,
  replanTicks: 30, retargetDistance: 2, progressTicks: 120, progressMin: 0.25,
} as const;

/** The only world queries the planner needs; `World` satisfies it. */
export interface NavProbe {
  capsuleOverlaps(centre: [number, number, number], radius: number, halfHeight: number): string[];
  walkableTop(x: number, z: number): number | null;
}
export type PlanStatus = "ok" | "none" | "budget";
export interface NavPlan { status: PlanStatus; nodes: number[]; expansions: number }

const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const CAP = COMBAT.capsule, STEP = COMBAT.controller.stepHeight;

/** Deterministic static ground-route graph. Built once per room; holds no Rapier handles. */
export class NavGrid {
  readonly size = NAV.cols * NAV.rows;
  private readonly top = new Float64Array(this.size).fill(NaN);
  private readonly edge = new Uint8Array(this.size * 8); // 0 unknown, 1 open, 2 blocked
  private constructor(private readonly probe: NavProbe) {}

  static build(probe: NavProbe): NavGrid {
    const g = new NavGrid(probe);
    for (let i = 0; i < g.size; i++) {
      const [x, z] = g.xz(i);
      const t = probe.walkableTop(x, z);
      if (t === null) continue;
      if (probe.capsuleOverlaps([x, t + ARENA.capsule.centreAboveSurface + 0.06, z], CAP.radius, CAP.halfHeight).length > 0) continue;
      let ok = true;
      for (let k = 0; k < 8 && ok; k++) {
        const s = probe.walkableTop(x + Math.cos(k * Math.PI / 4) * CAP.radius, z + Math.sin(k * Math.PI / 4) * CAP.radius);
        ok = s !== null && Math.abs(s - t) <= STEP + COMBAT.controller.snapDown;
      }
      if (ok) g.top[i] = t;
    }
    return g;
  }

  index(ix: number, iz: number): number { return iz * NAV.cols + ix; }
  xz(i: number): [number, number] { return [NAV.minX + (i % NAV.cols), NAV.minZ + Math.floor(i / NAV.cols)]; }
  valid(i: number): boolean { return i >= 0 && i < this.size && !Number.isNaN(this.top[i]!); }
  validCount(): number { let n = 0; for (let i = 0; i < this.size; i++) if (this.valid(i)) n++; return n; }

  /** Nearest valid cell centre within snapRadius, ties by node index; -1 when none. */
  snap(x: number, z: number): number {
    let best = -1, bd = Infinity;
    const cx = Math.round(x - NAV.minX), cz = Math.round(z - NAV.minZ);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const ix = cx + dx, iz = cz + dz;
      if (ix < 0 || iz < 0 || ix >= NAV.cols || iz >= NAV.rows) continue;
      const i = this.index(ix, iz);
      if (!this.valid(i)) continue;
      const [px, pz] = this.xz(i), d = Math.hypot(px - x, pz - z);
      if (d > NAV.snapRadius) continue;
      if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && i < best)) { bd = d; best = i; }
    }
    return best;
  }

  private open(i: number, dir: number): number {
    const [dx, dz] = DIRS[dir]!;
    const ix = i % NAV.cols + dx, iz = Math.floor(i / NAV.cols) + dz;
    if (ix < 0 || iz < 0 || ix >= NAV.cols || iz >= NAV.rows) return -1;
    const j = this.index(ix, iz);
    if (!this.valid(j)) return -1;
    const cached = this.edge[i * 8 + dir]!;
    if (cached) return cached === 1 ? j : -1;
    let ok = Math.abs(this.top[j]! - this.top[i]!) <= STEP;
    if (ok && dx !== 0 && dz !== 0) {
      ok = this.valid(this.index(i % NAV.cols + dx, Math.floor(i / NAV.cols))) && this.valid(this.index(i % NAV.cols, Math.floor(i / NAV.cols) + dz));
    }
    if (ok) {
      const [ax, az] = this.xz(i), [bx, bz] = this.xz(j);
      for (let k = 1; k < 4 && ok; k++) {
        const t = k / 4, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const y = this.top[i]! + (this.top[j]! - this.top[i]!) * t + ARENA.capsule.centreAboveSurface + 0.06;
        ok = this.probe.capsuleOverlaps([x, y, z], CAP.radius, CAP.halfHeight).length === 0;
      }
    }
    this.edge[i * 8 + dir] = ok ? 1 : 2;
    return ok ? j : -1;
  }

  /** A* with Euclidean heuristic; ties by node index; at most NAV.maxExpansions expansions. */
  plan(sx: number, sz: number, gx: number, gz: number, maxExpansions: number = NAV.maxExpansions): NavPlan {
    const s = this.snap(sx, sz), g = this.snap(gx, gz);
    if (s < 0 || g < 0) return { status: "none", nodes: [], expansions: 0 };
    const gxz = this.xz(g);
    const h = (i: number): number => { const [x, z] = this.xz(i); return Math.hypot(x - gxz[0], z - gxz[1]); };
    const gs = new Map<number, number>([[s, 0]]), from = new Map<number, number>(), closed = new Set<number>();
    const heap: Array<[number, number]> = []; // [f, index]
    const less = (a: [number, number], b: [number, number]): boolean => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (e: [number, number]): void => {
      heap.push(e);
      for (let c = heap.length - 1; c > 0;) { const p = (c - 1) >> 1; if (!less(heap[c]!, heap[p]!)) break; [heap[c], heap[p]] = [heap[p]!, heap[c]!]; c = p; }
    };
    const pop = (): [number, number] => {
      const top = heap[0]!, last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let c = 0;;) {
          const l = 2 * c + 1, r = l + 1; let m = c;
          if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
          if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
          if (m === c) break;
          [heap[c], heap[m]] = [heap[m]!, heap[c]!]; c = m;
        }
      }
      return top;
    };
    push([h(s), s]);
    let expansions = 0;
    while (heap.length) {
      const [, i] = pop();
      if (closed.has(i)) continue;
      if (i === g) {
        const nodes = [g];
        for (let n = g; from.has(n);) { n = from.get(n)!; nodes.push(n); }
        return { status: "ok", nodes: nodes.reverse(), expansions };
      }
      if (expansions >= maxExpansions) return { status: "budget", nodes: [], expansions };
      closed.add(i); expansions++;
      const [ix, iz] = this.xz(i);
      for (let d = 0; d < 8; d++) {
        const j = this.open(i, d);
        if (j < 0 || closed.has(j)) continue;
        const [jx, jz] = this.xz(j), ng = gs.get(i)! + Math.hypot(jx - ix, jz - iz);
        if (ng < (gs.get(j) ?? Infinity) - 1e-12) { gs.set(j, ng); from.set(j, i); push([ng + h(j), j]); }
      }
    }
    return { status: "none", nodes: [], expansions };
  }
}
