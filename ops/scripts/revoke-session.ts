// Usage: pnpm tsx ops/scripts/revoke-session.ts <session-id-or-unique-prefix (min 8 chars)>
// Operator-only. Removes the session record so its cookie stops working at the next request. A running server reads
// the file on every lookup, so no restart is needed; already open sockets end at their next ticket check or leave.
import { join } from "node:path";
import { SessionStore } from "../../apps/server/src/auth/SessionStore.js";

const id = process.argv[2];
if (!id) { console.error("usage: revoke-session.ts <session-id-or-prefix>"); process.exit(2); }
const dataDir = process.env["DATA_DIR"] ?? join(process.cwd(), "data");
const ok = new SessionStore(join(dataDir, "sessions.json")).revokeById(id);
console.error(ok ? "revoked" : "no unique session matched");
process.exit(ok ? 0 : 1);
