import { describe, expect, test } from "vitest";
import { checkNodeMajor, chooseOrigin, inviteLink, parsePlayArgs, pickLanIp, type RunCommand } from "../../ops/scripts/lib/play.js";

const status = (o: unknown): RunCommand => () => ({ stdout: JSON.stringify(o) });

describe("play args", () => {
  test("defaults", () => expect(parsePlayArgs([])).toEqual({ build: true, mode: "lan", hostIp: null, uses: 4, hours: 24 }));
  test("flags", () => expect(parsePlayArgs(["--no-build", "--local", "--uses", "2", "--hours=6"])).toEqual({ build: false, mode: "local", hostIp: null, uses: 2, hours: 6 }));
  test("modes and host ip", () => {
    expect(parsePlayArgs(["--tailscale"]).mode).toBe("tailscale");
    expect(parsePlayArgs(["--lan", "--host-ip", "192.168.1.20"])).toMatchObject({ mode: "lan", hostIp: "192.168.1.20" });
    expect(() => parsePlayArgs(["--host-ip", "8.8.8.8"])).toThrow(/private/);
  });
  test("rejects bad input", () => {
    expect(() => parsePlayArgs(["--uses", "0"])).toThrow();
    expect(() => parsePlayArgs(["--uses", "1.5"])).toThrow();
    expect(() => parsePlayArgs(["--hours"])).toThrow();
    expect(() => parsePlayArgs(["--funnel"])).toThrow(/unknown/);
  });
});

describe("node check", () => {
  test("24 passes", () => expect(checkNodeMajor("v24.22.2").ok).toBe(true));
  test("22 fails with the fix", () => {
    const r = checkNodeMajor("v22.23.4");
    expect(r.ok).toBe(false);
    expect(r.message).toContain('export PATH="$HOME/.local/node24/bin:$PATH"');
  });
});

describe("origin selection", () => {
  const good = { BackendState: "Running", Self: { DNSName: "studio.tail1234.ts.net." } };
  test("running tailscale with a DNS name uses https and serve, never funnel", () => {
    const c = chooseOrigin({ port: 2567, forceLocal: false, run: status(good) });
    expect(c).toEqual({ kind: "tailscale", origin: "https://studio.tail1234.ts.net", serveArgs: ["serve", "--bg", "http://127.0.0.1:2567"] });
    if (c.kind === "tailscale") expect(c.serveArgs.join(" ")).not.toMatch(/funnel/i);
  });
  test("--local forces loopback and does not call tailscale", () => {
    let called = false;
    const c = chooseOrigin({ port: 2600, forceLocal: true, run: () => { called = true; return null; } });
    expect(called).toBe(false);
    expect(c.kind).toBe("local");
    expect(c.origin).toBe("http://127.0.0.1:2600");
  });
  test("missing CLI falls back to local", () => expect(chooseOrigin({ port: 2567, forceLocal: false, run: () => null }).kind).toBe("local"));
  test("stopped backend falls back", () => expect(chooseOrigin({ port: 2567, forceLocal: false, run: status({ BackendState: "Stopped", Self: { DNSName: "a.ts.net." } }) }).kind).toBe("local"));
  test("missing or empty DNS name falls back", () => {
    expect(chooseOrigin({ port: 2567, forceLocal: false, run: status({ BackendState: "Running", Self: {} }) }).kind).toBe("local");
    expect(chooseOrigin({ port: 2567, forceLocal: false, run: status({ BackendState: "Running", Self: { DNSName: "." } }) }).kind).toBe("local");
  });
  test("garbage output and odd host names fall back", () => {
    expect(chooseOrigin({ port: 2567, forceLocal: false, run: () => ({ stdout: "not json" }) }).kind).toBe("local");
    expect(chooseOrigin({ port: 2567, forceLocal: false, run: status({ BackendState: "Running", Self: { DNSName: "a b/c.ts.net." } }) }).kind).toBe("local");
  });
  test("invite link puts the token in the fragment", () => expect(inviteLink("https://h.ts.net/", "tok")).toBe("https://h.ts.net/#invite=tok"));
});

describe("LAN ip selection", () => {
  const i = (address: string, internal = false, family: string | number = "IPv4") => ({ address, family, internal });
  test("prefers en0 and only RFC1918", () => {
    expect(pickLanIp({ lo0: [i("127.0.0.1", true)], en1: [i("10.0.0.5")], en0: [i("192.168.1.7")] })).toBe("192.168.1.7");
    expect(pickLanIp({ en0: [i("fe80::1", false, "IPv6"), i("203.0.113.9")], en5: [i("172.20.3.4")] })).toBe("172.20.3.4");
  });
  test("rejects 172.32, public, CGNAT, loopback; null when none", () => {
    expect(pickLanIp({ en0: [i("172.32.0.1"), i("100.64.1.1"), i("8.8.8.8")], lo0: [i("127.0.0.1", true)] })).toBeNull();
    expect(pickLanIp({})).toBeNull();
  });
});
