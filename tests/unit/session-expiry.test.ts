import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SessionStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "../../apps/server/src/auth/SessionStore.js";

const mk = () => {
  let t = 1_000_000;
  const s = new SessionStore(join(mkdtempSync(join(tmpdir(), "eb-se-")), "s.json"), () => t);
  return { s, set: (n: number) => { t = n; }, get: () => t };
};

test("touchMany refreshes live sessions but never an expired one, and never beyond the absolute cap", () => {
  const { s, set, get } = mk();
  const a = s.create("A").session;
  const b = s.create("B").session;
  set(get() + SESSION_IDLE_MS - 10);
  expect(s.touchMany([a.id])).toBe(1);
  set(get() + SESSION_IDLE_MS - 10); // B's idle window lapsed; A was refreshed
  expect(s.getById(b.id)).toBeNull();
  expect(s.touchMany([b.id])).toBe(0);
  expect(s.getById(b.id)).toBeNull();
  set(a.createdAt + SESSION_ABSOLUTE_MS + 1);
  expect(s.touchMany([a.id])).toBe(0);
  expect(s.getById(a.id)).toBeNull();
});

test("purgeExpired emits revocation for each removed id", () => {
  const { s, set } = mk();
  const a = s.create("A").session;
  const seen: string[] = [];
  s.onRevoke((id) => seen.push(id));
  set(a.createdAt + SESSION_ABSOLUTE_MS + 1);
  expect(s.purgeExpired()).toBe(1);
  expect(seen).toEqual([a.id]);
  expect(s.purgeExpired()).toBe(0);
});
