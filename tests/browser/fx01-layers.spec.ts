// FX01: layered hit, special and beast-form effects in the real GameScene on every tier, driven by the same inputs production presents
// (replicated action phases, the beast flag and confirmed combat events). Fails on any console or page error (shader compile errors
// surface as console errors) and checks decals, screen pulse, hit-stop-free pooling and cleanup. SwiftShader: counts are exact, looks are not a GPU measurement.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.resolve(root, process.env["EB_VISUAL_OUT"] ?? path.join(evidenceDir(root), "FX01"));
const req = createRequire(path.join(root, "apps/client/package.json"));
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const DECALS = { low: 3, medium: 8, high: 14 } as const;
type Tier = keyof typeof DECALS;

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface Fx {
  frames(): number; quality(q: string): void; act(id: string, a: string, m: string, t?: number): void; idle(id: string): void; event(e: Record<string, unknown>): void; beast(id: string, on: boolean): void;
  layers(): { decals: number; pulses: number; decalMeshes: number; pulseEl: boolean };
  fx(): { active: number; capacity: number; glow: { streaks: number } }; dispose(): void;
  peak(): { calls: number; triangles: number }; resetPeak(): void;
}
let server: Dev, browser: Browser, base = "";
test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
  mkdirSync(outDir, { recursive: true });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

const KITS = [["sv", "td"], ["td", "ea"], ["ea", "sv"]] as const;
const SPECIALS = ["sv", "td", "ea"].flatMap((k) => ["b", "a"].flatMap((f) => [1, 2, 3, 4].map((n) => `${k}.${f}${n}`)));

for (const tier of ["low", "medium", "high"] as const) {
  test(`all 24 specials, base and beast, run clean on ${tier}`, async () => {
    test.setTimeout(180_000); // render-time decal lives (up to 16 s) run slow under SwiftShader, where each frame advances at most 50 ms
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" || (m.type() === "warning" && /shader|glsl|WebGLProgram/i.test(m.text()))) errors.push(m.text()); });
    const f = <T>(fn: (x: Fx) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__fx)`) as Promise<T>;
    try {
      await page.goto(`${base}/fx.html`);
      await page.waitForFunction(() => ((window as unknown as { __fx?: Fx }).__fx?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
      await page.evaluate((t) => (window as unknown as { __fx: Fx }).__fx.quality(t), tier);
      await page.waitForTimeout(250);
      await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.resetPeak());
      let maxDecals = 0, maxMeshes = 0, maxActive = 0, maxCalls = 0;
      for (const beast of [false, true]) {
        await page.evaluate((b) => (window as unknown as { __fx: Fx }).__fx.beast("sv", b), beast);
        for (let i = 0; i < SPECIALS.length; i++) {
          const move = SPECIALS[i]!, [actor, victim] = move.startsWith("sv") ? ["sv", "td"] : KITS.find((k) => k[0] === move.slice(0, 2))!;
          await page.evaluate(([a, v, m, b]) => {
            const x = (window as unknown as { __fx: Fx }).__fx;
            x.beast(a!, b === "1");
            x.act(a!, "Windup", m!, 12);
            x.act(a!, "Active", m!, 12);
            x.event({ actorId: a, targetId: v, moveId: m, kind: "hit", damage100: 2400, hitClass: "heavy", targetHp100: 5000, position: { x: 0, y: 1.2, z: 6 } });
          }, [actor, victim, move, beast ? "1" : "0"] as const);
          if (i % 4 === 3) await page.waitForTimeout(90);
          const l = await f((x) => ({ l: x.layers(), a: x.fx().active, p: x.peak() }));
          maxDecals = Math.max(maxDecals, l.l.decals); maxMeshes = Math.max(maxMeshes, l.l.decalMeshes); maxActive = Math.max(maxActive, l.a); maxCalls = Math.max(maxCalls, l.p.calls);
        }
        if (beast) await page.screenshot({ path: path.join(outDir, `beast-specials-${tier}.png`) });
      }
      await page.evaluate(() => { const x = (window as unknown as { __fx: Fx }).__fx; x.beast("sv", true); x.act("sv", "Active", "sv.a2", 30); x.event({ actorId: "sv", targetId: "td", moveId: "sv.a2", kind: "hit", damage100: 5000, hitClass: "heavy", targetHp100: 0, position: { x: 1.5, y: 1.2, z: 6 } }); });
      await page.waitForTimeout(160);
      await page.screenshot({ path: path.join(outDir, `beast-ko-${tier}.png`) });
      const end = await f((x) => x.layers());
      expect(end.pulses, "screen pulses fired").toBeGreaterThan(0);
      expect(end.pulseEl, "pulse overlay exists").toBe(true);
      expect(maxDecals, "decals appear").toBeGreaterThan(0);
      expect(maxDecals, "decal pool cap").toBeLessThanOrEqual(DECALS[tier]);
      expect(maxMeshes, "decal meshes never grow past the pool").toBeLessThanOrEqual(DECALS[tier] * 2);
      expect(maxActive).toBeGreaterThan(0);
      expect(maxCalls, "draw calls").toBeLessThanOrEqual(120);
      // Everything expires: after the longest decal life plus slack the pool of lingering marks is empty again (tier lives are 4 to 10 s x 1.6).
      await page.evaluate(() => { const x = (window as unknown as { __fx: Fx }).__fx; for (const id of ["sv", "td", "ea", "sv2"]) { x.beast(id, false); x.idle(id); } });
      // High renders about 1 frame per second under SwiftShader (4 MP budget) and a frame advances at most 50 ms, so its 16 s lives would take minutes: expiry is proven on low and medium, unit-tested for every tier.
      if (tier !== "high") await page.waitForFunction(() => (window as unknown as { __fx: Fx }).__fx.layers().decals === 0, undefined, { timeout: 100_000 });
      // Cleanup: disposing the presentation removes the overlay and every decal mesh.
      await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.dispose());
      expect(await page.evaluate(() => document.querySelector('[data-fx="screen-pulse"]') === null)).toBe(true);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
