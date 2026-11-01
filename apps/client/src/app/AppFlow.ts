/**
 * App flow (T18c, spec section 6): boot checks, Welcome, invitation exchange, private lobby, Ready, and the five
 * error states. A small state machine with injected effects; it holds no DOM and no timers of its own except the
 * injected `sleep` used for the bounded Retry delay (never for gameplay). A retry is always a person's click.
 */
import { ClientError } from "../net/RoomClient.js";
import type { KitId } from "@eb/shared/protocol";

export type Screen = "boot" | "welcome" | "lobby" | "match" | "error";
export type FlowError = "ROOM_FULL" | "INVITE_INVALID" | "VERSION_MISMATCH" | "SERVER_OFFLINE" | "ASSET_FAILED" | "UNSUPPORTED";
type Step = "assets" | "login" | "join";

export type FlowMode = "play" | "practice";
export interface FlowState { screen: Screen; error: FlowError | null; canRetry: boolean }

export interface FlowDeps {
  /** WebGL2 and WebAssembly are available. */
  supported(): boolean;
  loadAssets(): Promise<void>;
  login(): Promise<void>;
  /** Joins the private FFA room, or the server derived practice room for `mode` "practice". */
  join(mode: FlowMode): Promise<void>;
  sendReady(kit: KitId): void;
  leave(): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Whether an adult supplied invitation was present in the URL fragment. */
  hasInvite: boolean;
}

/** 0.5 s, 1 s, 2 s, 4 s, then capped at 8 s. */
export const retryDelayMs = (attempt: number): number => Math.min(8000, 500 * 2 ** Math.min(attempt, 10));

export class AppFlow {
  state: FlowState = { screen: "boot", error: null, canRetry: false };
  /** Which room the current journey targets. Set by play() and practice(); kept across Retry. */
  mode: FlowMode = "play";
  private readonly subs = new Set<(s: FlowState) => void>();
  private loggedIn = false;
  private retries = 0;
  private failed: Step | null = null;
  private busy = false;

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
    await this.run("assets");
  }

  private async run(step: Step): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (step === "assets") {
        await this.deps.loadAssets();
        this.failed = null; this.retries = 0;
        this.set("welcome");
        return;
      }
      if (step === "login" && !this.loggedIn) { await this.deps.login(); this.loggedIn = true; }
      await this.deps.join(this.mode);
      this.failed = null; this.retries = 0;
      this.set("lobby");
    } catch (e) {
      this.fail(step, e);
    } finally {
      this.busy = false;
    }
  }

  /** Play: exchange the invitation, join the private room, show the lobby. */
  async play(): Promise<void> {
    if (this.state.screen !== "welcome") return;
    this.mode = "play";
    if (!this.deps.hasInvite && !this.loggedIn) { this.failed = null; this.set("error", "INVITE_INVALID", false); return; }
    await this.run("login");
  }

  /** Practice: the same session exchange, then a private room with one dummy (spec section 6). Never an FFA room. */
  async practice(): Promise<void> {
    if (this.state.screen !== "welcome") return;
    this.mode = "practice";
    if (!this.deps.hasInvite && !this.loggedIn) { this.failed = null; this.set("error", "INVITE_INVALID", false); return; }
    await this.run("login");
  }

  /** Ready submits the chosen kit; gameplay is enabled by the caller once the server state is ready. */
  ready(kit: KitId): void {
    if (this.state.screen !== "lobby") return;
    this.deps.sendReady(kit);
    this.set("match");
  }

  async retry(): Promise<void> {
    if (this.state.screen !== "error" || !this.state.canRetry) return;
    const step = this.failed;
    await this.deps.sleep(retryDelayMs(this.retries++));
    if (step === null) { await this.start(); return; }
    await this.run(step);
  }

  /** Back (or Leave): closes the room connection and returns to Welcome. */
  async back(): Promise<void> {
    try { await this.deps.leave(); } catch { /* the room may already be gone */ }
    this.failed = null; this.retries = 0;
    this.mode = "play";
    this.set("welcome");
  }
}
