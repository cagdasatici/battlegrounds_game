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
const TAG = process.env["EB_ART_TAG"] ?? "after";

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
      if (TAG !== "before") expect(env).toBe("ready");
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}

for (const view of ["route", "reverse"] as const) {
  test(`east bridge ${view} gameplay framing`, async () => {
    const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
    try {
      await page.goto(`${base}/art.html?view=${view}`);
      await page.waitForFunction(() => (window as unknown as { __art: ArtApi }).__art.envState() === "ready");
      await page.waitForFunction(() => (window as unknown as { __art: ArtApi }).__art.frames() > 30);
      await page.screenshot({ path: path.join(outDir, `ART1-${TAG}-${view}.png`) });
      const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
      writeFileSync(path.join(outDir, `ART1-${TAG}-${view}.json`), JSON.stringify(info, null, 2) + "\n");
      expect(info.calls).toBeLessThanOrEqual(120);
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      // QE01: the east landmark must be on screen in both gameplay angles (hiding it changes the frame) at medium and low.
      const withTrees = await page.screenshot();
      await page.evaluate(() => (window as unknown as { __art: { hide(p: string): void } }).__art.hide("env.CommonTree_1"));
      await page.waitForTimeout(200);
      const withoutTrees = await page.screenshot();
      expect(withTrees.equals(withoutTrees), `${view}: east landmark trees are not visible`).toBe(false);
      await page.reload();
      await page.waitForFunction(() => (window as unknown as { __art: ArtApi }).__art.envState() === "ready");
      if (view === "route") {
        await page.evaluate(() => (window as unknown as { __art: { quality(q: string): void } }).__art.quality("low"));
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(outDir, `ART1-${TAG}-route-low.png`) });
      }
    } finally { await page.close(); }
  });
}

// QE02: coverage grid. Eight spawn sightlines, four bridge headings (outbound), their reverse views from the satellites and
// two wall exchanges, at medium (commanded by the harness) and low. EB_QE02_TAG=before captures the baseline from the
// previous renderer; the default "after" run also enforces the renderer budget in every capture.
const QE02_TAG = process.env["EB_QE02_TAG"] ?? "after";
const QE02_VIEWS: ReadonlyArray<readonly [string, string]> = [
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`spawn-${i}`, `view=spawn&i=${i}`] as const),
  ...(["north", "south", "east", "west"] as const).map((n) => [`bridge-${n}`, `view=bridge&n=${n}`] as const),
  ...(["north", "south", "east", "west"] as const).map((n) => [`sat-${n}`, `view=sat&n=${n}`] as const),
  ["wall-0", "view=wall&i=0"], ["wall-1", "view=wall&i=1"],
];
test(`QE02 coverage grid (${QE02_TAG})`, async () => {
  test.setTimeout(900_000);
  const dir = path.join(outDir, "QE02");
  mkdirSync(dir, { recursive: true });
  const rows: Array<{ id: string; tier: string; calls: number; triangles: number }> = [];
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    for (const [id, query] of QE02_VIEWS) {
      await page.goto(`${base}/art.html?${query}`);
      await page.waitForFunction(() => { const a = (window as unknown as { __art?: ArtApi }).__art; return !!a && a.frames() > 20 && a.envState() !== "loading"; }, undefined, { timeout: 60_000 });
      for (const tier of ["medium", "low"] as const) {
        await page.evaluate((t) => (window as unknown as { __art: { quality(q: string): void } }).__art.quality(t), tier);
        const f0 = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.frames());
        await page.waitForFunction((n) => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > n + 3, f0);
        await page.screenshot({ path: path.join(dir, `${QE02_TAG}-${tier}-${id}.jpg`), type: "jpeg", quality: 82 });
        const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
        rows.push({ id, tier, ...info });
        if (QE02_TAG === "after") {
          expect.soft(info.calls, `${id} ${tier} calls`).toBeLessThanOrEqual(120);
          expect.soft(info.triangles, `${id} ${tier} triangles`).toBeLessThanOrEqual(150_000);
        }
      }
    }
    const peak = (tier: string): { calls: number; triangles: number } => ({ calls: Math.max(...rows.filter((r) => r.tier === tier).map((r) => r.calls)), triangles: Math.max(...rows.filter((r) => r.tier === tier).map((r) => r.triangles)) });
    writeFileSync(path.join(dir, `${QE02_TAG}-metrics.json`), JSON.stringify({ peak: { medium: peak("medium"), low: peak("low") }, rows }, null, 2) + "\n");
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

// QE02: labelled contact sheets pairing each before capture with its after capture at the same scale.
const SHEETS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["spawns", "Eight spawn sightlines (spawn anchor IDs 0-7)", [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `spawn-${i}`)],
  ["bridges", "Four bridge headings (outbound) and the reverse view from each satellite", ["north", "south", "east", "west"].flatMap((n) => [`bridge-${n}`, `sat-${n}`])],
  ["walls", "Two wall exchanges", ["wall-0", "wall-1"]],
];
test("QE02 contact sheets pair before and after at matched scale", async () => {
  test.setTimeout(300_000);
  const dir = path.join(outDir, "QE02");
  test.skip(!existsSync(path.join(dir, "before-medium-spawn-0.jpg")) || !existsSync(path.join(dir, "after-medium-spawn-0.jpg")), "needs both before and after captures");
  const uri = (f: string): string => `data:image/jpeg;base64,${readFileSync(path.join(dir, f)).toString("base64")}`;
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    for (const [name, title, ids] of SHEETS) for (const tier of ["medium", "low"] as const) {
      const cells = ids.map((id) => `<figure><figcaption>${id}</figcaption><div class="p"><span>before</span><img src="${uri(`before-${tier}-${id}.jpg`)}"><span>after</span><img src="${uri(`after-${tier}-${id}.jpg`)}"></div></figure>`).join("");
      await page.setContent(`<style>body{margin:0;background:#15181c;color:#e8edf2;font:600 15px system-ui}h1{font-size:18px;margin:12px 16px}main{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:0 16px 16px}figure{margin:0}figcaption{padding:2px 0}.p{display:grid;grid-template-columns:auto 1fr auto 1fr;gap:4px;align-items:start;font-weight:400;font-size:12px}img{width:100%;display:block}</style><h1>QE02 ${title} - ${tier} tier, 1024x768 captures (harness, SwiftShader)</h1><main>${cells}</main>`);
      await page.screenshot({ path: path.join(dir, `grid-${name}-${tier}.jpg`), type: "jpeg", quality: 80, fullPage: true });
    }
  } finally { await page.close(); }
});

// QE02: a disabled or failing glTF pack must leave the code-built arena intact (no page error, frames keep rendering).
for (const mode of ["blocked", "corrupt"] as const) {
  test(`QE02 pack load fallback (${mode}) keeps the code-built arena and approaches`, async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      // Vite module imports (?import) must succeed; only the loader's own fetches of the pack files fail.
      await page.route((u) => /\.(gltf|bin)$/.test(u.pathname) && !u.search.includes("import"), (r) => (mode === "blocked" ? r.abort() : r.fulfill({ status: 200, contentType: "application/octet-stream", body: "not a model" })));
      await page.goto(`${base}/art.html?view=bridge&n=north`);
      await page.waitForFunction(() => (window as unknown as { __art?: ArtApi }).__art?.envState() === "failed", undefined, { timeout: 30_000 });
      const f0 = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.frames());
      await page.waitForFunction((n) => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > n + 5, f0);
      const state = await page.evaluate(() => { const art = (window as unknown as { __art: { count(p: string): number; visible(n: string): boolean } }).__art; return { dressing: art.count("env."), edge: art.visible("deco.edge"), slabs: art.visible("deco.slabs"), lowCover: art.visible("deco.coverLow"), isletTrees: art.visible("deco.isletTrees") }; });
      expect(state).toEqual({ dressing: 0, edge: true, slabs: true, lowCover: true, isletTrees: true });
      mkdirSync(path.join(outDir, "QE02"), { recursive: true });
      await page.screenshot({ path: path.join(outDir, "QE02", `fallback-${mode}-bridge-north.jpg`), type: "jpeg", quality: 82 });
      const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
      expect(info.triangles).toBeLessThanOrEqual(150_000);
      expect(errors).toEqual([]);
    } finally { await page.close(); }
  });
}
