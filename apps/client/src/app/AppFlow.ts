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
/** GR12: what an in-flight entry action is doing. Display only; no byte progress is implied. */
export type FlowBusy = "preparing" | "joining";
/** FB05: `pendingReady` is true while the person already confirmed a fighter but background setup is still finishing. */
export interface FlowState { screen: Screen; error: FlowError | null; canRetry: boolean; busy?: FlowBusy | null; pendingReady?: boolean }

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
  /** FB05: shared asset load (concurrent callers await one load) and the in-flight early-entry run. */
  private assetsP: Promise<void> | null = null;
  private inflight: Promise<void> | null = null;
  /** FB05: true from the early pick screen until the room is joined. */
  private joining = false;
  private pendingKit: KitId | null = null;
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

  /** GR12: publishes (or clears) the busy phase without changing the screen. */
  private setBusy(busy: FlowBusy | null): void {
    if ((this.state.busy ?? null) === busy) return;
    this.state = busy === null ? { screen: this.state.screen, error: this.state.error, canRetry: this.state.canRetry } : { ...this.state, busy };
    for (const f of [...this.subs]) f(this.state);
  }

  private beginEntry(): void { this.setBusy(this.assetsReady ? "joining" : "preparing"); }

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
    this.assetsP ??= (async () => {
      try { await this.deps.loadAssets(); } catch (e) { this.assetsP = null; throw new AssetError(e); }
      this.assetsReady = true;
    })();
    await this.assetsP;
  }

  /** FB05: starts the asset load in the background (idle or on a Fight bots click). Failure is silent; the real entry retries. */
  warm(): void {
    if (this.assetsReady || this.state.screen === "error") return;
    void this.ensureAssets().catch(() => undefined);
  }

  /**
   * FB05: Practice shows the fighter pick at once. Asset load, sign-in and room join run in parallel in the background;
   * Ready pressed before they finish is queued and sent the moment the room is joined.
   */
  private async runEarly(step: Step): Promise<void> {
    this.busy = true; this.joining = true; this.pendingKit = null;
    const revision = this.revision;
    const d = this.deps;
    this.set("lobby");
    this.beginEntry();
    const assets = this.ensureAssets();
    const net = (async () => {
      if (!this.loggedIn || d.needsLogin?.() === true) { await d.login(); this.loggedIn = true; }
      if (revision !== this.revision) return;
      await d.join(this.mode, this.target ?? undefined);
    })();
    const run = (async () => {
      const [a, n] = await Promise.allSettled([assets, net]);
      try {
        if (revision !== this.revision) { if (n.status === "fulfilled") await d.leave(); return; }
        if (a.status === "rejected" || n.status === "rejected") {
          if (n.status === "fulfilled") { try { await d.leave(); } catch { /* the room may already be gone */ } }
          const e: unknown = a.status === "rejected" ? a.reason : (n as PromiseRejectedResult).reason;
          this.fail(e instanceof AssetError ? "assets" : step, e);
          return;
        }
        this.failed = null; this.retries = 0; this.joining = false;
        const kit = this.pendingKit; this.pendingKit = null;
        this.set("lobby");
        if (kit) this.ready(kit);
      } finally {
        this.busy = false; this.joining = false; this.inflight = null;
        if (revision === this.revision) this.setBusy(null);
      }
    })();
    this.inflight = run;
    await run;
  }

  private async run(step: Step): Promise<void> {
    if (this.busy) return;
    if (this.mode === "practice" && step === "login") return this.runEarly(step);
    this.busy = true;
    const revision = this.revision;
    try {
      this.beginEntry();
      await this.ensureAssets();
      if (revision !== this.revision) return;
      this.setBusy("joining");
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
      if (revision === this.revision) this.setBusy(null);
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
      this.beginEntry();
      await this.ensureAssets();
      this.setBusy("joining");
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
    } finally { this.busy = false; if (revision === this.revision) this.setBusy(null); }
  }

  async hostSparring(config: SparringConfig, kit: KitId, listed = false): Promise<void> {
    if (this.busy || this.state.screen !== "welcome" || !this.deps.sparring) return;
    this.busy = true;
    const revision = this.revision;
    try {
      this.beginEntry();
      await Promise.all([this.ensureAssets(), this.deps.login()]);
      this.loggedIn = true;
      this.setBusy("joining");
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
      if (revision === this.revision) {
        this.mode = "play";
        if (this.state.screen !== "welcome") this.set("welcome");
      }
      throw e;
    } finally { this.busy = false; if (revision === this.revision) this.setBusy(null); }
  }

  /** Ready submits the chosen kit; gameplay is enabled by the caller once the server state is ready. */
  ready(kit: KitId): void {
    if (this.state.screen !== "lobby") return;
    if (this.joining) {
      this.pendingKit = kit;
      this.state = { ...this.state, pendingReady: true };
      for (const f of [...this.subs]) f(this.state);
      return;
    }
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
    this.pendingKit = null;
    if (this.mode === "sparring") await this.deps.sparring?.end();
    try { await this.deps.leave(); } catch { /* the room may already be gone */ }
    // FB05: wait for an early run to release its room (it leaves on the stale revision) so the next entry starts clean.
    try { await this.inflight; } catch { /* already reported */ }
    this.failed = null; this.retries = 0;
    this.mode = "play"; this.target = null;
    this.set("welcome");
  }
}
