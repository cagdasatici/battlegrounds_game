import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, waitFor, type Harness } from "../fixtures/harness.js";
import { setup, everywhere, hpOn, KEYS } from "../fixtures/t23Wire.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

describe("T23 sv.x2 Gale Rebuff over a real Colyseus connection (three clients)", () => {
  test("awakened Vanguard: the wall fourth hit is sv.x2 Gale Rebuff (40 HP at +48, release +49) and contextSpent replicates to every client", async () => {
    const x = await setup(h, "sv");
    const y = x.room.movement!.position(x.aId)![1];
    x.place(x.bId, -10, y, 0.8, Math.PI);
    x.place(x.aId, -10, y, 2.0, 0);
    x.place(x.cId, 30, y, 30, 0);
    const f = x.room.combat.get(x.aId)!; f.form = "Awakened"; f.awakenedUsedMask = 0; f.contextSpent = false;
    await new Promise((r) => setTimeout(r, 80));
    const p = x.pressAttack();
    await waitFor(() => x.events.A.some((e) => e.moveId === "sv.x2" && e.kind === "release"), 8000, "gale release event");
    x.releaseAttack(p);
    for (const k of KEYS) {
      const ev = x.events[k].filter((e) => e.moveId === "sv.x2" && e.actorId === String(x.aId));
      const cap = ev.find((e) => e.kind === "capture")!;
      expect(cap, `capture seen by ${k}`).toBeTruthy();
      expect(ev.filter((e) => e.kind === "hit").map((e) => [e.tick - cap.tick, e.damage100]), `hits seen by ${k}`).toEqual([[48, 4000]]);
      expect(ev.find((e) => e.kind === "release")!.tick - cap.tick).toBe(49);
    }
    await waitFor(() => everywhere((k) => x.by(x.rooms[k], "Arel").contextSpent).every((v) => v === true), 3000, "contextSpent on all clients");
    expect(everywhere((k) => x.by(x.rooms[k], "Arel").form)).toEqual(["Awakened", "Awakened", "Awakened"]);
    expect(everywhere((k) => x.by(x.rooms[k], "Arel").awakenedUsedMask)).toEqual([0, 0, 0]);
    expect(x.events.A.filter((e) => e.moveId === "sv.wall").length).toBe(0);
    await waitFor(() => x.room.combat.get(x.aId)!.action === "Idle", 4000, "caster recovered");
    expect(x.room.combat.captures.size).toBe(0);
    await x.stop();
  }, 60000);
});
