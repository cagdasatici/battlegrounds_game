// Usage: printf '%s' 'my password' | pnpm --filter @eb/server exec tsx ../../ops/scripts/admin-hash.ts
// Reads the password from stdin (never from argv, so it stays out of shell history) and prints a scrypt hash
// to use as ADMIN_PASSWORD_HASH. The password itself is never printed.
import { hashPassword } from "../../apps/server/src/admin/AdminAuth.js";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (password.length < 12) {
  console.error("password must be at least 12 characters");
  process.exit(2);
}
console.log(await hashPassword(password));
