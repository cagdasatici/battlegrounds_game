import { Room, type Client } from "colyseus";
import { Schema, defineTypes } from "@colyseus/schema";
import { MAX_CLIENTS, PATCH_RATE_MS, PROTOCOL_VERSION } from "@eb/shared/protocol";

/** Minimal bootstrap state. Real schema arrives in T02/T04. */
export class BootstrapState extends Schema {
  protocolVersion: number = PROTOCOL_VERSION;
  serverTick: number = 0;
}
defineTypes(BootstrapState, { protocolVersion: "uint8", serverTick: "uint32" });

export class ArenaRoom extends Room {
  override maxClients = MAX_CLIENTS;
  override state = new BootstrapState();

  override onCreate(): void {
    this.patchRate = PATCH_RATE_MS;
    this.setSimulationInterval(() => {
      this.state.serverTick += 1;
    }, 1000 / 60);
  }

  override onJoin(client: Client): void {
    client.send("welcome", { protocolVersion: PROTOCOL_VERSION });
  }
}
