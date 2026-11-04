// GR03: closing a tab mid-match now suspends the fighter (its seat stays reserved for the server's 20 s window so a
// reload or BFCache restore can resume it). Specs that share a room code, or wait for a player to disappear, leave
// through the HUD menu first, exactly as a person pressing Leave would.
import type { BrowserContext, Page } from "@playwright/test";

export async function leaveMatch(page: Page): Promise<void> {
  try {
    const menu = page.locator("[data-hud=menu]");
    if (!(await menu.isVisible())) await page.keyboard.press("Escape");
    await page.locator("[data-hud=menu] button[data-leave]").click({ timeout: 3000 });
    await page.locator("[data-act=play]").waitFor({ timeout: 5000 });
  } catch { /* not in a match, or already gone */ }
}

export async function closeContext(ctx: BrowserContext): Promise<void> {
  for (const p of ctx.pages()) await leaveMatch(p);
  await ctx.close().catch(() => undefined);
}
