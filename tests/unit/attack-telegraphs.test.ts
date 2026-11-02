import { expect, test } from "vitest";
import { GameScene } from "../../apps/client/src/scene/GameScene.js";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { AttackTelegraphs, TELEGRAPHED_MOVES, TELEGRAPH_CAPACITY, UNTELEGRAPHED_MOVES, rayCoverLength, type TelegraphPlayer } from "../../apps/client/src/fx/AttackTelegraphs.js";

const P = (o: Partial<TelegraphPlayer> = {}): TelegraphPlayer => ({
  entityId: 1, lifeId: 1, x: 0, y: 90, z: 0, facingYaw: 0, action: "Windup", moveId: "sv.b1", actionStartTick: 100, actionEndTick: 124, ...o,
});
const O = (tick: number, extra: object = {}) => ({ tick, reducedMotion: false, lowQuality: false, ...extra });
const make = () => { const scene = new GameScene({ setSize() {}, render() {}, dispose() {} } as never, [], { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} } as never).scene; return { scene, t: new AttackTelegraphs(scene) }; };

test("windup warning appears from the replicated phase and progress follows ticks", () => {
  const { t } = make();
  t.sync([P()], O(100));
  expect(t.snapshot().entries[0]).toMatchObject({ phase: "Windup", progress: 0, kind: "box", length: 3, width: 2 });
  t.sync([P()], O(112));
  expect(t.snapshot().entries[0]!.progress).toBeCloseTo(0.5);
});

test("nothing is drawn before a confirmed cast or for an unwarned move", () => {
  const { t } = make();
  t.sync([P({ action: "Idle", moveId: "" }), P({ entityId: 2, moveId: "ea.b2" }), P({ entityId: 3, action: "Recovery" })], O(110));
  expect(t.snapshot().active).toBe(0);
  for (const id of Object.keys(UNTELEGRAPHED_MOVES)) expect(TELEGRAPHED_MOVES).not.toContain(id);
});

test("windup transfers to the active phase in the same slot and keeps the committed origin", () => {
  const { t, scene } = make();
  t.sync([P({ x: 500 })], O(110));
  const root = scene.getObjectByName("fx.telegraphs")!;
  const g = root.children.find((c) => c.visible)!;
  t.sync([P({ x: 900, action: "Active", actionStartTick: 124, actionEndTick: 128 })], O(125));
  expect(t.snapshot().entries).toHaveLength(1);
  expect(t.snapshot().entries[0]).toMatchObject({ phase: "Active", key: "1:1:sv.b1:124" });
  expect(g.position.x).toBeCloseTo(5);
});

test("a skipped windup gets no retroactive warning; the active phase is still shown", () => {
  const { t } = make();
  t.sync([P({ action: "Active", actionStartTick: 124, actionEndTick: 128 })], O(125));
  expect(t.snapshot().entries.map((e) => e.phase)).toEqual(["Active"]);
});

test.each([
  ["interruption", { action: "Stunned" }], ["death", { action: "Dead" }], ["a new move", { moveId: "ea.b2" }],
])("%s removes the warning", (_n, patch) => {
  const { t } = make();
  t.sync([P()], O(105));
  t.sync([P(patch)], O(106));
  expect(t.snapshot().active).toBe(0);
});

test("expiry, leave and a new life remove or replace the warning", () => {
  const { t } = make();
  t.sync([P()], O(105));
  t.sync([P()], O(124));
  expect(t.snapshot().active).toBe(0);
  t.sync([P()], O(105));
  t.sync([], O(106));
  expect(t.snapshot().active).toBe(0);
  t.sync([P()], O(105));
  t.sync([P({ lifeId: 2 })], O(106));
  expect(t.snapshot().entries.map((e) => e.key)).toEqual(["1:2:sv.b1:100"]);
});

test("saturation keeps the warnings already shown and counts the refused one", () => {
  const { t } = make();
  const many = Array.from({ length: TELEGRAPH_CAPACITY + 1 }, (_, i) => P({ entityId: i + 1 }));
  t.sync(many, O(105));
  expect(t.snapshot().active).toBe(TELEGRAPH_CAPACITY);
  expect(t.snapshot().dropped).toBeGreaterThan(0);
  t.sync(many.slice(1), O(106)); // actor 1 leaves; a slot frees for the next frame
  t.sync(many, O(107));
  expect(t.snapshot().active).toBe(TELEGRAPH_CAPACITY);
});

test("beam warning is clipped at cover and aims along the facing", () => {
  const { t } = make();
  const beam = P({ moveId: "ea.a3", actionStartTick: 100, actionEndTick: 130 });
  t.sync([beam], O(110, { cover: () => 7.5 }));
  expect(t.snapshot().entries[0]).toMatchObject({ kind: "beam", length: 7.5, width: 2 });
  const map = buildIslandsMap();
  const open = rayCoverLength([], 0, 1, 0, 0, -1, 24);
  expect(open).toBe(24);
  const box = map.colliders.find((c) => c.shape === "cuboid")!;
  const [cx, cy, cz] = box.centre;
  const hz = box.shape === "cuboid" ? box.halfExtents[2] : 0;
  const hit = rayCoverLength([box], cx, cy, cz + hz + 5, 0, -1, 24);
  expect(hit).toBeCloseTo(5, 3);
});

test("low quality and Reduced Motion keep the outline and drop the animated fill", () => {
  const { t, scene } = make();
  for (const flags of [{ lowQuality: true }, { reducedMotion: true }]) {
    t.sync([P()], { ...O(105), ...flags });
    const g = scene.getObjectByName("fx.telegraphs")!.children.find((c) => c.visible)!;
    const [fill, line] = g.children as unknown as [{ scale: { z: number }; material: { opacity: number } }, { visible: boolean }];
    expect(line.visible).toBe(true);
    expect(fill.scale.z).toBe(3); // full extent, not growing with progress
    expect(fill.material.opacity).toBeCloseTo(0.18);
    t.sync([], O(106));
  }
});

test("dispose removes the group and further syncs are inert", () => {
  const { t, scene } = make();
  t.sync([P()], O(105));
  t.dispose();
  expect(scene.getObjectByName("fx.telegraphs")).toBeUndefined();
  t.sync([P()], O(106));
  expect(t.activeCount).toBe(0);
});
