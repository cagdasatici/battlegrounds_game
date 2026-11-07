import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, waitFor, type Harness } from "../fixtures/harness.js";
import { setup, everywhere, hpOn, KEYS } from "../fixtures/t23Wire.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

describe("T23 urns over a real Colyseus connection (three clients)", () => {
  test("urn: pickup after 12 ticks, throw hits for 8 HP, urn returns to its anchor 600 ticks after the throw, all replicated to three clients", async () => {
    const x = await setup(h, "td");
    const y = x.room.movement!.position(x.aId)![1];
    // Urn 0 stands at (-16, 0.25, -16). A beside it facing -Z, B 4 m ahead, C far away.
    x.place(x.aId, -16, y, -15.4, 0);
    x.place(x.bId, -16, y, -19.4, Math.PI);
    x.place(x.cId, 30, y, 30, 0);
    await new Promise((r) => setTimeout(r, 80));
    let p = x.pressAttack();
    await waitFor(() => everywhere((k) => x.urnOn(k, 0)?.state).every((s) => s === "reserved"), 3000, "reserved on all clients");
    x.releaseAttack(p);
    await waitFor(() => everywhere((k) => x.urnOn(k, 0)?.state).every((s) => s === "held"), 3000, "held on all clients");
    expect(everywhere((k) => x.urnOn(k, 0)!.holderId)).toEqual([x.aId, x.aId, x.aId]);
    const pickedAt = x.room.sim.tick;
    await new Promise((r) => setTimeout(r, 400)); // let the pickup cast finish and the button stay released
    p = x.pressAttack();
    await waitFor(() => everywhere((k) => hpOn(x, k, "Nora")).every((v) => v === 10000 - 800), 4000, "8 HP on all clients");
    x.releaseAttack(p);
    for (const k of KEYS) {
      const hit = x.events[k].filter((e) => e.moveId === "td.throw" && e.kind === "hit");
      expect(hit.map((e) => [e.targetId, e.damage100]), `throw hit seen by ${k}`).toEqual([[String(x.bId), 800]]);
    }
    await waitFor(() => everywhere((k) => x.urnOn(k, 0)?.state).every((s) => s === "returning"), 2000, "returning on all clients");
    const ret = x.urnOn("B", 0)!.returnTick;
    expect(ret).toBeGreaterThan(pickedAt + 600); // thrown at least 12 ticks after pickup: return = throw + 600
    await waitFor(() => everywhere((k) => x.urnOn(k, 0)?.state).every((s) => s === "anchored"), 15000, "urn back on its anchor on all clients");
    expect(x.room.sim.tick).toBeGreaterThanOrEqual(ret);
    expect(x.room.sim.tick).toBeLessThan(ret + 30);
    expect(x.room.projectiles.size).toBe(0);
    expect(x.room.combat.invariantViolations()).toEqual([]);
    await x.stop();
  }, 60000);


  async function holdUrn(x: Awaited<ReturnType<typeof setup>>) {
    const y = x.room.movement!.position(x.aId)![1];
    x.place(x.aId, -16, y, -15.4, 0);
    x.place(x.bId, -16, y, -19.4, Math.PI);
    x.place(x.cId, 30, y, 30, 0);
    await new Promise((r) => setTimeout(r, 80));
    const p = x.pressAttack();
    await waitFor(() => everywhere((k) => x.urnOn(k, 0)?.state).every((s) => s === "held"), 3000, "held on all clients");
    x.releaseAttack(p);
  }

  test("disconnect: the holder leaving the room drops the urn back on its anchor on every remaining client", async () => {
    const x = await setup(h, "td");
    await holdUrn(x);
    await x.clients.a.leave();
    await waitFor(() => (["B", "C"] as const).every((k) => x.urnOn(k, 0)?.state === "anchored" && x.urnOn(k, 0)?.holderId === 0), 3000, "urn dropped");
    for (const cl of [x.clients.b, x.clients.c]) await cl.leave();
  }, 60000);

  test("dispose: room teardown clears every urn", async () => {
    const x = await setup(h, "td");
    await holdUrn(x);
    expect(x.room.urns.list().some((u) => u.state === "held")).toBe(true);
    x.room.onDispose();
    expect(x.room.urns.list().every((u) => u.state === "anchored" && u.holderId === 0)).toBe(true);
    await x.stop();
  }, 60000);
});
