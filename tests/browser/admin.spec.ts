// WEB5: real browser against the real admin API (Vite dev server proxying a real game server).
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { createServer as netServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Server } from "colyseus";
import { createGameServer } from "../../apps/server/src/createServer.js";
import { createAuthServices, type AuthServices } from "../../apps/server/src/auth/Services.js";
import { hashPassword } from "../../apps/server/src/admin/AdminAuth.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
const PW = "a long admin passphrase";
interface Dev { close(): Promise<void>; listen(): Promise<unknown> }
let now = Date.now();
let game: Server, svc: AuthServices, vite: Dev, browser: Browser, base: string;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = netServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
});
test.beforeAll(async () => {
  const gamePort = await freePort(), vitePort = await freePort();
  base = `http://localhost:${vitePort}`;
  svc = createAuthServices({ dataDir: mkdtempSync(path.join(tmpdir(), "eb-web5-")), allowedOrigins: [base], secureCookies: false,
    roomCodes: { play: "arena", practice: "practice" }, buildId: "WEB5", adminPasswordHash: await hashPassword(PW) }, () => now);
  game = createGameServer(svc); await game.listen(gamePort, undefined, undefined);
  const target = `http://127.0.0.1:${gamePort}`;
  const v = req("vite") as { createServer(c: unknown): Promise<Dev> };
  vite = await v.createServer({ root: path.join(root, "apps/client"), configFile: false, logLevel: "error",
    server: { hmr: false, watch: null, port: vitePort, strictPort: true, host: "127.0.0.1", fs: { strict: false }, proxy: { "/api": { target } } } });
  await vite.listen();
  browser = await chromium.launch({ ...(process.env["EB_CHROMIUM"] ? { executablePath: process.env["EB_CHROMIUM"] } : {}) });
});
test.afterAll(async () => { await browser?.close(); await vite?.close(); await game?.gracefullyShutdown(false); });

async function open(): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  now += 61_000; // the login limiter is 5 per minute per source; each test starts a fresh minute
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  const page = await ctx.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${base}/admin.html`);
  return { ctx, page, errors };
}
const btn = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
async function signIn(p: Page): Promise<void> {
  await p.getByLabel("Password").fill(PW);
  await btn(p, "Sign in").click();
  await expect(p.locator("[data-screen=status], section[data-screen=status]").first()).toBeVisible();
}
const nav = (p: Page, name: string) => p.locator(`nav button[data-screen=${name}]`);

test("login: wrong password shows an error and stays; correct password reaches Status", async () => {
  const { ctx, page, errors } = await open();
  try {
    await expect(page.locator("section[data-screen=login]")).toBeVisible();
    await page.getByLabel("Password").fill("nope");
    await btn(page, "Sign in").click();
    await expect(page.getByRole("status")).toContainText("Sign-in failed");
    await signIn(page);
    await expect(page.locator("section[data-screen=status]")).toContainText("Build WEB5");
    expect(await page.content()).not.toContain(PW);
    expect(errors).toEqual([]);
  } finally { await ctx.close(); }
});

test("invites: double-click creates one, link shown once and gone after Done and after reload, revoke removes it", async () => {
  const { ctx, page } = await open();
  try {
    await signIn(page);
    await nav(page, "invites").click();
    await expect(page.getByRole("status")).toContainText("No active invitations");
    let posts = 0;
    page.on("request", r => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/admin/invites") posts++; });
    await btn(page, "Create invitation").dblclick();
    const link = page.locator("[data-role=invite-link]");
    await expect(link).toContainText("#invite=");
    expect(posts).toBe(1);
    await expect(page.locator("li")).toHaveCount(1);
    expect(await page.locator("li").innerText()).not.toContain("#invite=");
    await btn(page, "Done").click();
    await expect(link).toHaveCount(0);
    await btn(page, "Revoke").click();
    await expect(page.getByRole("status")).toContainText("No active invitations");
    await btn(page, "Create invitation").click();
    await expect(link).toBeVisible();
    await nav(page, "players").click();
    await expect(link).toHaveCount(0);
    await page.reload();
    expect(await page.content()).not.toContain("#invite=");
  } finally { await ctx.close(); }
});

test("players: empty state, then a signed-in player appears and can be revoked", async () => {
  const { ctx, page } = await open();
  try {
    await signIn(page);
    await nav(page, "players").click();
    for (const s of svc.sessions.list()) svc.sessions.revokeById(s.id);
    await btn(page, "Sign out").click();
    await signIn(page);
    await nav(page, "players").click();
    await expect(page.getByRole("status")).toContainText("No signed-in players");
    svc.sessions.create("Zed");
    await nav(page, "status").click();
    await nav(page, "players").click();
    await expect(page.locator("li")).toContainText("Zed");
    await btn(page, "Revoke").click();
    await expect(page.getByRole("status")).toContainText("No signed-in players");
  } finally { await ctx.close(); }
});

test("rooms: create, unlist, list again, close", async () => {
  const { ctx, page } = await open();
  try {
    await signIn(page);
    await nav(page, "rooms").click();
    await expect(page.locator("li", { hasText: "Play (arena)" })).toBeVisible();
    await page.getByLabel("Room name").fill("Friday");
    await page.getByLabel("Bots", { exact: true }).selectOption("2");
    await page.getByLabel("Bot difficulty").selectOption("hard");
    await page.screenshot({ path: "docs/test-results/UX03-admin.png", fullPage: true });
    await btn(page, "Create room").click();
    const row = page.locator("li", { hasText: "Friday" });
    await expect(row).toContainText("2 bots");
    await expect(row).toContainText("listed");
    await row.getByRole("button", { name: "Unlist" }).click();
    await expect(row).toContainText("unlisted");
    await row.getByRole("button", { name: "List", exact: true }).click();
    await expect(row).toContainText(", listed");
    await row.getByRole("button", { name: "Close" }).click();
    await expect(page.locator("li", { hasText: "Friday" })).toHaveCount(0);
  } finally { await ctx.close(); }
});

test("announcement: publish shows on the public endpoint, clear removes it", async () => {
  const { ctx, page } = await open();
  try {
    await signIn(page);
    await nav(page, "announcement").click();
    await page.getByLabel(/Message/).fill("Server restarts at 9");
    await btn(page, "Publish").click();
    await expect(page.getByRole("status")).toContainText("Published");
    expect(((await (await page.request.get(`${base}/api/announcement`)).json()) as { announcement: { text: string } }).announcement.text).toBe("Server restarts at 9");
    await btn(page, "Clear").click();
    await expect(page.getByRole("status")).toContainText("Cleared");
    expect(((await (await page.request.get(`${base}/api/announcement`)).json()) as { announcement: unknown }).announcement).toBeNull();
  } finally { await ctx.close(); }
});

test("error state, 401 returns to Login, and screens stop polling when left", async () => {
  const { ctx, page } = await open();
  try {
    await signIn(page);
    let statusCalls = 0;
    page.on("request", r => { if (new URL(r.url()).pathname === "/api/admin/status") statusCalls++; });
    await nav(page, "rooms").click();
    await page.route("**/api/admin/rooms", r => r.fulfill({ status: 500, body: "{}" }));
    await nav(page, "status").click();
    await nav(page, "rooms").click();
    await expect(page.getByRole("status")).toContainText("Loading rooms failed");
    await page.unroute("**/api/admin/rooms");
    const seen = statusCalls;
    await page.waitForTimeout(5600);
    expect(statusCalls).toBe(seen);
    await ctx.clearCookies();
    await nav(page, "players").click();
    await expect(page.locator("section[data-screen=login]")).toBeVisible();
    await expect(page.locator("nav button")).toHaveCount(0);
  } finally { await ctx.close(); }
});

test("the admin page is separate from the game shell (own title, no manifest)", async () => {
  const { ctx, page } = await open();
  try {
    expect(await page.title()).toBe("Battlegrounds Admin");
    expect(await page.locator("link[rel=manifest]").count()).toBe(0);
  } finally { await ctx.close(); }
});
