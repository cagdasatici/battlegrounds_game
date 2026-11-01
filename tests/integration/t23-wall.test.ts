import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, waitFor, type Harness } from "../fixtures/harness.js";
import { setup, everywhere, hpOn, KEYS } from "../fixtures/t23Wire.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

describe("T23 wall attack over a real Colyseus connection (three clients)", () => {
  test("wall attack: fourth M1 beside a wall captures (3), hits 3 at +12 and 6 at +30, releases at +36, seen identically by three clients", async () => {
    const x = await setup(h, "td");
    const y = x.room.movement!.position(x.aId)![1];
    // Waist wall centred (-10, 0.6, 0), faces at z = +-0.3. B 0.5 m off the south face, A 1.2 m behind B facing -Z.
    x.place(x.bId, -10, y, 0.8, Math.PI);
    x.place(x.aId, -10, y, 2.0, 0);
    x.place(x.cId, 30, y, 30, 0);
    await new Promise((r) => setTimeout(r, 80));
    const p = x.pressAttack();
    await waitFor(() => x.events.A.some((e) => e.moveId === "td.wall" && e.kind === "release"), 8000, "wall release event");
    x.releaseAttack(p);
    for (const k of KEYS) {
      const ev = x.events[k].filter((e) => e.moveId === "td.wall" && e.actorId === String(x.aId));
      const cap = ev.find((e) => e.kind === "capture")!;
      expect(cap, `capture seen by ${k}`).toBeTruthy();
      expect(cap.damage100).toBe(300);
      expect(ev.filter((e) => e.kind === "hit").map((e) => [e.tick - cap.tick, e.damage100]), `hits seen by ${k}`).toEqual([[12, 300], [30, 600]]);
      expect(ev.find((e) => e.kind === "release")!.tick - cap.tick, `release seen by ${k}`).toBe(36);
    }
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 4000, "caster recovered");
    const dealt = x.events.A.filter((e) => e.targetId === String(x.bId) && (e.kind === "hit" || e.kind === "capture")).reduce((s, e) => s + (e.damage100 ?? 0), 0);
    await waitFor(() => everywhere((k) => hpOn(x, k, "Nora")).every((v) => v === 10000 - dealt), 3000, "victim hp on all clients");
    expect(x.room.combat.captures.size).toBe(0);
    expect(x.room.combat.invariantViolations()).toEqual([]);
    await x.stop();
  }, 60000);

});
