import { chmodSync, constants, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HASH_FORMAT, hashPassword } from "../../../apps/server/src/admin/AdminAuth.js";

const FILE = "admin-password.hash";
/** Host-local setup, never an unauthenticated HTTP endpoint. No plaintext password is persisted. */
export async function saveAdminPassword(dataDir: string, password: string): Promise<void> {
  if (password.length < 12 || password.length > 256) throw new Error("Use a password between 12 and 256 characters.");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 }); chmodSync(dataDir, 0o700);
  const path = join(dataDir, FILE);
  if (existsSync(path)) throw new Error("Admin is already configured. The existing password was not changed.");
  const hash = await hashPassword(password);
  writeFileSync(path, hash + "\n", { mode: 0o600, flag: "wx" });
}

export function loadAdminPasswordHash(dataDir: string): string | null {
  const path = join(dataDir, FILE);
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Cannot read local admin setup; use a regular owner-only hash file."); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 512 || (st.mode & 0o077) !== 0) throw new Error("Local admin hash must be an owner-only file (chmod 600).");
    const hash = readFileSync(fd, "utf8").trim();
    if (!HASH_FORMAT.test(hash)) throw new Error("Local admin setup is invalid. No credential values were printed.");
    return hash;
  } finally { closeSync(fd); }
}
