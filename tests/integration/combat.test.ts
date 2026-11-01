import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import { matchMaker } from "colyseus";
import type { ActionResult, CombatEvent } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25677); });
afterAll(async () => { await h.stop(); });

const pkt = (epoch: number, seq: number, o: Record<string, unknown> = {}) => ({
  v: 1, epoch, seq, sampleTick: 0, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
  attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges: [], ...o,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("T09 combat states over a real Colyseus connection", () => {
  test("dash edge: accepted once, repeat rejected, server moves the fighter; guard hold replicates; leave cleans up", async () => {
    const code = freshCode();
    const a = await loginClient(h, "Arel");
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    const results: ActionResult[] = [];
    ra.onMessage("actionResult", (m: ActionResult) => { results.push(m); });
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    b.send("ready", { kitId: "td", contentHash: b.localContentHash });
    const meFromB = () => [...players(rb).values()].find((p) => p.displayName === "Arel");
    await waitFor(() => meFromB()?.ready === true && meFromB()!.action === "Idle" && Math.abs(meFromB()!.y - 92) <= 3, 3000, "settled");
    const epoch = a.welcome!.epoch;
    const z0 = meFromB()!.z, x0 = meFromB()!.x;
    const dirZ = z0 > 0 ? -1 : 1; // toward the arena centre
    let seq = 0;
    // Two dash edges in consecutive packets (arrive within a tick or two of each other).
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 1, kind: "dash" }] }));
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 2, kind: "dash" }] }));
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 2, kind: "dash" }] })); // duplicate id: ignored
    await waitFor(() => results.length >= 2, 2000, "two action results");
    await waitFor(() => String(meFromB()!.moveId).startsWith("dash."), 1000, "B sees dash");
    expect(meFromB()!.action).toBe("Dash");
    expect(results[0]).toMatchObject({ edgeId: 1, accepted: true, epoch });
    expect(results[1]).toMatchObject({ edgeId: 2, accepted: false });
    expect(["STATE", "COOLDOWN"]).toContain(results[1]!.reason);
    await waitFor(() => meFromB()!.action === "Idle", 1500, "dash ends");
    await sleep(200);
    expect(results.length).toBe(2);
    const moved = Math.abs(meFromB()!.z - z0) / 100;
    // Forward 22 m/s x 18 ticks = 6.6 m or back 18 m/s x 18 = 5.4 m, plus coasting deceleration.
    expect(moved).toBeGreaterThan(4.5);
    expect(moved).toBeLessThan(12);
    expect(Math.abs(meFromB()!.x - x0)).toBeLessThan(30);

    // A third dash right after: same direction bucket is cooling down.
    a.send("input", pkt(epoch, ++seq, { moveZ: dirZ, edges: [{ id: 3, kind: "dash" }] }));
    await waitFor(() => results.length === 3, 2000, "third result");
    expect(results[2]).toMatchObject({ edgeId: 3, accepted: false, reason: "COOLDOWN" });

    // Guard hold: replicated as Guard while held, then recovery and Idle on release.
    const t0 = Date.now();
    while (Date.now() - t0 < 300) { a.send("input", pkt(epoch, ++seq, { blockHeld: true })); await sleep(33); }
    expect(meFromB()!.action).toBe("Guard");
    a.send("input", pkt(epoch, ++seq, { blockHeld: false }));
    await waitFor(() => meFromB()!.action === "Idle", 1000, "guard released");

    // Departure removes the fighter (captures, if any, are released by CombatSystem.remove).
    await a.leave();
    await waitFor(() => players(rb).size === 1, 2000, "A removed");
    await b.leave();
  });
});

describe("R06 forward dash hits over a real Colyseus connection", () => {
  test("a forward dash toward a standing target hits once for 4 HP on the server", async () => {
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
    // Test fixture only: place A 6.5 m in front of B (the dash covers about 5.5 m by its first hit tick), facing B. The dash itself is real client input.
    const mv = room.movement!;
    const bp = mv.position(bId)!;
    const body = mv.get(aId)!;
    // T17: spawns follow the farthest-anchor rule, so B may sit on a satellite island; approach from the arena centre side.
    const north = bp[2] > 0; // B on the +Z side: A stands toward the centre (-Z) and faces +Z
    const p = { x: bp[0], y: bp[1], z: bp[2] + (north ? -6.5 : 6.5) };
    body.rb.setTranslation(p, true);
    body.rb.setNextKinematicTranslation(p);
    body.state.facingYaw = north ? Math.PI : 0; body.state.vx = 0; body.state.vz = 0;
    await sleep(60);
    const epoch = a.welcome!.epoch;
    a.send("input", pkt(epoch, 1, { moveZ: north ? 1 : -1, edges: [{ id: 1, kind: "dash" }] }));
    await waitFor(() => events.some((e) => e.kind === "hit" && e.actorId === String(aId)), 2000, "dash hit");
    await sleep(300);
    const hits = events.filter((e) => e.kind === "hit" && e.actorId === String(aId));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ moveId: "dash.forward", damage100: 400 });
    await waitFor(() => byName("Nora").hp100 === 9600, 1000, "hp replicated");
    await a.leave();
    await b.leave();
  });
});
