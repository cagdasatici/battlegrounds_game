// ART1 visual and budget checks: the real GameScene over the islands map in real Chromium (SwiftShader WebGL).
// EB_ART_TAG selects the screenshot prefix ("before" or "after"); the budget is read from renderer.info after load.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = evidenceDir(root);
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const TAG = process.env["EB_CHARACTER_TAG"] ?? "after";

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



for (const view of ["front", "side", "rear"]) {
  test(`UX06 fighter ${view}: idle, guard and contact on low and medium`, async () => {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    try {
      await page.goto(`${base}/art.html?view=${view}&dist=4`);
      await page.waitForFunction(() => (window as unknown as { __art: ArtApi }).__art?.envState() === "ready");
      for (const quality of ["medium", "low"]) for (const action of ["Idle", "Guard", "Active"]) {
        await page.evaluate(({ q, action }) => {
          const a = (window as unknown as { __art: { quality(q: string): void; act(k: string, a: string, m?: string): void } }).__art;
          a.quality(q); for (const k of ["sv", "td", "ea"]) a.act(k, action, action === "Active" ? "m1.1" : "");
        }, { q: quality, action });
        await page.waitForTimeout(250);
        const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
        expect(info.calls).toBeLessThanOrEqual(120); expect(info.triangles).toBeLessThanOrEqual(300000);
        await page.screenshot({ path: path.join(outDir, `UX06-${TAG}-${view}-${quality}-${action}.png`) });
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
