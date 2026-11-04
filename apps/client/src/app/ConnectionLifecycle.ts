/**
 * GR03 connection lifecycle. A pure state holder (no DOM, no Three.js, no timers): it follows the installed
 * Colyseus SDK signals `onDrop`, `onReconnect` and `onLeave` plus the server's welcome message, and decides when
 * gameplay input may flow.
 *
 * `active` needs a welcome AND an owner snapshot carrying that welcome's epoch (AND the authoritative `ready`
 * flag once a match is entered). Until then the client sends no gameplay input. Subscriptions and their
 * unsubscribe handles are kept together so dispose() removes every one of them.
 */
import type { WelcomeMessage } from "@eb/shared/protocol";

export type ConnectionPhase = "connecting" | "active" | "reconnecting" | "closed";
export type CloseKind = "session" | "arena" | "lost";

export const JOINING_TEXT = "Joining arena…";
export const RECONNECTING_TEXT = "Reconnecting… Your fighter is still in the arena.";
export const CLOSE_TEXT: Readonly<Record<CloseKind, string>> = {
  session: "Your session ended. Return to the welcome screen.",
  arena: "This arena closed. Return to the welcome screen.",
  lost: "Connection lost. Try joining again.",
};

/** 4401 = session revoked/expired (GR01); 4500 = arena closed by a server fault; anything else is an unexpected loss. */
export function classifyClose(code: number): CloseKind {
  return code === 4401 ? "session" : code === 4500 ? "arena" : "lost";
}

/** Banner text for a phase, or null when nothing should be shown. */
export function phaseText(phase: ConnectionPhase): string | null {
  return phase === "connecting" ? JOINING_TEXT : phase === "reconnecting" ? RECONNECTING_TEXT : null;
}

/** The SDK signal shape we rely on (`room.onDrop(cb)` registers, `room.onDrop.remove(cb)` unregisters). */
export interface SignalLike<A extends unknown[]> {
  (cb: (...a: A) => void): unknown;
  remove(cb: (...a: A) => void): void;
}
export interface LifecycleRoom {
  onDrop: SignalLike<[number, string?]>;
  onReconnect: SignalLike<[]>;
  onLeave: SignalLike<[number, string?]>;
  /** Registers a message handler and returns its unsubscribe function. */
  onMessage(type: string, cb: (payload: WelcomeMessage) => void): () => void;
}

/** What the replicated state says about the local fighter: owner-only epoch and the authoritative ready flag. */
export interface LocalView { epoch: number; ready: boolean }

export interface LifecycleHooks {
  /** Authoritative local view from the latest received snapshot, or null before the owner record arrives. */
  readLocal(): LocalView | null;
  /** The phase changed (not called for no-op evaluations). */
  onPhase(phase: ConnectionPhase): void;
  /** The socket dropped: clear holds, edges, provisional input, prediction history and interpolation buffers. */
  onDrop(): void;
  /** A new welcome arrived (join or reconnect): reset clock, sampler epoch and loop state. */
  onWelcome(w: WelcomeMessage): void;
  /** Terminal, unexpected close. Never called for an explicit Leave. */
  onClosed(kind: CloseKind, code: number): void;
}

export class ConnectionLifecycle {
  phase: ConnectionPhase = "connecting";
  private welcome: WelcomeMessage | null = null;
  private requireReady = false;
  private explicit = false;
  private disposed = false;
  private readonly unsubs: (() => void)[] = [];

  constructor(private readonly h: LifecycleHooks) {}

  /** Subscribes to the room. Each subscription's removal is recorded so dispose() leaves nothing behind. */
  attach(room: LifecycleRoom): void {
    const onDrop = (): void => { this.drop(); };
    const onReconnect = (): void => { this.reconnected(); };
    const onLeave = (code: number): void => { this.left(code); };
    room.onDrop(onDrop); this.unsubs.push(() => { room.onDrop.remove(onDrop); });
    room.onReconnect(onReconnect); this.unsubs.push(() => { room.onReconnect.remove(onReconnect); });
    room.onLeave(onLeave); this.unsubs.push(() => { room.onLeave.remove(onLeave); });
    this.unsubs.push(room.onMessage("welcome", (w) => { this.noteWelcome(w); }));
  }

  /** Ready becomes part of the active condition once a match is entered. */
  setRequireReady(on: boolean): void { this.requireReady = on; this.evaluate(); }

  /** Records a welcome (also used for the one already received during join). Always starts a new epoch. */
  noteWelcome(w: WelcomeMessage): void {
    if (this.disposed || this.phase === "closed") return;
    this.welcome = w;
    this.h.onWelcome(w);
    this.setPhase("connecting");
    this.evaluate();
  }

  /** Re-checks the gate against the latest snapshot. Cheap; call once per frame. */
  evaluate(): void {
    if (this.disposed || (this.phase !== "connecting" && this.phase !== "active")) return;
    const local = this.h.readLocal();
    const ok = this.welcome !== null && local !== null && local.epoch === this.welcome.epoch && (!this.requireReady || local.ready);
    this.setPhase(ok ? "active" : "connecting");
  }

  get inputEnabled(): boolean { this.evaluate(); return this.phase === "active"; }

  /** Marks the next close as a person's choice (Leave/Back): it is not an error. */
  explicitLeave(): void { this.explicit = true; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const u of this.unsubs.splice(0)) { try { u(); } catch { /* keep disposing */ } }
  }

  private drop(): void {
    if (this.disposed || this.phase === "closed" || this.explicit) return;
    this.welcome = null; // the next epoch is only trusted after a new welcome
    this.setPhase("reconnecting");
    this.h.onDrop();
  }

  private reconnected(): void {
    if (this.disposed || this.phase === "closed" || this.explicit) return;
    this.setPhase("connecting"); // wait for the new welcome and a matching snapshot
    this.evaluate();
  }

  private left(code: number): void {
    if (this.disposed || this.phase === "closed") return;
    this.welcome = null;
    this.setPhase("closed");
    const explicit = this.explicit;
    this.dispose();
    if (!explicit) this.h.onClosed(classifyClose(code), code);
  }

  private setPhase(p: ConnectionPhase): void {
    if (this.phase === p) return;
    this.phase = p;
    this.h.onPhase(p);
  }
}
