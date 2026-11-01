// ART1 visual and budget checks: the real GameScene over the islands map in real Chromium (SwiftShader WebGL).
// EB_ART_TAG selects the screenshot prefix ("before" or "after"); the budget is read from renderer.info after load.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = process.env["EB_CHROMIUM"] ?? "/opt/pw-browsers/chromium";
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const TAG = process.env["EB_ART_TAG"] ?? "after";

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface ArtApi { frames(): number; info(): { calls: number; triangles: number }; envState(): string }
let server: Dev;
let browser: Browser;
let base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

for (const [w, h] of [[1024, 768], [1180, 820]] as const) {
  test(`arena overview ${w}x${h} stays inside the medium budget`, async () => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
    try {
      await page.goto(`${base}/art.html?view=overview`);
      await page.waitForFunction(() => { const a = (window as unknown as { __art?: ArtApi }).__art; return !!a && a.frames() > 30 && a.envState() !== "loading"; }, undefined, { timeout: 60_000 });
      await page.waitForTimeout(500);
      mkdirSync(outDir, { recursive: true });
      await page.screenshot({ path: path.join(outDir, `ART1-${TAG}-${w}x${h}.png`) });
      const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
      const env = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.envState());
      writeFileSync(path.join(outDir, `ART1-${TAG}-${w}x${h}.json`), JSON.stringify({ ...info, env }, null, 2) + "\n");
      expect(info.calls).toBeLessThanOrEqual(120);
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      if (TAG === "after") expect(env).toBe("ready");
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
