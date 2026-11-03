import { join } from "node:path";
import { InviteStore } from "./InviteStore.js";
import { SessionStore } from "./SessionStore.js";
import { SparringDirectory } from "./SparringDirectory.js";
import { JoinTicketStore } from "./JoinTicketStore.js";
import type { AccessVerifier } from "./AccessJwt.js";
import { AdminAuth } from "../admin/AdminAuth.js";
import { AtomicJsonStore } from "./AtomicJsonStore.js";
import type { Difficulty } from "@eb/shared/sparring";
import type { RoundTarget } from "@eb/shared/protocol";
import type { Announcement } from "@eb/shared/admin";

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
  /** scrypt hash for the admin login. Admin routes answer 404 when absent. */
  adminPasswordHash?: string | null;
  /** OPEN_JOIN: players pick Arel or Nora and get a session without an invitation (access is gated by Cloudflare Access). */
  openJoin?: boolean;
  /** Cloudflare Access verifier. When set, open sessions require a valid Access token (fail closed). */
  access?: AccessVerifier | null;
}

export interface AuthServices {
  config: AuthConfig;
  sparring: SparringDirectory;
  now: () => number;
  closeRoom: (code: string) => Promise<void>;
  invites: InviteStore;
  sessions: SessionStore;
  tickets: JoinTicketStore;
  /** Null when the admin is disabled. */
  admin: AdminAuth | null;
  startedAt: number;
  /** Admin overrides for arena rooms (display name, listed). TODO: persist when rooms must survive a restart. */
  roomMeta: Map<string, { name: string; listed: boolean; bots?: Difficulty[]; roundTarget?: RoundTarget }>;
  announcement: { get(): Announcement | null; set(a: Announcement | null): void };
  /** Set by createGameServer: live seated humans and capacity of the room for a code (0 seated when no room is live). */
  occupancy: (roomName: string, roomCode: string) => { players: number; capacity: number };
  /** Set by createGameServer: finds or creates the live room for a code and returns its roomId. */
  ensureRoom: ((roomName: string, roomCode: string) => Promise<string>) | null;
}

export function createAuthServices(config: AuthConfig, now: () => number = Date.now): AuthServices {
  const sessions = new SessionStore(join(config.dataDir, "sessions.json"), now);
  const tickets = new JoinTicketStore(now);
  sessions.onRevoke((id) => tickets.revokeSession(id));
  const annStore = new AtomicJsonStore<{ announcement: Announcement | null }>(join(config.dataDir, "announcement.json"), () => ({ announcement: null }));
  const announcement = {
    get: (): Announcement | null => {
      const a = annStore.read().announcement;
      return a && (a.expiresAt === null || a.expiresAt > now()) ? a : null;
    },
    set: (a: Announcement | null): void => annStore.write({ announcement: a }),
  };
  const admin = config.adminPasswordHash ? new AdminAuth(config.adminPasswordHash, now) : null;
  return { admin, startedAt: now(), roomMeta: new Map(), announcement, config, now, sparring: new SparringDirectory((id) => sessions.getById(id) !== null, now), closeRoom: async () => undefined, invites: new InviteStore(join(config.dataDir, "invites.json"), now), sessions, tickets, ensureRoom: null, occupancy: () => ({ players: 0, capacity: 4 }) };
}
