import { describe, expect, test } from "vitest";
import { AdminAuth, ADMIN_ABSOLUTE_MS, ADMIN_IDLE_MS, HASH_FORMAT, LOCKOUT_FAILURES, LOCKOUT_MS, hashPassword, verifyPassword } from "../../apps/server/src/admin/AdminAuth.js";
import { parseServerEnv } from "../../apps/server/src/config/env.js";

const PW = "correct horse battery";
let hash: string;
const getHash = async (): Promise<string> => (hash ??= await hashPassword(PW));

describe("scrypt hash", () => {
  test("round trip; wrong password and malformed hash fail; salts differ", async () => {
    const h = await getHash();
    expect(h).toMatch(HASH_FORMAT);
    expect(h).not.toContain(PW);
    expect(await verifyPassword(PW, h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword(PW, "not-a-hash")).toBe(false);
    expect(await hashPassword(PW)).not.toBe(h);
  });
});

describe("AdminAuth sessions and lockout", () => {
  test("login, idle and absolute expiry, logout", async () => {
    let t = 1_000_000;
    const a = new AdminAuth(await getHash(), () => t);
    const ok = await a.login("ip", PW);
    expect(ok).not.toBeNull();
    expect(a.get(ok!.cookieToken)?.csrf).toBe(ok!.csrf);
    t += ADMIN_IDLE_MS - 1;
    expect(a.get(ok!.cookieToken)).not.toBeNull(); // touches idle
    t += ADMIN_IDLE_MS + 1;
    expect(a.get(ok!.cookieToken)).toBeNull();
    const again = (await a.login("ip", PW))!;
    for (let i = 0; i < 3; i++) { t += ADMIN_IDLE_MS - 1; expect(a.get(again.cookieToken)).not.toBeNull(); }
    t += ADMIN_ABSOLUTE_MS;
    expect(a.get(again.cookieToken)).toBeNull();
    const third = (await a.login("ip", PW))!;
    a.logout(third.cookieToken);
    expect(a.get(third.cookieToken)).toBeNull();
    expect(a.get(undefined)).toBeNull();
  });

  test("repeated failures lock the source out, even for the right password, until the lockout ends", async () => {
    let t = 5_000;
    const a = new AdminAuth(await getHash(), () => t);
    for (let i = 0; i < LOCKOUT_FAILURES; i++) expect(await a.login("ip", "bad")).toBeNull();
    expect(a.locked("ip")).toBe(true);
    expect(await a.login("ip", PW)).toBeNull();
    expect(a.locked("other")).toBe(false);
    t += LOCKOUT_MS + 1;
    expect(a.locked("ip")).toBe(false);
    expect(await a.login("ip", PW)).not.toBeNull();
  });
});

describe("env", () => {
  const base = { NODE_ENV: "development" };
  test("hash optional; invalid or forced flags are rejected without echoing the value", async () => {
    expect(parseServerEnv(base, "/c", "/r").adminPasswordHash).toBeNull();
    const h = await getHash();
    expect(parseServerEnv({ ...base, ADMIN_PASSWORD_HASH: h }, "/c", "/r").adminPasswordHash).toBe(h);
    expect(parseServerEnv({ ...base, ADMIN_PASSWORD_HASH: h, ADMIN_ENABLED: "0" }, "/c", "/r").adminPasswordHash).toBeNull();
    expect(() => parseServerEnv({ ...base, ADMIN_PASSWORD_HASH: "secret-plain" }, "/c", "/r")).toThrow(/ADMIN_PASSWORD_HASH/);
    try { parseServerEnv({ ...base, ADMIN_PASSWORD_HASH: "secret-plain" }, "/c", "/r"); } catch (e) { expect(String(e)).not.toContain("secret-plain"); }
    expect(() => parseServerEnv({ ...base, ADMIN_ENABLED: "1" }, "/c", "/r")).toThrow(/requires ADMIN_PASSWORD_HASH/);
  });
});
