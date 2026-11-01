import { expect, test } from "vitest";
import { GameScene } from "../../apps/client/src/scene/GameScene.js";
import { UrnViews, type LoopUrn } from "../../apps/client/src/scene/UrnViews.js";

// QV01: replicated urn lifecycle rendering. State comes only from published records.
const mk = () => new GameScene({ setSize() {}, render() {}, dispose() {} }, [],
  { innerWidth: 800, innerHeight: 600, addEventListener() {}, removeEventListener() {} });
const urn = (o: Partial<LoopUrn> = {}): LoopUrn => ({ id: 0, state: "anchored", holderId: 0, returnTick: 0, x: 900, y: 25, z: -1000, ...o });
// `three` resolves only from apps/client, so borrow an Object3D by cloning the scene root.
const group = (g: GameScene) => g.scene.clone(false);
const none = () => undefined;

test("anchored, reserved, held, returning and re-anchored states place and hide the vessel", () => {
  const game = mk();
  const base = game.scene.children.length;
  const v = new UrnViews(game.scene);
  v.sync([["0", urn()]], none);
  expect(v.snapshot()[0]).toMatchObject({ state: "anchored", visible: true, x: 9, y: 0.25, z: -10 });

  // Reserved publishes the holder's pose; the highlight must stay on the remembered anchor.
  v.sync([["0", urn({ state: "reserved", holderId: 5, x: 880, y: 90, z: -990 })]], none);
  expect(v.snapshot()[0]).toMatchObject({ state: "reserved", visible: true, x: 9, z: -10 });

  const holder = group(game);
  holder.position.set(2, 0, 3);
  v.sync([["0", urn({ state: "held", holderId: 5, x: 200, y: 90, z: 300 })]], (id) => (id === 5 ? holder : undefined));
  const held = v.snapshot()[0]!;
  expect(held.visible).toBe(true);
  expect(Math.hypot(held.x - 2, held.z - 3)).toBeGreaterThan(0.2);
  expect(Math.hypot(held.x - 2, held.z - 3)).toBeLessThan(1);
  expect(held.y).toBeGreaterThan(0.5);

  // The holder moves; update() follows without a new server record.
  holder.position.set(4, 0, 3);
  v.update(0.016);
  expect(v.snapshot()[0]!.x).toBeGreaterThan(3);

  v.sync([["0", urn({ state: "returning", returnTick: 700 })]], none);
  expect(v.snapshot()[0]!.visible).toBe(false);
  v.sync([["0", urn()]], none);
  expect(v.snapshot()[0]).toMatchObject({ state: "anchored", visible: true, x: 9, z: -10 });
  v.dispose();
  expect(game.scene.children).toHaveLength(base);
  game.dispose();
});

test("missing or invisible holder hides a held urn; removed records and disposal clean up", () => {
  const game = mk();
  const base = game.scene.children.length;
  const v = new UrnViews(game.scene);
  v.sync([["0", urn({ state: "held", holderId: 9 })]], none);
  expect(v.snapshot()[0]!.visible).toBe(false);
  const holder = group(game); holder.visible = false;
  v.sync([["0", urn({ state: "held", holderId: 9 })]], () => holder);
  expect(v.snapshot()[0]!.visible).toBe(false);
  v.sync([["0", urn({ state: "held", holderId: 9 })], ["1", urn({ id: 1, x: 100, z: 100 })]], () => holder);
  expect(game.scene.children.length).toBe(base + 2);
  v.sync([], none); // disconnect / room reset
  expect(game.scene.children).toHaveLength(base);
  v.sync([["0", urn()]], none);
  v.dispose(); v.dispose();
  v.sync([["0", urn()]], none);
  expect(v.snapshot()).toEqual([]);
  expect(game.scene.children).toHaveLength(base);
  game.dispose();
});
