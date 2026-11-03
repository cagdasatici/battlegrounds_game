import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { matchMaker } from "colyseus";
import { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { startHarness, loginClient, waitFor, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.stop(); });

test("tick fault closes both real clients with 4500 while another room advances", async () => {
  const a = await loginClient(h, "A"), b = await loginClient(h, "B"), c = await loginClient(h, "C");
  const ra = await a.join("r0"), rb = await b.join("r0"), rc = await c.join("r1");
  const room = matchMaker.getLocalRoomById(ra.roomId) as unknown as ArenaRoom;
  const healthy = matchMaker.getLocalRoomById(rc.roomId) as unknown as ArenaRoom;
  const codes: number[] = [];
  ra.onLeave((code) => codes.push(code)); rb.onLeave((code) => codes.push(code));
  const pipeline = (room as unknown as { pipeline: { step(t: number): void } }).pipeline;
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    vi.spyOn(pipeline, "step").mockImplementation(() => { throw new TypeError("private state"); });
    // Invoke through the same boundary as the scheduler; keep the pre-fix throw inside the assertion.
    expect(() => room.stepTick(room.sim.tick + 1)).not.toThrow();
    await waitFor(() => codes.length === 2, 2000, "fault close codes");
    expect(codes).toEqual([4500, 4500]);
    expect((room as ArenaRoom & { faulted: boolean }).faulted).toBe(true);
    const tick = healthy.state.serverTick;
    await waitFor(() => healthy.state.serverTick > tick, 2000, "healthy room advances");
  } finally {
    vi.restoreAllMocks(); errorLog.mockRestore();
    await c.leave();
  }
});

test("a faulted room never calls the pipeline", () => {
  const room = new ArenaRoom() as ArenaRoom & { faulted: boolean };
  room.faulted = true;
  const step = vi.spyOn((room as unknown as { pipeline: { step(t: number): void } }).pipeline, "step").mockImplementation(() => undefined);
  room.stepTick(1);
  expect(step).not.toHaveBeenCalled();
  step.mockRestore();
});
