import { newHexToken256, sha256 } from "./tokens.js";

export const TICKET_TTL_MS = 30_000;

interface Ticket { sessionId: string; roomName: string; roomCode: string; contentHash: string; protocolVersion: number; expiresAt: number }

/** One-use, short-lived, in-memory join tickets bound to session, room, content hash and protocol. */
export class JoinTicketStore {
  private tickets = new Map<string, Ticket>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(t: Omit<Ticket, "expiresAt">): { ticket: string; expiresAt: number } {
    this.sweep();
    const ticket = newHexToken256();
    const expiresAt = this.now() + TICKET_TTL_MS;
    this.tickets.set(sha256(ticket), { ...t, expiresAt });
    return { ticket, expiresAt };
  }

  /** Atomic consume: the ticket is deleted before any comparison, so a failed attempt also burns it. */
  consume(ticket: string, expect: { roomName: string; roomCode?: string; contentHash: string; protocolVersion: number }): { sessionId: string; roomCode: string } | null {
    const key = sha256(ticket);
    const t = this.tickets.get(key);
    if (!t) return null;
    this.tickets.delete(key);
    if (t.expiresAt <= this.now()) return null;
    if (t.roomName !== expect.roomName || t.contentHash !== expect.contentHash || t.protocolVersion !== expect.protocolVersion) return null;
    if (expect.roomCode !== undefined && t.roomCode !== expect.roomCode) return null;
    return { sessionId: t.sessionId, roomCode: t.roomCode };
  }

  revokeSession(sessionId: string): void {
    for (const [k, t] of this.tickets) if (t.sessionId === sessionId) this.tickets.delete(k);
  }

  private sweep(): void {
    const n = this.now();
    for (const [k, t] of this.tickets) if (t.expiresAt <= n) this.tickets.delete(k);
  }
}
