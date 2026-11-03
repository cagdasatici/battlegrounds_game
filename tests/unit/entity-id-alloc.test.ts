import { expect, test } from "vitest";
import { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { PlayerSchema } from "../../apps/server/src/state/PlayerSchema.js";
class AllocationRoom extends ArenaRoom {
  alloc(): number { return this.allocEntityId(); }
}
test("allocates lowest free id, including a hole", () => {
  const room = new AllocationRoom();
  for (const id of [1, 2, 4]) room.state.players.set(String(id), new PlayerSchema());
  expect(room.alloc()).toBe(3);
});
test("exhaustion throws ROOM_FULL instead of overflowing uint8", () => {
  const room = new AllocationRoom();
  for (let id = 1; id <= 255; id++) room.state.players.set(String(id), new PlayerSchema());
  expect(() => room.alloc()).toThrow("ROOM_FULL");
});
