import { describe, expect, test } from "vitest";
import { Scene } from "../../apps/client/node_modules/three/build/three.module.js";
import { EffectsPool, POOL_CAPACITY } from "../../apps/client/src/scene/EffectsPool.js";
import { CameraRig } from "../../apps/client/src/scene/CameraRig.js";
import { FighterView } from "../../apps/client/src/scene/FighterView.js";
import { makeToonRamp } from "../../apps/client/src/scene/FighterModel.js";
import { CombatBus, type CombatListener } from "../../apps/client/src/app/CombatBus.js";
import { HitFx } from "../../apps/client/src/fx/HitFx.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";

const p = (over = {}) => ({ x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, life: 0.25, size: 0.1, color: 0xffffff, ...over });

describe("FX1 EffectsPool", () => {
  test("capacity per quality tier", () => {
    expect(POOL_CAPACITY).toEqual({ low: 200, medium: 600, high: 1000 });
    for (const q of ["low", "medium", "high"] as const) { const e = new EffectsPool(); e.init(new Scene(), q); expect(e.capacity).toBe(POOL_CAPACITY[q]); e.dispose(); }
  });
  test("pool cap holds: overfilling never exceeds capacity and replaces the oldest", () => {
    const e = new EffectsPool(); e.init(new Scene(), "low");
    for (let i = 0; i < 200; i++) e.spawn(p({ life: 10 }));
    e.update(0.1);
    for (let i = 0; i < 50; i++) e.spawn(p({ life: 10 }));
    expect(e.activeCount).toBe(200);
    e.dispose();
  });
  test("particles expire after their life in render seconds", () => {
    const e = new EffectsPool(); e.init(new Scene(), "low");
    e.spawn(p({ life: 0.25 })); e.spawn(p({ life: 0.5 }));
    expect(e.activeCount).toBe(2);
    e.update(0.3);
    expect(e.activeCount).toBe(1);
    e.update(0.3);
    expect(e.activeCount).toBe(0);
    e.dispose();
  });
  test("dispose removes the mesh, runs registered disposers once and is idempotent", () => {
    const s = new Scene(); const e = new EffectsPool(); e.init(s, "low");
    let n = 0; e.register(() => n++);
    expect(s.getObjectByName("fx.particles")).toBeDefined();
    e.dispose(); e.dispose();
    expect(s.getObjectByName("fx.particles")).toBeUndefined();
    expect(n).toBe(1);
    expect(e.activeCount).toBe(0);
  });
});

describe("FX1 flash, freeze and shake", () => {
  const view = () => new FighterView("sv", makeToonRamp());
  const body = (v: FighterView) => (v.group.children.find((c) => c.name.endsWith(".body")) as unknown as { material: { emissiveIntensity: number; emissive: { getHex(): number } } });
  test("flash amount scales with flashLevel and expires", () => {
    const a = view(), b = view();
    a.flash(0xff3b3b, 90, 0.3); b.flash(0xff3b3b, 90, 0.9);
    expect(a.flashing).toBe(true);
    expect(body(a).material.emissiveIntensity).toBeCloseTo(0.3);
    expect(body(b).material.emissiveIntensity).toBeCloseTo(0.9);
    expect(body(a).material.emissive.getHex()).toBe(0xff3b3b);
    a.update(0.2);
    expect(a.flashing).toBe(false);
    expect(body(a).material.emissive.getHex()).toBe(0);
    a.flash(0xff3b3b, 90, 0);
    expect(a.flashing).toBe(false);
    a.dispose(); b.dispose();
  });
  test("freeze holds the animation for N frames then resumes", () => {
    const v = view();
    v.update(0.016);
    const t = (): number => (v as unknown as { mixer: { time: number } }).mixer.time;
    v.freeze(4);
    const t0 = t();
    for (let i = 0; i < 4; i++) v.update(0.016);
    expect(t()).toBe(t0);
    v.update(0.016);
    expect(t()).toBeGreaterThan(t0);
    v.dispose();
  });
  test("camera shake moves the camera, decays to zero and ignores bad input", () => {
    const rig = new CameraRig([]);
    const c = { x: 0, y: 0, z: 0 };
    const base = rig.update(c, 0, 0, 0.016).position;
    rig.shake(0, 100); rig.shake(0.3, -5);
    expect(rig.shaking).toBe(false);
    rig.shake(0.3, 100);
    const moved = rig.update(c, 0, 0, 0.016).position;
    expect(Math.hypot(moved.x - base.x, moved.y - base.y, moved.z - base.z)).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) rig.update(c, 0, 0, 0.016);
    expect(rig.shaking).toBe(false);
    expect(rig.update(c, 0, 0, 0.016).position).toEqual(base);
  });
});

function harness(reduced = false, flashLevel = 0.3) {
  let handler: CombatListener | null = null;
  const bus = new CombatBus((h) => { handler = h; return () => { handler = null; }; }, () => undefined);
  const calls: string[] = [];
  const mk = (id: string) => ({
    flash: (c: number, ms: number, l?: number) => calls.push(`${id}:flash:${c.toString(16)}:${ms}:${l}`),
    freeze: (f: number) => calls.push(`${id}:freeze:${f}`), flashing: false,
  });
  const views: Record<string, ReturnType<typeof mk>> = { "1": mk("1"), "2": mk("2") };
  const hooks = new Set<(dt: number) => void>();
  const players = new Map<string, unknown>([["1", { x: 0, y: 90, z: 0 }], ["2", { x: 200, y: 90, z: 0 }]]);
  const fx = HitFx.attach(bus, {
    scene: new Scene(), camera: null as never, players: () => players,
    settings: { get: () => ({ quality: "low", reducedMotion: reduced, flashLevel }) } as never,
    localId: () => "1", viewFor: (id) => views[id],
    shake: (a, ms) => calls.push(`shake:${a.toFixed(4)}:${ms}`),
    onFrame: (fn) => { hooks.add(fn); return () => hooks.delete(fn); },
  });
  const send = (e: Partial<CombatEvent>) => handler?.({ eventId: String(Math.random()), tick: 1, kind: "hit", actorId: "1", targetId: "2", lifeId: 1, ...e });
  return { send, calls, active: () => HitFx.current?.pool.activeCount ?? 0, frame: (dt: number) => { for (const h of hooks) h(dt); }, fx, hooks };
}

describe("FX1 HitFx event table", () => {
  test("light hit: 10 sparks, red flash on the victim, no freeze or shake", () => {
    const h = harness();
    h.send({ hitClass: "light" });
    expect(h.active()).toBe(10);
    expect(h.calls).toEqual(["2:flash:ff3b3b:90:0.3"]);
    h.frame(0.3);
    expect(h.active()).toBe(0);
    h.fx();
  });
  test("heavy hit: 24 sparks plus a ring, 140 ms flash, freeze 4 both, shake for the local player", () => {
    const h = harness();
    h.send({ hitClass: "heavy" });
    expect(h.active()).toBeGreaterThan(24);
    expect(h.calls).toContain("2:flash:ff3b3b:140:0.3");
    expect(h.calls).toContain("1:freeze:4"); expect(h.calls).toContain("2:freeze:4");
    expect(h.calls).toContain("shake:0.0875:180");
    h.fx();
  });
  test("heavy hit between two remote players does not shake", () => {
    const h = harness();
    h.send({ hitClass: "heavy", actorId: "3", targetId: "4" });
    expect(h.calls.some((c) => c.startsWith("shake"))).toBe(false);
    h.fx();
  });
  test("Reduced Motion produces zero shake", () => {
    const h = harness(true);
    h.send({ hitClass: "heavy" }); h.send({ kind: "block" });
    expect(h.calls.some((c) => c.startsWith("shake"))).toBe(false);
    h.fx();
  });
  test("block: arc, no flash, small shake for the local player only", () => {
    const h = harness();
    h.send({ kind: "block", actorId: "2", targetId: "1" });
    expect(h.active()).toBeGreaterThan(0);
    expect(h.calls).toEqual(["shake:0.0250:80"]);
    h.fx();
  });
  test("counter: gold flash on the countered attacker, freeze 6 on both", () => {
    const h = harness();
    h.send({ kind: "counter", actorId: "2", targetId: "1" });
    expect(h.calls).toContain("2:flash:ffcc33:160:0.3");
    expect(h.calls).toContain("1:freeze:6"); expect(h.calls).toContain("2:freeze:6");
    expect(h.active()).toBeGreaterThan(0);
    h.fx();
  });
  test("heal: 12 green motes, green flash 200 ms", () => {
    const h = harness();
    h.send({ kind: "heal", actorId: "2", targetId: undefined });
    expect(h.active()).toBe(12);
    expect(h.calls).toEqual(["2:flash:4dff88:200:0.3"]);
    h.fx();
  });
  test("ko: dust and column, no flash", () => {
    const h = harness();
    h.send({ kind: "ko" });
    expect(h.active()).toBeGreaterThan(0);
    expect(h.calls).toEqual([]);
    h.fx();
  });
  test("cast draws nothing; dispose unhooks the frame callback", () => {
    const h = harness();
    h.send({ kind: "cast" });
    expect(h.active()).toBe(0);
    expect(h.hooks.size).toBe(1);
    h.fx();
    expect(h.hooks.size).toBe(0);
  });
});
