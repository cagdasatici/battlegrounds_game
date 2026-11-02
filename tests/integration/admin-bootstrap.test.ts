import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { saveAdminPassword } from "../../ops/scripts/lib/adminSetup.js";

// Exercises the actual owner launcher, not an injected AuthServices instance.
test.each(["play", "production"])("%s bootstrap consumes the private setup file and serves authenticated admin bot configuration", async (mode) => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const req = createRequire(join(root, "apps/server/package.json"));
  const dir = mkdtempSync(join(tmpdir(), "eb-admin-launch-")), password = "bootstrap fixture password 0123";
  await saveAdminPassword(dir, password);
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const p = (socket.address() as { port: number }).port; socket.close(() => resolve(p)); });
  });
  const origin = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_ENABLED: "1", HOST: "127.0.0.1", NODE_ENV: "production", BUILD_ID: "admin-bootstrap", EB_ALLOW_HTTP_ORIGIN: "1" };
  delete env["ADMIN_PASSWORD_HASH"]; env["PUBLIC_ORIGIN"] = origin;
  const args = mode === "play" ? ["ops/scripts/play.ts", "--local", "--no-build"] : ["apps/server/src/main.ts"];
  const child = spawn(process.execPath, ["--import", req.resolve("tsx"), ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  // Output contains a generated fixture invitation. Keep it in memory and never include it in assertion diagnostics.
  let output = ""; child.stdout.on("data", chunk => { output += String(chunk); }); child.stderr.on("data", () => {});
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  try {
    let ready = false;
    for (let i = 0; i < 150 && child.exitCode === null; i++) {
      try { if ((await fetch(origin + "/healthz")).ok) { ready = true; break; } } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(ready, "launcher becomes healthy with the stored admin hash").toBe(true);
    if (mode === "play") {
    expect(output.includes(`Game home (bookmark this): ${origin}/`)).toBe(true);
    expect(output.includes(`Admin: ${origin}/admin.html`)).toBe(true);
    }
    expect(output.includes(password)).toBe(false); expect(output.includes("scrypt$")).toBe(false);
    const response = await fetch(origin + "/api/admin/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password }) });
    expect(response.status).toBe(200);
    const csrf = (await response.json() as { csrfToken: string }).csrfToken;
    const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
    const room = await fetch(origin + "/api/admin/rooms", { method: "POST", headers: { origin, cookie, "x-csrf-token": csrf, "content-type": "application/json" }, body: JSON.stringify({ name: "Bootstrap room", bots: ["easy"] }) });
    expect(room.status).toBe(201); expect((await room.json() as { bots: number }).bots).toBe(1);
    expect((await fetch(origin + "/api/admin/rooms")).status).toBe(401);
  } finally {
    child.kill("SIGINT");
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000); kill.unref();
    await exited; clearTimeout(kill); output = ""; rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
