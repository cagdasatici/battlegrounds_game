import { fileURLToPath } from "node:url";
import { createGameServer } from "./createServer.js";
import { AccessVerifier } from "./auth/AccessJwt.js";
import { createAuthServices } from "./auth/Services.js";
import { ConfigError, loadServerEnv, type ServerEnv } from "./config/env.js";
import { log } from "./ops/StructuredLog.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
let env: ServerEnv;
try {
  env = loadServerEnv(process.env, process.cwd(), repoRoot);
} catch (e) {
  if (e instanceof ConfigError) { console.error(e.message); process.exit(78); }
  throw e;
}
const auth = createAuthServices({
  dataDir: env.dataDir,
  allowedOrigins: [env.publicOrigin],
  secureCookies: !env.lanHttp && env.publicOrigin.startsWith("https:"),
  roomCodes: { play: "arena", practice: "practice" },
  buildId: env.buildId,
  adminPasswordHash: env.adminPasswordHash,
  openJoin: env.openJoin,
  access: env.accessTeam && env.accessAud ? new AccessVerifier(env.accessTeam, env.accessAud) : null,
});
const server = createGameServer(auth, { staticDir: env.staticDir });
await server.listen(env.port, env.host);
log("info", "server listening", { host: env.host, port: env.port, build: env.buildId, nodeEnv: env.nodeEnv });

// Spec 24: delete expired session records daily.
const purge = (): void => { const n = auth.sessions.purgeExpired(); if (n > 0) log("info", "expired sessions purged", { count: n }); };
purge();
const purgeTimer = setInterval(purge, 24 * 3600_000);
purgeTimer.unref();

// Graceful stop for launchd / docker: stop accepting, drain rooms, exit.
let stopping = false;
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log("info", "shutdown requested", { signal: sig });
    void server.gracefullyShutdown(true).finally(() => process.exit(0));
  });
}
