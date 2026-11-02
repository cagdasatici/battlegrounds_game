import { AtomicJsonStore } from "./AtomicJsonStore.js";
import { newToken, sha256 } from "./tokens.js";

export const SESSION_IDLE_MS = 8 * 3600_000;
export const SESSION_ABSOLUTE_MS = 24 * 3600_000;

export interface SessionRecord {
  id: string; // sha256 of cookie token
  displayName: string;
  /** sha256 of the source address for open-join sessions; never the raw address. */
  ipHash?: string;
  csrf: string;
  createdAt: number;
  lastActive: number;
}
interface SessionFile { sessions: SessionRecord[] }

export class SessionStore {
  private readonly store: AtomicJsonStore<SessionFile>;
  private revokeListeners = new Set<(sessionId: string) => void>();
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.store = new AtomicJsonStore<SessionFile>(path, () => ({ sessions: [] }));
  }

  onRevoke(fn: (sessionId: string) => void): () => void {
    this.revokeListeners.add(fn);
    return () => this.revokeListeners.delete(fn);
  }

  create(displayName: string, ipHash?: string): { cookieToken: string; session: SessionRecord; expiresAt: number } {
    const cookieToken = newToken(32);
    const t = this.now();
    const session: SessionRecord = { id: sha256(cookieToken), displayName, csrf: newToken(24), createdAt: t, lastActive: t };
    if (ipHash !== undefined) session.ipHash = ipHash;
    const data = this.prune(this.store.read());
    data.sessions.push(session);
    this.store.write(data);
    return { cookieToken, session, expiresAt: this.expiry(session) };
  }

  private expiry(s: SessionRecord): number {
    return Math.min(s.lastActive + SESSION_IDLE_MS, s.createdAt + SESSION_ABSOLUTE_MS);
  }

  private prune(data: SessionFile): SessionFile {
    const t = this.now();
    data.sessions = data.sessions.filter((s) => this.expiry(s) > t);
    return data;
  }

  /** Looks up a live session. Refreshes idle expiry only when `touch` (authenticated activity). */
  get(cookieToken: string | undefined, touch = true): SessionRecord | null {
    if (!cookieToken) return null;
    const id = sha256(cookieToken);
    const data = this.store.read();
    const s = data.sessions.find((x) => x.id === id);
    if (!s || this.expiry(s) <= this.now()) return null;
    if (touch) {
      s.lastActive = this.now();
      this.store.write(data);
    }
    return s;
  }

  getById(id: string): SessionRecord | null {
    const s = this.store.read().sessions.find((x) => x.id === id);
    return s && this.expiry(s) > this.now() ? s : null;
  }

  /** Live sessions for the admin list. Ids are cut to a 12 character prefix (enough for revokeById, not a credential). */
  list(): { id: string; displayName: string; createdAt: number; lastActive: number }[] {
    const t = this.now();
    return this.store.read().sessions.filter((s) => this.expiry(s) > t)
      .map((s) => ({ id: s.id.slice(0, 12), displayName: s.displayName, createdAt: s.createdAt, lastActive: s.lastActive }));
  }

  /** Deletes expired records (spec 24: daily). Returns how many were removed. */
  purgeExpired(): number {
    const data = this.store.read();
    const before = data.sessions.length;
    this.prune(data);
    if (data.sessions.length !== before) this.store.write(data);
    return before - data.sessions.length;
  }

  /** Operator revoke by session id (or unique id prefix). Returns false when nothing matched. */
  revokeById(idOrPrefix: string): boolean {
    if (idOrPrefix.length < 8) return false;
    const data = this.store.read();
    const hits = data.sessions.filter((s) => s.id.startsWith(idOrPrefix));
    if (hits.length !== 1) return false;
    const id = hits[0]!.id;
    data.sessions = data.sessions.filter((s) => s.id !== id);
    this.store.write(data);
    for (const fn of this.revokeListeners) fn(id);
    return true;
  }

  revoke(cookieToken: string): void {
    const id = sha256(cookieToken);
    const data = this.store.read();
    const before = data.sessions.length;
    data.sessions = data.sessions.filter((s) => s.id !== id);
    if (data.sessions.length !== before) this.store.write(data);
    for (const fn of this.revokeListeners) fn(id);
  }
}
