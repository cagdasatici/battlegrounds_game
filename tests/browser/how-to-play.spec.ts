import { test, expect, chromium, type Browser } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { evidenceDir } from "./harness/evidence.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const req = createRequire(path.join(root, "apps/client/package.json"));
interface Dev { close(): Promise<void>; listen(): Promise<unknown>; resolvedUrls: { local: string[] } | null }
let server: Dev, browser: Browser, base: string;
test.beforeAll(async () => {
  const vite = req("vite");
  server = await vite.createServer({ root, configFile: false, optimizeDeps: { noDiscovery: true }, server: { hmr: false, watch: null, port: 0, host: "127.0.0.1", fs: { strict: false } }, logLevel: "error",
    plugins: [{ name: "guide-fixture", configureServer(s: { middlewares: { use(fn: (req: { url: string }, res: { setHeader(k: string, v: string): void; end(s: string): void }, next: () => void) => void): void } }) {
      s.middlewares.use((req, res, next) => {
        if (!req.url.startsWith("/guide-fixture")) return next();
        res.setHeader("Content-Type", "text/html");
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">
          import {mountHowToPlay} from '/apps/client/src/ui/HowToPlay.ts';
          import {lobbyKits,KIT_LABEL,baseMoveLabels} from '/apps/client/src/ui/Lobby.ts';
          const host=document.querySelector('#root');
          window.counts={close:0,practice:0};
          window.labels=lobbyKits().map(k=>[KIT_LABEL[k],...baseMoveLabels(k)]);
          window.mount=()=>window.dispose=mountHowToPlay(host,{sparringAvailable:new URLSearchParams(location.search).has('sparring'),onClose:()=>window.counts.close++,onPractice:()=>window.counts.practice++});
          window.mount();
        </script></body></html>`);
      });
    } }],
  });
  await server.listen(); base = server.resolvedUrls!.local[0]!;
  browser = await chromium.launch({ executablePath: process.env['EB_CHROMIUM'] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
});
test.afterAll(async () => { await browser?.close(); await server?.close(); });

for (const [width, height] of [[1024, 768], [1180, 820]]) {
  test(`guide controls, navigation and layout ${width}x${height}`, async () => {
    const page = await browser.newPage({ viewport: { width: width!, height: height! } });
    await page.goto(base + 'guide-fixture');
    const guide = page.getByRole('region', { name: 'How to play' });
    await expect(page.getByRole('button', { name: 'Touch', exact: true })).toBeFocused();
    await expect(guide).toContainText('Knock out fighters to score. You return after a knockout.');
    await expect(guide).toContainText('invitation link');
    await expect(guide).toContainText('press Ready');
    const labels = await page.evaluate(() => (window as unknown as { labels: string[][] }).labels);
    expect(labels).toHaveLength(3);
    for (const label of labels.flat()) await expect(guide).toContainText(label);
    for (const text of ['stick', 'Drag open space', 'Hold Strike', 'Hold Guard', 'Tap Dash', 'Tap Jump', 'double jump', 'skills 1–4', 'Tap Awaken', 'Facing lock', 'Menu']) await expect(guide).toContainText(text);
    await expect(guide).toContainText('Practice uses a stationary dummy. Try Guard or Ragdoll while you learn.');
    await expect(guide).not.toContainText('Host sparring');
    await page.screenshot({ path: path.join(evidenceDir(root), `HELP1-touch-${width}.png`), fullPage: true });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Keyboard', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Keyboard', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const text of ['WASD: move', 'Left mouse: hold to Strike', 'F: hold Guard', 'Q: Dash', 'Space: Jump', 'double jump', '1–4: use skills', 'G: Awaken', 'Shift: toggle facing lock', 'Esc: open the menu']) await expect(guide).toContainText(text);
    await page.screenshot({ path: path.join(evidenceDir(root), `HELP1-keyboard-${width}.png`), fullPage: true });
    await page.keyboard.press('Tab');
    await page.screenshot({ path: path.join(evidenceDir(root), `HELP1-actions-${width}.png`) });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    expect(await page.evaluate(() => (window as unknown as { counts: unknown }).counts)).toEqual({ close: 1, practice: 1 });
    expect(await guide.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    for (let i = 0; i < 3; i++) {
      // Retain a detached button to prove cleanup removes its callback listener.
      await page.evaluate(() => {
        const w = window as unknown as { dispose(): void; mount(): void };
        const old = document.querySelector<HTMLButtonElement>('[data-action="practice"]')!;
        w.dispose(); old.click(); w.dispose(); w.mount();
      });
      await expect(guide).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Touch', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Try practice' }).click();
    }
    expect(await page.evaluate(() => (window as unknown as { counts: unknown }).counts)).toEqual({ close: 1, practice: 4 });
    await page.evaluate(() => (window as unknown as { dispose(): void }).dispose());
    await expect(guide).toHaveCount(0);
    await page.close();
  });
}
test('sparring availability is injected', async () => {
  const page = await browser.newPage();
  await page.goto(base + 'guide-fixture?sparring');
  await expect(page.getByRole('region')).toContainText('Host sparring to fight bots. Choose Easy, Medium or Hard for each bot before Start. Copy a guest link if a human seat is free.');
  await page.close();
});
