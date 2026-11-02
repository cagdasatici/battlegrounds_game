import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, test } from "vitest";
import { AccessVerifier } from "../../apps/server/src/auth/AccessJwt.js";
import { parseServerEnv } from "../../apps/server/src/config/env.js";

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048 });
const enc = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString("base64url");
const mint = (priv: ReturnType<typeof pair>["privateKey"], claims: object, header: object = { alg: "RS256", kid: "k1" }): string => {
  const body = `${enc(header)}.${enc(claims)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), priv).toString("base64url")}`;
};
const AUD = "a".repeat(64);
const NOW = 1_800_000_000_000;
const good = { aud: [AUD], iss: "https://team.cloudflareaccess.com", exp: NOW / 1000 + 600, email: "me@example.com" };

function setup() {
  const k = pair();
  const jwk = { ...k.publicKey.export({ format: "jwk" }), kid: "k1" };
  let fetches = 0;
  const fetchFn = (async () => { fetches++; return new Response(JSON.stringify({ keys: [jwk] })); }) as typeof fetch;
  return { k, v: new AccessVerifier("team", AUD, fetchFn, () => NOW), fetches: () => fetches };
}

describe("Cloudflare Access token", () => {
  test("accepts a valid token and caches the certificates", async () => {
    const { k, v, fetches } = setup();
    expect(await v.verify(mint(k.privateKey, good))).toBe("me@example.com");
    expect(await v.verify(mint(k.privateKey, good))).toBe("me@example.com");
    expect(fetches()).toBe(1);
  });
  test("rejects missing, forged, expired, wrong audience and wrong issuer", async () => {
    const { k, v } = setup();
    expect(await v.verify(undefined)).toBeNull();
    expect(await v.verify("a.b.c")).toBeNull();
    expect(await v.verify(mint(pair().privateKey, good))).toBeNull(); // signed by another key
    expect(await v.verify(mint(k.privateKey, { ...good, exp: NOW / 1000 - 1 }))).toBeNull();
    expect(await v.verify(mint(k.privateKey, { ...good, aud: ["other"] }))).toBeNull();
    expect(await v.verify(mint(k.privateKey, { ...good, iss: "https://evil.cloudflareaccess.com" }))).toBeNull();
    expect(await v.verify(mint(k.privateKey, good, { alg: "none", kid: "k1" }))).toBeNull();
  });
});

describe("OPEN_JOIN configuration", () => {
  const base = { NODE_ENV: "production", PUBLIC_ORIGIN: "https://battle.example.com", OPEN_JOIN: "1" };
  test("production open join without Access is refused", () => {
    expect(() => parseServerEnv(base, "/tmp", "/tmp")).toThrow(/CF_ACCESS_TEAM/);
  });
  test("with Access settings it is accepted", () => {
    const e = parseServerEnv({ ...base, NODE_ENV: "development", CF_ACCESS_TEAM: "team", CF_ACCESS_AUD: AUD }, "/tmp", "/tmp");
    expect(e.openJoin).toBe(true);
    expect(e.accessTeam).toBe("team");
  });
});
