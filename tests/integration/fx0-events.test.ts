import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { matchMaker } from "colyseus";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25681); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("FX0 combat event fields over two real Colyseus clients", () => {
  test("a hit reaches both clients with the same eventId, hitClass, targetHp100 and moveId; a slotted cast emits cast with moveId", async () => {
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
    // Test fixture only: place A 6.5 m in front of B facing B; the dash itself is real client input.
    const mv = room.movement!;
    const bp = mv.position(bId)!;
    const body = mv.get(aId)!;
    const north = bp[2] > 0;
    const p = { x: bp[0], y: bp[1], z: bp[2] + (north ? -6.5 : 6.5) };
    body.rb.setTranslation(p, true);
    body.rb.setNextKinematicTranslation(p);
    body.state.facingYaw = north ? Math.PI : 0; body.state.vx = 0; body.state.vz = 0;
    await sleep(60);
    const epoch = a.welcome!.epoch;
    a.send("input", pkt(epoch, 1, { moveZ: north ? 1 : -1, edges: [{ id: 1, kind: "dash" }] }));
    const isHit = (e: CombatEvent) => e.kind === "hit" && e.actorId === String(aId);
    await waitFor(() => evA.some(isHit) && evB.some(isHit), 2000, "hit on both clients");
    const hA = evA.find(isHit)!, hB = evB.find(isHit)!;
    expect(hA.eventId).toBe(hB.eventId);
    expect(hA).toMatchObject({ moveId: "dash.forward", damage100: 400, hitClass: "light", targetHp100: 9600 });
    expect(hB).toEqual(hA);

    // A slotted ability commit emits "cast" with moveId on both clients.
    await waitFor(() => byName("Arel").action === "Idle", 2000, "A idle");
    a.send("input", pkt(epoch, 2, { edges: [{ id: 2, kind: "skillDown", slot: 1 }] }));
    const isCast = (e: CombatEvent) => e.kind === "cast" && e.actorId === String(aId) && !!e.moveId;
    await waitFor(() => evA.some(isCast) && evB.some(isCast), 2000, "cast on both clients");
    expect(evA.find(isCast)!.eventId).toBe(evB.find(isCast)!.eventId);
    expect(evA.find(isCast)!.moveId).toMatch(/^sv\./);
    await a.leave();
    await b.leave();
  });
});
