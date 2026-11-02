// UX10c: a busy four-fighter scene with overlapping windups, actives, hits, blocks and KOs on every quality tier.
// Measures draw calls, triangles, pooled particles and glow slots every step and holds them to the budgets
// (120 draw calls, 300k triangles, tier particle capacity, tier glow slots, tier dynamic lights 0/2/4).
// Software WebGL (SwiftShader): the counts are exact, the frame times are only a relative CPU signal.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results/UX10");
const req = createRequire(path.join(root, "apps/client/package.json"));
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const LIGHTS = { low: 0, medium: 2, high: 4 } as const;
type Tier = keyof typeof LIGHTS;

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface Budget { glow: Record<Tier, { flashes: number; rings: number; streaks: number; lights: number }>; pool: Record<Tier, number> }
interface Fx {
  frames(): number; quality(q: string): void; act(id: string, a: string, m: string, t?: number): void; event(e: Record<string, unknown>): void;
  fx(): { active: number; capacity: number; glow: { flashes: number; rings: number; streaks: number; lights: number }; lit: number };
  peak(): { calls: number; triangles: number }; resetPeak(): void; budget(): Budget;
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

const MOVES = ["sv.b1", "td.b2", "ea.a3", "sv.a2", "td.a4", "ea.b4", "sv.b4", "td.b4", "ea.b1", "sv.a3", "td.a1", "ea.a4"];
const FIGHTERS = [{ id: "sv", at: [-1.5, 6] }, { id: "td", at: [1.5, 6] }, { id: "ea", at: [-1.5, 9] }, { id: "sv2", at: [1.5, 9] }] as const;

for (const tier of ["low", "medium", "high"] as const) {
  test(`busy four-fighter overlapping effects stay inside the ${tier} budgets`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${base}/fx.html`);
      await page.waitForFunction(() => ((window as unknown as { __fx?: Fx }).__fx?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
      const budget = await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.budget());
      await page.evaluate((t) => (window as unknown as { __fx: Fx }).__fx.quality(t), tier);
      await page.waitForTimeout(300);
      await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.resetPeak());
      const peak = { pool: 0, flashes: 0, rings: 0, streaks: 0, lights: 0, lit: 0, calls: 0, triangles: 0 };
      const STEPS = 36;
      for (let step = 0; step < STEPS; step++) {
        // Every 120 ms each fighter starts a new ability phase and lands or blocks a hit on the next fighter: effects overlap constantly.
        await page.evaluate(([step, moves, fighters]) => {
          const f = (window as unknown as { __fx: Fx }).__fx;
          fighters!.forEach((p, i) => {
            const move = moves![(step! + i * 3) % moves!.length]!, victim = fighters![(i + 1) % fighters!.length]!;
            f.act(p.id, step! % 2 === 0 ? "Windup" : "Active", move, 24);
            if ((step! + i) % 3 !== 0) return; // staggered: about one landed blow per fighter every 360 ms, on top of the constant ability phases
            const kind = step! % 9 === 4 ? "block" : step! % 18 === 9 && i === 0 ? "ko" : "hit";
            f.event({ actorId: p.id, targetId: victim.id, moveId: move, kind, damage100: 1800, hitClass: "heavy", position: { x: victim.at[0], y: 1.2, z: victim.at[1] } });
          });
        }, [step, MOVES, FIGHTERS] as const);
        await page.waitForTimeout(120);
        const s = await page.evaluate(() => { const f = (window as unknown as { __fx: Fx }).__fx; return { fx: f.fx(), p: f.peak() }; });
        peak.pool = Math.max(peak.pool, s.fx.active); peak.flashes = Math.max(peak.flashes, s.fx.glow.flashes); peak.rings = Math.max(peak.rings, s.fx.glow.rings);
        peak.streaks = Math.max(peak.streaks, s.fx.glow.streaks); peak.lights = Math.max(peak.lights, s.fx.glow.lights); peak.lit = Math.max(peak.lit, s.fx.lit);
        peak.calls = Math.max(peak.calls, s.p.calls); peak.triangles = Math.max(peak.triangles, s.p.triangles);
      }
      await page.screenshot({ path: path.join(outDir, `busy-4-fighters-${tier}.png`) });
      const frames = await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.frames());
      writeFileSync(path.join(outDir, `budget-${tier}.json`), JSON.stringify({ fixture: "four fighters, 12 abilities cycling, an ability phase per fighter every 120 ms and a staggered hit/block per fighter every 360 ms plus a KO every 2.2 s; SwiftShader desktop Chromium 1100x700", tier, steps: STEPS, frames, peak, budget: { drawCalls: 120, triangles: 300_000, pool: budget.pool[tier], glow: budget.glow[tier], lights: LIGHTS[tier] } }, null, 1) + "\n");
      expect(peak.calls, "draw calls").toBeLessThanOrEqual(120);
      expect(peak.triangles, "triangles").toBeLessThanOrEqual(300_000);
      expect(peak.pool, "pooled particles").toBeLessThanOrEqual(budget.pool[tier]);
      expect(peak.flashes).toBeLessThanOrEqual(budget.glow[tier].flashes);
      expect(peak.rings).toBeLessThanOrEqual(budget.glow[tier].rings);
      expect(peak.streaks).toBeLessThanOrEqual(budget.glow[tier].streaks);
      expect(peak.lights).toBeLessThanOrEqual(LIGHTS[tier]);
      expect(peak.lit).toBeLessThanOrEqual(LIGHTS[tier]);
      expect(peak.streaks, "the scene really was busy").toBeGreaterThan(budget.glow[tier].streaks * 0.3);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
