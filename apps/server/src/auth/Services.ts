import { join } from "node:path";
import { InviteStore } from "./InviteStore.js";
import { SessionStore } from "./SessionStore.js";
import { JoinTicketStore } from "./JoinTicketStore.js";

export interface AuthConfig {
  dataDir: string;
  /** Exact origins allowed to call mutating endpoints, e.g. "https://studio.local:2567". */
  allowedOrigins: string[];
  /** Secure cookie flag. Always true outside local tests. */
  secureCookies: boolean;
  /** roomCode to Colyseus room name. The server owns room creation. */
  roomCodes: Record<string, string>;
  buildId: string;
  /** Per-source session attempts per minute. Default 5 (spec 24). */
  sessionsPerMinute?: number;
  /** Session attempts per minute across all sources. Default 30 (spec 24). */
  globalSessionsPerMinute?: number;
}

export interface AuthServices {
  config: AuthConfig;
  invites: InviteStore;
  sessions: SessionStore;
  tickets: JoinTicketStore;
  /** Set by createGameServer: finds or creates the live room for a code and returns its roomId. */
  ensureRoom: ((roomName: string, roomCode: string) => Promise<string>) | null;
}

export function createAuthServices(config: AuthConfig, now: () => number = Date.now): AuthServices {
  const sessions = new SessionStore(join(config.dataDir, "sessions.json"), now);
  const tickets = new JoinTicketStore(now);
  sessions.onRevoke((id) => tickets.revokeSession(id));
  return { config, invites: new InviteStore(join(config.dataDir, "invites.json"), now), sessions, tickets, ensureRoom: null };
}
