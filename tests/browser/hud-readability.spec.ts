// GR11 combat HUD readability: real Chromium + Colyseus clients. Forms, casts, HP and KOs are set on the server by fixtures; replication, DOM layout, layering and the KO card are real.
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { matchMaker, type Server } from "colyseus";
import type { ArenaRoom } from "../../apps/server/src/rooms/ArenaRoom.js";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { mkdtempSync } from "node:fs";
import { resolveChromium } from "./harness/chromium-path.js";
import { closeContext } from "./harness/leave.js";
import { evidenceDir } from "./harness/evidence.js";
import { computeLayout } from "../../apps/client/src/input/ControlLayout.js";
import { LAYER } from "../../apps/client/src/ui/Layers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const CHROMIUM = resolveChromium();
const GL_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

interface Dev { close(): Promise<void>; listen(): Promise<unknown> }

interface Snap { localEntityId: number | null; players: { entityId: number; ready: boolean; local: boolean; action: string; moveId: string; hp100: number }[] }

let game: Server, svc: AuthServices, vite: Dev, browser: Browser;
let base = "";
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer();
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  s.on("error", reject);
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({
    dataDir: mkdtempSync(path.join(tmpdir(), "eb-pw-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { match: "arena", rounds: "arena", practice: "practice" }, buildId: "test", sessionsPerMinute: 10_000, globalSessionsPerMinute: 10_000,
  });
  svc.roomMeta.set("rounds", { name: "Rounds", listed: true, bots: ["easy"], roundTarget: 5 });
  game = createGameServer(svc);
  await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({
    root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false },
      proxy: { "/api": { target }, "/matchmake": { target }, "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": { target, ws: true } } },
  });
  await vite.listen();
  browser = await chromium.launch({ executablePath: CHROMIUM, args: GL_ARGS });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });

const snap = (p: Page): Promise<Snap> => p.evaluate(() => (window as unknown as { __eb: { snapshot(): unknown } }).__eb.snapshot() as never);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => Promise<T | null | false>, ms: number, what: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timeout: ${what}`);
    await sleep(40);
  }
}
const shots = evidenceDir(root);
const tag = process.env.GR11_SHOTS === "before" ? "before" : "after";
const ctrl = (p: Page, id: string) => p.locator(`[data-control=${id}]`);

/** Minimum editor scale (0.85) on the four skill buttons, left or right handed, at the viewport's default skill positions. */
function settingsJson(vp: { width: number; height: number }, hand: "left" | "right", minScale: boolean): string {
  const l = computeLayout({ x0: 0, y0: 0, W: vp.width, H: vp.height });
  const controls: Record<string, { nx: number; ny: number; size: number }> = {};
  if (minScale) for (const id of ["skill1", "skill2", "skill3", "skill4"] as const) controls[id] = { nx: l.controls[id].cx / vp.width, ny: l.controls[id].cy / vp.height, size: 0.85 };
  const profile = { opacity: 0.9, controls };
  return JSON.stringify({
    v: 2, sensitivity: 1, cameraDistance: 6.5, facingLock: false, quickUse: true, autoRun: false, handedness: hand,
    effectsVolume: 0.8, musicVolume: 0.5, quality: "medium", reducedMotion: false, flashLevel: 0.3,
    damageNumbers: true, combatText: "all", layouts: { wide: profile, compact: profile },
  });
}

async function open(room: string, name: string, kit: string, vp = { width: 1024, height: 768 }, stored?: string, reduced = false): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: false, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
  await page.goto(`${base}/?room=${room}&name=${name}&kit=sv&debug=1#invite=${token}`);
  await page.waitForSelector("[data-act=play]");
  if (stored) await page.evaluate(([n, v]) => window.localStorage.setItem(`eb.settings.v1.${n}`, v!), [name, stored]);
  await page.click("[data-act=play]");
  await page.click(`[data-act=kit][data-kit=${kit}]`);
  await page.click("[data-act=ready]");
  await page.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
  return { ctx, page, errors };
}
/** The live room that holds this display name (earlier tests' rooms may still be listed while they dispose). */
const arenaOf = async (...names: string[]): Promise<ArenaRoom> => until(async () => {
  for (const l of await matchMaker.query({ name: "arena" })) {
    const room = matchMaker.getLocalRoomById(l.roomId) as unknown as ArenaRoom | undefined;
    if (room && (names.length ? names : ["Aria"]).every((n) => [...room.state.players.values()].some((p) => p.displayName === n))) return room;
  }
  return null;
}, 10000, `room for ${names.join(",")}`);
const localId = (p: Page) => until(async () => (await snap(p)).localEntityId, 15000, "local id");

interface Rect { id: string; x: number; y: number; w: number; h: number }
async function controlRects(p: Page): Promise<Rect[]> {
  return p.$$eval("[data-control]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { id: (e as HTMLElement).dataset["control"]!, x: r.x, y: r.y, w: r.width, h: r.height }; }));
}
const overlap = (a: Rect, b: Rect): boolean => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

for (const kit of ["sv", "td", "ea"] as const) {
  for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
    for (const hand of ["right", "left"] as const) {
      test(`${kit} base and awakened skill buttons stay inside their box at ${vp.width}x${vp.height}, ${hand}-handed, minimum editor scale`, async () => {
        test.setTimeout(150_000);
        const { ctx, page, errors } = await open("match", "Aria", kit, vp, settingsJson(vp, hand, true));
        try {
          const arena = await arenaOf();
          const id = await localId(page);
          const fa = arena.combat.get(id)!;
          const names: Record<string, string[]> = {};
          for (const form of ["Base", "Awakened"] as const) {
            fa.form = form; fa.formEndTick = form === "Base" ? 0 : arena.sim.tick + 6000; fa.awakenedUsedMask = form === "Awakened" ? 1 : 0;
            const want = form === "Awakened" ? "Awakened" : "Base";
            await until(async () => {
              const t = await ctrl(page, "skill1").getAttribute("data-structure");
              return t !== null && (await page.locator("[data-control=skill2] [data-part=state]").count()) > 0 ? want : null;
            }, 8000, "skill structure");
            await sleep(300);
            for (const slot of [1, 2, 3, 4]) {
              const m = await ctrl(page, `skill${slot}`).evaluate((el) => {
                const part = (n: string) => el.querySelector<HTMLElement>(`[data-part=${n}]`)!;
                const name = part("name"), state = part("state");
                const cs = getComputedStyle(name);
                const lines = Math.round(name.getBoundingClientRect().height / parseFloat(cs.lineHeight));
                return {
                  sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth,
                  nameSh: name.scrollHeight, nameCh: name.clientHeight, lines, nameFont: cs.fontSize, nameLine: cs.lineHeight,
                  stateSh: state.scrollHeight, stateCh: state.clientHeight, stateFont: getComputedStyle(state).fontSize, stateText: state.textContent, width: el.getBoundingClientRect().width,
                  aria: el.getAttribute("aria-label"), role: el.getAttribute("role"), roleRow: el.querySelector("small") !== null,
                };
              });
              const tag2 = `${kit} ${form} slot${slot}`;
              expect(m.sh, `${tag2} vertical clip`).toBeLessThanOrEqual(m.ch + 1);
              expect(m.sw, `${tag2} horizontal clip`).toBeLessThanOrEqual(m.cw + 1);
              expect(m.nameSh, `${tag2} name clip`).toBeLessThanOrEqual(m.nameCh + 1);
              expect(m.stateSh, `${tag2} state clip`).toBeLessThanOrEqual(m.stateCh + 1);
              expect(m.lines, `${tag2} name lines`).toBeLessThanOrEqual(2);
              expect(m.roleRow, `${tag2} no role description row`).toBe(false);
              expect(m.role).toBe("button");
              expect(m.aria ?? "", `${tag2} aria-label carries the full move name`).not.toBe("");
              const big = m.width >= 64;
              expect([m.nameFont, m.nameLine, m.stateFont]).toEqual(big ? ["11px", "12px", "13px"] : ["10px", "11px", "11px"]);
            }
            names[form] = await Promise.all([1, 2, 3, 4].map(async (n) => (await ctrl(page, `skill${n}`).getAttribute("aria-label")) ?? ""));
            const rects = await controlRects(page);
            for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
              expect(overlap(rects[i]!, rects[j]!), `${rects[i]!.id} overlaps ${rects[j]!.id}`).toBe(false);
            }
          }
          expect(names["Awakened"], "the awakened slots were really rendered").not.toEqual(names["Base"]);
          expect(errors).toEqual([]);
        } finally { await closeContext(ctx); }
      });
    }
  }
}

test("layer scale: world labels < damage cues < HUD < practice < backdrop < modal content < status, applied to the live overlays", async () => {
  expect([LAYER.world, LAYER.worldLabels, LAYER.damageCues, LAYER.hud, LAYER.practice, LAYER.modalBackdrop, LAYER.modalContent, LAYER.status]).toEqual([0, 10, 20, 30, 35, 50, 60, 70]);
  test.setTimeout(120_000);
  const { ctx, page, errors } = await open("match", "Aria", "sv");
  try {
    const z = (sel: string) => page.locator(sel).first().evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(await z("[data-ui=nameplates]")).toBe(LAYER.worldLabels);
    expect(await z("[data-ui=damage-cues]")).toBe(LAYER.damageCues);
    expect(await z("[data-ui=combat-text]")).toBe(LAYER.damageCues);
    expect(await z("[data-control=skill1]")).toBe(LAYER.hud);
    expect(await z("[data-hud=backdrop]")).toBe(LAYER.modalBackdrop);
    expect(await z("[data-hud=menu]")).toBe(LAYER.modalContent);
    expect(await z("[data-ui=connection-status]")).toBe(LAYER.status);
    expect(errors).toEqual([]);
  } finally { await closeContext(ctx); }
});

test("menu with an active cast and nameplates: buttons are legible and unobstructed, labels and callouts step aside", async () => {
  test.setTimeout(150_000);
  const A = await open("match", "Aria", "sv");
  const B = await open("match", "Bo", "sv");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.hp100 > 0).length === 2 || null, 15000, "both present");
    const arena = await arenaOf("Aria", "Bo");
    const id = await localId(A.page);
    const fa = arena.combat.get(id)!;
    await until(async () => (await snap(A.page)).players.find((p) => p.local)?.action === "Idle" || null, 15000, "idle");
    fa.action = "Windup" as never; fa.moveId = "sv.b1"; fa.actionStartTick = arena.sim.tick; fa.actionEndTick = arena.sim.tick + 6000;
    const info = A.page.locator("[data-hud=info]");
    await until(async () => (await info.isVisible()) || null, 8000, "cast text visible");
    await A.page.screenshot({ path: path.join(shots, `GR11-${tag}-cast-1024x768.png`) });
    // Cast phase text: below the objective strip, centred at y=92, one 14 px line, at most 360 px wide, clear of health (y 32).
    const ib = (await info.boundingBox())!;
    expect.soft(ib.y).toBeGreaterThanOrEqual(90); expect.soft(ib.y).toBeLessThanOrEqual(94);
    expect.soft(ib.width).toBeLessThanOrEqual(360); expect.soft(ib.height, "single line pill").toBeLessThan(36);
    expect.soft(await info.evaluate((el) => getComputedStyle(el).fontSize)).toBe("14px");
    expect.soft(Math.abs(ib.x + ib.width / 2 - 512)).toBeLessThan(2);
    const health = (await ctrl(A.page, "health").boundingBox())!;
    expect.soft(ib.y).toBeGreaterThanOrEqual(health.y + health.height);
    await A.page.keyboard.press("Escape");
    const menu = A.page.locator("[data-hud=menu]");
    await until(async () => (await menu.isVisible()) || null, 5000, "menu open");
    await sleep(200);
    await A.page.screenshot({ path: path.join(shots, `GR11-${tag}-menu-cast-1024x768.png`) });
    expect(await A.page.evaluate(() => document.documentElement.hasAttribute("data-modal-open"))).toBe(true);
    for (const sel of ["[data-ui=nameplates]", "[data-ui=combat-text]", "[data-hud=info]"]) {
      expect(await A.page.locator(sel).first().evaluate((el) => getComputedStyle(el).visibility), `${sel} hidden`).toBe("hidden");
    }
    for (const b of await menu.locator("button").all()) {
      const box = (await b.boundingBox())!;
      const top = await A.page.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.closest("button")?.textContent ?? null, [box.x + box.width / 2, box.y + box.height / 2]);
      expect(top, "menu button is the topmost element").toBe(await b.textContent());
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Underlying state is preserved: closing the menu brings the cast text back.
    await A.page.keyboard.press("Escape");
    await until(async () => (await menu.isHidden()) || null, 5000, "menu closed");
    expect(await A.page.evaluate(() => document.documentElement.hasAttribute("data-modal-open"))).toBe(false);
    await until(async () => (await info.isVisible()) || null, 5000, "cast text back");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});

test("practice panel starts collapsed (title, hint, Expand) and its expanded form stays below modals", async () => {
  test.setTimeout(120_000);
  const ctx2 = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const p2 = await ctx2.newPage();
  const errs: string[] = [];
  p2.on("pageerror", (e) => errs.push(String(e)));
  try {
    const { token } = svc.invites.create({ ttlMs: 120_000, maxUses: 1 });
    await p2.goto(`${base}/?room=practice&debug=1&name=Arel&kit=sv#invite=${token}`);
    await p2.waitForSelector("[data-act=practice]");
    await p2.click("[data-act=practice]");
    await p2.click("[data-act=ready]");
    await p2.waitForFunction(() => (window as unknown as { __eb?: unknown }).__eb !== undefined, undefined, { timeout: 30_000 });
    const panel = p2.locator("[data-ui=practice]");
    await panel.waitFor({ timeout: 30_000 });
    await expect(panel.locator("[data-expand]")).toHaveText("Expand");
    await expect(panel.locator("[data-ui=practice-hint]")).toBeVisible();
    await expect(panel.locator("[data-toggle]")).toHaveCount(0);
    await expect(panel.locator("select")).toHaveCount(0);
    expect(await panel.evaluate((el) => Number(getComputedStyle(el).zIndex))).toBe(LAYER.practice);
    await p2.screenshot({ path: path.join(shots, `GR11-${tag}-practice-collapsed.png`) });
    await panel.locator("[data-expand]").click();
    await expect(panel.locator("[data-toggle=guard]")).toBeVisible();
    await p2.screenshot({ path: path.join(shots, `GR11-${tag}-practice-expanded.png`) });
    // A modal (the Esc menu) sits above the expanded panel.
    await p2.keyboard.press("Escape");
    const menu = p2.locator("[data-hud=menu]");
    await menu.waitFor({ state: "visible" });
    const gb = (await menu.locator("button[data-moves]").boundingBox())!;
    expect(await p2.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.closest("[data-hud=menu]") !== null, [gb.x + gb.width / 2, gb.y + gb.height / 2])).toBe(true);
    expect(errs).toEqual([]);
  } finally { await closeContext(ctx2); }
});

test("low HP + round results + settings do not stack conflicting cards", async () => {
  test.setTimeout(150_000);
  const { ctx, page, errors } = await open("rounds", "Aria", "sv");
  try {
    const arena = await arenaOf();
    const id = await localId(page);
    const fa = arena.combat.get(id)!;
    fa.hp100 = 1500; // low HP: vignette
    arena.state.players.get(String(id))!.kills = 5;
    const card = page.locator("[data-ui=round-results]");
    await until(async () => (await card.isVisible()) || null, 8000, "results card");
    await expect(page.locator("[data-hud=respawn]")).toBeHidden();
    await page.screenshot({ path: path.join(shots, `GR11-${tag}-results-lowhp-1024x768.png`) });
    await page.keyboard.press("Escape");
    await page.locator("[data-hud=menu] button[data-settings]").click();
    await page.locator("[data-ui=settings]").first().waitFor({ state: "visible" }).catch(() => undefined);
    await until(async () => (await card.isHidden()) || null, 4000, "results card steps aside for settings");
    await sleep(200);
    await page.screenshot({ path: path.join(shots, `GR11-${tag}-results-lowhp-settings-1024x768.png`) });
    const visibleCards = await page.evaluate(() => ["[data-ui=round-results]", "[data-hud=respawn]", "[data-hud=kit]", "[data-hud=menu]"].filter((s) => { const e = document.querySelector<HTMLElement>(s); return e !== null && getComputedStyle(e).display !== "none"; }));
    expect(visibleCards).toEqual([]);
    expect(errors).toEqual([]);
  } finally { await closeContext(ctx); }
});

test("KO card keeps the killer HP seen at the KO event, names a rival honestly and labels an uncredited fall", async () => {
  test.setTimeout(150_000);
  const A = await open("match", "Aria", "sv");
  const B = await open("match", "Bo", "td");
  try {
    await until(async () => (await snap(B.page)).players.filter((p) => p.hp100 > 0).length === 2 || null, 15000, "both present");
    const arena = await arenaOf("Aria", "Bo");
    const aId = await localId(A.page), bId = await localId(B.page);
    const fa = arena.combat.get(aId)!, fb = arena.combat.get(bId)!;
    await until(async () => (await snap(A.page)).players.find((p) => p.local)?.action === "Idle" || null, 15000, "idle");
    const pipe = (arena as unknown as { pipeline: { knockOut(tick: number, v: unknown, killer?: number): void } }).pipeline;
    // Credited KO: Bo has 40 HP when Aria falls, then heals to full before the card is read.
    fb.hp100 = 4000;
    await sleep(300);
    arena.combat.kill(aId, arena.sim.tick);
    pipe.knockOut(arena.sim.tick, fa, bId);
    const card = A.page.locator("[data-hud=respawn]");
    await until(async () => (await card.isVisible()) || null, 8000, "KO card");
    await expect(card).toContainText("by Bo");
    await expect(card).toContainText("40 HP left");
    fb.hp100 = 10000;
    await until(async () => (await snap(A.page)).players.find((p) => !p.local)?.hp100 === 10000 || null, 5000, "heal replicated");
    await sleep(300);
    await expect(card).toContainText("40 HP left");
    await expect(card).not.toContainText("100 HP left");
    await A.page.screenshot({ path: path.join(shots, `GR11-${tag}-ko-card-1024x768.png`) });
    // Uncredited fall after the next respawn.
    await until(async () => (await card.isHidden()) || null, 8000, "respawned");
    await until(async () => (await snap(A.page)).players.find((p) => p.local)?.action === "Idle" || null, 15000, "idle again");
    arena.combat.kill(aId, arena.sim.tick);
    pipe.knockOut(arena.sim.tick, fa, undefined);
    await until(async () => (await card.isVisible()) || null, 8000, "fall card");
    await expect(card).toContainText("Fell from the arena");
    await expect(card).not.toContainText("by ");
    for (const x of [A, B]) expect(x.errors).toEqual([]);
  } finally { await closeContext(A.ctx); await closeContext(B.ctx); }
});

test("left-handed and reduced-motion play keep the same readable layout", async () => {
  test.setTimeout(120_000);
  const vp = { width: 1180, height: 820 };
  const { ctx, page, errors } = await open("match", "Aria", "ea", vp, settingsJson(vp, "left", false), true);
  try {
    const rects = await controlRects(page);
    const byId = new Map(rects.map((r) => [r.id, r]));
    expect(byId.get("joystick")!.x, "left-handed: joystick moves to the right side").toBeGreaterThan(vp.width / 2);
    expect(byId.get("attack")!.x, "left-handed: attack moves to the left side").toBeLessThan(vp.width / 2);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlap(rects[i]!, rects[j]!), `${rects[i]!.id}/${rects[j]!.id}`).toBe(false);
    await page.screenshot({ path: path.join(shots, `GR11-${tag}-lefthanded-reduced-motion-1180x820.png`) });
    expect(errors).toEqual([]);
  } finally { await closeContext(ctx); }
});

test("evidence: skill rows at both target sizes", async () => {
  test.setTimeout(150_000);
  for (const vp of [{ width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
    const { ctx, page } = await open("match", "Aria", "ea", vp, settingsJson(vp, "right", true));
    try {
      await sleep(600);
      await page.screenshot({ path: path.join(shots, `GR11-${tag}-skills-${vp.width}x${vp.height}.png`) });
    } finally { await closeContext(ctx); }
  }
});
