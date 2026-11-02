import { mkdtempSync, readFileSync, statSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { loadAdminPasswordHash, saveAdminPassword } from "../../ops/scripts/lib/adminSetup.js";
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
