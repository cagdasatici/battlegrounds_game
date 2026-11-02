// ART1 visual and budget checks: the real GameScene over the islands map in real Chromium (SwiftShader WebGL).
// EB_ART_TAG selects the screenshot prefix ("before" or "after"); the budget is read from renderer.info after load.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const TAG = process.env["EB_POLISH_TAG"] ?? "after";

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface ArtApi { frames(): number; info(): { calls: number; triangles: number }; envState(): string }
let server: Dev;
let browser: Browser;
let base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });


for (const view of ["overview", "spawn", "bridge", "front"]) {
  test(`UX05 environment ${view}, both quality tiers fit rendering budgets`, async () => {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    try {
      await page.goto(`${base}/art.html?view=${view}&i=0&n=east`);
      await page.waitForFunction(() => { const a = (window as unknown as { __art: ArtApi }).__art; return a?.envState() === "ready" && a.frames() > 5; });
      for (const quality of ["medium", "low"]) {
        await page.evaluate(q => (window as unknown as { __art: { quality(q: string): void } }).__art.quality(q), quality);
        await page.waitForTimeout(150);
        const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
        expect(info.calls).toBeLessThanOrEqual(120); expect(info.triangles).toBeLessThanOrEqual(300000);
        await page.screenshot({ path: path.join(outDir, `UX05-${TAG}-${view}-${quality}.png`) });
        writeFileSync(path.join(outDir, `UX05-${TAG}-${view}-${quality}.json`), JSON.stringify(info));
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}

test("UX08 four fighters in the dense east satellite view stay inside the render budget", async () => {
  const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
  try {
    await page.goto(`${base}/art.html?view=sat&n=east`);
    await page.waitForFunction(() => (window as unknown as { __art: ArtApi }).__art?.envState() === "ready");
    await page.evaluate(() => (window as unknown as { __art: { fourth(): void } }).__art.fourth());
    for (const quality of ["medium", "low"]) {
      await page.evaluate(q => (window as unknown as { __art: { quality(q: string): void } }).__art.quality(q), quality);
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
      const breakdown = await page.evaluate(() => (window as unknown as { __art: { breakdown(): unknown } }).__art.breakdown());
      writeFileSync(path.join(outDir, `UX08-four-fighters-${quality}.json`), JSON.stringify({ ...info, breakdown }));
      await page.screenshot({ path: path.join(outDir, `UX08-four-fighters-${quality}.png`) });
      expect(info.calls).toBeLessThanOrEqual(120); expect(info.triangles).toBeLessThanOrEqual(300000);
    }
  } finally { await page.close(); }
});
