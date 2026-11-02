// FX1 exit checks: hitting the practice dummy fills the effects pool and flashes the victim within 2 frames of the
// confirmed server event. Same harness as flow.spec.ts: real Colyseus server in-process, real client
// served by Vite, same origin, workers 1.
import { test, expect, chromium, type Browser } from "@playwright/test";
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
const GL_ARGS = ["--autoplay-policy=document-user-activation-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
interface Snap {
  localEntityId: number | null; serverTick: number;
  players: { name: string; kitId: string; action: string; form: string; x: number; z: number; local: boolean; kills: number; deaths: number; meter100: number; hp100: number }[];
  fx: { active: number; capacity: number; flashing: string[]; shaking: boolean };
  hitMoveIds: string[];
  practice: { step: number; skillMask: number; dummyGuard: boolean; dummyRagdoll: boolean } | null;
}

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
const evidence: Record<string, unknown> = {};

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});

test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-qs01-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { flow: "arena", practice: "practice" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
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
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "QS01-playwright.json"), JSON.stringify(evidence, null, 2));
  await browser?.close();
  await vite?.close();
  await game?.gracefullyShutdown(false);
});


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Probe { isUnlocked: boolean; activeVoices: number; loopCount: number; isSuspended: boolean }
interface T {
  made: number; closed: number; plays: number; players: Map<string, Record<string, unknown>>; setTick(n: number): void;
  emit(e: object): void; probe(): Probe | undefined; off(): void; ctx(): AudioContext | undefined;
}
declare global { interface Window { __t: T } }

// Event-to-audio routing against the real Sfx module and the browser's real WebAudio, driven by a stand-in combat bus so
// every outcome kind and every loop-ending path is reachable. The game case below uses real input.
test("QS01 routing: no autoplay, first gesture unlocks, duplicates ignored, loops stop on every end, cleanup", async () => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/`);
    await page.evaluate(async () => {
      const { Sfx } = await import("/src/fx/Sfx.ts");
      // Playwright's evaluate counts as user activation; hide it so only the real click below can unlock.
      Object.defineProperty(navigator, "userActivation", { configurable: true, value: { hasBeenActive: false } });
      const t = { made: 0, closed: 0, plays: 0, players: new Map<string, Record<string, unknown>>(), tick: 100 } as unknown as T & { tick: number };
      let live: AudioContext | undefined;
      const factory = () => { t.made++; const c = new AudioContext(); live = c; const close = c.close.bind(c); c.close = () => { t.closed++; return close(); }; return c as never; };
      const ls = new Set<(e: unknown) => void>();
      const bus = { on(fn: (e: unknown) => void) { ls.add(fn); return () => { ls.delete(fn); }; } };
      t.players.set("me", { x: 0, z: 0, action: "Idle" });
      t.players.set("foe", { x: 500, z: 0, action: "Idle" });
      t.setTick = (n: number) => { t.tick = n; };
      t.emit = (e: object) => ls.forEach((f) => f({ tick: 1, lifeId: 1, actorId: "foe", ...e }));
      t.probe = () => (globalThis as unknown as { __ebAudio?: { audio: Probe } }).__ebAudio?.audio;
      t.ctx = () => live;
      t.off = Sfx.attach(bus as never, { players: () => t.players, settings: { get: () => ({ effectsVolume: 0.8 }) }, localId: () => "me", serverTick: () => t.tick } as never, factory);
      window.__t = t;
      t.emit({ eventId: "pre", kind: "hit", targetId: "me" });
    });
    const before = await page.evaluate(() => ({ made: window.__t.made, unlocked: window.__t.probe()!.isUnlocked, voices: window.__t.probe()!.activeVoices }));
    expect(before).toEqual({ made: 0, unlocked: false, voices: 0 });

    await page.mouse.click(300, 300); // first intentional interaction
    const unlocked = await page.evaluate(() => ({ made: window.__t.made, unlocked: window.__t.probe()!.isUnlocked }));
    expect(unlocked).toEqual({ made: 1, unlocked: true });

    // Every outcome kind makes a voice; a duplicate eventId makes none.
    const kinds = await page.evaluate(() => {
      const t = window.__t, res: Record<string, number> = {};
      const one = (name: string, e: object) => { const v0 = t.probe()!.activeVoices; t.emit({ eventId: `k-${name}`, ...e }); res[name] = t.probe()!.activeVoices - v0; };
      one("block", { kind: "block", targetId: "me" });
      one("counter", { kind: "counter", targetId: "me" });
      one("ko", { kind: "ko", targetId: "me" });
      one("stone", { kind: "cast", moveId: "sv.a1" });
      one("tide", { kind: "cast", moveId: "td.a1" });
      one("ember", { kind: "cast", moveId: "ea.a1" });
      const v0 = t.probe()!.activeVoices;
      t.emit({ eventId: "k-block", kind: "block", targetId: "me" });
      res["duplicate"] = t.probe()!.activeVoices - v0;
      return res;
    });
    expect(kinds).toEqual({ block: 1, counter: 1, ko: 1, stone: 1, tide: 1, ember: 1, duplicate: 0 });

    // Sustained bed: starts on Active, stops on confirmed end, interruption, death, leave, visibility, interruption.
    const sustain = await page.evaluate(async () => {
      const t = window.__t, res: Record<string, number> = {};
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const me = () => t.players.get("me")!;
      const active = () => { t.players.set("me", { x: 0, z: 0, action: "Active", moveId: "ea.a3", actionStartTick: 100, actionEndTick: 400 }); t.setTick(150); };
      active(); await frame(); res["start"] = t.probe()!.loopCount;
      t.setTick(400); await frame(); res["phaseEnd"] = t.probe()!.loopCount;
      active(); await frame(); res["restart"] = t.probe()!.loopCount;
      me()["action"] = "Stunned"; await frame(); res["interrupt"] = t.probe()!.loopCount;
      active(); await frame(); me()["action"] = "Dead"; await frame(); res["death"] = t.probe()!.loopCount;
      active(); await frame(); t.players.delete("me"); await frame(); res["leave"] = t.probe()!.loopCount;
      t.players.set("me", { x: 0, z: 0, action: "Idle" });
      active(); await frame(); res["beforeHide"] = t.probe()!.loopCount;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange")); await frame();
      res["hidden"] = t.probe()!.loopCount; res["hiddenSuspended"] = t.probe()!.isSuspended ? 1 : 0;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange")); await frame(); await frame();
      res["visibleAgain"] = t.probe()!.loopCount;
      const c = t.ctx()!;
      await c.suspend(); await frame(); // device interruption
      res["ctxSuspended"] = t.probe()!.loopCount;
      await c.resume(); await frame(); await frame();
      res["resumed"] = t.probe()!.loopCount;
      return res;
    });
    expect(sustain).toMatchObject({ start: 1, phaseEnd: 0, restart: 1, interrupt: 0, death: 0, leave: 0, beforeHide: 1, hidden: 0, hiddenSuspended: 1, ctxSuspended: 0 });
    expect(sustain["visibleAgain"]).toBe(1);
    expect(sustain["resumed"]).toBe(1);

    const end = await page.evaluate(async () => {
      const t = window.__t;
      t.off();
      await sleep0();
      function sleep0() { return new Promise((r) => setTimeout(r, 50)); }
      return { closed: t.closed, probeGone: t.probe() === undefined, ctxState: t.ctx()!.state };
    });
    expect(end).toEqual({ closed: 1, probeGone: true, ctxState: "closed" });
    expect(errors).toEqual([]);
    evidence["routing"] = { before, unlocked, kinds, sustain, end, pageErrors: errors };
  } finally { await ctx.close(); }
});

// Offline renders of the real AudioBus through a real OfflineAudioContext: measurable identity, not human audibility.
test("QS01 offline renders: each element and defensive sound is audible and distinct", async () => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}/`);
    const res = await page.evaluate(async () => {
      const { AudioBus } = await import("/src/audio/AudioBus.ts");
      const names = ["castStone", "castWater", "castHeat", "block", "counter", "ko", "hitLight", "hitHeavy"] as const;
      const rate = 22050, secs = 1;
      const out: Record<string, { peak: number; rms: number; centroidHz: number; spectrum: number[] }> = {};
      for (const name of names) {
        const off = new OfflineAudioContext(1, rate * secs, rate);
        // Offline contexts lack resume/close semantics the bus expects; forward everything else untouched.
        const facade = new Proxy(off, { get: (o, k) => (k === "resume" || k === "close" ? async () => {} : k === "state" ? "running" : typeof (o as never)[k] === "function" ? ((o as never)[k] as (...a: unknown[]) => unknown).bind(o) : (o as never)[k]), set: (o, k, v) => { (o as never)[k] = v; return true; } });
        const bus = new AudioBus(() => facade as never);
        bus.unlock();
        const played = bus.play(name, 0, 0);
        if (!played) throw new Error(`not played ${name} unlocked=${bus.isUnlocked} susp=${bus.isSuspended}`);
        const buf = await off.startRendering();
        const d = buf.getChannelData(0);
        let peak = 0, sum = 0;
        for (const v of d) { peak = Math.max(peak, Math.abs(v)); sum += v * v; }
        // 16 log-spaced band energies via a direct DFT on 2048 samples from the loudest window.
        const N = 2048; let best = 0, bestE = -1;
        for (let s = 0; s + N <= d.length; s += 512) { let e = 0; for (let i = 0; i < N; i++) e += d[s + i]! ** 2; if (e > bestE) { bestE = e; best = s; } }
        const bands = new Array<number>(16).fill(0); let num = 0, den = 0;
        for (let k = 1; k < N / 2; k += 2) {
          let re = 0, im = 0;
          for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N), a = (2 * Math.PI * k * i) / N; re += d[best + i]! * w * Math.cos(a); im -= d[best + i]! * w * Math.sin(a); }
          const m = re * re + im * im, f = (k * rate) / N;
          num += f * m; den += m;
          bands[Math.min(15, Math.floor(Math.log2(f / 40) * 2))] = (bands[Math.min(15, Math.max(0, Math.floor(Math.log2(f / 40) * 2)))] ?? 0) + m;
        }
        const tot = bands.reduce((a, b) => a + b, 0) || 1;
        out[name] = { peak, rms: Math.sqrt(sum / d.length), centroidHz: den > 0 ? num / den : 0, spectrum: bands.map((b) => b / tot) };
      }
      return out;
    });
    const names = Object.keys(res);
    for (const n of names) {
      expect(res[n]!.peak, `${n} peak`).toBeGreaterThan(0.03);
      expect(res[n]!.peak, `${n} not clipping`).toBeLessThan(1);
    }
    // Pairwise spectral distance (L1 of normalised band energy, 0..2) among the six identity sounds.
    const ident = ["castStone", "castWater", "castHeat", "block", "counter", "ko"];
    const dist: Record<string, number> = {};
    let minD = 9;
    for (let i = 0; i < ident.length; i++) for (let j = i + 1; j < ident.length; j++) {
      const a = res[ident[i]!]!.spectrum, b = res[ident[j]!]!.spectrum;
      const dd = a.reduce((s, v, k) => s + Math.abs(v - b[k]!), 0);
      dist[`${ident[i]}~${ident[j]}`] = Number(dd.toFixed(3)); minD = Math.min(minD, dd);
    }
    expect(minD, "closest pair of identity sounds").toBeGreaterThan(0.25);
    expect(res["castStone"]!.centroidHz).toBeLessThan(res["castWater"]!.centroidHz);
    expect(res["castWater"]!.centroidHz).toBeLessThan(res["castHeat"]!.centroidHz);
    evidence["offline"] = { metrics: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { peak: +v.peak.toFixed(3), rms: +v.rms.toFixed(4), centroidHz: Math.round(v.centroidHz) }])), pairwiseL1: dist, minPairwiseL1: Number(minD.toFixed(3)) };
  } finally { await ctx.close(); }
});

// Real client against the real server: a server-confirmed hit makes a voice after the Play press unlocked audio, and
// the voices drain afterwards.
test("QS01 game: real input hit makes a voice after the Play gesture, then nothing lingers", async () => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const probe = () => page.evaluate(() => { const a = (globalThis as unknown as { __ebAudio?: { audio: Probe } }).__ebAudio?.audio; return a ? { unlocked: a.isUnlocked, voices: a.activeVoices, loops: a.loopCount } : null; });
  try {
    await page.goto(`${base}/?room=flow&debug=1&name=Arel&kit=sv#invite=${svc.invites.create({ ttlMs: 120_000, maxUses: 1 }).token}`);
    await page.waitForSelector("[data-act=practice]");
    const pre = await probe();
    expect(pre?.unlocked ?? false).toBe(false);
    await page.click("[data-act=practice]");
    await expect(page.locator("[data-ui=room-status]")).toContainText("training dummy");
    await page.click("[data-act=ready]");
    await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    expect((await probe())?.unlocked).toBe(true);
    await page.evaluate(() => {
      const w = window as unknown as { __maxV: number };
      w.__maxV = 0;
      const a = (globalThis as unknown as { __ebAudio: { audio: Probe } }).__ebAudio.audio;
      const tick = (): void => { w.__maxV = Math.max(w.__maxV, a.activeVoices); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const atk = (await page.locator("[data-control=attack]").boundingBox())!;
    const t0 = Date.now();
    let max = 0;
    while (Date.now() - t0 < 30_000 && max === 0) {
      await page.keyboard.down("KeyW");
      await page.mouse.move(atk.x + atk.width / 2, atk.y + atk.height / 2);
      await page.mouse.down(); await sleep(150); await page.mouse.up();
      await page.keyboard.up("KeyW");
      max = await page.evaluate(() => (window as unknown as { __maxV: number }).__maxV);
      await sleep(150);
    }
    expect(max, "a voice played for a server-confirmed event").toBeGreaterThan(0);
    await sleep(2500);
    const drained = await probe();
    expect(drained?.voices, "one-shots expire").toBe(0);
    expect(drained?.loops).toBe(0);
    evidence["game"] = { maxVoices: max, drained, pageErrors: errors };
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
