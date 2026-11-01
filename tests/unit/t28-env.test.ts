import { describe, expect, test } from "vitest";
import { ConfigError, parseServerEnv } from "../../apps/server/src/config/env.js";
import { resolveStaticPath } from "../../apps/server/src/http/staticFiles.js";

const ok = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://studio.example.ts.net", DATA_DIR: "/var/eb", BUILD_ID: "v1.0.0" };
const parse = (e: Record<string, string>) => parseServerEnv(e, "/cwd", "/repo");
const problems = (e: Record<string, string>): string[] => { try { parse(e); return []; } catch (x) { return (x as ConfigError).problems; } };

describe("T28 production env schema", () => {
  test("valid production config with defaults", () => {
    expect(parse(ok)).toMatchObject({ host: "127.0.0.1", port: 2567, publicOrigin: "https://studio.example.ts.net", roomCapacity: 4, logLevel: "info", staticDir: "/repo/apps/client/dist" });
  });
  test("production requires PUBLIC_ORIGIN, DATA_DIR and BUILD_ID", () => {
    const p = problems({ NODE_ENV: "production" }).join("|");
    expect(p).toMatch(/PUBLIC_ORIGIN is required/); expect(p).toMatch(/DATA_DIR is required/); expect(p).toMatch(/BUILD_ID is required/);
  });
  test("rejects non-loopback host, http origin, path origin, bad port, capacity, relative dirs", () => {
    expect(problems({ ...ok, HOST: "0.0.0.0" }).join()).toMatch(/loopback/);
    expect(problems({ ...ok, PUBLIC_ORIGIN: "http://x.example" }).join()).toMatch(/https/);
    expect(problems({ ...ok, PUBLIC_ORIGIN: "https://x.example/" }).join()).toMatch(/exact origin/);
    expect(problems({ ...ok, PORT: "99999" }).join()).toMatch(/PORT/);
    expect(problems({ ...ok, ROOM_CAPACITY: "8" }).join()).toMatch(/ROOM_CAPACITY/);
    expect(problems({ ...ok, DATA_DIR: "rel" }).join()).toMatch(/absolute/);
    expect(problems({ ...ok, LOG_LEVEL: "loud" }).join()).toMatch(/LOG_LEVEL/);
  });
  test("explicit local overrides are accepted", () => {
    expect(parse({ ...ok, PUBLIC_ORIGIN: "http://127.0.0.1:3000", EB_ALLOW_HTTP_ORIGIN: "1" }).publicOrigin).toBe("http://127.0.0.1:3000");
    expect(parse({ ...ok, HOST: "0.0.0.0", EB_ALLOW_NONLOOPBACK: "1" }).host).toBe("0.0.0.0");
  });
  test("error text never echoes values", () => {
    expect(problems({ ...ok, PUBLIC_ORIGIN: "https://user:hunter2-secret@x.example/path" }).join()).not.toMatch(/hunter2/);
  });
  test("development needs no configuration", () => {
    expect(parse({})).toMatchObject({ nodeEnv: "development", staticDir: null, buildId: "dev" });
  });
});

describe("T28 static path resolution", () => {
  test("stays inside the root", () => {
    expect(resolveStaticPath("/r", "/assets/a.js?x=1")).toBe("/r/assets/a.js");
    expect(resolveStaticPath("/r", "/../etc/passwd")).toBe("/r/etc/passwd");
    expect(resolveStaticPath("/r", "/%2e%2e/%2e%2e/etc/passwd")).toBe("/r/etc/passwd");
    expect(resolveStaticPath("/r", "/a%00b")).toBeNull();
    expect(resolveStaticPath("/r", "/%E0%A4%A")).toBeNull();
  });
});

describe("EB_LAN_HTTP home-network mode", () => {
  const lan = { NODE_ENV: "production", DATA_DIR: "/var/eb", BUILD_ID: "v1", HOST: "0.0.0.0", EB_ALLOW_NONLOOPBACK: "1", EB_ALLOW_HTTP_ORIGIN: "1", EB_LAN_HTTP: "1", PUBLIC_ORIGIN: "http://192.168.1.20:2567" };
  test("accepted for RFC1918 http origin on a non-loopback host", () => {
    expect(parse(lan)).toMatchObject({ lanHttp: true, host: "0.0.0.0" });
    expect(parse({ ...lan, PUBLIC_ORIGIN: "http://10.1.2.3:2567" }).lanHttp).toBe(true);
    expect(parse({ ...lan, PUBLIC_ORIGIN: "http://172.31.0.9:2567" }).lanHttp).toBe(true);
  });
  test("refused for public IPs, domains, https, 172.32 and loopback host", () => {
    for (const o of ["http://8.8.8.8:2567", "http://example.com:2567", "http://172.32.0.1:2567", "http://100.64.0.1:2567", "https://192.168.1.20:2567", "http://localhost:2567"]) {
      expect(problems({ ...lan, PUBLIC_ORIGIN: o }).join(), o).toMatch(/EB_LAN_HTTP/);
    }
    expect(problems({ ...lan, HOST: "127.0.0.1" }).join()).toMatch(/EB_LAN_HTTP requires a non-loopback HOST/);
    expect(problems({ ...lan, PUBLIC_ORIGIN: "" }).join()).toMatch(/EB_LAN_HTTP/);
  });
  test("lanHttp is false by default", () => {
    expect(parse(ok).lanHttp).toBe(false);
  });
});
