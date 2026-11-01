// Starts the real production entry point (apps/server/src/main.ts, NODE_ENV=production) as a child process
// and drives it with two real Colyseus clients over HTTP and WebSocket on loopback.
// Serves a small fixture shell (STATIC_DIR) so the test does not depend on a prior build.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { InviteStore } from "../../apps/server/src/auth/InviteStore.js";
import { RoomClient } from "../../apps/client/src/net/RoomClient.js";
import { browserFetch, players, waitFor } from "../fixtures/harness.js";
import { PROTOCOL_VERSION } from "../../packages/shared/src/protocol.js";

const PORT = 25728;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const root = new URL("../../", import.meta.url).pathname;
const tsx = join(root, "apps/server/node_modules/.bin/tsx");
const dataDir = mkdtempSync(join(tmpdir(), "eb-t28-"));
const staticDir = mkdtempSync(join(tmpdir(), "eb-t28-static-"));
mkdirSync(join(staticDir, "assets"));
writeFileSync(join(staticDir, "index.html"), "<!doctype html><script type=module src=\"/assets/app.js\"></script>");
writeFileSync(join(staticDir, "assets/app.js"), "export {};");
let child: ChildProcess;
let out = "";

const baseEnv = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(PORT), PUBLIC_ORIGIN: ORIGIN, EB_ALLOW_HTTP_ORIGIN: "1", DATA_DIR: dataDir, STATIC_DIR: staticDir, BUILD_ID: "t28-local" };

function client(): RoomClient {
  const store = new Map<string, string>();
  return new RoomClient({
    httpBase: ORIGIN, wsEndpoint: `ws://127.0.0.1:${PORT}`, fetchFn: browserFetch(ORIGIN),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    sleep: async () => undefined,
  });
}

beforeAll(async () => {
  child = spawn(tsx, ["src/main.ts"], { cwd: join(root, "apps/server"), env: baseEnv });
  child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
  child.stderr?.on("data", (d: Buffer) => { out += d.toString(); });
  await waitFor(() => out.includes("server listening"), 20000, "production server to listen");
}, 30000);
afterAll(async () => {
  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await exited;
});

describe("T28 production process on loopback", () => {
  test("health, version and static shell are served from one origin", async () => {
    const h = await fetch(`${ORIGIN}/healthz`);
    expect(h.status).toBe(200);
    expect(await h.json()).toEqual({ ok: true });
    const v = await (await fetch(`${ORIGIN}/api/version`)).json() as { protocolVersion: number; buildId: string };
    expect(v).toMatchObject({ protocolVersion: PROTOCOL_VERSION, buildId: "t28-local" });
    const idx = await fetch(`${ORIGIN}/`);
    expect(idx.status).toBe(200);
    expect(idx.headers.get("content-type")).toMatch(/text\/html/);
    expect(await idx.text()).toMatch(/<script/);
    expect((await fetch(`${ORIGIN}/some/client/route`)).status).toBe(200); // SPA fallback
    expect((await fetch(`${ORIGIN}/missing.js`)).status).toBe(404);
    expect((await fetch(`${ORIGIN}/%2e%2e/%2e%2e/package.json`)).status).not.toBe(200);
    expect((await fetch(`${ORIGIN}/api/nope`)).status).toBe(404);
  });
  test("two real clients join one room on the production process", async () => {
    const store = new InviteStore(join(dataDir, "invites.json"));
    const a = client(); const b = client();
    await a.login(store.create({ ttlMs: 60_000, maxUses: 1 }).token, "Arel");
    await b.login(store.create({ ttlMs: 60_000, maxUses: 1 }).token, "Nora");
    const ra = await a.join("play"); const rb = await b.join("play");
    expect(ra.roomId).toBe(rb.roomId);
    await waitFor(() => players(ra).size === 2 && players(rb).size === 2, 5000, "both players visible");
    await a.leave(); await b.leave();
  });
  test("origin check uses PUBLIC_ORIGIN", async () => {
    const r = await fetch(`${ORIGIN}/api/session`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
  test("logs contain no invite tokens", () => {
    expect(out).not.toMatch(/invite=/);
  });
});

describe("T28 refuses invalid production config", () => {
  test("exits 78 with a nonsecret explanation", async () => {
    const env = { ...baseEnv, PUBLIC_ORIGIN: "", HOST: "0.0.0.0" };
    const p = spawn(tsx, ["src/main.ts"], { cwd: join(root, "apps/server"), env });
    let text = ""; p.stderr?.on("data", (d: Buffer) => { text += d.toString(); });
    const code = await new Promise<number | null>((r) => p.once("exit", r));
    expect(code).toBe(78);
    expect(text).toMatch(/PUBLIC_ORIGIN is required/);
    expect(text).toMatch(/loopback/);
  }, 20000);
});
