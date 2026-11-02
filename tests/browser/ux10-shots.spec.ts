// UX10 evidence: scripted ability showcase in the fx lab (real GameScene + presentation modules, SwiftShader WebGL).
// EB_UX10_PHASE=before|after names the screenshots; the same spec captures both so they compare like for like.
import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveChromium } from "./harness/chromium-path.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "docs/test-results/UX10");
const req = createRequire(path.join(root, "apps/client/package.json"));
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const phase = process.env["EB_UX10_PHASE"] ?? "after";

interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
interface Fx {
  frames(): number; quality(q: string): void; act(id: string, a: string, m: string, t?: number): void; idle(id: string): void;
  event(e: Record<string, unknown>): void; settings(s: Record<string, unknown>): void; shakes(): { a: number; ms: number }[];
  fx(): { active: number; capacity: number }; info(): { calls: number; triangles: number }; cam(...n: number[]): void;
  place(id: string, kit: string, x: number, z: number, yaw: number): void; face(id: string, x: number, z: number): void;
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

/** One shot per fighter: attacker, ability, windup frame, active frame, impact frame. */
const SHOWS: Array<{ name: string; actor: string; moveId: string; windupMs: number; activeMs: number; hit: Record<string, unknown> }> = [
  { name: "sv-b1-fault-strike", actor: "sv", moveId: "sv.b1", windupMs: 330, activeMs: 120, hit: { damage100: 2000, hitClass: "heavy" } },
  { name: "td-b4-mirror-current", actor: "td", moveId: "td.b4", windupMs: 250, activeMs: 100, hit: { damage100: 1500, hitClass: "heavy" } },
  { name: "ea-b1-cinder-array", actor: "ea", moveId: "ea.b1", windupMs: 160, activeMs: 250, hit: { damage100: 1200, hitClass: "heavy" } },
];

for (const show of SHOWS) {
  test(`${phase}: ${show.name} windup, active, impact`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    try {
      await page.goto(`${base}/fx.html`);
      await page.waitForFunction(() => ((window as unknown as { __fx?: Fx }).__fx?.frames() ?? 0) > 20, undefined, { timeout: 30_000 });
      await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.quality("high"));
      const victim = show.actor === "td" ? "sv" : "td";
      await page.evaluate(([a, v]) => { const f = (window as unknown as { __fx: Fx }).__fx; f.place("sv", "sv", -1.5, 6, 0); f.place("td", "td", 1.5, 6, 0); f.place("ea", "ea", -1.5, 9, 0); f.place("sv2", "sv", 1.5, 9, 0); f.face(a!, 0, 6); f.face(v!, 0, 6); f.face("sv", 1.5, 6); f.face("td", -1.5, 6); f.face("ea", 1.5, 9); f.face("sv2", -1.5, 9); }, [show.actor, victim]);
      const snap = async (tag: string): Promise<void> => { await page.screenshot({ path: path.join(outDir, `${show.name}-${phase}-${tag}.png`) }); };
      await page.evaluate(([a, m]) => (window as unknown as { __fx: Fx }).__fx.act(a!, "Windup", m!, 40), [show.actor, show.moveId]);
      await page.waitForTimeout(show.windupMs);
      await snap("1-windup");
      await page.evaluate(([a, m]) => (window as unknown as { __fx: Fx }).__fx.act(a!, "Active", m!, 24), [show.actor, show.moveId]);
      await page.waitForTimeout(show.activeMs);
      await snap("2-active");
      await page.evaluate(([a, v, hit]) => (window as unknown as { __fx: Fx }).__fx.event({ actorId: a, targetId: v, moveId: (JSON.parse(hit!) as { m: string }).m, ...(JSON.parse(hit!) as { h: Record<string, unknown> }).h, position: { x: 1.5, y: 1.2, z: 6 } }), [show.actor, victim, JSON.stringify({ m: show.moveId, h: show.hit })]);
      await page.waitForTimeout(90);
      await snap("3-impact");
      const info = await page.evaluate(() => (window as unknown as { __fx: Fx }).__fx.info());
      expect(info.calls).toBeLessThanOrEqual(120);
      expect(info.triangles).toBeLessThanOrEqual(300_000);
      expect(errors).toEqual([]);
    } finally { await ctx.close(); }
  });
}
