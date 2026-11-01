import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { PointerRouter } from "../../apps/client/src/input/PointerRouter.js";
import { IntentSampler } from "../../apps/client/src/input/IntentSampler.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25690); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = computeLayout({ x0: 0, y0: 0, W: 1024, H: 768 });

describe("FX0 combat event fields over two real clients", () => {
  test("both clients receive the same hit eventId with hitClass, targetHp100 and moveId; casts carry moveId", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const evA: CombatEvent[] = [], evB: CombatEvent[] = [];
    ra.onMessage("combatEvent", (e: CombatEvent) => { evA.push(e); });
    rb.onMessage("combatEvent", (e: CombatEvent) => { evB.push(e); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded, 4000, "settled");
    // Fixture only: stand A 1.5 m in front of B through the server's body API. Everything after is real traffic.
    const mv = room.movement!;
    const bp = mv.position(bId)!, ab = mv.get(aId)!;
    const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
    ab.rb.setTranslation(p, true); ab.rb.setNextKinematicTranslation(p);
    ab.state.facingYaw = 0; ab.state.vx = 0; ab.state.vz = 0;
    await sleep(60);

    const router = new PointerRouter(L);
    const sampler = new IntentSampler(router, a.welcome!.epoch);
    let tick = 0;
    const atk = L.controls.attack;
    router.down({ pointerId: 7, x: atk.cx, y: atk.cy });
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) { a.send("input", sampler.sample(++tick)!); await sleep(33); }
    router.up(7);
    await sleep(300);

    const hitsA = evA.filter((e) => e.kind === "hit");
    expect(hitsA.length).toBeGreaterThanOrEqual(2);
    for (const hit of hitsA) {
      const same = evB.find((e) => e.eventId === hit.eventId);
      expect(same).toEqual(hit);
      expect(hit.hitClass).toBe(hit.moveId === "m1.4.finisher" ? "heavy" : "light");
      expect(hit.moveId).toMatch(/^m1\./);
      expect(hit.targetHp100).toBe(room.combat.get(bId)!.hp100 + hitsA.filter((x) => x.tick > hit.tick || (x.tick === hit.tick && x.eventId > hit.eventId)).reduce((s, x) => s + (x.damage100 ?? 0), 0));
    }
    // Every committed M1 emits a cast with a moveId, on both clients.
    const casts = evA.filter((e) => e.kind === "cast");
    expect(casts.length).toBeGreaterThanOrEqual(2);
    for (const c of casts) { expect(c.moveId).toBeTruthy(); expect(evB.some((e) => e.eventId === c.eventId)).toBe(true); }
    // Only hits carry the new presentation fields.
    for (const e of evA.filter((x) => x.kind !== "hit")) expect(e.hitClass).toBeUndefined();
    expect(new Set(evA.map((e) => e.eventId)).size).toBe(evA.length);
    await a.leave();
    await b.leave();
  }, 20000);
});
