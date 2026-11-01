import { AtomicJsonStore } from "./AtomicJsonStore.js";
import { newToken, sha256 } from "./tokens.js";

interface InviteRecord { id: string; hash: string; createdAt: number; expiresAt: number; maxUses: number; uses: number; revoked: boolean }
interface InviteFile { invites: InviteRecord[] }

/** Stores only SHA-256 hashes of invitation tokens. Tokens are shown once at creation. */
export class InviteStore {
  private readonly store: AtomicJsonStore<InviteFile>;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.store = new AtomicJsonStore<InviteFile>(path, () => ({ invites: [] }));
  }

  create(opts: { ttlMs: number; maxUses: number }): { token: string; id: string; expiresAt: number } {
    const token = newToken(32);
    const data = this.store.read();
    const rec: InviteRecord = {
      id: sha256(token).slice(0, 8),
      hash: sha256(token),
      createdAt: this.now(),
      expiresAt: this.now() + opts.ttlMs,
      maxUses: opts.maxUses,
      uses: 0,
      revoked: false,
    };
    data.invites.push(rec);
    this.store.write(data);
    return { token, id: rec.id, expiresAt: rec.expiresAt };
  }

  /** Atomically consumes one use. Returns false for unknown, expired, revoked or exhausted invites. */
  consume(token: string): boolean {
    const h = sha256(token);
    const data = this.store.read();
    const rec = data.invites.find((i) => i.hash === h);
    if (!rec || rec.revoked || rec.expiresAt <= this.now() || rec.uses >= rec.maxUses) return false;
    rec.uses += 1;
    this.store.write(data);
    return true;
  }

  revoke(id: string): boolean {
    const data = this.store.read();
    const rec = data.invites.find((i) => i.id === id);
    if (!rec) return false;
    rec.revoked = true;
    this.store.write(data);
    return true;
  }
}
