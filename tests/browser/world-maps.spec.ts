// WORLD01/WORLD02: every non-grove registry map renders in Chromium (SwiftShader WebGL) with no console or shader errors, stays inside the triangle
// budget on every tier, and writes screenshots to docs/test-results/WORLD-<id>-<view>.png (medium tier). iPad is NOT RUN here.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";
import { MAP_REGISTRY } from "../../packages/shared/src/config/maps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const docs = path.join(root, "docs/test-results");
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const TIERS = ["low", "medium", "high"] as const;
const VIEWS: Readonly<Record<string, readonly string[]>> = { coast: ["overview", "sea", "shore", "north"], frost: ["overview", "sea", "shore", "north"] };

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface Art { frames(): number; info(): { calls: number; triangles: number }; envState(): string; quality(q: string): void; hide(prefix: string): void }
let server: Dev, browser: Browser, base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  mkdirSync(docs, { recursive: true });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

for (const id of Object.keys(MAP_REGISTRY).filter((m) => m !== "grove")) {
  test(`${id}: renders on every tier without console errors, within the triangle budget`, async () => {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    const errors: string[] = [], budget: Record<string, { calls: number; triangles: number }> = {};
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    try {
      for (const view of VIEWS[id] ?? ["overview"]) {
        await page.goto(`${base}/art.html?map=${id}&view=${view}`);
        await page.waitForFunction(() => { const a = (window as unknown as { __art: Art }).__art; return a?.envState() === "ready" && a.frames() > 5; });
        for (const q of TIERS) {
          await page.evaluate((t) => (window as unknown as { __art: Art }).__art.quality(t), q);
          await page.waitForTimeout(300);
          const info = await page.evaluate(() => (window as unknown as { __art: Art }).__art.info());
          budget[`${view}-${q}`] = info;
          expect(info.triangles, `${id} ${view} ${q}`).toBeLessThanOrEqual(q === "high" ? 520000 : 300000);
          expect(info.triangles).toBeGreaterThan(1000);
          if (q === "medium") await page.screenshot({ path: path.join(docs, `WORLD-${id}-${view}.png`) });
        }
      }
      writeFileSync(path.join(docs, `WORLD-${id}-budget.json`), JSON.stringify(budget, null, 1) + "\n"); // SwiftShader (CPU) render info, not device timings
      expect(errors.filter((e) => !/GPU stall|ReadPixels|PCFSoftShadowMap/i.test(e))).toEqual([]);
    } finally { await page.close(); }
  });
}
