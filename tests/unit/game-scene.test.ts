import { describe, expect, it } from "vitest";
import type { BufferGeometry, Material, Mesh } from "three";
import { buildIslandsMap } from "../../packages/shared/src/config/arena.js";
import { GameScene, type RendererLike, type WindowLike } from "../../apps/client/src/scene/GameScene.js";
import { KIT_COLORS } from "../../apps/client/src/scene/FighterView.js";
import { TICK_RATE } from "../../packages/shared/src/protocol.js";

function fakeWindow() {
  const l = new Map<string, Set<() => void>>();
  const win: WindowLike & { count(): number; fire(t: string): void } = {
    innerWidth: 800, innerHeight: 600,
    addEventListener: (t, f) => { (l.get(t) ?? l.set(t, new Set()).get(t)!).add(f); },
    removeEventListener: (t, f) => { l.get(t)?.delete(f); },
    count: () => [...l.values()].reduce((n, s) => n + s.size, 0),
    fire: (t) => l.get(t)?.forEach((f) => f()),
  };
  return win;
}
function fakeRenderer() {
  const r: RendererLike & { disposed: number; sizes: number } = {
    disposed: 0, sizes: 0, setSize() { r.sizes++; }, render() {}, dispose() { r.disposed++; },
  };
  return r;
}
const colliders = buildIslandsMap().colliders;

describe("T18a GameScene", () => {
  it("renders one mesh per island collider, named by collider id", () => {
    const gs = new GameScene(fakeRenderer(), colliders, fakeWindow());
    const names = new Set<string>();
    gs.scene.traverse((o) => { if ((o as Mesh).isMesh) names.add(o.name); });
    // T25: one mesh per collider id, plus merged decoration meshes named "deco.*" (sky, clouds, cover, islets).
    const ids = new Set(colliders.map((c) => c.id));
    expect([...names].filter((n) => ids.has(n)).length).toBe(colliders.length);
    for (const n of names) expect(ids.has(n) || n.startsWith("deco.") || n === "fx.pool" || n.startsWith("fx.glow.")).toBe(true); // FX1: pooled particle mesh; UX10: GlowLayer flash/ring/spark meshes
    gs.dispose();
  });

  it("create and dispose 10 times returns listeners and resources to baseline", () => {
    const win = fakeWindow();
    const baseline = win.count();
    for (let i = 0; i < 10; i++) {
      const r = fakeRenderer();
      const gs = new GameScene(r, colliders, win);
      gs.addFighter("a", "sv"); gs.addFighter("b", "td");
      expect(win.count()).toBe(baseline + 1);
      const geos: BufferGeometry[] = [];
      const mats: Material[] = [];
      let disposedGeo = 0, disposedMat = 0;
      gs.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        geos.push(m.geometry); mats.push(m.material as Material);
        m.geometry.addEventListener("dispose", () => disposedGeo++);
        (m.material as Material).addEventListener("dispose", () => disposedMat++);
      });
      gs.dispose();
      gs.dispose(); // idempotent
      expect(disposedGeo).toBe(geos.length);
      expect(disposedMat).toBe(mats.length);
      expect(gs.resourceCount).toBe(0);
      expect(gs.fighterCount).toBe(0);
      expect(gs.scene.children.length).toBe(0);
      expect(r.disposed).toBe(1);
      expect(win.count()).toBe(baseline);
    }
  });

  it("resize listener updates renderer size and camera aspect", () => {
    const win = fakeWindow(); const r = fakeRenderer();
    const gs = new GameScene(r, colliders, win);
    win.innerWidth = 1000; win.innerHeight = 500;
    win.fire("resize");
    expect(gs.camera.aspect).toBe(2);
    gs.dispose();
  });

  it("uses distinct original colours per kit", () => {
    expect(new Set(Object.values(KIT_COLORS)).size).toBe(3);
  });

  it("interpolates a remote fighter from SnapshotBuffer at 100 ms delay", () => {
    const gs = new GameScene(fakeRenderer(), colliders, fakeWindow());
    const view = gs.addFighter("r", "td");
    const buf = gs.bufferFor("r")!;
    buf.push({ tick: 0, x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0 });
    buf.push({ tick: 12, x: 12, y: 1, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0 });
    // 100 ms = 6 ticks; now = 12 -> sample at tick 6 -> x = 6
    gs.updateRemotes(12);
    expect(view.group.position.x).toBeCloseTo(6);
    expect(TICK_RATE).toBe(60);
    view.setAction("m1");
    expect(view.actionText).toBe("m1");
    gs.removeFighter("r");
    expect(gs.fighterCount).toBe(0);
    gs.dispose();
  });

  it("EffectsPool dispose runs every registered disposer once", () => {
    const gs = new GameScene(fakeRenderer(), colliders, fakeWindow());
    let n = 0;
    gs.effects.register(() => n++);
    gs.dispose();
    gs.dispose();
    expect(n).toBe(1);
    expect(gs.effects.size).toBe(0);
  });
});

it("UX05 contact shadow stays on ground and fades during a jump, including low tier", () => {
  const gs = new GameScene(fakeRenderer(), colliders, fakeWindow());
  gs.setQuality("low"); const v = gs.addFighter("jump", "sv"); v.setPose(0, .9, 0, 0); gs.render(0);
  const shadow = gs.scene.getObjectByName("contact.jump") as Mesh;
  expect(shadow.position.y).toBeCloseTo(.025);
  const groundOpacity = (shadow.material as Material).opacity;
  v.setPose(0, 3, 0, 0); gs.render(0);
  expect(shadow.position.y).toBeCloseTo(.025); expect((shadow.material as Material).opacity).toBeLessThan(groundOpacity);
  gs.removeFighter("jump"); expect(gs.scene.getObjectByName("contact.jump")).toBeUndefined(); gs.dispose();
});
