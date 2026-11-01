/**
 * WEB2: decides when to offer the Update button. Pure of DOM: every dependency is injected so it is unit-testable.
 * The button compares the client bundle (asset-manifest.json), never buildId, so server-only releases do not nag.
 * It never reloads on its own; apply() runs only from a user tap.
 */
export interface UpdateDeps {
  /** Asset paths of the bundle this page was loaded from (e.g. its entry script src). */
  loadedAssets(): string[];
  /** Latest asset-manifest.json, or null when offline or unreadable. */
  fetchManifest(): Promise<{ assets: string[] } | null>;
  /** Latest /api/version buildId for display only, or null. */
  fetchBuildId(): Promise<string | null>;
  /** True while a worker is installed and waiting to take over. */
  hasWaitingWorker(): boolean;
  /** Asks the waiting worker (if any) to skipWaiting and resolves when the page controller changed or none was waiting. */
  activate(): Promise<void>;
  reload(): void;
  /** True while a room is joined. */
  inMatch(): boolean;
  /** True while the Welcome/Lobby screen is open (periodic checks run only then). */
  onLobbyScreen(): boolean;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  onVisible(fn: () => void): () => void;
  /** Fires when a new worker finishes installing (becomes waiting). Returns an unsubscribe. */
  onWaiting?(fn: () => void): () => void;
}

export interface UpdateState {
  available: boolean;
  /** Button is shown: an update exists and no match is in progress. */
  visible: boolean;
  buildId: string | null;
}

export const UPDATE_CHECK_MS = 10 * 60_000;

export class UpdateWatcher {
  private newBundle = false;
  private buildId: string | null = null;
  private timer: number | null = null;
  private offVisible: (() => void) | null = null;
  private disposed = false;
  private checking: Promise<void> | null = null;
  private readonly subs = new Set<(s: UpdateState) => void>();

  constructor(private readonly d: UpdateDeps) {}

  start(): void {
    if (this.disposed || this.timer !== null) return;
    this.timer = this.d.setInterval(() => { if (this.d.onLobbyScreen()) void this.check(); }, UPDATE_CHECK_MS);
    const offV = this.d.onVisible(() => { if (this.d.onLobbyScreen()) void this.check(); });
    const offW = this.d.onWaiting?.(() => { this.emit(); });
    this.offVisible = () => { offV(); offW?.(); };
    void this.check();
  }

  get state(): UpdateState {
    const available = this.newBundle || this.d.hasWaitingWorker();
    return { available, visible: available && !this.d.inMatch(), buildId: this.buildId };
  }

  subscribe(fn: (s: UpdateState) => void): () => void {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  }

  /** Re-publishes state, e.g. after a room is joined or left. */
  refresh(): void { this.emit(); }

  /** One check; overlapping calls share a single request. Offline or failed checks keep the previous answer. */
  check(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.checking ??= this.run().finally(() => { this.checking = null; });
    return this.checking;
  }

  private async run(): Promise<void> {
    try {
      const m = await this.d.fetchManifest();
      if (m && !this.disposed) {
        const latest = new Set(m.assets);
        const loaded = this.d.loadedAssets();
        if (loaded.length > 0 && loaded.some((a) => !latest.has(a))) this.newBundle = true;
      }
      const id = await this.d.fetchBuildId();
      if (id !== null) this.buildId = id;
    } catch { /* offline: keep previous state */ }
    this.emit();
  }

  /** User tap only. Waiting worker takes over, then the page reloads. */
  async apply(): Promise<void> {
    if (this.disposed || this.d.inMatch() || !this.state.available) return;
    try { await this.d.activate(); } finally { this.d.reload(); }
  }

  private emit(): void {
    if (this.disposed) return;
    const s = this.state;
    for (const fn of this.subs) fn(s);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) this.d.clearInterval(this.timer);
    this.timer = null;
    this.offVisible?.();
    this.offVisible = null;
    this.subs.clear();
  }
}

/** Browser wiring. Kept separate so the class above never touches the DOM. */
export function browserUpdateDeps(opts: {
  inMatch(): boolean; onLobbyScreen(): boolean; reg: () => Promise<ServiceWorkerRegistration | null>; httpBase?: string;
}): UpdateDeps {
  const base = opts.httpBase ?? "";
  let registration: ServiceWorkerRegistration | null = null;
  const waitingSubs = new Set<() => void>();
  const watch = (w: ServiceWorker | null): void => {
    w?.addEventListener("statechange", () => { if (w.state === "installed") for (const f of waitingSubs) f(); });
  };
  void opts.reg().then((r) => {
    registration = r;
    if (!r) return;
    watch(r.installing);
    r.addEventListener("updatefound", () => { watch(r.installing); });
    if (r.waiting) for (const f of waitingSubs) f();
  });
  return {
    loadedAssets: () => Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
      .map((s) => new URL(s.src, location.href)).filter((u) => u.origin === location.origin && u.pathname.startsWith("/assets/")).map((u) => u.pathname),
    fetchManifest: async () => {
      void registration?.update().catch(() => undefined);
      try {
        const r = await fetch(base + "/asset-manifest.json", { cache: "no-store" });
        if (!r.ok) return null;
        const j = (await r.json()) as { assets?: unknown };
        return Array.isArray(j.assets) ? { assets: j.assets.filter((a): a is string => typeof a === "string") } : null;
      } catch { return null; }
    },
    fetchBuildId: async () => {
      try {
        const r = await fetch(base + "/api/version", { cache: "no-store", credentials: "include" });
        if (!r.ok) return null;
        const j = (await r.json()) as { buildId?: unknown };
        return typeof j.buildId === "string" ? j.buildId : null;
      } catch { return null; }
    },
    hasWaitingWorker: () => registration?.waiting != null,
    activate: async () => {
      if (!registration || !navigator.serviceWorker) return;
      // The bundle may be seen before the browser has fetched the new worker script; ask it to look now.
      if (!registration.waiting && !registration.installing) await registration.update().catch(() => undefined);
      let w = registration.waiting;
      const inst = registration.installing;
      if (!w && inst) {
        // New bundle seen before its worker finished installing: give it a few seconds to become waiting.
        await new Promise<void>((resolve) => {
          const done = (): void => { inst.removeEventListener("statechange", onState); window.clearTimeout(t); resolve(); };
          const onState = (): void => { if (inst.state !== "installing") done(); };
          const t = window.setTimeout(done, 5000);
          inst.addEventListener("statechange", onState);
        });
        w = registration.waiting;
      }
      if (!w) return;
      await new Promise<void>((resolve) => {
        const done = (): void => { navigator.serviceWorker.removeEventListener("controllerchange", done); window.clearTimeout(t); resolve(); };
        const t = window.setTimeout(done, 3000);
        navigator.serviceWorker.addEventListener("controllerchange", done);
        w.postMessage({ type: "SKIP_WAITING" });
      });
    },
    onWaiting: (fn) => { waitingSubs.add(fn); return () => { waitingSubs.delete(fn); }; },
    reload: () => { location.reload(); },
    inMatch: opts.inMatch,
    onLobbyScreen: opts.onLobbyScreen,
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => { window.clearInterval(id); },
    onVisible: (fn) => {
      const h = (): void => { if (document.visibilityState === "visible") fn(); };
      document.addEventListener("visibilitychange", h);
      return () => { document.removeEventListener("visibilitychange", h); };
    },
  };
}
