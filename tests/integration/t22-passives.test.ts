import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { matchMaker } from "colyseus";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25683); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T22 heal events over two real Colyseus clients", () => {
  test("a lethal td.b1 finisher sends one heal event with targetHp100 to both clients, then the KO", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const evA: CombatEvent[] = [], evB: CombatEvent[] = [];
    ra.onMessage("combatEvent", (e: CombatEvent) => { evA.push(e); });
    rb.onMessage("combatEvent", (e: CombatEvent) => { evB.push(e); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "td", contentHash: a.localContentHash });
    b.send("ready", { kitId: "sv", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded
      && room.movement!.get(aId)!.state.grounded, 4000, "settled");
    // Test fixtures only: HP values and a 1.5 m start position. The cast itself is a real skillDown edge from client A.
    room.combat.get(bId)!.hp100 = 1500;
    room.combat.get(aId)!.hp100 = 5000;
    const mv = room.movement!;
    const bp = mv.position(bId)!;
    const body = mv.get(aId)!;
    const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
    body.rb.setTranslation(p, true);
    body.rb.setNextKinematicTranslation(p);
    body.state.facingYaw = 0; body.state.vx = 0; body.state.vz = 0;
    await sleep(60);
    a.send("input", pkt(a.welcome!.epoch, 1, { edges: [{ id: 1, kind: "skillDown", slot: 1 }] }));
    const isHeal = (e: CombatEvent) => e.kind === "heal" && e.targetId === String(aId);
    const isKo = (e: CombatEvent) => e.kind === "ko" && e.targetId === String(bId);
    await waitFor(() => evA.some(isHeal) && evB.some(isHeal) && evA.some(isKo) && evB.some(isKo), 6000, "heal and ko on both clients");
    const hA = evA.find(isHeal)!, hB = evB.find(isHeal)!;
    expect(hB).toEqual(hA);
    expect(hA).toMatchObject({ actorId: String(aId), targetId: String(aId), moveId: "td.b1", damage100: 3500, targetHp100: 8500 });
    expect(evA.filter(isHeal)).toHaveLength(1);
    expect(hA.lifeId).toBe(room.combat.get(aId)!.lifeId);
    // The heal belongs to the KO tick and arrives before the KO event.
    expect(evA.findIndex(isHeal)).toBeLessThan(evA.findIndex(isKo));
    await waitFor(() => byName("Arel").hp100 === 8500, 2000, "killer hp replicated");
    await a.leave();
    await b.leave();
  });
});
