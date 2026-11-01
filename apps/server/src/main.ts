import { join } from "node:path";
import { createGameServer } from "./createServer.js";
import { createAuthServices } from "./auth/Services.js";
import { log } from "./ops/StructuredLog.js";

const port = Number(process.env["PORT"] ?? 2567);
const auth = createAuthServices({
  dataDir: process.env["EB_DATA_DIR"] ?? join(process.cwd(), "data"),
  allowedOrigins: (process.env["EB_ORIGINS"] ?? `https://localhost:${port}`).split(",").map((s) => s.trim()).filter(Boolean),
  secureCookies: process.env["EB_INSECURE_COOKIES"] !== "1",
  roomCodes: { play: "arena", practice: "practice" },
  buildId: process.env["EB_BUILD_ID"] ?? "dev",
});
const server = createGameServer(auth);
await server.listen(port);
log("info", "server listening", { port });
