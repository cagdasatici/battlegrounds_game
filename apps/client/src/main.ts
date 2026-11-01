import { Client } from "@colyseus/sdk";
import { ARENA_ROOM_NAME } from "@eb/shared/protocol";

const app = document.getElementById("app");
if (app) app.textContent = "Preparing arena…";

export async function joinArena(endpoint: string) {
  const client = new Client(endpoint);
  return client.joinOrCreate(ARENA_ROOM_NAME);
}
