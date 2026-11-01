import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "colyseus";
import type { Room } from "@colyseus/sdk";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";

export interface Harness { server: Server; svc: AuthServices; port: number; origin: string; stop(): Promise<void> }

export async function startHarness(port: number): Promise<Harness> {
  const origin = `http://localhost:${port}`;
  const svc = createAuthServices({
    dataDir: mkdtempSync(join(tmpdir(), "eb-h-")), allowedOrigins: [origin], secureCookies: true,
    roomCodes: Object.fromEntries(["play", "other", ...Array.from({ length: 40 }, (_, i) => `r${i}`)].map((c) => [c, "arena"])), buildId: "test", sessionsPerMinute: 10_000,
  });
  const server = createGameServer(svc);
  await server.listen(port, undefined, undefined);
  return { server, svc, port, origin, stop: () => server.gracefullyShutdown(false) };
}

/** fetch with a minimal cookie jar and an Origin header, standing in for the browser. */
export function browserFetch(origin: string): typeof fetch {
  let cookie = "";
  return (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("origin", origin);
    if (cookie) headers.set("cookie", cookie);
    const r = await fetch(url, { ...init, headers });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.startsWith("eb_session=;") ? "" : sc.split(";")[0]!;
    return r;
  }) as typeof fetch;
}

export function newClient(h: Harness, storage?: Map<string, string>): RoomClient {
  const store = storage ?? new Map<string, string>();
  return new RoomClient({
    httpBase: h.origin, wsEndpoint: `ws://localhost:${h.port}`, fetchFn: browserFetch(h.origin),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => undefined,
  });
}

export async function loginClient(h: Harness, name: string, storage?: Map<string, string>): Promise<RoomClient> {
  const c = newClient(h, storage);
  const { token } = h.svc.invites.create({ ttlMs: 60_000, maxUses: 1 });
  await c.login(token, name);
  return c;
}

export async function waitFor(cond: () => boolean, ms = 3000, what = "condition"): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const players = (room: Room): Map<string, any> => (room.state as any)?.players ?? new Map();

let roomSeq = 0;
/** A fresh private room code per test so leftover seats never leak between tests. */
export const freshCode = (): string => `r${roomSeq++ % 40}`;
