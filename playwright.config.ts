import { defineConfig } from "@playwright/test";

export default defineConfig({ testDir: "tests/browser", testMatch: "*.spec.ts", timeout: 60000, reporter: "list", workers: 1 });
