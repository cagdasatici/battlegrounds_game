// Chromium resolution for browser specs: EB_CHROMIUM, then the legacy sandbox path, then Playwright's own install.
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const LEGACY = "/opt/pw-browsers/chromium";

export function resolveChromium(): string {
  const fromEnv = process.env["EB_CHROMIUM"];
  if (fromEnv) return fromEnv;
  if (existsSync(LEGACY)) return LEGACY;
  return chromium.executablePath();
}
