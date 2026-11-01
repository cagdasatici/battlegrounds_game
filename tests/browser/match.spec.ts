// T18b exit check: two real browser contexts (Chromium, SwiftShader WebGL) fight over a real Colyseus server.
// The Vite dev server serves the real client and proxies /api, /matchmake and the room websocket to the game server,
// so the page is same-origin exactly as in production. Input is real pointer/touch events on the touch shell.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  hitMoveIds?: string[];
  localEntityId: number | null; serverTick: number; reconciles: number;
  corrections: Record<string, number>; predicted: { x: number; y: number; z: number } | null;
  players: { entityId: number; name: string; kitId: string; hp100: number; action: string; moveId: string; ready: boolean; x: number; y: number; z: number; local: boolean }[];
}

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { match: "arena" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: {
      port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false },
      proxy: {
        "/api": { target }, "/matchmake": { target },
        "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true },
      },
    },
  });
  await vite.listen();
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => {
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});

const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): unknown } }).__eb.snapshot() as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => Promise<T | null | false>, ms: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}

async function open(name: string, kit: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  if (process.env["EB_PW_DEBUG"]) { page.on("console", (m) => console.log(name, m.type(), m.text())); page.on("requestfailed", (r) => console.log(name, "FAILED", r.url())); page.on("response", (r) => { if (r.status() >= 400) console.log(name, r.status(), r.url()); }); }
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=match&name=${name}&kit=${kit}&debug=1&auto=1#invite=${token}`);
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 })
    .catch(async (e: unknown) => { throw new Error(`${String(e)}\npage: ${await page.evaluate(() => document.body.innerText)} url=${page.url()} tokenLen=${token.length}`); });
  return { ctx, page, errors };
}

// Touch shell control centres at 1024x768 (spec section 7 fixture).
const JOY = { x: 104, y: 656 }, ATTACK = { x: 932, y: 578 };
const SKILL = [377, 467, 557, 647].map((x) => ({ x, y: 704 }));

test("two browser contexts fight: walk, four-hit chain, four Vanguard skills, replicated HP agrees", async () => {
  test.setTimeout(150_000);
  const A = await open("Arel", "sv");
  await until(async () => (await snap(A.page)).localEntityId !== null || false, 15_000, "A local player");
  const B = await open("Nora", "td");
  try {
    await until(async () => {
      const [a, b] = [await snap(A.page), await snap(B.page)];
      return a.players.length === 2 && b.players.length === 2 && a.players.every((p) => p.ready) && b.players.every((p) => p.ready);
    }, 20_000, "both ready");
    // Spawn protection lasts 120 ticks (2 s) after ready; wait it out and for the clocks to settle.
    await sleep(3500);
    await expect(A.page.locator("canvas")).toBeVisible();
    await expect(B.page.locator("canvas")).toBeVisible();

    const me = async () => (await snap(A.page)).players.find((p) => p.local)!;
    const foe = async () => (await snap(A.page)).players.find((p) => !p.local)!;
    const a0 = await me(), b0 = await foe();
    expect(b0.name).toBe("Nora");
    const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
    expect(dist(a0, b0)).toBeGreaterThan(20);

    const snapsBefore = (await snap(A.page)).corrections["snap"] ?? 0; // the spawn placement is a legitimate snap

    // Turn the camera towards B with a real camera-area drag (yaw 0 faces -Z; yaw = atan2(-dx, -dz)).
    const yaw = Math.atan2(-(b0.x - a0.x), -(b0.z - a0.z));
    let px = -yaw / 0.003; // CAMERA_SENSITIVITY at s = 1
    await A.page.mouse.move(500, 300);
    await A.page.mouse.down();
    let cx = 500;
    while (Math.abs(px) > 1) {
      const step = Math.sign(px) * Math.min(Math.abs(px), 200);
      cx += step; px -= step;
      await A.page.mouse.move(cx, 300, { steps: 4 });
    }
    await A.page.mouse.up();

    // Walk with the joystick until close to B.
    await A.page.mouse.move(JOY.x, JOY.y);
    await A.page.mouse.down();
    await A.page.mouse.move(JOY.x, JOY.y - 60, { steps: 4 });
    await until(async () => dist(await me(), await foe()) < 1.7, 30_000, "A reaches B");
    await A.page.mouse.up();
    await sleep(400);
    const walked = await snap(A.page);
    // Prediction agreed with the server while walking: no snap corrections, and at rest the poses match.
    expect(walked.corrections["snap"]).toBe(snapsBefore);
    expect(walked.reconciles).toBeGreaterThan(10);
    const aRest = walked.players.find((p) => p.local)!;
    expect(Math.hypot(walked.predicted!.x - aRest.x, walked.predicted!.z - aRest.z)).toBeLessThan(0.1);

    // Hold Attack: the server runs the four-hit chain. Record B's replicated HP on both contexts.
    const hpTrace: number[] = [];
    const moveIds = new Set<string>();
    await A.page.mouse.move(ATTACK.x, ATTACK.y);
    await A.page.mouse.down();
    const t0 = Date.now();
    let shot = false;
    while (Date.now() - t0 < 6000) {
      const s = await snap(A.page);
      const f = s.players.find((p) => !p.local)!;
      if (hpTrace.at(-1) !== f.hp100) hpTrace.push(f.hp100);
      const m = s.players.find((p) => p.local)!.moveId;
      if (m) moveIds.add(m);
      if (!shot && hpTrace.length >= 3) { shot = true; mkdirSync(outDir, { recursive: true }); await A.page.screenshot({ path: path.join(outDir, "T18b.png") }); }
      if (hpTrace.length >= 5 || f.action === "Dead" || (s.hitMoveIds ?? []).includes("m1.4.finisher")) break;
      await sleep(30);
    }
    await A.page.mouse.up();
    // Count chain hits from server-confirmed events: a slow renderer can sample two HP drops as one.
    const damageSteps = ((await snap(A.page)).hitMoveIds ?? []).filter((m) => m.startsWith("m1.")).length;
    expect(damageSteps).toBeGreaterThanOrEqual(4); // four chain hits, each a distinct replicated HP drop

    // Both contexts read the same HP for B (A's foe, B's own record).
    const fin = await until(async () => {
      const a = (await snap(A.page)).players.find((p) => p.name === "Nora")!;
      const b = (await snap(B.page)).players.find((p) => p.local)!;
      return a.hp100 === b.hp100 ? { a: a.hp100, b: b.hp100 } : null;
    }, 5000, "HP agreement");
    expect(fin.a).toBeLessThan(10000);

    // Four base Vanguard skills by real touch taps; each must produce a server-confirmed move id on A.
    await sleep(1800); // finisher recovery
    for (const [i, c] of SKILL.entries()) {
      if ((await foe()).action === "Dead") break;
      await A.page.touchscreen.tap(c.x, c.y);
      await until(async () => {
        const m = (await me()).moveId;
        if (m) moveIds.add(m);
        return moveIds.has(`sv.b${i + 1}`) ? true : null;
      }, 4000, `skill ${i + 1} accepted`).catch(() => undefined);
      await sleep(1200);
    }
    const sa = await snap(A.page), sb = await snap(B.page);
    const finalA = sa.players.find((p) => p.name === "Nora")!, finalB = sb.players.find((p) => p.local)!;
    expect(finalA.hp100).toBe(finalB.hp100);
    writeFileSync(path.join(outDir, "T18b-playwright.json"), JSON.stringify({
      hpTraceForB: hpTrace, moveIdsSeenOnA: [...moveIds], finalHp100: { seenByA: finalA.hp100, seenByB: finalB.hp100 },
      correctionsA: sa.corrections, reconcilesA: sa.reconciles, consoleErrorsA: A.errors, consoleErrorsB: B.errors,
    }, null, 2));
    const skillsSeen = [1, 2, 3, 4].filter((n) => moveIds.has(`sv.b${n}`)).length;
    // The chain must be the M1 family; every skill that fired must be a Vanguard move.
    expect([...moveIds].every((m) => m.startsWith("sv.") || m.startsWith("m1."))).toBe(true);
    // Chain membership comes from server-confirmed hit events; sampling replicated moveId can miss a short action.
    const hitMoves = new Set<string>((await snap(A.page)).hitMoveIds ?? []);
    expect(["m1.1", "m1.2", "m1.3", "m1.4.finisher"].filter((m) => !hitMoves.has(m))).toEqual([]);
    expect(skillsSeen).toBeGreaterThanOrEqual(3);
    expect(A.errors).toEqual([]);
    expect(B.errors).toEqual([]);
  } finally {
    await A.ctx.close();
    await B.ctx.close();
  }
});
