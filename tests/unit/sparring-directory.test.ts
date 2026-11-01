import { describe, expect, test } from "vitest";
import { SparringDirectory, SparringError, type SparringPrincipal } from "../../apps/server/src/auth/SparringDirectory.js";
import { SparringRoomCodeSchema, SparringTokenSchema } from "../../packages/shared/src/sparring.js";

function fixture(bots: ("easy" | "medium" | "hard")[] = []) {
  let time = 1000;
  const live = new Set(["adult", "other"]);
  const directory = new SparringDirectory((id) => live.has(id), () => time);
  const host: SparringPrincipal = { kind: "host", id: "adult" };
  const { roomCode } = directory.create(host, { bots });
  const join = () => directory.connected(host, roomCode, "host-1");
  const guest = () => directory.redeem(directory.link(host, roomCode).token, "Guest");
  return { directory, host, roomCode, join, guest, live, at: (value: number) => { time = value; } };
}
function status(fn: () => unknown, expected: number) {
  try { fn(); expect.fail("Expected rejection"); } catch (error) {
    expect(error).toBeInstanceOf(SparringError);
    expect((error as SparringError).status).toBe(expected);
  }
}

describe("BOT2 private membership", () => {
  test("creation validates authority/config and freezes ordered roster", () => {
    const f = fixture(["hard", "easy", "medium"]);
    expect(SparringRoomCodeSchema.safeParse(f.roomCode).success).toBe(true);
    const config = f.directory.config(f.host, f.roomCode);
    config.bots.pop();
    expect(f.directory.config(f.host, f.roomCode).bots).toEqual(["hard", "easy", "medium"]);
    status(() => f.directory.create(f.host, { bots: [] }), 409);
    status(() => f.directory.create({ kind: "guest", id: "adult" }, { bots: [] }), 403);
    status(() => f.directory.create({ kind: "host", id: "absent" }, { bots: [] }), 401);
    status(() => f.directory.create({ kind: "host", id: "other" }, { bots: ["wrong"] as never }), 400);
    f.join();
    status(() => f.directory.link(f.host, f.roomCode), 409);
  });

  test.each([0, 1, 2, 3])("four-seat cap includes %i bots and every reserved human", (count) => {
    const f = fixture(Array.from({ length: count }, () => "easy" as const)); f.join();
    for (let i = 0; i < 3 - count; i++) f.guest();
    status(() => f.directory.link(f.host, f.roomCode), 409);
    expect(f.directory.config(f.host, f.roomCode).bots).toHaveLength(count);
  });

  test("links require joined owner, replace previous, and are single use", () => {
    const f = fixture();
    status(() => f.directory.link(f.host, f.roomCode), 409);
    f.join();
    status(() => f.directory.link({ kind: "host", id: "other" }, f.roomCode), 403);
    const old = f.directory.link(f.host, f.roomCode);
    const link = f.directory.link(f.host, f.roomCode);
    expect(SparringTokenSchema.safeParse(link.token).success).toBe(true);
    expect(link.expiresAt).toBe(601000);
    status(() => f.directory.redeem(old.token, "Guest"), 401);
    const guest = f.directory.redeem(link.token, "Guest");
    expect(guest.csrfToken).toHaveLength(32);
    expect(guest.principal.id).not.toBe(guest.cookieToken);
    status(() => f.directory.redeem(link.token, "Again"), 401);
    expect(f.directory.guest(guest.cookieToken)?.principal).toEqual(guest.principal);
    expect(f.directory.guest(undefined)).toBeNull();
    expect(f.directory.guest("unknown")).toBeNull();
    // Serialized internal state contains hashes, not link or cookie bearers.
    const stored = JSON.stringify([...(f.directory as unknown as { matches: Map<string, unknown> }).matches.values()]);
    expect(stored).not.toContain(link.token);
    expect(stored).not.toContain(guest.cookieToken);
  });

  test("link expiry is exclusive at the exact wall-time boundary", () => {
    const f = fixture(); f.join();
    const link = f.directory.link(f.host, f.roomCode);
    f.at(link.expiresAt);
    status(() => f.directory.redeem(link.token, "Guest"), 401);
    expect(f.directory.sweep()).toEqual([]);
    const next = f.directory.link(f.host, f.roomCode);
    f.at(next.expiresAt - 1);
    expect(f.directory.redeem(next.token, "Guest").roomCode).toBe(f.roomCode);
  });

  test("last-seat competing redemptions reserve once; tickets cannot grow reservations", () => {
    const f = fixture(["easy", "hard"]); f.join();
    const link = f.directory.link(f.host, f.roomCode);
    const guest = f.directory.redeem(link.token, "Guest");
    status(() => f.directory.redeem(link.token, "Racer"), 401);
    status(() => f.directory.link(f.host, f.roomCode), 409);
    for (let i = 0; i < 5; i++) expect(f.directory.authorizeJoin(guest.principal, f.roomCode).principal).toEqual(guest.principal);
    f.at(60999);
    expect(f.directory.authorizeJoin(guest.principal, f.roomCode)).toBeTruthy();
    f.at(61000);
    expect(f.directory.guest(guest.cookieToken)).toBeNull();
    status(() => f.directory.authorizeJoin(guest.principal, f.roomCode), 403);
    expect(f.directory.link(f.host, f.roomCode)).toBeTruthy();
  });

  test("guest authority and membership cannot cross room boundaries", () => {
    const f = fixture(); f.join(); const guest = f.guest();
    const other: SparringPrincipal = { kind: "host", id: "other" };
    const second = f.directory.create(other, { bots: [] });
    status(() => f.directory.authorizeJoin(guest.principal, second.roomCode), 403);
    status(() => f.directory.authorizeJoin(other, f.roomCode), 403);
    status(() => f.directory.end(guest.principal, f.roomCode), 403);
    status(() => f.directory.link(guest.principal, f.roomCode), 403);
    status(() => f.directory.create(guest.principal, { bots: [] }), 403);
    // A guest hash relabeled as an ordinary session does not authorize.
    status(() => f.directory.authorizeJoin({ kind: "host", id: guest.principal.id }, f.roomCode), 403);
    status(() => f.directory.redeem("malformed", "Guest"), 400);
    const link = f.directory.link(f.host, f.roomCode);
    status(() => f.directory.redeem(link.token, ""), 400);
    expect(f.directory.redeem(link.token, "Valid").roomCode).toBe(f.roomCode);
  });

  test("atomic admission rejects duplicate consumers and ignores stale connection callbacks", () => {
    const f = fixture(); f.join(); const guest = f.guest();
    f.directory.authorizeJoin(guest.principal, f.roomCode);
    f.directory.authorizeJoin(guest.principal, f.roomCode);
    f.directory.connected(guest.principal, f.roomCode, "g1");
    status(() => f.directory.connected(guest.principal, f.roomCode, "g2"), 409);
    status(() => f.directory.authorizeJoin(guest.principal, f.roomCode), 409);
    f.directory.dropped(guest.principal, f.roomCode, "g1");
    f.at(20999);
    f.directory.connected(guest.principal, f.roomCode, "g2");
    f.directory.left(guest.principal, f.roomCode, "g1");
    f.directory.dropped(guest.principal, f.roomCode, "g1");
    status(() => f.directory.authorizeJoin(guest.principal, f.roomCode), 409);
    f.directory.left(guest.principal, f.roomCode, "g2");
    expect(f.directory.guest(guest.cookieToken)).toBeNull();
  });

  test("host initial join timeout closes without any clients; repeat tickets do not extend it", () => {
    const f = fixture();
    f.at(60999); expect(f.directory.authorizeJoin(f.host, f.roomCode)).toBeTruthy();
    f.at(61000); status(() => f.directory.connected(f.host, f.roomCode, "late"), 409);
    expect(f.directory.sweep()).toEqual([f.roomCode]);
    expect(f.directory.sweep()).toEqual([]);
    expect(f.directory.create(f.host, { bots: [] }).roomCode).not.toBe(f.roomCode);
  });

  test("host reconnect grace preserves seats until boundary, then closes links and all guests", () => {
    const f = fixture(); f.join(); const guest = f.guest();
    const link = f.directory.link(f.host, f.roomCode);
    f.directory.dropped(f.host, f.roomCode, "host-1");
    f.at(20999); expect(f.directory.sweep()).toEqual([]);
    f.directory.connected(f.host, f.roomCode, "host-2");
    f.directory.left(f.host, f.roomCode, "host-1");
    f.directory.dropped(f.host, f.roomCode, "host-2");
    f.at(40999);
    expect(f.directory.sweep()).toEqual([f.roomCode]);
    expect(f.directory.guest(guest.cookieToken)).toBeNull();
    status(() => f.directory.redeem(link.token, "Late"), 401);
    status(() => f.directory.authorizeJoin(guest.principal, f.roomCode), 409);
  });

  test.each(["leave", "end", "revoke"])("%s invalidates scoped credentials and clears reservations", (action) => {
    const f = fixture(); f.join(); const guest = f.guest();
    const link = f.directory.link(f.host, f.roomCode);
    if (action === "leave") f.directory.left(f.host, f.roomCode, "host-1");
    if (action === "end") f.directory.end(f.host, f.roomCode);
    if (action === "revoke") { f.live.delete(f.host.id); expect(f.directory.sweep()).toEqual([f.roomCode]); }
    expect(f.directory.guest(guest.cookieToken)).toBeNull();
    status(() => f.directory.redeem(link.token, "Guest"), 401);
    if (action !== "revoke") expect(f.directory.create(f.host, { bots: [] })).toBeTruthy();
  });

  test("connected guests do not expire, dropped guests release only their own seat at grace boundary", () => {
    const f = fixture(); f.join(); const guest = f.guest();
    f.directory.connected(guest.principal, f.roomCode, "g1");
    f.at(70000); expect(f.directory.guest(guest.cookieToken)).toBeTruthy();
    f.directory.dropped(guest.principal, f.roomCode, "g1");
    f.at(89999); expect(f.directory.guest(guest.cookieToken)).toBeTruthy();
    f.at(90000); expect(f.directory.sweep()).toEqual([]);
    expect(f.directory.guest(guest.cookieToken)).toBeNull();
    expect(f.directory.link(f.host, f.roomCode)).toBeTruthy();
    expect(new SparringDirectory(() => true).guest(guest.cookieToken)).toBeNull();
  });
});
