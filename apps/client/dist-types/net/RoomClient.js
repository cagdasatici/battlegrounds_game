import { Client } from "@colyseus/sdk";
import { ClientMessage, PROTOCOL_VERSION, ServerMessage, checkCompatibility, } from "@eb/shared/protocol";
import { computeContentHash } from "@eb/shared/config/content";
export class ClientError extends Error {
    code;
    retryable;
    constructor(code, retryable) {
        super(code);
        this.code = code;
        this.retryable = retryable;
    }
}
const TOKEN_KEY = "eb.reconnect";
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Bounded exponential backoff: 0.5 s, 1 s, 2 s ... capped at 8 s, at most `attempts` tries. */
export async function withRetry(fn, attempts, sleep = defaultSleep) {
    let last;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        }
        catch (e) {
            last = e;
            if (e instanceof ClientError && !e.retryable)
                throw e;
            if (i < attempts - 1)
                await sleep(Math.min(8000, 500 * 2 ** i));
        }
    }
    throw last;
}
export class RoomClient {
    deps;
    localContentHash = computeContentHash();
    room = null;
    welcome = null;
    f;
    sleep;
    csrf = null;
    constructor(deps) {
        this.deps = deps;
        this.f = deps.fetchFn ?? ((...a) => fetch(...a));
        this.sleep = deps.sleep ?? defaultSleep;
    }
    async http(path, init = {}) {
        try {
            return await this.f(this.deps.httpBase + path, { credentials: "include", cache: "no-store", ...init });
        }
        catch {
            throw new ClientError("SERVER_OFFLINE", true);
        }
    }
    async checkVersion() {
        const r = await this.http("/api/version");
        if (!r.ok)
            throw new ClientError("SERVER_OFFLINE", true);
        const v = (await r.json());
        if (checkCompatibility(v, { protocolVersion: PROTOCOL_VERSION, contentHash: this.localContentHash }) !== "ok") {
            throw new ClientError("VERSION_MISMATCH", false);
        }
    }
    /** Exchanges an adult supplied invitation for a session. A display name never authenticates. */
    async login(invite, displayName) {
        const r = await this.http("/api/session", {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invite, displayName }),
        });
        if (r.status === 201)
            return;
        if (r.status === 429 || r.status >= 500)
            throw new ClientError("SERVER_OFFLINE", true);
        throw new ClientError("INVITE_INVALID", false);
    }
    async ensureCsrf() {
        if (this.csrf)
            return this.csrf;
        const r = await this.http("/api/csrf");
        if (!r.ok)
            throw new ClientError("INVITE_INVALID", false);
        this.csrf = (await r.json()).csrfToken;
        return this.csrf;
    }
    async requestTicket(roomCode) {
        const csrf = await this.ensureCsrf();
        const r = await this.http("/api/join-ticket", {
            method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrf }, body: JSON.stringify({ roomCode }),
        });
        if (r.status === 200)
            return (await r.json());
        if (r.status === 429 || r.status >= 500)
            throw new ClientError("SERVER_OFFLINE", true);
        throw new ClientError("INVITE_INVALID", false);
    }
    /** Fetches a fresh ticket and joins. Never silently enters a different room. */
    async join(roomCode) {
        await this.checkVersion();
        const t = await this.requestTicket(roomCode);
        const client = new Client(this.deps.wsEndpoint);
        let room;
        try {
            room = await client.joinById(t.roomId, {
                roomCode, ticket: t.ticket, protocolVersion: PROTOCOL_VERSION, contentHash: this.localContentHash,
            });
        }
        catch (e) {
            throw this.mapJoinError(e);
        }
        this.attach(room);
        return room;
    }
    mapJoinError(e) {
        const m = e instanceof Error ? e.message : String(e);
        if (/full|locked/i.test(m))
            return new ClientError("ROOM_FULL", true);
        if (/AUTH_FAILED|SEAT_TAKEN/.test(m))
            return new ClientError("INVITE_INVALID", false);
        return new ClientError("SERVER_OFFLINE", true);
    }
    attach(room) {
        this.room = room;
        // Old epoch input must never be replayed after a resync: no offline message buffering.
        room.reconnection.maxEnqueuedMessages = 0;
        room.onMessage(ServerMessage.welcome, (w) => { this.welcome = w; });
        try {
            this.deps.storage?.setItem(TOKEN_KEY, room.reconnectionToken);
        }
        catch { /* storage may be unavailable */ }
        room.onLeave(() => { try {
            this.deps.storage?.removeItem(TOKEN_KEY);
        }
        catch { /* ignore */ } });
    }
    send(type, payload) {
        this.room?.send(ClientMessage[type], payload);
    }
    async leave() {
        await this.room?.leave(true);
        this.room = null;
        this.welcome = null;
    }
    async logout() {
        const csrf = await this.ensureCsrf();
        await this.http("/api/session", { method: "DELETE", headers: { "x-csrf-token": csrf } });
        this.csrf = null;
    }
    /** Reload recovery: reconnect with the sessionStorage token, otherwise null (return to lobby). */
    async tryResume() {
        let token = null;
        try {
            token = this.deps.storage?.getItem(TOKEN_KEY) ?? null;
        }
        catch { /* ignore */ }
        if (!token)
            return null;
        try {
            const room = await new Client(this.deps.wsEndpoint).reconnect(token);
            this.attach(room);
            return room;
        }
        catch {
            try {
                this.deps.storage?.removeItem(TOKEN_KEY);
            }
            catch { /* ignore */ }
            return null;
        }
    }
    joinWithRetry(roomCode, attempts = 4) {
        return withRetry(() => this.join(roomCode), attempts, this.sleep);
    }
}
