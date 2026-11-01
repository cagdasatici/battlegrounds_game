import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { matchMaker } from "colyseus";
import { Client } from "@colyseus/sdk";
import { startHarness, loginClient, waitFor, players, freshCode, type Harness } from "../fixtures/harness.js";
import type { ActionResult } from "../../packages/shared/src/protocol.js";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25690); });
afterAll(async () => { await h.stop(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pkt(epoch: number, seq: number, edges: unknown[] = []): unknown {
  return {
    v: 1, epoch, seq, sampleTick: seq + 1000, moveX: 0, moveZ: 0, yaw: 0, pitch: 0,
    attackHeld: false, blockHeld: false, jumpHeld: false, runHeld: false, chargeHeldSlot: 0, edges,
  };
}

describe("R08 owner-only replicated state over real clients", () => {
  test("A receives its own ackSeq growing; B never receives A's owner record; cooldownEndTicks[2] = accept tick + 600", async () => {
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
    const view = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
    await waitFor(() => view(rb, "Arel")?.ready && view(rb, "Nora")?.ready && view(rb, "Arel").action === "Idle", 3000, "ready");
    const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
    const aId = view(rb, "Arel").entityId as number;
    await waitFor(() => room.sim.tick > room.combat.get(aId)!.protectedUntilTick + 2 && room.movement!.get(aId)!.state.grounded, 4000, "settled");

    const epoch = a.welcome!.epoch;
    let seq = 0;
    for (let i = 0; i < 5; i++) { a.send("input", pkt(epoch, ++seq)); await sleep(30); }
    await waitFor(() => (view(ra, "Arel")?.owner?.ackSeq ?? 0) === seq, 2000, "ackSeq reaches last seq");
    const first = view(ra, "Arel").owner.ackSeq as number;
    expect(view(ra, "Arel").owner.ackInputTick).toBe(seq + 1000);
    expect(view(ra, "Arel").owner.epoch).toBe(epoch);
    for (let i = 0; i < 3; i++) { a.send("input", pkt(epoch, ++seq)); await sleep(30); }
    await waitFor(() => view(ra, "Arel").owner.ackSeq === seq, 2000, "ackSeq grows");
    expect(seq).toBeGreaterThan(first);

    // B must not see A's owner record, and not B's own either through A's client.
    await sleep(150);
    expect(view(rb, "Arel").owner).toBeUndefined();
    expect(view(ra, "Nora").owner).toBeUndefined();
    expect(view(rb, "Nora").owner).toBeDefined();

    // sv.b3 (slot 3, cooldown 600): cooldownEndTicks[2] = accept tick + 600, visible on every client.
    a.send("input", pkt(epoch, ++seq, [{ id: 1, kind: "skillDown", slot: 3 }]));
    await waitFor(() => results.some((r) => r.accepted && r.castId !== undefined), 2000, "b3 accepted");
    const acc = results.find((r) => r.accepted && r.castId !== undefined)!;
    await waitFor(() => view(rb, "Arel").cooldownEndTicks[2] === acc.tick + 600, 2000, "cooldown replicated");
    expect(view(ra, "Arel").cooldownEndTicks[2]).toBe(acc.tick + 600);
    expect(view(rb, "Arel").cooldownEndTicks[0]).toBe(0);
    await a.leave(); await b.leave();
  });

  test("owner record survives a reconnect and B still never sees it", async () => {
    const code = freshCode();
    const store = new Map<string, string>();
    const a = await loginClient(h, "Arel", store);
    const b = await loginClient(h, "Nora");
    const ra = await a.join(code);
    const rb = await b.join(code);
    await waitFor(() => a.welcome !== null && players(ra).size === 2 && players(rb).size === 2, 3000, "joined");
    a.send("ready", { kitId: "sv", contentHash: a.localContentHash });
    const view = (r: typeof ra, n: string) => [...players(r).values()].find((p) => p.displayName === n);
    await waitFor(() => view(rb, "Arel")?.ready, 3000, "ready");
    a.send("input", pkt(a.welcome!.epoch, 1));
    await waitFor(() => view(ra, "Arel")?.owner?.ackSeq === 1, 2000, "ack before drop");
    // Drop the socket without a clean leave, then reconnect with the stored token.
    const token = ra.reconnectionToken;
    ra.reconnection.enabled = false;
    ra.connection.close(4010, "network lost");
    await waitFor(() => view(rb, "Arel")?.connected === false, 3000, "drop seen");
    const ra2 = await new Client(`ws://localhost:${h.port}`).reconnect(token);
    let epoch2 = 0;
    ra2.onMessage("welcome", (w: { epoch: number }) => { epoch2 = w.epoch; });
    await waitFor(() => epoch2 === 2, 3000, "new epoch welcome");
    ra2.send("input", pkt(2, 1));
    await sleep(300);
    await waitFor(() => view(ra2, "Arel")?.owner?.ackSeq === 1 && view(ra2, "Arel").owner.epoch === 2, 3000, "owner record after reconnect");
    expect(view(rb, "Arel").owner).toBeUndefined();
    await b.leave(); await ra2.leave();
  });
});
