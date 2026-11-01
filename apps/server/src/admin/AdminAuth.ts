import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { newToken, sha256 } from "../auth/tokens.js";

const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const ADMIN_ABSOLUTE_MS = 2 * 3600_000;
export const ADMIN_IDLE_MS = 30 * 60_000;
export const LOCKOUT_FAILURES = 8;
export const LOCKOUT_MS = 15 * 60_000;
/** Format: scrypt$N$r$p$saltBase64url$hashBase64url */
export const HASH_FORMAT = /^scrypt\$\d{1,7}\$\d{1,3}\$\d{1,3}\$[A-Za-z0-9_-]{16,64}\$[A-Za-z0-9_-]{32,128}$/;

const derive = (password: string, salt: Buffer, n: number, r: number, p: number, len: number): Promise<Buffer> =>
  new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, len, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant-time comparison of the derived key. A malformed stored hash never verifies. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!HASH_FORMAT.test(stored)) return false;
  const [, n, r, p, salt, hash] = stored.split("$") as [string, string, string, string, string, string];
  const expected = Buffer.from(hash, "base64url");
  try {
    const got = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p), expected.length);
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch { return false; }
}

export interface AdminSession { id: string; csrf: string; createdAt: number; lastActive: number }

/** In-memory admin sessions (a restart signs the admin out) and per-source failure lockout. Separate from player sessions. */
export class AdminAuth {
  private readonly sessions = new Map<string, AdminSession>();
  private readonly failures = new Map<string, { n: number; lockedUntil: number }>();
  constructor(private readonly passwordHash: string, private readonly now: () => number = Date.now) {}

  locked(source: string): boolean {
    const f = this.failures.get(source);
    return !!f && f.lockedUntil > this.now();
  }

  /** Verifies a password; repeated failures from one source lock it out. */
  async login(source: string, password: string): Promise<{ cookieToken: string; csrf: string; expiresAt: number } | null> {
    if (this.locked(source)) return null;
    const ok = await verifyPassword(password, this.passwordHash);
    if (!ok) {
      const f = this.failures.get(source) ?? { n: 0, lockedUntil: 0 };
      f.n += 1;
      if (f.n >= LOCKOUT_FAILURES) { f.lockedUntil = this.now() + LOCKOUT_MS; f.n = 0; }
      if (this.failures.size > 10_000) this.failures.clear();
      this.failures.set(source, f);
      return null;
    }
    this.failures.delete(source);
    const t = this.now();
    const cookieToken = newToken(32);
    const s: AdminSession = { id: sha256(cookieToken), csrf: newToken(24), createdAt: t, lastActive: t };
    this.prune();
    this.sessions.set(s.id, s);
    return { cookieToken, csrf: s.csrf, expiresAt: this.expiry(s) };
  }

  private expiry(s: AdminSession): number { return Math.min(s.createdAt + ADMIN_ABSOLUTE_MS, s.lastActive + ADMIN_IDLE_MS); }
  private prune(): void {
    const t = this.now();
    for (const [id, s] of this.sessions) if (this.expiry(s) <= t) this.sessions.delete(id);
  }

  get(cookieToken: string | undefined): AdminSession | null {
    if (!cookieToken) return null;
    const s = this.sessions.get(sha256(cookieToken));
    if (!s || this.expiry(s) <= this.now()) return null;
    s.lastActive = this.now();
    return s;
  }

  logout(cookieToken: string | undefined): void {
    if (cookieToken) this.sessions.delete(sha256(cookieToken));
  }
}
