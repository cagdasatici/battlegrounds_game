// Playwright check for T18a. Equivalent check executed by orchestrator on Chromium (SwiftShader WebGL): see docs/test-results/T18a.md.
// Run: pnpm exec playwright install chromium; pnpm --filter @eb/client dev; then pnpm exec playwright test tests/e2e
import { expect, test } from "@playwright/test";

test("page loads, canvas visible, no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(process.env.CLIENT_URL ?? "http://localhost:5173/");
  await expect(page.locator("canvas")).toBeVisible();
  expect(errors).toEqual([]);
});
