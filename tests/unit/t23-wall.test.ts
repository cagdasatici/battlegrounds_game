import { afterEach, describe, expect, test } from "vitest";
import { ALL_ABILITY_DEFS } from "../../packages/shared/src/config/kits/index.js";
import { makeContextRig, type ContextRig } from "../fixtures/contextRig.js";
import { by, toFourth, wallTotal } from "../fixtures/contextHelpers.js";

/** T23 generic wall attack (spec 13, 16): sv.wall, td.wall, ea.wall. */
let rig: ContextRig;
afterEach(() => rig?.dispose());

describe("wall definitions", () => {
  test("sv.wall, td.wall and ea.wall are generated from one template; none takes a slot; no Artificer kit move is added", () => {
    const get = (id: string) => ALL_ABILITY_DEFS.find((d) => d.id === id)!;
    for (const k of ["sv", "td", "ea"]) {
      const d = get(`${k}.wall`);
      expect(d, k).toBeDefined();
      expect(d.input).toBe("context");
      expect(d.slot).toBeNull();
      expect(d.damage100).toEqual([300, 300, 600]);
      expect(d.hitOffsets).toEqual([0, 12, 30]);
      expect(d.cooldown).toBe(360);
    }
    // The shared template adds no Artificer kit move: apart from it, ea.* is exactly T20's base set.
    expect(ALL_ABILITY_DEFS.filter((d) => d.id.startsWith("ea.") && !/^ea\.(wall|pickup|throw)$/.test(d.id)).map((d) => d.id)).toEqual(["ea.b1", "ea.b2", "ea.b3", "ea.b4", "ea.a1", "ea.a2", "ea.a3", "ea.a4"]);
  });
});

describe("generic wall attack (td.wall)", () => {
  test("fourth M1 beside a wall: capture 3, then 3 at +12 and 6 at +30, release at +36 into a 60 tick ragdoll", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("td.wall");
    rig.run(t + 1, t + 20);
    const cap = by(rig, "td.wall", "captured");
    expect(cap.length).toBe(1);
    const c = cap[0]!.tick;
    rig.run(t + 21, c + 35);
    expect(rig.cs.get(2)!.action).toBe("Captured");
    rig.step(c + 36);
    expect(cap[0]!.r.damage100).toBe(300);
    expect(by(rig, "td.wall", "hit").map((x) => [x.tick - c, x.r.damage100])).toEqual([[12, 300], [30, 600]]);
    expect(wallTotal(rig, "td.wall")).toBe(1200);
    const v = rig.cs.get(2)!;
    expect(v.action).toBe("Ragdolled");
    expect(v.actionStartTick).toBe(c + 36);
    expect(rig.cs.captures.size).toBe(0);
  });
  test("cooldown is exactly 360 ticks: refused at commit + 359, accepted at commit + 360, for every kit", async () => {
    for (const kit of ["sv", "td", "ea"] as const) {
      const r = await makeContextRig({ kit });
      const f = r.cs.get(1)!;
      const def = r.runner.registry.byId(`${kit}.wall`)!;
      expect(r.runner.startContext(f, 100, def).kind, kit).toBe("started");
      expect(f.cooldowns.get(def.id)).toBe(460);
      for (const [tick, want] of [[459, "rejected"], [460, "started"]] as const) {
        r.runner.cancel(1);
        f.action = "Idle"; f.cast = null;
        const o = r.runner.startContext(f, tick, def);
        expect(o.kind, `${kit} @${tick}`).toBe(want);
        if (o.kind === "rejected") expect(o.reason).toBe("COOLDOWN");
      }
      r.dispose();
    }
  });
  test("not near a wall (3 m away) the fourth M1 is the ordinary finisher", async () => {
    rig = await makeContextRig();
    toFourth(rig);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.finisher");
    expect(rig.resultsOf("td.wall").length).toBe(0);
  });
  test("the attacker must be within 2 m of the victim", async () => {
    rig = await makeContextRig();
    rig.atWall();
    rig.place(1, -10, 3.5); // 2.7 m away
    const t = rig.holdUntil(10, (id) => id.startsWith("m1.1"));
    expect(t).toBeGreaterThan(0);
    rig.place(1, -10, 3.5);
    expect(rig.contexts.wallTargetOf(rig.cs.get(1)!, t + 1)).toBeNull();
  });
  test("P0 flag off: the wall branch is disabled", async () => {
    rig = await makeContextRig({ enabled: false });
    rig.atWall();
    toFourth(rig);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.finisher");
  });
  test("cooldown 360: a second fourth hit inside the cooldown falls back to the normal finisher", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 100);
    rig.cs.get(2)!.hp100 = 10000;
    const t2 = rig.holdUntil(t + 101, (id) => id.startsWith("m1.4") || id.endsWith(".wall"), {}, 300);
    expect(t2).toBeGreaterThan(0);
    expect(rig.casts[rig.casts.length - 1]!.moveId).toBe("m1.4.finisher");
    expect(t2 - t).toBeLessThan(360);
  });
  test("miss: nothing in reach captures nothing, the cooldown is still spent, no orphan capture", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const f1 = rig.cs.get(1)!;
    // Force the fourth request with the victim stepping away after the wall check.
    const t = toFourth(rig);
    rig.place(2, -10, -9); // gone before the probe window
    rig.run(t + 1, t + 60);
    expect(by(rig, "td.wall", "captured").length).toBe(0);
    expect(f1.cooldowns.get("td.wall")).toBe(t + 360);
    expect(rig.cs.captures.size).toBe(0);
  });
  test("block: a guarding victim blocks the capture hit and nothing is captured", async () => {
    rig = await makeContextRig();
    rig.atWall();
    rig.guard.add(2);
    const t = toFourth(rig);
    rig.run(t + 1, t + 80);
    expect(by(rig, "td.wall", "captured").length).toBe(0);
    expect(by(rig, "td.wall", "blocked").length).toBeGreaterThan(0);
    expect(wallTotal(rig, "td.wall")).toBe(0);
  });
  test("counter: a victim in a td.b4 counter stance counters the capture hit", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.cs.get(2)!.kitId = "td";
    rig.cs.get(2)!.action = "Idle";
    rig.runner.skillDown(rig.cs.get(2)!, t + 1, 4, 1);
    rig.run(t + 2, t + 80);
    expect(by(rig, "td.wall", "captured").length + by(rig, "td.wall", "hit").length).toBe(0);
  });
  test("duplicate hit: each scheduled hit lands once; the victim loses exactly 12 HP to the wall attack", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 200);
    expect(rig.resultsOf("td.wall").filter((x) => x.r.outcome === "duplicate").length).toBe(0);
    expect(wallTotal(rig, "td.wall")).toBe(1200);
  });
  test("interruption: a third party hit on the caster during startup cancels it, no capture, no orphan", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 3);
    rig.poke(3, 1);
    rig.run(t + 4, t + 100);
    expect(by(rig, "td.wall", "captured").length).toBe(0);
    expect(rig.cs.captures.size).toBe(0);
  });
  test("caster armor during the capture: a third party hit does not interrupt the sequence", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 25);
    const c = by(rig, "td.wall", "captured")[0]!.tick;
    rig.poke(3, 1);
    rig.run(t + 26, t + 120);
    expect(by(rig, "td.wall", "hit").map((x) => x.tick - c)).toEqual([12, 30]);
  });
  test("victim death mid sequence releases the capture and frees the caster", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 20);
    rig.cs.kill(2, t + 21);
    rig.run(t + 21, t + 120);
    expect(rig.cs.captures.size).toBe(0);
    expect(rig.cs.get(1)!.action).toBe("Idle");
  });
  test("caster death mid sequence releases the victim", async () => {
    rig = await makeContextRig();
    rig.atWall();
    const t = toFourth(rig);
    rig.run(t + 1, t + 20);
    rig.cs.kill(1, t + 21);
    rig.run(t + 21, t + 60);
    expect(rig.cs.captures.size).toBe(0);
    expect(rig.cs.get(2)!.action).not.toBe("Captured");
  });
  test("works for every kit (ea included) without any ea definition", async () => {
    for (const kit of ["sv", "td", "ea"] as const) {
      const r = await makeContextRig({ kit });
      r.atWall();
      toFourth(r);
      expect(r.casts[r.casts.length - 1]!.moveId, kit).toBe(`${kit}.wall`);
      r.dispose();
    }
  });
});
