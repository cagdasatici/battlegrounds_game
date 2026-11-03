import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = evidenceDir(root);
const req = createRequire(path.join(root, "apps/client/package.json"));
import { resolveChromium } from "./harness/chromium-path.js";
import { evidenceDir } from "./harness/evidence.js";
const CHROMIUM = resolveChromium();

interface Box { id: string; cx: number; cy: number; w: number; h: number }
interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
let server: Dev;
let browser: Browser;
let base = "";

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({
    root: path.join(here, "harness"),
    configFile: false,
    server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } },
    logLevel: "error",
  });
  await server.listen();
  base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: CHROMIUM });
});
test.afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const FIXTURE_1024: Record<string, [number, number]> = {
  attack: [932, 578], jump: [948, 688], dash: [844, 658], block: [842, 563],
  skill1: [377, 704], skill2: [467, 704], skill3: [557, 704], skill4: [647, 704],
};
const ROUND = new Set(["attack", "jump", "dash", "block", "facing"]);

for (const [W, H] of [[1024, 768], [1180, 820]] as const) {
  test(`T07 layout at ${W}x${H}`, async () => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
    await page.goto(base);
    await page.waitForFunction(() => (window as unknown as { __layout?: unknown }).__layout !== undefined);
    const boxes: Box[] = await page.$$eval("[data-control]", (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { id: (e as HTMLElement).dataset["control"]!, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height };
      }));
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const info = await page.evaluate(() => (window as unknown as { __layout: { issues: unknown[] } }).__layout);
    expect(info.issues).toEqual([]);

    // Independent arithmetic from spec section 7 (s = min(W/1024,H/768) clamped 0.78..1.25).
    const s = Math.min(1.25, Math.max(0.78, Math.min(W / 1024, H / 768)));
    const expected: Record<string, [number, number]> = W === 1024 ? FIXTURE_1024 : {
      attack: [W - 92 * s, H - 190 * s], jump: [W - 76 * s, H - 80 * s],
      dash: [W - 180 * s, H - 110 * s], block: [W - 182 * s, H - 205 * s],
      skill1: [W / 2 - 1.5 * 90 * s, H - 64 * s], skill2: [W / 2 - 0.5 * 90 * s, H - 64 * s],
      skill3: [W / 2 + 0.5 * 90 * s, H - 64 * s], skill4: [W / 2 + 1.5 * 90 * s, H - 64 * s],
    };
    const measured: Record<string, unknown> = {};
    for (const [id, [ex, ey]] of Object.entries(expected)) {
      const b = byId.get(id)!;
      expect(Math.abs(b.cx - ex), `${id} x`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.cy - ey), `${id} y`).toBeLessThanOrEqual(1);
      measured[id] = { expected: [+ex.toFixed(2), +ey.toFixed(2)], measured: [+b.cx.toFixed(2), +b.cy.toFixed(2)] };
    }
    // Hit target is max(visual, 48) per spec section 7; check clearance of DOM-measured targets.
    const hit = boxes.filter((b) => b.id !== "health")
      .map((b) => ({ id: b.id, cx: b.cx, cy: b.cy, w: Math.max(b.w, 48), h: Math.max(b.h, 48) }));
    for (const h of hit) { expect(h.w, `${h.id} w`).toBeGreaterThanOrEqual(48); expect(h.h, `${h.id} h`).toBeGreaterThanOrEqual(48); }
    for (let i = 0; i < hit.length; i++) for (let j = i + 1; j < hit.length; j++) {
      const a = hit[i]!, c = hit[j]!;
      const gap = ROUND.has(a.id) && ROUND.has(c.id)
        ? Math.hypot(a.cx - c.cx, a.cy - c.cy) - a.w / 2 - c.w / 2
        : Math.max(Math.abs(a.cx - c.cx) - (a.w + c.w) / 2, Math.abs(a.cy - c.cy) - (a.h + c.h) / 2);
      expect(gap, `${a.id}/${c.id} no overlap`).toBeGreaterThanOrEqual(0);
    }
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `R13-layout-${W}x${H}.png`) });
    writeFileSync(path.join(outDir, `R13-layout-${W}x${H}.json`), JSON.stringify({
      viewport: { W, H }, s, browserVersion: browser.version(), measured,
      allBoxes: boxes.map((b) => ({ ...b, cx: +b.cx.toFixed(2), cy: +b.cy.toFixed(2), w: +b.w.toFixed(2), h: +b.h.toFixed(2) })),
    }, null, 2) + "\n");
    await page.close();
  });
}

// QU01: sparring and score actions are separate measured rectangles; skill buttons show names and readiness; Blocked shows on Guard.
for (const [W, H] of [[1024, 768], [1180, 820]] as const) {
  test(`QU01 sparring/score rectangles do not intersect any control at ${W}x${H}`, async () => {
    const page = await browser.newPage({ viewport: { width: W, height: H }, hasTouch: true });
    await page.goto(`${base}?qu01=1`);
    await page.waitForSelector("[data-spar]");
    const rects: { id: string; l: number; t: number; r: number; b: number }[] = await page.$$eval("[data-control],[data-spar]", (els) =>
      els.map((e) => {
        const x = e.getBoundingClientRect(); const h = e as HTMLElement;
        return { id: h.dataset["control"] ?? "sparring", l: x.left, t: x.top, r: x.right, b: x.bottom };
      }));
    const spar = rects.find((q) => q.id === "sparring")!, score = rects.find((q) => q.id === "scoreboard")!;
    expect(spar.l >= 0 && spar.t >= 0 && spar.r <= W && spar.b <= H).toBe(true);
    for (const q of rects) {
      if (q.id === "sparring") continue;
      const gap = Math.max(q.l - spar.r, spar.l - q.r, q.t - spar.b, spar.t - q.b);
      expect(gap, `sparring vs ${q.id}`).toBeGreaterThanOrEqual(8);
    }
    expect(spar.r <= score.l - 8 || spar.b <= score.t - 8 || spar.l >= score.r + 8 || spar.t >= score.b + 8).toBe(true);
    // Skill buttons: equipped name plus text readiness (not colour alone).
    const skills = await page.$$eval("[data-control^=skill]", (els) => els.map((e) => ({ text: (e as HTMLElement).innerText.replace(/\n/g, "|"), border: getComputedStyle(e).borderTopStyle })));
    expect(skills[0]).toEqual({ text: "1 Fault Strike|Ready", border: "solid" });
    expect(skills[1]).toEqual({ text: "2 Undertow Spiral|3.2", border: "dashed" });
    expect(skills[3]).toEqual({ text: "4 Quake|12", border: "dashed" });
    expect(await page.locator("[data-control^=skill]").evaluateAll(els => els.every(e => e.scrollWidth <= e.clientWidth))).toBe(true);
    mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `QU01-hud-${W}x${H}.png`) });
    await page.goto(`${base}?qu01=blocked`);
    await page.waitForSelector("[data-control=block]");
    expect(await page.locator("[data-control=block]").innerText()).toBe("Blocked!");
    expect(await page.locator("[data-hud=block-feedback]").isVisible()).toBe(true);
    await page.close();
  });
}
