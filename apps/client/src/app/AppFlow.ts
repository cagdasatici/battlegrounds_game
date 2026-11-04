/**
 * App flow (T18c, spec section 6): boot checks, Welcome, invitation exchange, private lobby, Ready, and the five
 * error states. A small state machine with injected effects; it holds no DOM and no timers of its own except the
 * injected `sleep` used for the bounded Retry delay (never for gameplay). A retry is always a person's click.
 */
import { ClientError } from "../net/RoomClient.js";
import type { SparringConfig } from "@eb/shared/sparring";
import type { RoomSummary } from "@eb/shared/rooms";
import type { KitId } from "@eb/shared/protocol";

export type Screen = "boot" | "welcome" | "lobby" | "match" | "error";
export type FlowError =
  | "ROOM_FULL" | "INVITE_INVALID" | "VERSION_MISMATCH" | "SERVER_OFFLINE" | "ASSET_FAILED" | "UNSUPPORTED"
  /** GR03 terminal closes of a joined room: revoked session (4401), closed arena (4500), unexpected loss. */
  | "SESSION_ENDED" | "ARENA_CLOSED" | "CONNECTION_LOST";
type Step = "assets" | "login" | "join";

export type FlowMode = "play" | "practice" | "sparring";
export interface FlowState { screen: Screen; error: FlowError | null; canRetry: boolean }

export interface FlowDeps {
  /** WebGL2 and WebAssembly are available. */
  supported(): boolean;
  loadAssets(): Promise<void>;
  login(): Promise<void>;
  /** True when the signed-in identity no longer matches the picked profile (open join rename). */
  needsLogin?(): boolean;
  /** Joins the private FFA room, or the server derived practice room for `mode` "practice". */
  join(mode: FlowMode, roomCode?: string): Promise<void>;
  sendReady(kit: KitId): void;
  /**
   * GR03 reload recovery. `canResume` is a cheap synchronous check (stored token + metadata); `resume` tries the
   * reconnection token exactly once and resolves with the restored mode, or null when rejected (metadata discarded).
   * `enterResumed` starts the match for a fighter that is already ready (never sends Ready).
   */
  canResume?(): boolean;
  resume?(): Promise<FlowMode | null>;
  enterResumed?(): void;
  leave(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Whether an adult supplied invitation was present in the URL fragment. */
  hasInvite: boolean;
  sparring?: {
    guest: boolean;
    recover(): Promise<boolean>;
    create(config: SparringConfig, listed?: boolean): Promise<void>;
    joinListed(roomCode: string): Promise<void>;
    end(): Promise<void>;
  };
}

/** 0.5 s, 1 s, 2 s, 4 s, then capped at 8 s. */
export const retryDelayMs = (attempt: number): number => Math.min(8000, 500 * 2 ** Math.min(attempt, 10));

class AssetError extends Error { constructor(readonly cause0: unknown) { super("assets"); } }

export class AppFlow {
  state: FlowState = { screen: "boot", error: null, canRetry: false };
  /** Which room the current journey targets. Set by play() and practice(); kept across Retry. */
  mode: FlowMode = "play";
  private readonly subs = new Set<(s: FlowState) => void>();
  private loggedIn = false;
  private assetsReady = false;
  private retries = 0;
  private failed: Step | null = null;
  private busy = false;
  private revision = 0;
  private retryPending = false;
  /** Arena room picked from the room list; null means the boot-time room. */
  private target: string | null = null;

  constructor(private readonly deps: FlowDeps) {}

  subscribe(fn: (s: FlowState) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  private set(screen: Screen, error: FlowError | null = null, canRetry = false): void {
    this.state = { screen, error, canRetry };
    for (const f of [...this.subs]) f(this.state);
  }

  private fail(step: Step, e: unknown): void {
    this.failed = step;
    if (step === "assets") { this.set("error", "ASSET_FAILED", true); return; }
    if (e instanceof ClientError) {
      const code = e.code;
      if (code === "ROOM_FULL" || code === "INVITE_INVALID" || code === "VERSION_MISMATCH" || code === "SERVER_OFFLINE") {
        this.set("error", code, e.retryable);
        return;
      }
    }
    this.set("error", "SERVER_OFFLINE", true);
  }

  async start(): Promise<void> {
    this.set("boot");
    if (!this.deps.supported()) { this.failed = null; this.set("error", "UNSUPPORTED", true); return; }
    // QP01: Welcome is interactive without the renderer; assets load on the first Play/Practice/room join (see ensureAssets).
    const revision = this.revision;
    try {
      this.failed = null; this.retries = 0;
      if (await this.tryResume(revision)) return;
      if (revision !== this.revision) return;
      if (this.deps.sparring && await this.deps.sparring.recover()) this.mode = "sparring";
    } catch (e) {
      if (revision === this.revision) this.fail("login", e);
      return;
    }
    if (revision !== this.revision) return;
    this.set("welcome");
  }

  /** Reload recovery, once, before the normal entry. True when the same ready fighter was restored. */
  private async tryResume(revision: number): Promise<boolean> {
    const d = this.deps;
    if (!d.canResume?.() || !d.resume || !d.enterResumed) return false;
    try {
      // Reconnect first: the seat is only reserved for 20 s and asset loading can take several seconds.
      const mode = await d.resume();
      if (revision !== this.revision) { if (mode) await d.leave(); return false; }
      if (mode === null) return false;
      await this.ensureAssets();
      if (revision !== this.revision) { await d.leave(); return false; }
      this.mode = mode; this.loggedIn = true;
      this.set("lobby");
      d.enterResumed();
      this.set("match");
      return true;
    } catch {
      try { await d.leave(); } catch { /* the room may already be gone */ } // leave also discards the stored token
      return false; // a failed recovery shows Welcome
    }
  }

  /** GR03: the joined room closed for good. Always an explicit error route; there is no silent rejoin or reset. */
  connectionClosed(kind: "session" | "arena" | "lost"): void {
    if (this.state.screen !== "lobby" && this.state.screen !== "match") return;
    this.retries = 0;
    if (kind === "lost" && this.mode !== "sparring") {
      this.failed = "join"; // Retry joins again through the ordinary ticket path
      this.set("error", "CONNECTION_LOST", true);
    } else {
      this.failed = null;
      this.set("error", kind === "session" ? "SESSION_ENDED" : kind === "arena" ? "ARENA_CLOSED" : "CONNECTION_LOST", false);
    }
  }

  /** Loads renderer, physics and the map once (idempotent in the dep). Failure is ASSET_FAILED with Retry. */
  private async ensureAssets(): Promise<void> {
    if (this.assetsReady) return;
    try { await this.deps.loadAssets(); } catch (e) { throw new AssetError(e); }
    this.assetsReady = true;
  }

  private async run(step: Step): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const revision = this.revision;
    try {
      await this.ensureAssets();
      if (revision !== this.revision) return;
      if (step === "login" && (!this.loggedIn || this.mode === "sparring" || this.deps.needsLogin?.() === true)) { await this.deps.login(); this.loggedIn = true; }
      if (revision !== this.revision) return;
      await this.deps.join(this.mode, this.target ?? undefined);
      if (revision !== this.revision) { await this.deps.leave(); return; }
      this.failed = null; this.retries = 0;
      this.set("lobby");
    } catch (e) {
      if (revision === this.revision) this.fail(e instanceof AssetError ? "assets" : step, e);
    } finally {
      this.busy = false;
    }
  }

  /** Play: exchange the invitation, join the private room, show the lobby. */
  async play(): Promise<void> {
    if (this.busy || this.state.screen !== "welcome") return;
    this.mode = this.deps.sparring?.guest || this.mode === "sparring" ? "sparring" : "play";
    await this.run("login");
  }

  /** Practice: the same session exchange, then a private room with one dummy (spec section 6). Never an FFA room. */
  async practice(): Promise<void> {
    if (this.busy || this.state.screen !== "welcome") return;
    this.mode = "practice";
    await this.run("login");
  }

  /** Signs in (exchanging the invitation once) so the room list can be fetched. */
  async signIn(): Promise<void> {
    if (this.loggedIn || this.state.screen !== "welcome") return;
    await this.deps.login();
    this.loggedIn = true;
  }

  /** One tap join from the room list. Arena rooms use the normal ticket path; listed sparring reserves a guest seat first. */
  async joinListed(room: RoomSummary): Promise<void> {
    if (this.busy || this.state.screen !== "welcome") return;
    if (room.kind === "arena") {
      this.mode = "play"; this.target = room.roomCode;
      await this.run("login");
      return;
    }
    if (!this.deps.sparring) return;
    this.busy = true;
    const revision = this.revision;
    try {
      await this.ensureAssets();
      await this.deps.login();
      this.loggedIn = true;
      if (revision !== this.revision) return;
      await this.deps.sparring.joinListed(room.roomCode);
      this.mode = "sparring"; this.target = null;
      await this.deps.join("sparring");
      if (revision !== this.revision) { await this.deps.leave(); return; }
      this.failed = null; this.retries = 0;
      this.set("lobby");
    } catch (e) {
      this.mode = "play";
      try { await this.deps.sparring.end(); } catch { /* nothing held yet */ }
      if (revision === this.revision) {
        const c = e instanceof ClientError ? e.code : null;
        const code: FlowError = e instanceof AssetError ? "ASSET_FAILED" : c === "ROOM_FULL" || c === "INVITE_INVALID" || c === "VERSION_MISMATCH" ? c : "SERVER_OFFLINE";
        this.failed = null;
        this.set("error", code, false);
      }
    } finally { this.busy = false; }
  }

  async hostSparring(config: SparringConfig, kit: KitId, listed = false): Promise<void> {
    if (this.busy || this.state.screen !== "welcome" || !this.deps.sparring) return;
    this.busy = true;
    const revision = this.revision;
    try {
      await this.ensureAssets();
      await this.deps.login();
      this.loggedIn = true;
      if (revision !== this.revision) return;
      this.mode = "sparring";
      await this.deps.sparring.create(config, listed);
      if (revision !== this.revision) { await this.deps.sparring.end(); return; }
      await this.deps.join("sparring");
      if (revision !== this.revision) { await this.deps.sparring.end(); await this.deps.leave(); return; }
      this.set("lobby");
      this.ready(kit);
    } catch (e) {
      // Release a created match before allowing setup to retry.
      if (this.mode === "sparring") {
        try { await this.deps.sparring.end(); } catch { /* retain ownership so a retry can recover */ }
        try { await this.deps.leave(); } catch { /* transport may already be closed */ }
      }
      throw e;
    } finally { this.busy = false; }
  }

  /** Ready submits the chosen kit; gameplay is enabled by the caller once the server state is ready. */
  ready(kit: KitId): void {
    if (this.state.screen !== "lobby") return;
    this.deps.sendReady(kit);
    this.set("match");
  }

  async retry(): Promise<void> {
    if (this.busy || this.retryPending || this.state.screen !== "error" || !this.state.canRetry) return;
    this.retryPending = true;
    const revision = this.revision;
    try {
      const step = this.failed;
      await this.deps.sleep(retryDelayMs(this.retries++));
      if (revision !== this.revision) return;
      if (step === null) { await this.start(); return; }
      await this.run(step === "assets" ? "login" : step);
    } finally { this.retryPending = false; }
  }

  dispose(): void { this.revision++; this.subs.clear(); }

  /** Back (or Leave): closes the room connection and returns to Welcome. */
  async back(): Promise<void> {
    this.revision++;
    if (this.mode === "sparring") await this.deps.sparring?.end();
    try { await this.deps.leave(); } catch { /* the room may already be gone */ }
    this.failed = null; this.retries = 0;
    this.mode = "play"; this.target = null;
    this.set("welcome");
  }
}
