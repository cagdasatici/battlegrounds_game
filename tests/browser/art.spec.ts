// T25 visual checks: the real GameScene over the islands map with all three fighters, in real Chromium (SwiftShader WebGL).
// Screenshot name comes from EB_ART_SHOT (default T25-after.png) so the same spec captures the before and after images.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface ArtApi { frames(): number; info(): { calls: number; triangles: number }; act(kit: string, action: string, moveId: string): void; clip(kit: string): string; quality(q: string): void }
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

test("arena and three fighters render without errors and stay inside the draw budget", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The only expected console error is the favicon 404.
  page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text()); });
  try {
    await page.goto(`${base}/art.html${process.env["EB_ART_VIEW"] ? `?view=${process.env["EB_ART_VIEW"]}` : ""}`);
    await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 30, undefined, { timeout: 30_000 });
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, process.env["EB_ART_SHOT"] ?? "T25-after.png") });
    const info = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.info());
    // Software (SwiftShader) frame rate per quality: not a device measurement, only a relative CPU cost signal.
    const fps: Record<string, number> = {};
    for (const q of ["medium", "low"]) {
      await page.evaluate((v) => (window as unknown as { __art: ArtApi }).__art.quality(v), q);
      const f0 = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.frames());
      await page.waitForTimeout(2000);
      const f1 = await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.frames());
      fps[q] = (f1 - f0) / 2;
    }
    writeFileSync(path.join(outDir, "T25-render-info.json"), JSON.stringify({ ...info, swiftShaderFps1180x820: fps }, null, 2) + "\n");
    expect(info.calls).toBeLessThanOrEqual(120);
    expect(info.triangles).toBeLessThanOrEqual(300_000);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("fighters play move, guard and ability clips in a real render, and low quality still renders", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  try {
    await page.goto(`${base}/art.html`);
    await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 10, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      const a = (window as unknown as { __art: ArtApi }).__art;
      a.act("sv", "Active", "sv.a2"); a.act("td", "Guard", ""); a.act("ea", "Windup", "ea.a3");
    });
    await page.waitForTimeout(450);
    const clips = await page.evaluate(() => { const a = (window as unknown as { __art: ArtApi }).__art; return [a.clip("sv"), a.clip("td"), a.clip("ea")]; });
    expect(clips).toEqual(["sv.a2", "guard", "ea.a3"]);
    await page.screenshot({ path: path.join(outDir, "T25-after-poses.png") });
    await page.evaluate(() => (window as unknown as { __art: ArtApi }).__art.quality("low"));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, "T25-after-low.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// QF01 evidence: same-scale grayscale rear poses at 8 m and 14 m (low and medium, base and awakened), plus Stone Vanguard
// guard / windup / contact / recovery with no combat text. Harness-commanded tiers; clip times are wall-clock approximations.
test("QF01 Stone Vanguard rear silhouette and Fault Strike phases", async () => {
  const outQ = path.join(outDir, "QF01");
  mkdirSync(outQ, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const act = (kit: string, action: string, moveId: string) => page.evaluate(([k, a, m]) => (window as unknown as { __art: ArtApi }).__art.act(k as string, a as string, m as string), [kit, action, moveId]);
  const clipOf = (kit: string) => page.evaluate((k) => (window as unknown as { __art: ArtApi }).__art.clip(k), kit);
  try {
    for (const dist of [8, 14]) {
      await page.goto(`${base}/art.html?view=rear&dist=${dist}`);
      await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
      await page.addStyleTag({ content: "canvas{filter:grayscale(1)}" });
      for (const q of ["medium", "low"]) {
        for (const awakened of [false, true]) {
          await page.evaluate(([qq, on]) => { const a = (window as unknown as { __art: ArtApi & { awaken(k: string, v: boolean): void } }).__art; a.quality(qq as string); a.awaken("sv", on as boolean); }, [q, awakened]);
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(outQ, `rear-${dist}m-${q}${awakened ? "-awakened" : ""}.png`) });
        }
      }
    }
    await page.goto(`${base}/art.html`);
    await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
    await page.addStyleTag({ content: "canvas{filter:grayscale(1)}" });
    await act("sv", "Guard", "");
    await page.waitForTimeout(500);
    expect(await clipOf("sv")).toBe("guard");
    await page.screenshot({ path: path.join(outQ, "sv-guard.png") });
    // Fault Strike is retimed to 30 ticks (0.5 s): shift ~0.08 s, windup ~0.17 s, contact ~0.24 s, recovery to 0.5 s.
    await act("sv", "Windup", "sv.b1");
    await page.waitForTimeout(100);
    expect(await clipOf("sv")).toBe("sv.b1");
    await page.screenshot({ path: path.join(outQ, "sv-b1-windup.png") });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outQ, "sv-b1-contact.png") });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(outQ, "sv-b1-recovery.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// QF02 evidence: grayscale front / side / rear of all three kits at the same scale (8 m and 14 m, low and medium, Duelist base and
// awakened), plus Tide Duelist guard / shoulder lead / windup / contact / recovery with no combat text. Wall-clock approximations.
test("QF02 Tide Duelist silhouette and Undertow Spiral phases", async () => {
  const outQ = path.join(outDir, "QF02");
  mkdirSync(outQ, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  type A = ArtApi & { awaken(k: string, v: boolean): void };
  const act = (kit: string, action: string, moveId: string) => page.evaluate(([k, a, m]) => (window as unknown as { __art: ArtApi }).__art.act(k as string, a as string, m as string), [kit, action, moveId]);
  const clipOf = (kit: string) => page.evaluate((k) => (window as unknown as { __art: ArtApi }).__art.clip(k), kit);
  const ready = async (url: string) => {
    await page.goto(url);
    await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
    await page.addStyleTag({ content: "canvas{filter:grayscale(1)}" });
  };
  try {
    for (const view of ["rear", "side"]) for (const dist of [8, 14]) {
      await ready(`${base}/art.html?view=${view}&dist=${dist}`);
      for (const q of ["medium", "low"]) for (const awakened of [false, true]) {
        await page.evaluate(([qq, on]) => { const a = (window as unknown as { __art: A }).__art; a.quality(qq as string); a.awaken("td", on as boolean); }, [q, awakened]);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outQ, `${view}-${dist}m-${q}${awakened ? "-awakened" : ""}.png`) });
      }
    }
    await ready(`${base}/art.html`);
    await page.screenshot({ path: path.join(outQ, "front-idle.png") });
    await act("td", "Guard", "");
    await page.waitForTimeout(500);
    expect(await clipOf("td")).toBe("guard");
    await page.screenshot({ path: path.join(outQ, "td-guard.png") });
    // Undertow Spiral is retimed to its authoritative length; shoulder lead ~0.1 s, windup ~0.25 s, contact ~0.35 s, then recovery.
    await act("td", "Windup", "td.b2");
    await page.waitForTimeout(60);
    expect(await clipOf("td")).toBe("td.b2");
    await page.screenshot({ path: path.join(outQ, "td-b2-lead.png") });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(outQ, "td-b2-windup.png") });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outQ, "td-b2-contact.png") });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outQ, "td-b2-recovery.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

// QF03 evidence: grayscale front / side / rear of all three kits at the same scale (8 m and 14 m, low and medium, Artificer base and
// awakened), plus Ember Artificer guard / shoulder lead / windup / contact / recovery with no combat text. Wall-clock approximations.
test("QF03 Ember Artificer silhouette and Furnace Ray phases", async () => {
  const outQ = path.join(outDir, "QF03");
  mkdirSync(outQ, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  type A = ArtApi & { awaken(k: string, v: boolean): void };
  const act = (kit: string, action: string, moveId: string) => page.evaluate(([k, a, m]) => (window as unknown as { __art: ArtApi }).__art.act(k as string, a as string, m as string), [kit, action, moveId]);
  const clipOf = (kit: string) => page.evaluate((k) => (window as unknown as { __art: ArtApi }).__art.clip(k), kit);
  const ready = async (url: string) => {
    await page.goto(url);
    await page.waitForFunction(() => ((window as unknown as { __art?: ArtApi }).__art?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
    await page.addStyleTag({ content: "canvas{filter:grayscale(1)}" });
  };
  try {
    for (const view of ["rear", "side"]) for (const dist of [8, 14]) {
      await ready(`${base}/art.html?view=${view}&dist=${dist}`);
      for (const q of ["medium", "low"]) for (const awakened of [false, true]) {
        await page.evaluate(([qq, on]) => { const a = (window as unknown as { __art: A }).__art; a.quality(qq as string); a.awaken("ea", on as boolean); }, [q, awakened]);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(outQ, `${view}-${dist}m-${q}${awakened ? "-awakened" : ""}.png`) });
      }
    }
    await ready(`${base}/art.html`);
    await page.screenshot({ path: path.join(outQ, "front-idle.png") });
    // Complete anonymous lineup for QD01: all three fighters side by side, no labels, base then awakened.
    for (const k of ["sv", "td", "ea"]) await page.evaluate(([kk]) => (window as unknown as { __art: A }).__art.awaken(kk as string, true), [k]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outQ, "lineup-awakened.png") });
    for (const k of ["sv", "td", "ea"]) await page.evaluate(([kk]) => (window as unknown as { __art: A }).__art.awaken(kk as string, false), [k]);
    await act("ea", "Guard", "");
    await page.waitForTimeout(500);
    expect(await clipOf("ea")).toBe("guard");
    await page.screenshot({ path: path.join(outQ, "ea-guard.png") });
    // Furnace Ray is retimed to its authoritative length; vent-open key ~0.1 s, windup ~0.25 s, contact ~0.35 s, then recovery.
    await act("ea", "Windup", "ea.a3");
    await page.waitForTimeout(60);
    expect(await clipOf("ea")).toBe("ea.a3");
    await page.screenshot({ path: path.join(outQ, "ea-a3-lead.png") });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(outQ, "ea-a3-windup.png") });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outQ, "ea-a3-contact.png") });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outQ, "ea-a3-recovery.png") });
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});
