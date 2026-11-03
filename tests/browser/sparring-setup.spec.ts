import { test, expect, chromium, type Browser, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evidenceDir } from "./harness/evidence.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
let server: Dev;
let browser: Browser;
let base: string;
const fixture = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#152334"><main></main><script type="module">
import { mountSparringSetup } from '/apps/client/src/ui/SparringSetup.ts';
window.calls = []; window.fail = ''; window.pending = ''; window.clipboardFails = true; window.copied = [];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (url) => { if(window.clipboardFails) throw Error('denied'); window.copied.push(url); } } });
const action = async (kind, data) => {
  window.calls.push({kind, ...data});
  if (window.pending === kind) await new Promise(resolve => window.release = resolve);
  if (window.fail === kind) throw Error('private transport detail');
};
window.dispose = mountSparringSetup(document.querySelector('main'), {
 start: async (config, kitId) => action('start', {config, kitId}),
 copyLink: async () => { await action('copy', {}); return 'https://example.test/#spar=local-fixture'; },
 end: async () => action('end', {})
});
window.ready = true;
</script>`;

test.beforeAll(async () => {
  const vite = req("vite") as { createServer(c: unknown): Promise<Dev> };
  server = await vite.createServer({ root, configFile: false, logLevel: "error", optimizeDeps: { noDiscovery: true }, server: { hmr: false, watch: null, host: "127.0.0.1", port: 0 },
    plugins: [{ name: "bot3-local-fixture", configureServer(s: { middlewares: { use(fn: (q: { url?: string }, r: { setHeader(k: string, v: string): void; end(s: string): void }, next: () => void) => void): void } }) {
      s.middlewares.use((q, r, next) => { if (q.url !== "/bot3") return next(); r.setHeader("Content-Type", "text/html"); r.end(fixture); });
    } }],
  });
  await server.listen(); base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch(process.env["EB_CHROMIUM"] ? { executablePath: process.env["EB_CHROMIUM"] } : {});
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });
type Harness = { ready: boolean; calls: unknown[]; fail: string; pending: string; clipboardFails: boolean; copied: string[]; release(): void; dispose(): void };
async function fresh(): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, hasTouch: true });
  await page.goto(base + "bot3"); await page.waitForFunction(() => (window as unknown as Harness).ready);
  return page;
}
const b = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const calls = (p: Page) => p.evaluate(() => (window as unknown as Harness).calls);
const set = (p: Page, values: Partial<Pick<Harness, "fail" | "pending" | "clipboardFails">>) => p.evaluate(v => Object.assign(window, v), values);
async function start(p: Page): Promise<void> { await b(p, "Start match").click(); await expect(b(p, "End match")).toBeVisible(); }

test("default Medium, roster bounds, all difficulties, fighter and frozen setup", async () => {
  const p = await fresh();
  try {
    await expect(p.getByLabel("Bot 1 difficulty")).toHaveValue("medium");
    await b(p, "Add opponent").click(); await b(p, "Add opponent").click();
    await expect(b(p, "Add opponent")).toBeDisabled();
    await p.getByLabel("Bot 1 difficulty").selectOption("easy");
    await p.getByLabel("Bot 3 difficulty").selectOption("hard");
    await p.getByLabel("Your fighter").selectOption("td");
    mkdirSync(evidenceDir(root), { recursive: true });
    await p.screenshot({ path: path.join(evidenceDir(root), "BOT3-setup.png") });
    await start(p);
    expect(await calls(p)).toEqual([{ kind: "start", config: { bots: ["easy", "medium", "hard"] }, kitId: "td" }]);
    await expect(p.getByLabel("Your fighter")).toBeDisabled();
    await expect(b(p, "Copy guest link")).toBeDisabled();
    await b(p, "End match").click(); await expect(b(p, "Start match")).toBeEnabled();
    await b(p, "Remove Bot 2").click(); await expect(p.getByLabel("Bot 2 difficulty")).toHaveValue("hard");
    await b(p, "Remove Bot 2").click(); await b(p, "Remove Bot 1").click();
    await expect(p.getByRole("button", { name: /^Remove Bot/ })).toHaveCount(0);
    await start(p);
    expect((await calls(p)).at(-1)).toEqual({ kind: "start", config: { bots: [] }, kitId: "td" });
    // MODE01: the round length selector defaults to endless (omitted) and sends roundTarget only when chosen.
    await b(p, "End match").click();
    await p.getByLabel("Round length").selectOption("10");
    await start(p);
    expect((await calls(p)).at(-1)).toEqual({ kind: "start", config: { bots: [], roundTarget: 10 }, kitId: "td" });
  } finally { await p.close(); }
});

test("pending start suppresses duplicates, failure permits retry, end failure retains match", async () => {
  const p = await fresh();
  try {
    await set(p, { pending: "start", fail: "start" });
    await b(p, "Start match").click();
    await b(p, "Start match").evaluate(e => { (e as HTMLButtonElement).click(); (e as HTMLButtonElement).click(); });
    expect(await calls(p)).toHaveLength(1); await expect(b(p, "Add opponent")).toBeDisabled();
    await p.evaluate(() => (window as unknown as Harness).release());
    await expect(p.getByRole("status")).toContainText("Could not start");
    await set(p, { pending: "", fail: "" }); await start(p);
    await set(p, { fail: "end" }); await b(p, "End match").click();
    await expect(p.getByRole("status")).toContainText("Could not end");
    await expect(b(p, "End match")).toBeEnabled(); await expect(b(p, "Start match")).toBeDisabled();
    await set(p, { fail: "", pending: "end" }); await b(p, "End match").click();
    await expect(b(p, "Copy guest link")).toBeDisabled();
    await b(p, "End match").evaluate(e => (e as HTMLButtonElement).click());
    expect((await calls(p)).filter((c) => (c as {kind: string}).kind === "end")).toHaveLength(2);
    await p.evaluate(() => (window as unknown as Harness).release());
    await expect(b(p, "Start match")).toBeEnabled();
  } finally { await p.close(); }
});

test("fresh link, selectable clipboard fallback, clipboard success and retry", async () => {
  const p = await fresh();
  try {
    await start(p); await set(p, { fail: "copy" }); await b(p, "Copy guest link").click();
    await expect(p.getByRole("status")).toContainText("Could not create");
    await expect(p.getByLabel("Guest link", {exact:true})).toBeHidden();
    await set(p, { fail: "", pending: "copy" }); await b(p, "Copy guest link").click();
    await b(p, "Copy guest link").evaluate(e => (e as HTMLButtonElement).click());
    await p.evaluate(() => (window as unknown as Harness).release());
    const link = p.getByLabel("Guest link", {exact:true});
    await expect(link).toHaveValue("https://example.test/#spar=local-fixture");
    expect(await link.evaluate(e => { const i = e as HTMLInputElement; return i.selectionEnd! - i.selectionStart!; })).toBe("https://example.test/#spar=local-fixture".length);
    await set(p, { pending: "", clipboardFails: false }); await b(p, "Copy guest link").click();
    await expect(p.getByRole("status")).toHaveText("Guest link copied."); await expect(link).toBeHidden();
    expect((await calls(p)).filter(c => (c as {kind: string}).kind === "copy")).toHaveLength(3);
    expect(await p.evaluate(() => (window as unknown as Harness).copied)).toHaveLength(1);
  } finally { await p.close(); }
});

for (const kind of ["start", "copy", "end"] as const) {
  test(`dispose during pending ${kind} removes listeners and ignores completion`, async () => {
    const p = await fresh(); const errors: string[] = []; p.on("pageerror", e => errors.push(e.message));
    try {
      if (kind !== "start") await start(p);
      await set(p, { pending: kind });
      await b(p, kind === "start" ? "Start match" : kind === "copy" ? "Copy guest link" : "End match").click();
      const count = (await calls(p)).length;
      await p.evaluate(() => {
        const panel = document.querySelector('[data-ui="sparring-setup"]')!;
        (window as unknown as Harness).dispose(); (window as unknown as Harness).dispose();
        panel.querySelectorAll("button").forEach(e => e.click());
        (window as unknown as Harness).release();
      });
      await expect(p.locator("main")).toBeEmpty(); expect(await calls(p)).toHaveLength(count);
      expect(await p.evaluate(() => (window as unknown as Harness).copied)).toEqual([]); expect(errors).toEqual([]);
    } finally { await p.close(); }
  });
}
