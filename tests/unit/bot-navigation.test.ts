import { beforeAll, expect, test } from "vitest";
import { World } from "../../apps/server/src/sim/World.js";
import { NAV, NavGrid } from "../../apps/server/src/sim/BotNavigation.js";
import { COMBAT } from "../../packages/shared/src/config/combat.js";

let world: World, grid: NavGrid;
beforeAll(async () => { world = await World.create(); grid = NavGrid.build(world); });

const clearAt = (x: number, z: number) =>
  world.capsuleOverlaps([x, 0.96, z], COMBAT.capsule.radius, COMBAT.capsule.halfHeight).length === 0;
/** Every node valid on real ground and every 0.25 m of every segment clear of obstacles. */
function expectSafe(nodes: number[]) {
  for (const n of nodes) { expect(grid.valid(n)).toBe(true); const [x, z] = grid.xz(n); expect(world.walkableTop(x, z)).not.toBeNull(); }
  for (let i = 1; i < nodes.length; i++) {
    const [ax, az] = grid.xz(nodes[i - 1]!), [bx, bz] = grid.xz(nodes[i]!);
    for (let t = 0; t <= 1; t += 0.25) {
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      expect(clearAt(x, z), `segment point ${x},${z}`).toBe(true);
      expect(world.walkableTop(x, z), `ground at ${x},${z}`).not.toBeNull();
    }
  }
}
const length = (nodes: number[]) => nodes.slice(1).reduce((s, n, i) => {
  const [ax, az] = grid.xz(nodes[i]!), [bx, bz] = grid.xz(n); return s + Math.hypot(bx - ax, bz - az);
}, 0);

test("grid covers 113 x 101 candidates and rejects void, rails and obstacle cells", () => {
  expect(grid.size).toBe(11413);
  expect(grid.validCount()).toBeGreaterThan(2000);
  const at = (x: number, z: number) => grid.valid(grid.index(x - NAV.minX, z - NAV.minZ));
  for (const [x, z] of [[-12, -10], [12, 10], [-10, 0], [10, 0], [54, 0], [-54, 0], [50, 30]] as const) expect(at(x, z), `${x},${z}`).toBe(false);
  for (const [x, z] of [[0, 0], [0, -26], [-27, 0], [53, 0], [-48, 5]] as const) expect(at(x, z), `${x},${z}`).toBe(true);
});

const blocked: Array<[string, [number, number], [number, number], number]> = [
  ["pillar.0", [-12, -13], [-12, -7], 6], ["pillar.1", [12, -13], [12, -7], 6],
  ["pillar.2", [-12, 7], [-12, 13], 6], ["pillar.3", [12, 7], [12, 13], 6],
  ["wall.0", [-10, -3], [-10, 3], 6], ["wall.1", [10, -3], [10, 3], 6],
];
for (const [name, a, b, straight] of blocked) {
  test(`routes around ${name} without clipping it`, () => {
    const plan = grid.plan(a[0], a[1], b[0], b[1]);
    expect(plan.status).toBe("ok");
    expectSafe(plan.nodes);
    expect(length(plan.nodes)).toBeGreaterThan(straight);
    expect(length(plan.nodes)).toBeLessThan(straight + 6);
    expect(plan.expansions).toBeLessThanOrEqual(NAV.maxExpansions);
  });
}

for (const [name, sx, sz] of [["west", -36, 0], ["east", 36, 0], ["north", 0, -32], ["south", 0, 32]] as const) {
  test(`satellite ${name} reaches the centre and back without crossing void`, () => {
    const there = grid.plan(sx, sz, 0, 0), back = grid.plan(0, 0, sx, sz);
    for (const p of [there, back]) { expect(p.status).toBe("ok"); expectSafe(p.nodes); expect(p.expansions).toBeLessThanOrEqual(NAV.maxExpansions); }
    expect(there.nodes.length).toBeGreaterThan(20);
  });
}

test("satellite to opposite satellite is routable inside the expansion cap", () => {
  const p = grid.plan(-36, 0, 36, 0);
  expect(p.status).toBe("ok"); expectSafe(p.nodes); expect(p.expansions).toBeLessThanOrEqual(NAV.maxExpansions);
});

test("output is deterministic across repeated calls and a rebuilt grid", () => {
  const a = grid.plan(-36, 0, 12, 13), b = grid.plan(-36, 0, 12, 13), c = NavGrid.build(world).plan(-36, 0, 12, 13);
  expect(b).toEqual(a); expect(c).toEqual(a);
});

test("expansion cap is enforced and reported as budget", () => {
  const p = grid.plan(-36, 0, 36, 0, 10);
  expect(p.status).toBe("budget"); expect(p.nodes).toEqual([]); expect(p.expansions).toBe(10);
});

test("goal over the void with no cell within 2 m yields no route", () => {
  expect(grid.plan(0, 0, 10, -35).status).toBe("none");
  expect(grid.snap(10, -35)).toBe(-1);
  const snapped = grid.snap(0.4, 0.4);
  expect(grid.xz(snapped)).toEqual([0, 0]);
});
