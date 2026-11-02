import { expect, test } from "vitest";
import { GameScene } from "../../apps/client/src/scene/GameScene.js";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { ACTIVE_FILL, AttackTelegraphs, FILL_OPACITY, WINDUP_EDGE, WINDUP_FILL, TELEGRAPHED_MOVES, TELEGRAPH_CAPACITY, UNTELEGRAPHED_MOVES, rayCoverLength, type TelegraphPlayer } from "../../apps/client/src/fx/AttackTelegraphs.js";

const P = (o: Partial<TelegraphPlayer> = {}): TelegraphPlayer => ({
  entityId: 1, lifeId: 1, x: 0, y: 90, z: 0, facingYaw: 0, action: "Windup", moveId: "sv.b1", actionStartTick: 100, actionEndTick: 124, ...o,
});
const O = (tick: number, extra: object = {}) => ({ tick, reducedMotion: false, lowQuality: false, ...extra });
const make = () => { const scene = new GameScene({ setSize() {}, render() {}, dispose() {} } as never, [], { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} } as never).scene; return { scene, t: new AttackTelegraphs(scene) }; };

test("windup warning appears from the replicated phase and progress follows ticks", () => {
  const { t } = make();
  t.sync([P()], O(100));
  expect(t.snapshot().entries[0]).toMatchObject({ phase: "Windup", progress: 0, kind: "box", length: 8, width: 2 });
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
    expect(fill.scale.z).toBe(8); // full extent, not growing with progress
    expect(fill.material.opacity).toBeCloseTo(FILL_OPACITY.flat);
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

test("QI01: the windup band is a dark saturated fill with a light edge, strongly opaque, readable on sand planks", () => {
  const lum = (h: number) => { const r = (h >> 16) & 255, g = (h >> 8) & 255, b = h & 255; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const SAND = 0xc9a56a;
  expect(lum(WINDUP_FILL)).toBeLessThan(lum(SAND) * 0.5); // dark against the planks
  expect(lum(WINDUP_EDGE)).toBeGreaterThan(lum(SAND)); // light edge contrasts with the fill
  expect(lum(ACTIVE_FILL)).toBeLessThan(lum(SAND) * 0.7);
  expect(FILL_OPACITY.windupMin).toBeGreaterThanOrEqual(0.4);
  expect(FILL_OPACITY.flat).toBeGreaterThanOrEqual(0.5);
  const { t, scene } = make();
  t.sync([P()], O(100));
  const g = scene.getObjectByName("fx.telegraphs")!.children.find((c) => c.visible)!;
  const fill = g.children[0] as unknown as { material: { opacity: number; color: { getHex(): number } } };
  expect(fill.material.opacity).toBeGreaterThanOrEqual(0.4);
  expect(fill.material.color.getHex()).toBe(WINDUP_FILL);
});

test.each(["sv.b3", "sv.b4", "td.b1", "td.b2", "td.b3", "td.a1", "td.a2", "sv.a4"])("UX07 %s: close move shows a retained footprint and interruption removes it", moveId => {
  const { t } = make(); t.sync([P({ moveId })], O(105, { lowQuality: true, reducedMotion: true }));
  expect(t.snapshot().entries[0]?.phase).toBe("Windup");
  t.sync([P({ moveId, action: "Stunned" })], O(106)); expect(t.activeCount).toBe(0); t.dispose();
});
test("UX07 Furnace Drop: no guessed endpoint during windup; active footprint follows actual projected position and disappears over void/death", () => {
  const { t, scene } = make(); const surface = () => 2;
  t.sync([P({ moveId: "ea.b4", y: 600 })], O(105, { surface })); expect(t.activeCount).toBe(0);
  const p = P({ moveId: "ea.b4", action: "Active", y: 600, x: 300 });
  t.sync([p], O(106, { surface }));
  expect(t.snapshot().entries[0]).toMatchObject({ kind: "ring", length: 8, width: 8 });
  const g = scene.getObjectByName("fx.telegraphs")!.children.find(c => c.visible)!;
  expect(g.position.x).toBe(3); expect(g.position.y).toBeCloseTo(2.06);
  t.sync([{ ...p, x: 500 }], O(107, { surface })); expect(g.position.x).toBe(5);
  t.sync([p], O(108, { surface: () => null })); expect(t.activeCount).toBe(0);
  t.sync([{ ...p, action: "Dead" }], O(109, { surface })); expect(t.activeCount).toBe(0); t.dispose();
});
