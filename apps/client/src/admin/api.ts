import type { Difficulty } from "@eb/shared/sparring";
import {
  AdminInviteRowSchema, AdminLoginResponseSchema, AdminRoomRowSchema, AdminSessionRowSchema, AdminStatusSchema, AnnouncementResponseSchema,
  type AdminInviteRow, type AdminRoomRow, type AdminSessionRow, type AdminStatus, type Announcement,
} from "@eb/shared/admin";

/** WEB5: typed admin API client. The CSRF token lives in memory only; a page reload returns to Login. */
export class AdminHttpError extends Error {
  constructor(readonly status: number) { super(`admin request failed: ${status}`); }
}
export interface InviteCreated { id: string; expiresAt: number; link: string }
export interface AdminApi {
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  status(): Promise<AdminStatus>;
  invites(): Promise<AdminInviteRow[]>;
  createInvite(ttlHours: number, maxUses: number): Promise<InviteCreated>;
  revokeInvite(id: string): Promise<void>;
  sessions(): Promise<AdminSessionRow[]>;
  revokeSession(id: string): Promise<void>;
  rooms(): Promise<AdminRoomRow[]>;
  createRoom(name: string, bots?: Difficulty[], roundTarget?: 0 | 5 | 10): Promise<AdminRoomRow>;
  setListed(code: string, listed: boolean): Promise<void>;
  closeRoom(code: string): Promise<void>;
  announcement(): Promise<Announcement | null>;
  setAnnouncement(text: string): Promise<Announcement | null>;
}
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** onUnauthorized fires on any 401 after login so the app can return to the Login screen. */
export function createAdminApi(onUnauthorized: () => void, f: Fetch = (i, o) => fetch(i, o)): AdminApi {
  let csrf = "";
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await f(`/api/admin${path}`, {
      method, credentials: "same-origin",
      headers: { ...(csrf ? { "x-csrf-token": csrf } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 401 && path !== "/login") { csrf = ""; onUnauthorized(); }
    if (!res.ok) throw new AdminHttpError(res.status);
    return res.status === 204 ? undefined : res.json();
  };
  const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
  return {
    async login(password) { csrf = AdminLoginResponseSchema.parse(await call("POST", "/login", { password })).csrfToken; },
    async logout() { try { await call("POST", "/logout"); } finally { csrf = ""; } },
    async status() { return AdminStatusSchema.parse(await call("GET", "/status")); },
    async invites() { return AdminInviteRowSchema.array().parse(obj(await call("GET", "/invites"))["invites"]); },
    async createInvite(ttlHours, maxUses) {
      const r = obj(await call("POST", "/invites", { ttlHours, maxUses }));
      if (typeof r["id"] !== "string" || typeof r["link"] !== "string" || typeof r["expiresAt"] !== "number") throw new AdminHttpError(502);
      return { id: r["id"], expiresAt: r["expiresAt"], link: r["link"] };
    },
    async revokeInvite(id) { await call("DELETE", `/invites/${encodeURIComponent(id)}`); },
    async sessions() { return AdminSessionRowSchema.array().parse(obj(await call("GET", "/sessions"))["sessions"]); },
    async revokeSession(id) { await call("DELETE", `/sessions/${encodeURIComponent(id)}`); },
    async rooms() { return AdminRoomRowSchema.array().parse(obj(await call("GET", "/rooms"))["rooms"]); },
    async createRoom(name, bots = [], roundTarget = 0) { return AdminRoomRowSchema.parse(await call("POST", "/rooms", { name, bots, roundTarget: bots.length === 0 ? 0 : roundTarget })); },
    async setListed(code, listed) { await call("PATCH", `/rooms/${encodeURIComponent(code)}`, { listed }); },
    async closeRoom(code) { await call("DELETE", `/rooms/${encodeURIComponent(code)}`); },
    async announcement() { return AnnouncementResponseSchema.parse(await call("GET", "/announcement")).announcement; },
    async setAnnouncement(text) { return AnnouncementResponseSchema.parse(await call("PUT", "/announcement", { text })).announcement; },
  };
}
