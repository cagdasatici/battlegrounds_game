// WEB5: admin API client against a fixture fetch (no DOM, no network).
import { describe, expect, it, vi } from "vitest";
import { AdminHttpError, createAdminApi } from "../../apps/client/src/admin/api.js";

const json = (status: number, body?: unknown): Response => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const login = (): Response => json(200, { csrfToken: "tok", expiresAt: 1 });

describe("admin api client", () => {
  it("sends the CSRF token from login on later calls and never before", async () => {
    const calls: RequestInit[] = [];
    const f = vi.fn(async (_u: string, init?: RequestInit) => { calls.push(init ?? {}); return calls.length === 1 ? login() : json(200, { announcement: null }); });
    const api = createAdminApi(() => undefined, f);
    await api.login("pw");
    expect((calls[0]!.headers as Record<string, string>)["x-csrf-token"]).toBeUndefined();
    await api.announcement();
    expect((calls[1]!.headers as Record<string, string>)["x-csrf-token"]).toBe("tok");
    expect(calls[1]!.credentials).toBe("same-origin");
  });
  it("401 after login clears the token and calls onUnauthorized; a failed login does not", async () => {
    const out = vi.fn();
    const seq = [json(401, { error: "LOGIN_FAILED" }), login(), json(401, { error: "UNAUTHENTICATED" })];
    const api = createAdminApi(out, async () => seq.shift()!);
    await expect(api.login("bad")).rejects.toBeInstanceOf(AdminHttpError);
    expect(out).not.toHaveBeenCalled();
    await api.login("pw");
    await expect(api.status()).rejects.toMatchObject({ status: 401 });
    expect(out).toHaveBeenCalledTimes(1);
  });
  it("encodes ids, maps 204 to undefined and rejects malformed responses", async () => {
    const urls: string[] = [];
    const seq = [login(), json(204), json(200, { rooms: [{ nope: 1 }] }), json(200, { id: "i", expiresAt: 2 })];
    const api = createAdminApi(() => undefined, async (u) => { urls.push(u); return seq.shift()!; });
    await api.login("pw");
    await expect(api.closeRoom("a/b c")).resolves.toBeUndefined();
    expect(urls[1]).toBe("/api/admin/rooms/a%2Fb%20c");
    await expect(api.rooms()).rejects.toBeTruthy();
    await expect(api.createInvite(1, 1)).rejects.toMatchObject({ status: 502 });
  });
  it("parses list and invite responses", async () => {
    const seq = [login(), json(200, { invites: [{ id: "x", createdAt: 1, expiresAt: 2, usesLeft: 1 }] }), json(201, { id: "x", expiresAt: 2, link: "https://h/#invite=t" })];
    const api = createAdminApi(() => undefined, async () => seq.shift()!);
    await api.login("pw");
    expect(await api.invites()).toHaveLength(1);
    expect((await api.createInvite(1, 1)).link).toContain("#invite=");
  });
});
