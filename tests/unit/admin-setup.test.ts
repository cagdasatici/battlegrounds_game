import { mkdtempSync, readFileSync, statSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadAdminPasswordHash, saveAdminPassword } from "../../ops/scripts/lib/adminSetup.js";
import { loadServerEnv } from "../../apps/server/src/config/env.js";
import { verifyPassword } from "../../apps/server/src/admin/AdminAuth.js";

test("local setup persists only a private verifiable hash and refuses to overwrite an existing admin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-admin-setup-")), password = "owner setup fixture password";
  try {
    expect(loadAdminPasswordHash(dir)).toBeNull();
    await expect(saveAdminPassword(dir, "short")).rejects.toThrow("12");
    await saveAdminPassword(dir, password);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "admin-password.hash")).mode & 0o777).toBe(0o600);
    const stored = loadAdminPasswordHash(dir)!;
    expect(readFileSync(join(dir, "admin-password.hash"), "utf8")).not.toContain(password);
    expect(await verifyPassword(password, stored)).toBe(true);
    expect(await verifyPassword("wrong fixture password", stored)).toBe(false);
    await expect(saveAdminPassword(dir, "another fixture password")).rejects.toThrow("already configured");
    expect(loadAdminPasswordHash(dir)).toBe(stored);
    chmodSync(join(dir, "admin-password.hash"), 0o644); expect(() => loadAdminPasswordHash(dir)).toThrow("owner-only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("loader refuses symlinks rather than following a credential outside the data directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-admin-link-"));
  try { symlinkSync(join(dir, "missing"), join(dir, "admin-password.hash")); expect(() => loadAdminPasswordHash(dir)).toThrow("regular owner-only"); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("production startup loads the stored password, preserves explicit overrides and honors disable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "eb-admin-env-"));
  const env = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://game.example", DATA_DIR: dir, BUILD_ID: "fixture", ADMIN_ENABLED: "1" };
  try {
    await saveAdminPassword(dir, "stored startup fixture password");
    const stored = loadAdminPasswordHash(dir)!;
    expect(loadServerEnv(env, "/cwd", "/repo").adminPasswordHash).toBe(stored);
    const other = stored.replace(/.$/, stored.endsWith("a") ? "b" : "a");
    expect(loadServerEnv({ ...env, ADMIN_PASSWORD_HASH: other }, "/cwd", "/repo").adminPasswordHash).toBe(other);
    chmodSync(join(dir, "admin-password.hash"), 0o644);
    expect(() => loadServerEnv(env, "/cwd", "/repo")).toThrow("owner-only");
    expect(loadServerEnv({ ...env, ADMIN_ENABLED: "0" }, "/cwd", "/repo").adminPasswordHash).toBeNull();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
