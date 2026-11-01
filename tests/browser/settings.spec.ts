import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// T27 layout editor and settings, real Chromium, real SettingsPanel/SettingsStore/Hud (localStorage), D06 simulated.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = process.env["EB_CHROMIUM"] ?? "/opt/pw-browsers/chromium";

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
let server: Dev;
let browser: Browser;
let base = "";
const evidence: Record<string, unknown> = {};

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({
    root: path.join(here, "harness"), configFile: false,
    server: { port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error",
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: CHROMIUM });
});
test.afterAll(async () => {
  await browser?.close();
  await server?.close();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "T27-playwright.json"), JSON.stringify(evidence, null, 2) + "\n");
});

const centre = async (page: Page, sel: string): Promise<{ x: number; y: number }> => {
  const b = (await page.locator(sel).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const hudCentre = (page: Page, id: string) => centre(page, `.eb-hud [data-control="${id}"]`);
const editCentre = (page: Page, id: string) => centre(page, `[data-edit-control="${id}"]`);
const stored = (page: Page) => page.evaluate(() => JSON.parse(window.localStorage.getItem("eb.settings.v1.Arel") ?? "null"));

async function fresh(W = 1024, H = 768): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: false });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  (page as unknown as { errors: string[] }).errors = errors;
  await page.goto(base + "settings.html");
  await page.waitForFunction(() => (window as unknown as { __t27?: unknown }).__t27 !== undefined);
  return page;
}
const openEditor = async (page: Page): Promise<void> => {
  await page.click("#open");
  await page.click('button[data-act="edit"]');
  await expect(page.locator('[data-ui="layout-editor"]')).toBeVisible();
};
const drag = async (page: Page, id: string, to: { x: number; y: number }): Promise<void> => {
  const from = await editCentre(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
};

test("D06 simulated: drag, save, reload, reset restores the fixture", async () => {
  const page = await fresh();
  // Default fixture before any edit.
  const a0 = await hudCentre(page, "attack");
  expect(Math.abs(a0.x - 932)).toBeLessThan(1);
  expect(Math.abs(a0.y - 578)).toBeLessThan(1);

  await openEditor(page);
  await drag(page, "facing", { x: 512, y: 230 });
  const s1 = await stored(page);
  expect(s1.layouts.wide.controls.facing.nx).toBeCloseTo(0.5, 1);
  expect(s1.layouts.wide.controls.facing.ny).toBeCloseTo(230 / 768, 1);
  expect(s1.layouts.compact.controls).toEqual({});

  // Size slider on the selected control, opacity slider.
  await page.locator('input[data-edit="size"]').fill("1.2");
  await page.locator('input[data-edit="opacity"]').fill("0.5");
  const s2 = await stored(page);
  expect(s2.layouts.wide.controls.facing.size).toBeCloseTo(1.2, 2);
  expect(s2.layouts.wide.opacity).toBeCloseTo(0.5, 2);
  await page.screenshot({ path: path.join(outDir, "T27-editor.png") });
  await page.click('button[data-act="edit-done"]');
  await page.click('button[data-act="close"]');

  const moved = await hudCentre(page, "facing");
  expect(Math.abs(moved.x - 512)).toBeLessThan(2);

  // Reload: same normalized position from storage.
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __t27?: unknown }).__t27 !== undefined);
  const after = await hudCentre(page, "facing");
  expect(Math.abs(after.x - moved.x)).toBeLessThan(1);
  expect(Math.abs(after.y - moved.y)).toBeLessThan(1);
  expect(Number(await page.locator('.eb-hud [data-control="facing"]').evaluate((e) => getComputedStyle(e).opacity))).toBeCloseTo(0.5, 2);

  // Reset layout restores the section 7 fixture.
  await openEditor(page);
  await page.click('button[data-act="reset-layout"]');
  await page.click('button[data-act="edit-done"]');
  await page.click('button[data-act="close"]');
  const f = await hudCentre(page, "facing");
  expect(Math.abs(f.x - (1024 - 78))).toBeLessThan(1);
  expect(Math.abs(f.y - (768 - 286))).toBeLessThan(1);
  const s3 = await stored(page);
  expect(s3.layouts.wide.controls).toEqual({});
  evidence["d06Simulated"] = { savedNx: s1.layouts.wide.controls.facing.nx, reloadStable: true, resetRestoresFixture: true };
  expect((page as unknown as { errors: string[] }).errors).toEqual([]);
  await page.context().close();
});

test("invalid overlap and off-screen drops are rejected and the button goes back", async () => {
  const page = await fresh();
  await openEditor(page);
  const jump0 = await editCentre(page, "jump");
  const attack = await editCentre(page, "attack");
  await drag(page, "jump", attack);
  await expect(page.locator('[data-ui="settings-message"]')).toContainText("overlaps another button");
  const jump1 = await editCentre(page, "jump");
  expect(Math.abs(jump1.x - jump0.x)).toBeLessThan(1);
  expect(Math.abs(jump1.y - jump0.y)).toBeLessThan(1);
  expect((await stored(page))?.layouts.wide.controls ?? {}).toEqual({});

  // Off the right edge of the safe rectangle.
  await drag(page, "attack", { x: 1020, y: 400 });
  await expect(page.locator('[data-ui="settings-message"]')).toContainText("leaves the screen");
  expect((await stored(page))?.layouts.wide.controls ?? {}).toEqual({});
  evidence["rejections"] = { overlap: true, offScreen: true };
  await page.context().close();
});

test("a stored layout that does not fit the viewport falls back to defaults", async () => {
  const page = await fresh();
  await page.evaluate(() => {
    const s = JSON.parse(JSON.stringify({
      v: 1, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: "right",
      effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: false, flashLevel: 0.3,
      layouts: { wide: { opacity: 0.9, controls: { jump: { nx: 0.9102, ny: 0.7526, size: 1 } } }, compact: { opacity: 0.9, controls: {} } },
    }));
    window.localStorage.setItem("eb.settings.v1.Arel", JSON.stringify(s));
  });
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __t27?: unknown }).__t27 !== undefined);
  expect(await page.evaluate(() => (window as unknown as { __fellBack: boolean }).__fellBack)).toBe(true);
  const j = await hudCentre(page, "jump");
  expect(Math.abs(j.x - 948)).toBeLessThan(1);
  // Rotation to a compact viewport re-validates; portrait-ish small viewports never leave an unsafe layout.
  await page.setViewportSize({ width: 800, height: 600 });
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(600);
  await page.waitForTimeout(100);
  const boxes = await page.$$eval(".eb-hud [data-control]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
  for (const [l, t, r, b] of boxes as number[][]) { expect(l).toBeGreaterThanOrEqual(-0.5); expect(t).toBeGreaterThanOrEqual(-0.5); expect(r).toBeLessThanOrEqual(800.5); expect(b).toBeLessThanOrEqual(600.5); }
  evidence["fallback"] = { fellBack: true };
  await page.context().close();
});

test("left hand mirror, toggles, import and export validation", async () => {
  const page = await fresh();
  await page.click("#open");
  await expect(page.locator('[data-ui="settings"]')).toContainText("The arena continues while this menu is open.");
  await page.click('button[data-toggle="hand"]');
  await page.click('button[data-act="close"]');
  const a = await hudCentre(page, "attack");
  expect(Math.abs(a.x - (1024 - 932))).toBeLessThan(1);
  const j = await hudCentre(page, "joystick");
  expect(Math.abs(j.x - (1024 - 104))).toBeLessThan(1);
  expect((await stored(page)).handedness).toBe("left");

  await page.click("#open");
  await page.click('button[data-toggle="reducedMotion"]');
  await page.locator('input[data-k="cameraDistance"]').fill("9");
  const s = await stored(page);
  expect(s.reducedMotion).toBe(true);
  expect(s.cameraDistance).toBe(9);

  // Export, then bad imports.
  await page.click('button[data-act="export"]');
  const text = await page.locator('[data-ui="settings-json"]').inputValue();
  expect(JSON.parse(text).v).toBe(1);
  const io = page.locator('[data-ui="settings-json"]');
  await io.fill(JSON.stringify({ ...JSON.parse(text), invite: "abcdefgh" }));
  await page.click('button[data-act="import"]');
  await expect(page.locator('[data-ui="settings-message"]')).toContainText("not valid");
  await io.fill(" ".repeat(9000));
  await page.click('button[data-act="import"]');
  await expect(page.locator('[data-ui="settings-message"]')).toContainText("8 KB");
  await io.fill(JSON.stringify({ ...JSON.parse(text), musicVolume: 0.1 }));
  await page.click('button[data-act="import"]');
  await expect(page.locator('[data-ui="settings-message"]')).toContainText("imported");
  expect((await stored(page)).musicVolume).toBe(0.1);
  await page.click('button[data-act="reset-all"]');
  expect((await stored(page)).handedness).toBe("right");
  evidence["importExport"] = { unknownKeyRejected: true, oversizeRejected: true, validAccepted: true };
  await page.context().close();
});

test("open releases inputs through the hook, and dispose removes every listener and element", async () => {
  const page = await fresh();
  const before = await page.evaluate(() => (window as unknown as { __t27: { liveListeners(): Record<string, number> } }).__t27.liveListeners());
  expect(Object.values(before).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  await page.click("#open");
  expect(await page.evaluate(() => (window as unknown as { __t27: { counts(): unknown } }).__t27.counts())).toEqual({ opened: 1, closed: 0 });
  await page.click('button[data-act="close"]');
  expect(await page.evaluate(() => (window as unknown as { __t27: { counts(): unknown } }).__t27.counts())).toEqual({ opened: 1, closed: 1 });
  await page.click("#open");
  await page.click('button[data-act="edit"]');
  const after = await page.evaluate(() => {
    const t = (window as unknown as { __t27: { dispose(): void; liveListeners(): Record<string, number>; panelPresent(): boolean } }).__t27;
    t.dispose();
    return { live: t.liveListeners(), present: t.panelPresent() };
  });
  expect(after.live).toEqual({});
  expect(after.present).toBe(false);
  evidence["cleanup"] = { listenersBeforeDispose: before, listenersAfterDispose: after.live, elementsRemoved: true };
  await page.context().close();
});
