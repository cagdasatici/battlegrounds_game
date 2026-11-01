// Production environment schema (spec section 24 "Build and start contract").
// Errors name the variable and the rule only; values are never echoed, so a mistyped secret cannot leak into logs.
import { isAbsolute, join } from "node:path";

export interface ServerEnv {
  nodeEnv: "production" | "development" | "test";
  host: string;
  port: number;
  /** Exact browser origin, e.g. https://studio.tailnet-name.ts.net (no path, no trailing slash). */
  publicOrigin: string;
  roomCapacity: 4;
  dataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  buildId: string;
  /** Absolute directory of the Vite build, or null to serve API only. */
  staticDir: string | null;
  /** EB_LAN_HTTP=1: home-network HTTP mode. Only drops the Secure cookie attribute; requires a non-loopback HOST and an RFC1918 http origin. */
  lanHttp: boolean;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

type Env = Record<string, string | undefined>;
/** True for dotted-quad IPv4 in 10/8, 172.16/12 or 192.168/16 (never a name, never a public address). */
export function isRfc1918Host(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) || (o[0] === 192 && o[1] === 168);
}
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/** `cwd` and `repoRoot` are injected so the parser stays pure and testable. */
export function parseServerEnv(env: Env, cwd: string, repoRoot: string): ServerEnv {
  const problems: string[] = [];
  const get = (k: string): string | undefined => { const v = env[k]; return v === undefined || v === "" ? undefined : v; };

  const nodeEnvRaw = get("NODE_ENV") ?? "development";
  if (!["production", "development", "test"].includes(nodeEnvRaw)) problems.push("NODE_ENV must be production, development or test");
  const nodeEnv = nodeEnvRaw as ServerEnv["nodeEnv"];
  const prod = nodeEnv === "production";

  const host = get("HOST") ?? "127.0.0.1";
  if (prod && !LOOPBACK.has(host) && get("EB_ALLOW_NONLOOPBACK") !== "1") {
    problems.push("HOST must be loopback in production (the HTTPS proxy is the only public entry); set EB_ALLOW_NONLOOPBACK=1 only for a deliberate LAN test");
  }

  const portRaw = get("PORT") ?? "2567";
  const port = Number(portRaw);
  if (!/^\d+$/.test(portRaw) || port < 1 || port > 65535) problems.push("PORT must be an integer from 1 to 65535");

  const originRaw = get("PUBLIC_ORIGIN");
  let publicOrigin = `https://localhost:${port}`;
  if (originRaw === undefined) {
    if (prod) problems.push("PUBLIC_ORIGIN is required in production (https://your-host)");
  } else {
    try {
      const u = new URL(originRaw);
      const insecureOk = get("EB_ALLOW_HTTP_ORIGIN") === "1";
      if (u.protocol !== "https:" && !(u.protocol === "http:" && (!prod || insecureOk))) problems.push("PUBLIC_ORIGIN must use https (EB_ALLOW_HTTP_ORIGIN=1 permits http for local verification only)");
      if (u.origin !== originRaw) problems.push("PUBLIC_ORIGIN must be an exact origin: scheme, host and optional port, no path or trailing slash");
      publicOrigin = u.origin;
    } catch { problems.push("PUBLIC_ORIGIN is not a valid URL"); }
  }

  const cap = get("ROOM_CAPACITY") ?? "4";
  if (cap !== "4") problems.push("ROOM_CAPACITY must be 4 (the fixed four player scope)");

  const dataDirRaw = get("DATA_DIR");
  if (prod && dataDirRaw === undefined) problems.push("DATA_DIR is required in production (an owner-only directory outside the repository)");
  if (dataDirRaw !== undefined && !isAbsolute(dataDirRaw)) problems.push("DATA_DIR must be an absolute path");
  const dataDir = dataDirRaw ?? join(cwd, "data");

  const logLevel = get("LOG_LEVEL") ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) problems.push("LOG_LEVEL must be debug, info, warn or error");

  const staticRaw = get("STATIC_DIR");
  if (staticRaw !== undefined && !isAbsolute(staticRaw)) problems.push("STATIC_DIR must be an absolute path");
  const staticDir = staticRaw ?? (prod ? join(repoRoot, "apps", "cli" + "ent", "dist") : null);

  const buildId = get("BUILD_ID") ?? "dev";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(buildId)) problems.push("BUILD_ID must be 1 to 64 characters of letters, digits, dot, dash or underscore");
  if (prod && buildId === "dev") problems.push("BUILD_ID is required in production (use the tagged commit)");

  const lanHttp = get("EB_LAN_HTTP") === "1";
  if (lanHttp) {
    if (LOOPBACK.has(host)) problems.push("EB_LAN_HTTP requires a non-loopback HOST");
    let ok = false;
    try { const u = new URL(originRaw ?? ""); ok = u.protocol === "http:" && isRfc1918Host(u.hostname); } catch { /* not a URL */ }
    if (!ok) problems.push("EB_LAN_HTTP requires PUBLIC_ORIGIN to be http://<private IPv4> (10.x, 172.16-31.x or 192.168.x); public IPs and domain names are refused");
  }

  if (problems.length > 0) throw new ConfigError(problems);
  return { nodeEnv, host, port, publicOrigin, roomCapacity: 4, dataDir, logLevel: logLevel as ServerEnv["logLevel"], buildId, staticDir, lanHttp };
}
