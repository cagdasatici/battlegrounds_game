import { type Room } from "@colyseus/sdk";
import { ClientMessage, type ClientErrorCode, type JoinTicketResponse, type WelcomeMessage } from "@eb/shared/protocol";
export declare class ClientError extends Error {
    readonly code: ClientErrorCode;
    readonly retryable: boolean;
    constructor(code: ClientErrorCode, retryable: boolean);
}
export interface StorageLike {
    getItem(k: string): string | null;
    setItem(k: string, v: string): void;
    removeItem(k: string): void;
}
export interface RoomClientDeps {
    /** http(s) base, same origin as the page. Empty string means relative URLs. */
    httpBase: string;
    /** ws(s) endpoint for Colyseus. */
    wsEndpoint: string;
    fetchFn?: typeof fetch;
    /** sessionStorage only; the reconnection token must never reach localStorage. */
    storage?: StorageLike;
    sleep?: (ms: number) => Promise<void>;
}
/** Bounded exponential backoff: 0.5 s, 1 s, 2 s ... capped at 8 s, at most `attempts` tries. */
export declare function withRetry<T>(fn: () => Promise<T>, attempts: number, sleep?: (ms: number) => Promise<void>): Promise<T>;
export declare class RoomClient {
    private readonly deps;
    readonly localContentHash: string;
    room: Room | null;
    welcome: WelcomeMessage | null;
    private readonly f;
    private readonly sleep;
    private csrf;
    constructor(deps: RoomClientDeps);
    private http;
    checkVersion(): Promise<void>;
    /** Exchanges an adult supplied invitation for a session. A display name never authenticates. */
    login(invite: string, displayName: string): Promise<void>;
    private ensureCsrf;
    requestTicket(roomCode: string): Promise<JoinTicketResponse>;
    /** Fetches a fresh ticket and joins. Never silently enters a different room. */
    join(roomCode: string): Promise<Room>;
    private mapJoinError;
    private attach;
    send(type: keyof typeof ClientMessage, payload?: unknown): void;
    leave(): Promise<void>;
    logout(): Promise<void>;
    /** Reload recovery: reconnect with the sessionStorage token, otherwise null (return to lobby). */
    tryResume(): Promise<Room | null>;
    joinWithRetry(roomCode: string, attempts?: number): Promise<Room>;
}
