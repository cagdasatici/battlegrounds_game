// Usage: pnpm tsx ops/scripts/invite.ts <origin> [ttlHours=24] [maxUses=1]
// Prints an invitation link once. Only the hash is stored. The token is placed in a URL fragment.
import { join } from "node:path";
import { InviteStore } from "../../apps/server/src/auth/InviteStore.js";

const origin = process.argv[2];
if (!origin) {
  console.error("usage: invite.ts <origin> [ttlHours] [maxUses]");
  process.exit(2);
}
const ttlHours = Number(process.argv[3] ?? 24);
const maxUses = Number(process.argv[4] ?? 1);
const dataDir = process.env["EB_DATA_DIR"] ?? join(process.cwd(), "data");
const store = new InviteStore(join(dataDir, "invites.json"));
const { token, id, expiresAt } = store.create({ ttlMs: ttlHours * 3600_000, maxUses });
console.log(`${origin.replace(/\/$/, "")}/#invite=${token}`);
console.error(`invite id ${id}, expires ${new Date(expiresAt).toISOString()}, uses ${maxUses}`);
