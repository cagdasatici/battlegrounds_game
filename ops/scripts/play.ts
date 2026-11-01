// One-command start for the owner: pnpm play [--lan|--local|--tailscale] [--no-build] [--uses N] [--hours N]
// Builds, picks an origin (Tailscale Serve or loopback), creates an invitation BEFORE the server starts,
// prints the link and a QR code, runs the production server and stops it on Ctrl-C.
// The invitation token appears only in the printed link.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InviteStore } from "../../apps/server/src/auth/InviteStore.js";
import { chooseOrigin, checkNodeMajor, inviteLink, parsePlayArgs, pickLanIp, type RunCommand } from "./lib/play.js";
import { encodeQr, renderHalfBlocks } from "./lib/qr.js";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const say = (m: string): void => console.log(m);
const fail = (m: string): never => { console.error(`play: ${m}`); process.exit(1); };

const run: RunCommand = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 10_000 });
  return r.error || r.status !== 0 ? null : { stdout: r.stdout };
};

async function healthz(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1000) });
    return res.ok && ((await res.json()) as { ok?: unknown }).ok === true;
  } catch { return false; }
}

async function main(): Promise<void> {
  let args;
  try { args = parsePlayArgs(process.argv.slice(2)); } catch (e) { return fail((e as Error).message); }

  const node = checkNodeMajor(process.version);
  if (!node.ok) console.warn(`play: WARNING: ${node.message}`);
  if (!existsSync(join(root, "node_modules"))) return fail("node_modules is missing. Run: pnpm install");

  if (args.build) {
    say("Building (pnpm build)...");
    const b = spawnSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
    if (b.status !== 0) return fail("pnpm build failed");
  } else if (!existsSync(join(root, "apps/client/dist/index.html"))) {
    return fail("apps/client/dist is missing and --no-build was given. Run without --no-build.");
  }

  const port = Number(process.env["PORT"] ?? 2567);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail("PORT must be an integer from 1 to 65535");
  if (await healthz(port)) return fail(`something already answers on port ${port}. Stop it or set PORT.`);

  const dataDir = resolve(process.env["DATA_DIR"] ?? join(homedir(), "eb-data"));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const git = run("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
  const buildId = process.env["BUILD_ID"] ?? (git?.stdout.trim() || "local");

  let origin: string;
  let allowHttp = false;
  let lan = false;
  const override = process.env["PUBLIC_ORIGIN"];
  if (override) {
    origin = override;
    allowHttp = override.startsWith("http:");
    say(`Using PUBLIC_ORIGIN from the environment: ${origin}`);
  } else if (args.mode === "tailscale") {
    const choice = chooseOrigin({ port, forceLocal: false, run });
    if (choice.kind !== "tailscale") return fail(`--tailscale requested but ${choice.reason}. Use the default home-network mode or --local.`);
    origin = choice.origin;
    const s = spawnSync("tailscale", choice.serveArgs, { stdio: "inherit" });
    if (s.status !== 0) return fail("tailscale serve failed. Fix it or use the default mode.");
    say(`Tailscale Serve (tailnet only, no Funnel): ${origin}`);
  } else if (args.mode === "local") {
    origin = `http://127.0.0.1:${port}`;
    allowHttp = true;
    say(`Local mode: ${origin}`);
    say("NOTE: this address only works on this computer. iPads need the default home-network mode (or --tailscale).");
  } else {
    const ip = args.hostIp ?? pickLanIp(networkInterfaces());
    if (!ip) return fail("no private IPv4 address found (10.x, 172.16-31.x, 192.168.x). Connect to Wi-Fi, pass --host-ip <ip>, or use --local.");
    origin = `http://${ip}:${port}`;
    allowHttp = true;
    lan = true;
    say(`Home network mode: ${origin} (plain HTTP, reachable by devices on this network)`);
    say("iPad Safari: open the link, then Share > Add to Home Screen.");
    say("If macOS asks to allow incoming connections for node, click Allow.");
  }

  const store = new InviteStore(join(dataDir, "invites.json"));
  const { token, id, expiresAt } = store.create({ ttlMs: args.hours * 3600_000, maxUses: args.uses });
  const link = inviteLink(origin, token);
  say("");
  say(`Invitation ${id}: ${args.uses} use(s), expires ${new Date(expiresAt).toISOString()}`);
  say(link);
  try { say("\n" + renderHalfBlocks(encodeQr(link, { ecc: "M" })) + "\n"); }
  catch (e) { say(`(QR code skipped: ${(e as Error).message})`); }

  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port), PUBLIC_ORIGIN: origin, DATA_DIR: dataDir, BUILD_ID: buildId };
  if (allowHttp) env["EB_ALLOW_HTTP_ORIGIN"] = "1";
  if (lan) { env["HOST"] = "0.0.0.0"; env["EB_ALLOW_NONLOOPBACK"] = "1"; env["EB_LAN_HTTP"] = "1"; }
  const child = spawn(join(root, "apps/server/node_modules/.bin/tsx"), ["src/main.ts"], { cwd: join(root, "apps/server"), env, stdio: "inherit" });

  let stopping = false;
  const stop = (sig: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    say("\nStopping server...");
    child.kill(sig);
    setTimeout(() => child.kill("SIGKILL"), 15_000).unref();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  const exited = new Promise<number>((res) => child.on("exit", (code, sig) => res(code ?? (sig ? 1 : 0))));

  let ready = false;
  const deadline = Date.now() + 30_000;
  let early: number | null = null;
  void exited.then((c) => { early = c; });
  while (Date.now() < deadline && early === null && !stopping) {
    if (await healthz(port)) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready && !stopping) {
    if (early === null) child.kill("SIGTERM");
    return fail(early === null ? "server did not become healthy within 30 s" : `server exited early with code ${early}`);
  }
  if (ready) say(`Ready: ${origin}  (build ${buildId}, data ${dataDir}). Press Ctrl-C to stop.`);
  const code = await exited;
  if (args.mode === "tailscale" && !override) say("Tailscale Serve is still configured. To remove it: tailscale serve reset");
  process.exit(stopping ? 0 : code);
}

void main();
