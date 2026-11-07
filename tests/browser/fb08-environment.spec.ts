// FB08 environment visual quality: real GameScene over the islands map in Chromium (SwiftShader WebGL).
// FB08_TAG=before|after|final names transient captures in test-results/fb08/; "final" also writes docs/test-results/FB08-*.png.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const out = path.join(root, "test-results/fb08");
const docs = path.join(root, "docs/test-results");
const TAG = process.env["FB08_TAG"] ?? "after";
const VARIANT = process.env["FB08_VARIANT"] ?? "";
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const SIZES = [[1024, 768], [1180, 820]] as const;
const TIERS = ["low", "medium", "high"] as const;

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface Art {
  frames(): number; info(): { calls: number; triangles: number }; envState(): string; quality(q: string): void;
  reduced(on: boolean): void; ambient(): { visible: boolean; sample: number[] };
}
let server: Dev, browser: Browser, base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root: path.join(here, "harness"), configFile: false, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error" });
  mkdirSync(out, { recursive: true });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: resolveChromium(), args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

test("FB08 arena loads without console errors; draw calls and triangles per tier stay within budget", async () => {
  const results: Record<string, { calls: number; triangles: number }> = {};
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    try {
      for (const view of ["overview", "spawn"]) {
        await page.goto(`${base}/art.html?view=${view}&i=0&n=east${VARIANT}`);
        await page.waitForFunction(() => { const a = (window as unknown as { __art: Art }).__art; return a?.envState() === "ready" && a.frames() > 5; });
        for (const q of TIERS) {
          await page.evaluate((t) => (window as unknown as { __art: Art }).__art.quality(t), q);
          await page.waitForTimeout(250);
          const info = await page.evaluate(() => (window as unknown as { __art: Art }).__art.info());
          results[`${view}-${q}-${w}x${h}`] = info;
          // GFX01: low and medium keep the 300k budget; the high tier now buys a denser meadow and forest, so it gets a higher ceiling.
          expect(info.triangles).toBeLessThanOrEqual(q === "high" ? 520000 : 300000);
          await page.screenshot({ path: path.join(out, `${TAG}${VARIANT ? "-" + VARIANT.replace(/\W/g, "") : ""}-${view}-${q}-${w}x${h}.png`) });
          if (TAG === "final" && q === "medium" && view === "overview") await page.screenshot({ path: path.join(docs, `FB08-${w}x${h}.png`) });
        }
      }
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  }
  writeFileSync(path.join(out, `${TAG}.json`), JSON.stringify(results, null, 1));
  const basePath = process.env["FB08_BEFORE"] ?? path.join(out, "before.json");
  if (TAG !== "before" && existsSync(basePath)) {
    const before = JSON.parse(readFileSync(basePath, "utf8")) as typeof results;
    for (const [k, v] of Object.entries(results)) {
      const b = before[k]!;
      const allowed = k.includes("-low-") ? 0 : 15;
      expect(v.calls, k).toBeLessThanOrEqual(b.calls + allowed);
    }
  }
});

test("FB08 ambient motes bob on medium, and are off for reduced motion and the low tier", async () => {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${base}/art.html?view=overview`);
    await page.waitForFunction(() => (window as unknown as { __art: Art }).__art?.envState() === "ready");
    const get = (): Promise<{ visible: boolean; sample: number[] }> => page.evaluate(() => (window as unknown as { __art: Art }).__art.ambient());
    await page.evaluate(() => (window as unknown as { __art: Art }).__art.quality("medium"));
    await page.evaluate(() => (window as unknown as { __art: Art }).__art.reduced(false));
    const a = await get(); await page.waitForTimeout(600); const b = await get();
    expect(b.visible).toBe(true);
    expect(b.sample).not.toEqual(a.sample);
    await page.evaluate(() => (window as unknown as { __art: Art }).__art.reduced(true));
    await page.waitForTimeout(100);
    const c = await get(); await page.waitForTimeout(600); const d = await get();
    expect(d.sample).toEqual(c.sample);
    await page.evaluate(() => { const a = (window as unknown as { __art: Art }).__art; a.reduced(false); a.quality("low"); });
    expect((await get()).visible).toBe(false);
  } finally { await page.close(); }
});
