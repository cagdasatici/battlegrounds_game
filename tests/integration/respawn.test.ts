import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25693); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});

describe("T17 respawn and FFA over real Colyseus connections", () => {
  test("a real M1 knockout scores, the 3 s countdown respawns the victim with the queued kit, and a ring-out credits the last attacker", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const events: CombatEvent[] = [];
    rb.onMessage("combatEvent", (e: CombatEvent) => { events.push(e); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const byName = (n: string) => [...players(rb).values()].find((p) => p.displayName === n);
    await waitFor(() => byName("Arel")?.ready && byName("Nora")?.ready && byName("Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = byName("Arel").entityId as number, bId = byName("Nora").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2
      && room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(bId)!.state.grounded, 4000, "settled");

    // Fixture only: A stands 1.5 m in front of B and B has 1 HP left. The knockout itself is real input -> server.
    const mv = room.movement!;
    const bp = mv.position(bId)!;
    const body = mv.get(aId)!;
    const p = { x: bp[0], y: bp[1], z: bp[2] + 1.5 };
    body.rb.setTranslation(p, true); body.rb.setNextKinematicTranslation(p);
    body.state.facingYaw = 0; body.state.vx = 0; body.state.vz = 0;
    room.combat.get(bId)!.hp100 = 100;
    await sleep(60);
    const epoch = a.welcome!.epoch;
    let seq = 0;
    const koSeen = () => events.some((e) => e.kind === "ko");
    const t0 = Date.now();
    while (!koSeen() && Date.now() - t0 < 3000) { a.send("input", pkt(epoch, ++seq, { attackHeld: true })); await sleep(33); }
    a.send("input", pkt(epoch, ++seq));
    expect(koSeen()).toBe(true);
    const ko = events.find((e) => e.kind === "ko")!;
    expect(ko).toMatchObject({ actorId: String(aId), targetId: String(bId) });
    await waitFor(() => byName("Arel").kills === 1 && byName("Nora").deaths === 1, 1500, "scoreboard replicated");
    expect(byName("Nora").action).toBe("Dead");
    expect(byName("Nora").hp100).toBe(0);
    expect(byName("Arel").assists).toBe(0);

    // B asks for the Stone Vanguard kit while dead; it takes effect at respawn, not before.
    b.send("changeKit", { kitId: "sv" });
    await sleep(100);
    expect(byName("Nora").kitId).toBe("td");

    // Countdown: 180 ticks after the KO tick, never earlier.
    await waitFor(() => events.some((e) => e.kind === "respawn" && e.actorId === String(bId)), 6000, "respawn event");
    const rs = events.find((e) => e.kind === "respawn")!;
    expect(rs.tick - ko.tick).toBe(180);
    await waitFor(() => byName("Nora").action === "Idle" && byName("Nora").hp100 === 10000, 1500, "respawned");
    expect(byName("Nora").kitId).toBe("sv");
    expect(byName("Nora").lifeId).toBe(rs.lifeId);
    expect(byName("Nora").lifeId).not.toBe(ko.lifeId);
    expect(byName("Nora").protectedUntilTick).toBe(rs.tick + 120);
    expect(byName("Nora").deaths).toBe(1);

    // Ring-out: A damaged B recently? Make it so (server fixture records a real hit), then knock B off the island.
    await waitFor(() => room.sim.tick > room.combat.get(bId)!.protectedUntilTick + 2, 4000, "B unprotected");
    const bp2 = mv.position(bId)!;
    const body2 = mv.get(aId)!;
    const p2 = { x: bp2[0], y: bp2[1], z: bp2[2] + 1.5 };
    body2.rb.setTranslation(p2, true); body2.rb.setNextKinematicTranslation(p2);
    body2.state.facingYaw = 0; body2.state.vx = 0; body2.state.vz = 0;
    await sleep(60);
    const kos = events.filter((e) => e.kind === "ko").length;
    const hits = events.filter((e) => e.kind === "hit" && e.actorId === String(aId)).length;
    const t1 = Date.now();
    while (events.filter((e) => e.kind === "hit" && e.actorId === String(aId)).length === hits && Date.now() - t1 < 3000) {
      a.send("input", pkt(epoch, ++seq, { attackHeld: true })); await sleep(33);
    }
    a.send("input", pkt(epoch, ++seq));
    // Knockback off the island is simulated by the server fixture placing B below the void plane.
    const b2 = mv.get(bId)!;
    const off = { x: 0, y: -30, z: 0 };
    b2.rb.setTranslation(off, true); b2.rb.setNextKinematicTranslation(off);
    await waitFor(() => events.filter((e) => e.kind === "ko").length === kos + 1, 3000, "void KO");
    const ring = events.filter((e) => e.kind === "ko").at(-1)!;
    expect(ring).toMatchObject({ actorId: String(aId), targetId: String(bId) });
    await waitFor(() => byName("Arel").kills === 2 && byName("Nora").deaths === 2, 1500, "scores");
    await a.leave();
    await b.leave();
  });
});
