// Pure helpers for ops/scripts/play.ts so they can be unit-tested with injected command results.
export type PlayMode = "lan" | "local" | "tailscale";
export interface PlayArgs { build: boolean; mode: PlayMode; hostIp: string | null; uses: number; hours: number }

export function parsePlayArgs(argv: string[]): PlayArgs {
  const out: PlayArgs = { build: true, mode: "lan", hostIp: null, uses: 4, hours: 24 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const num = (name: string): number => {
      const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      const n = Number(raw);
      if (raw === undefined || raw === "" || !Number.isFinite(n) || n <= 0 || (name === "uses" && !Number.isInteger(n))) throw new Error(`--${name} needs a positive ${name === "uses" ? "integer" : "number"}`);
      return n;
    };
    if (a === "--no-build") out.build = false;
    else if (a === "--local") out.mode = "local";
    else if (a === "--lan") out.mode = "lan";
    else if (a === "--tailscale") out.mode = "tailscale";
    else if (a === "--host-ip" || a.startsWith("--host-ip=")) {
      const raw = a.includes("=") ? a.slice(a.indexOf("=") + 1) : argv[++i];
      if (raw === undefined || !isRfc1918(raw)) throw new Error("--host-ip needs a private IPv4 address (10.x, 172.16-31.x, 192.168.x)");
      out.hostIp = raw;
    }
    else if (a === "--uses" || a.startsWith("--uses=")) out.uses = num("uses");
    else if (a === "--hours" || a.startsWith("--hours=")) out.hours = num("hours");
    else throw new Error(`unknown argument ${a} (use --lan, --local, --tailscale, --host-ip IP, --no-build, --uses N, --hours N)`);
  }
  return out;
}

export interface NodeCheck { ok: boolean; message: string }
export function checkNodeMajor(version: string): NodeCheck {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  if (major === 24) return { ok: true, message: `Node ${version}` };
  return { ok: false, message: `Node ${version} found but this project needs Node 24. Fix: export PATH="$HOME/.local/node24/bin:$PATH"` };
}

/** Result of running a command: stdout text, or null when the command is missing or failed. */
export type RunResult = { stdout: string } | null;
export type RunCommand = (cmd: string, args: string[]) => RunResult;

export type OriginChoice =
  | { kind: "tailscale"; origin: string; serveArgs: string[] }
  | { kind: "local"; origin: string; reason: string };

/** Tailscale Serve (tailnet only, never Funnel) when the CLI reports a running backend with a DNS name; otherwise loopback HTTP. */
export function chooseOrigin(opts: { port: number; forceLocal: boolean; run: RunCommand }): OriginChoice {
  const local = (reason: string): OriginChoice => ({ kind: "local", origin: `http://127.0.0.1:${opts.port}`, reason });
  if (opts.forceLocal) return local("--local given");
  const res = opts.run("tailscale", ["status", "--json"]);
  if (res === null) return local("tailscale CLI not found or not responding");
  let parsed: unknown;
  try { parsed = JSON.parse(res.stdout); } catch { return local("tailscale status output was not JSON"); }
  const obj = parsed as { BackendState?: unknown; Self?: { DNSName?: unknown } };
  if (obj.BackendState !== "Running") return local(`tailscale backend is ${typeof obj.BackendState === "string" ? obj.BackendState : "unknown"}, not Running`);
  const dns = obj.Self?.DNSName;
  if (typeof dns !== "string" || dns.replace(/\.$/, "") === "") return local("tailscale reports no DNS name (enable MagicDNS and HTTPS certificates)");
  const host = dns.replace(/\.$/, "");
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return local("tailscale DNS name has unexpected characters");
  return { kind: "tailscale", origin: `https://${host}`, serveArgs: ["serve", "--bg", `http://127.0.0.1:${opts.port}`] };
}

export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/#invite=${token}`;
}

export function isRfc1918(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  return o[0] === 10 || (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) || (o[0] === 192 && o[1] === 168);
}

export interface NetIf { address: string; family: string | number; internal: boolean }
/** Private IPv4 of the active interface: en0 first, then other non-internal interfaces in name order. */
export function pickLanIp(ifs: Record<string, NetIf[] | undefined>): string | null {
  const names = Object.keys(ifs).sort((a, b) => (a === "en0" ? -1 : b === "en0" ? 1 : a.localeCompare(b)));
  for (const name of names) {
    for (const i of ifs[name] ?? []) {
      if ((i.family === "IPv4" || i.family === 4) && !i.internal && isRfc1918(i.address)) return i.address;
    }
  }
  return null;
}
