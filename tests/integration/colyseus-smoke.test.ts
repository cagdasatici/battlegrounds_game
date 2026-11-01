import { afterAll, beforeAll, expect, test } from "vitest";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";
import { startHarness, loginClient, waitFor, type Harness } from "../fixtures/harness.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(25670); });
afterAll(async () => { await h.stop(); });

test("T01 smoke: a real client joins the arena room and receives a welcome plus ticking state", async () => {
  const c = await loginClient(h, "Arel");
  const room = await c.join("play");
  await waitFor(() => c.welcome !== null, 3000, "welcome");
  expect(c.welcome!.contentHash).toBe(c.localContentHash);
  expect((room.state as { protocolVersion: number }).protocolVersion).toBe(PROTOCOL_VERSION);
  await waitFor(() => (room.state as { serverTick: number }).serverTick > 0, 3000, "tick");
  await c.leave();
});
