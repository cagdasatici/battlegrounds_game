import "./base.css";
import type { WebGLRenderer } from "three";
import type { Room } from "@colyseus/sdk";
import { meterFraction } from "@eb/shared/awakening";
import { surfaceBelow, parseArenaMap, type ArenaMap } from "@eb/shared/config/arena";
import {
  MAX_CLIENTS, P0_KITS, PRACTICE_ROOM_CODE, ServerMessage,
  type ActionResult, type CombatEvent, type KitId, type PongMessage, type WelcomeMessage,
} from "@eb/shared/protocol";
import islandsUrl from "../../../assets/maps/islands.v1.json?url";
import { mountRoomList } from "./ui/RoomList.js";
import { mountSparringSetup } from "./ui/SparringSetup.js";
import { swRegistration } from "./app/registerSw.js";
import { UpdateWatcher, browserUpdateDeps } from "./app/UpdateWatcher.js";
import { AppFlow } from "./app/AppFlow.js";
import { CombatBus } from "./app/CombatBus.js";
import type { AttackTelegraphs } from "./fx/AttackTelegraphs.js";
import { AdaptiveQuality } from "./app/AdaptiveQuality.js";
import type { LoopPlayer, LoopState } from "./app/GameLoop.js";
import { SettingsStore } from "./app/SettingsStore.js";
import { computeLayout, placeSparringRect, type Layout } from "./input/ControlLayout.js";
import { resolveLayout, viewportClass } from "./input/LayoutEdit.js";
import { attachKeyboardRouter } from "./input/KeyboardRouter.js";
import { IntentSampler } from "./input/IntentSampler.js";
import { PointerRouter, attachPointerRouter } from "./input/PointerRouter.js";
import { ClockSync } from "./net/ClockSync.js";
import { RoomClient } from "./net/RoomClient.js";
import { hasWebGL2 } from "./scene/webgl.js";
import type { GameScene, Quality } from "./scene/GameScene.js";
import { Hud, readSafeRect } from "./ui/Hud.js";
import {
  BlockNotice, RejectionNotice, cooldownLabel, equippedSkillNames, formTimerText, meterLabel, respawnSecondsLeft, scoreboardRows, stillpointText,
} from "./ui/HudFormat.js";
import { mountHowToPlay } from "./ui/HowToPlay.js";
import { KIT_LABEL, Lobby, type LobbyView } from "./ui/Lobby.js";
import { PracticePanel } from "./ui/PracticePanel.js";
import { SettingsPanel } from "./ui/Settings.js";

/** TODO(BOT4C): set from the real Host sparring action's availability once it is wired on this build. */
const SPARRING_GUIDE_AVAILABLE = false;

type Runtime = typeof import("./gameRuntime.js");

export interface BootOptions {
  /** Invitation consumed from the URL fragment; without it Play shows INVITE_INVALID. */
  invite: string | null;
  sparToken?: string | null;
  roomCode: string;
  displayName: string;
  kitId: "sv" | "td";
  /** Exposes a read-only state probe on window for browser tests (`?debug=1`). */
  debug: boolean;
  /** `?auto=1`: Play and Ready are pressed for the person (browser tests, quick QA). */
  auto: boolean;
}

export interface Session { scene: GameScene | null; dispose(): void }

/** Player record as read from room.state (HUD fields on top of the loop's). */
interface HudPlayer extends LoopPlayer {
  form: string; formEndTick: number; kills: number; deaths: number; assists: number;
  cooldownEndTicks: ArrayLike<number>;
  owner?: {
    ackInputTick: number; epoch: number; pendingKit?: string; lethalCounterRemaining?: number;
    tutorialStep?: number; tutorialSkillMask?: number; dummyGuard?: boolean; dummyRagdoll?: boolean;
  } | undefined;
}

/** Boots the app flow (spec section 6): Welcome, lobby, Ready, then the match. Every resource has a cleanup. */
export async function boot(app: HTMLElement, opts: BootOptions = readBootOptions()): Promise<Session> {
  app.textContent = "";
  const cleanups: (() => void)[] = [];
  const matchCleanups: (() => void)[] = [];
  let disposed = false;
  const runAll = (list: (() => void)[]): void => {
    for (const c of list.splice(0).reverse()) { try { c(); } catch { /* keep disposing */ } }
  };

  let rt: Runtime | null = null; // QP01: Three/Rapier runtime, loaded on first arena use
  let map: ArenaMap | null = null;
  let gs: GameScene | null = null;
  let glRenderer: WebGLRenderer | undefined; // read only by the opt-in ?debug=1 probe
  let softwareGl = false; // CPU rasteriser (SwiftShader): always the low tier, whatever the setting
  let room: Room | null = null;
  let clock = new ClockSync();
  let rafId = 0;
  const rc = createRoomClient();
  let sparToken = opts.sparToken ?? null;
  opts.sparToken = null;
  let sparRoom: string | null = null;
  let hostRoom: string | null = null;
  let authenticated = false;
  const canvasHost = document.createElement("div");
  app.append(canvasHost);
  cleanups.push(() => canvasHost.remove());
  const rejections = new RejectionNotice();
  const flowRef: { current: AppFlow | null } = { current: null };

  const players = (): Map<string, HudPlayer> => (room?.state as { players?: Map<string, HudPlayer> } | undefined)?.players ?? new Map();
  const localOf = (): HudPlayer | undefined => { for (const p of players().values()) if (p.owner !== undefined) return p; return undefined; };
  const leaveRoom = async (): Promise<void> => {
    runAll(matchCleanups);
    const r = room;
    room = null;
    if (r) await rc.leave().catch(() => undefined);
  };

  // WEB2: update button. Hidden while a room is joined; checks run only on the welcome/lobby screens.
  const updater = new UpdateWatcher(browserUpdateDeps({
    inMatch: () => room !== null,
    onLobbyScreen: () => flowRef.current?.state.screen !== "match",
    reg: swRegistration,
  }));
  const lobby = new Lobby(app, {
    play: () => { void flowRef.current?.play(); },
    practice: () => { void flowRef.current?.practice(); },
    guide: () => { openGuide(); },
    update: () => { void updater.apply(); },
    retry: () => { void flowRef.current?.retry(); },
    back: () => { void flowRef.current?.back(); },
    ready: (k) => { flowRef.current?.ready(k); },
    settings: () => { openSettings(); },
  }, { kit: opts.kitId, name: opts.displayName });
  cleanups.push(() => lobby.dispose());

  // HELP2: the guide is a local overlay with no network or stored state; Try practice reuses the normal Practice flow.
  let closeGuideView: (() => void) | null = null;
  const closeGuide = (restoreFocus: boolean): void => {
    const c = closeGuideView;
    closeGuideView = null;
    c?.();
    if (c && restoreFocus) lobby.focusAct("guide");
  };
  const openGuide = (): void => {
    if (closeGuideView || flowRef.current?.state.screen !== "welcome") return;
    closeGuideView = mountHowToPlay(app, {
      sparringAvailable: SPARRING_GUIDE_AVAILABLE,
      onClose: () => { closeGuide(true); },
      onPractice: () => { closeGuide(false); void flowRef.current?.practice(); },
    });
  };
  cleanups.push(() => { closeGuide(false); });

  // T27 settings: one store and panel per local profile name (Arel/Nora); rebuilt if the label changes.
  const safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(safeProbe);
  cleanups.push(() => safeProbe.remove());
  let settingsRef: { name: string; store: SettingsStore; panel: SettingsPanel; unsub: () => void } | null = null;
  const settingsHooks = {
    onOpen: () => { for (const f of settingsOpenHooks) f(); },
    inMatch: () => matchCleanups.length > 0,
    safeRect: () => readSafeRect(window, safeProbe),
  };
  const settingsOpenHooks = new Set<() => void>();
  const settingsChangeHooks = new Set<() => void>();
  const activeSettings = (): SettingsStore => {
    const name = lobby.displayName;
    if (settingsRef && settingsRef.name === name) return settingsRef.store;
    settingsRef?.unsub();
    settingsRef?.panel.dispose();
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    const store = new SettingsStore(storage, name);
    const panel = new SettingsPanel(document.body, store, settingsHooks);
    const unsub = store.subscribe(() => { for (const f of [...settingsChangeHooks]) f(); });
    settingsRef = { name, store, panel, unsub };
    return store;
  };
  const openSettings = (): void => { activeSettings(); settingsRef?.panel.open(); };
  cleanups.push(() => { settingsRef?.unsub(); settingsRef?.panel.dispose(); settingsRef = null; });

  const guestLabel = document.createElement("label");
  guestLabel.textContent = "Guest display name ";
  guestLabel.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:10;color:white;font:16px system-ui";
  const guestName = document.createElement("input");
  guestName.value = opts.displayName; guestName.maxLength = 16;
  guestName.style.cssText = "min-height:48px;font:inherit;max-width:180px";
  guestLabel.append(guestName); app.append(guestLabel);
  cleanups.push(() => guestLabel.remove());

  const flow = new AppFlow({
    hasInvite: opts.invite !== null,
    supported: () => hasWebGL2() && typeof WebAssembly === "object",
    loadAssets: async () => {
      if (map) return;
      const loaded = rt ?? (rt = await import("./gameRuntime.js"));
      if (disposed) return;
      const res = await fetch(islandsUrl);
      if (!res.ok) throw new Error("map");
      const m = parseArenaMap(await res.json());
      await loaded.initRapier();
      const renderer = new loaded.WebGLRenderer({ antialias: true });
      canvasHost.append(renderer.domElement);
      glRenderer = renderer;
      softwareGl = loaded.isSoftwareRenderer(renderer.getContext());
      gs = new loaded.GameScene(renderer, m.colliders, window);
      if (softwareGl) gs.setQuality("low");
      await gs.loadEnvironment();
      gs.setCamera({ position: { x: 0, y: 20, z: 40 }, pivot: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 40, shoulderOffset: 0 });
      map = m;
      const idle = (): void => { if (matchCleanups.length === 0) gs?.render(); rafId = requestAnimationFrame(idle); };
      rafId = requestAnimationFrame(idle);
    },
    login: async () => {
      if (sparToken !== null) {
        sparRoom = await rc.redeemSparring(sparToken, guestName.value || lobby.displayName);
        sparToken = null;
      } else if (!sparRoom && !authenticated) {
        if (opts.invite) await rc.login(opts.invite, lobby.displayName);
        // Cookie-only adult reload is authenticated by the CSRF endpoint when creating/joining.
        authenticated = true;
      }
    },
    sparring: {
      get guest() { return sparToken !== null || (sparRoom !== null && hostRoom === null); },
      recover: async () => {
        if (sparToken !== null || opts.invite) return false;
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
        if (navigation?.type !== "reload") return false;
        sparRoom = await rc.recoverSparringGuest();
        return sparRoom !== null;
      },
      create: async (config, listed) => {
        if (sparRoom && !hostRoom) throw new Error("Guest cannot host");
        hostRoom ??= await rc.createSparring(config, listed === true);
        sparRoom = hostRoom;
      },
      joinListed: async (code) => { sparRoom = await rc.joinListedSparring(code); },
      end: async () => {
        if (hostRoom) await rc.endSparring(hostRoom);
        hostRoom = null; sparRoom = null;
      },
    },
    join: async (mode, picked) => {
      room = await rc.joinWithRetry(mode === "sparring" ? sparRoom! : mode === "practice" ? PRACTICE_ROOM_CODE : picked ?? opts.roomCode, opts.auto ? 4 : 1);
      await waitFor(() => rc.welcome, 5000, "welcome");
      clock = new ClockSync();
      if (mode === "sparring") {
        const joined = room;
        const onLeave = (): void => {
          if (room !== joined || disposed) return;
          hostRoom = null; sparRoom = null;
          void flow.back();
        };
        joined.onLeave(onLeave);
        matchCleanups.push(() => joined.onLeave.remove(onLeave));
      }
    },
    sendReady: (kit) => { if (map && gs && room) enterMatch(kit); },
    leave: leaveRoom,
    sleep: (ms) => new Promise((r) => { const t = window.setTimeout(r, ms); cleanups.push(() => window.clearTimeout(t)); }),
  });
  flowRef.current = flow;

  const lobbyView = (): LobbyView =>
    ({ updateVisible: updater.state.visible, seated: players().size, capacity: MAX_CLIENTS, connection: room ? "online" : "offline", mode: flow.mode === "practice" ? "practice" : "play" });
  let setupPending = false;
  const sparControls = document.createElement("div");
  sparControls.style.cssText = "position:fixed;inset:0;z-index:20;overflow:auto;background:#0b1118;display:none;padding:16px;box-sizing:border-box";
  const closeSetup = document.createElement("button");
  closeSetup.textContent = "Back to game";
  closeSetup.style.cssText = "min-height:48px;font:inherit";
  closeSetup.onclick = () => { sparControls.style.display = "none"; };
  sparControls.append(closeSetup);
  const sparButton = document.createElement("button");
  sparButton.textContent = "Host sparring";
  sparButton.style.cssText = "position:fixed;right:16px;top:16px;z-index:21;min-height:48px;font:600 17px system-ui";
  sparButton.onclick = () => {
    if (setupPending) return;
    if (!hostRoom) { disposeSetup(); disposeSetup = mountSparringSetup(sparControls, setupActions); }
    sparControls.style.display = "block";
  };
  app.append(sparControls, sparButton);
  // WEB3: room list. The panel exists only while open; its timer and listeners go with it.
  const roomsHost = document.createElement("div");
  roomsHost.style.cssText = "position:fixed;inset:0;z-index:20;overflow:auto;background:#0b1118;display:none;padding:16px;box-sizing:border-box";
  const closeRooms = document.createElement("button");
  closeRooms.textContent = "Back to game";
  closeRooms.style.cssText = "min-height:48px;font:inherit";
  let disposeRooms: (() => void) | null = null;
  const hideRooms = (): void => { disposeRooms?.(); disposeRooms = null; roomsHost.style.display = "none"; };
  closeRooms.onclick = hideRooms;
  roomsHost.append(closeRooms);
  const roomsButton = document.createElement("button");
  roomsButton.textContent = "Find a room";
  roomsButton.style.cssText = "position:fixed;right:16px;top:76px;z-index:21;min-height:48px;font:600 17px system-ui";
  roomsButton.onclick = () => {
    if (disposeRooms || flow.state.screen !== "welcome") return;
    roomsHost.style.display = "block";
    disposeRooms = mountRoomList(roomsHost, {
      list: async () => { await flow.signIn(); return rc.listRooms(); },
      join: async (r) => { await flow.joinListed(r); hideRooms(); },
    });
  };
  app.append(roomsHost, roomsButton);
  cleanups.push(() => { hideRooms(); roomsHost.remove(); roomsButton.remove(); });
  // In a match the sparring button gets its own measured rectangle clear of every control (QU01); outside a match it keeps the lobby spot.
  const placeSparButton = (layout: Layout | null): void => {
    const r = layout ? placeSparringRect(layout) : null;
    const st = sparButton.style;
    if (layout && r) { st.left = `${r.left}px`; st.top = `${r.top}px`; st.width = `${r.width}px`; st.height = `${r.height}px`; st.right = "auto"; st.visibility = ""; }
    else if (layout) st.visibility = "hidden";
    else { st.left = ""; st.top = "16px"; st.width = ""; st.height = ""; st.right = "16px"; st.visibility = ""; }
  };
  const setupActions: import("@eb/shared/sparring").SparringSetupActions = {
    start: async (config, kit, listed) => {
      setupPending = true;
      try {
        await flow.hostSparring(config, kit, listed === true);
        sparControls.style.display = "none";
      } finally { setupPending = false; }
    },
    copyLink: async () => {
      if (!hostRoom) throw new Error("No hosted match");
      return rc.copySparringLink(hostRoom, location.origin);
    },
    end: async () => { await flow.back(); sparControls.style.display = "none"; },
  };
  let disposeSetup = mountSparringSetup(sparControls, setupActions);
  cleanups.push(() => { disposeSetup(); sparControls.remove(); sparButton.remove(); sparToken = null; });
  let lobbyKey = "";
  const paintLobby = (force = false): void => {
    const v = lobbyView();
    const key = `${updater.state.visible}|${flow.state.screen}|${flow.state.error}|${flow.state.canRetry}|${v.seated}|${v.connection}|${flow.mode}`;
    if (!force && key === lobbyKey) return;
    lobbyKey = key;
    lobby.render(flow.state, v);
    guestLabel.hidden = flow.state.screen !== "welcome" || sparToken === null;
    sparButton.hidden = !(hostRoom || (flow.state.screen === "welcome" && sparToken === null && !sparRoom));
    roomsButton.hidden = !(flow.state.screen === "welcome" && sparToken === null && !sparRoom);
    if (flow.state.screen !== "welcome") hideRooms();
    sparButton.textContent = hostRoom ? "Sparring controls" : "Host sparring";
  };
  cleanups.push(flow.subscribe(() => { paintLobby(true); updater.refresh(); }));
  cleanups.push(updater.subscribe(() => { paintLobby(true); }));
  updater.start();
  cleanups.push(() => { updater.dispose(); });
  const lobbyTimer = window.setInterval(() => { paintLobby(); }, 250);
  cleanups.push(() => window.clearInterval(lobbyTimer));

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    flow.dispose();
    cancelAnimationFrame(rafId);
    runAll(matchCleanups);
    void rc.leave().catch(() => undefined);
    runAll(cleanups);
    gs?.dispose();
    gs = null;
  };
  window.addEventListener("pagehide", dispose, { once: true });
  cleanups.push(() => window.removeEventListener("pagehide", dispose));

  function enterMatch(kit: KitId): void {
    const g = gs as GameScene, m = map as ArenaMap, r = room as Room, R = rt as Runtime;
    const kitHandle = R.createRapierCollide(m);
    matchCleanups.push(() => kitHandle.dispose());
    const welcome = rc.welcome as WelcomeMessage;
    let showBoard = false, menuOpen = false, kitMenu = false;
    let ko: { tick: number; by: string } | null = null;
    const blockNotice = new BlockNotice();
    const settings = activeSettings();
    const tier = (q: Quality): Quality => (softwareGl ? "low" : q);
    const adaptive = new AdaptiveQuality(tier(settings.get().quality));
    g.setQuality(adaptive.level);
    const router = new PointerRouter(computeLayout({ x0: 0, y0: 0, W: window.innerWidth, H: window.innerHeight }), {
      awakeningReady: () => { const me = localOf(); return me !== undefined && meterFraction(me.kitId, me.meter100 ?? 0) >= 1; },
      onMenu: () => { menuOpen = !menuOpen; },
      onScoreboard: () => { showBoard = !showBoard; },
      onFighter: () => { kitMenu = !kitMenu; },
    });
    const sampler = new IntentSampler(router, welcome.epoch);
    const unsubs = [
      r.onMessage(ServerMessage.pong, (x: PongMessage) => { clock.onPong(x, performance.now()); }),
      r.onMessage(ServerMessage.welcome, (w: WelcomeMessage) => { sampler.setEpoch(w.epoch); }),
      r.onMessage(ServerMessage.actionResult, (a: ActionResult) => { if (!a.accepted) rejections.push(a.reason, performance.now()); }),
    ];
    matchCleanups.push(() => { for (const u of unsubs) u(); });
    const bus = new CombatBus((h) => r.onMessage(ServerMessage.combatEvent, h),
      (id) => (players().get(id) as { lifeId?: number } | undefined)?.lifeId);
    matchCleanups.push(() => bus.dispose());
    bus.on((e: CombatEvent) => {
      const me = localOf();
      if (!me || e.targetId !== String(me.entityId)) return;
      if (e.kind === "block") blockNotice.confirm(performance.now());
      else if (e.kind === "ko") ko = { tick: e.tick, by: e.actorId === e.targetId ? "the arena" : players().get(e.actorId)?.displayName ?? "a rival" };
      else if (e.kind === "respawn") ko = null;
    });

    // Debug only: server-confirmed hit move ids, so browser tests need not sample short actions from replicated state.
    const debugHitMoves: string[] = [];
    const debugEventCounts: Record<string, number> = {};
    if (opts.debug) matchCleanups.push(bus.on((e: CombatEvent) => {
      debugEventCounts[e.kind] = (debugEventCounts[e.kind] ?? 0) + 1;
      if (e.kind === "hit" && e.moveId) { debugHitMoves.push(e.moveId); if (debugHitMoves.length > 256) debugHitMoves.shift(); }
    }));

    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;inset:0;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
    document.body.append(probe);
    const hud = new Hud(document.body, document, (k) => { r.send("changeKit", { kitId: k }); kitMenu = false; }, () => { void flow.back(); }, () => { menuOpen = false; openSettings(); });
    matchCleanups.push(() => { hud.dispose(); probe.remove(); });
    let hudKey = "";
    const currentLayout = (): Layout => {
      const base = computeLayout(readSafeRect(window, probe));
      const st = settings.get();
      return resolveLayout(base, st.layouts[viewportClass(base.safe.W)], st.handedness).layout;
    };
    let lastLayout = currentLayout();
    router.setLayout(lastLayout);
    router.facingLock = settings.get().facingLock;
    router.sensitivity = settings.get().sensitivity;
    // Repaint now rather than on the next HUD interval tick, so the visible HUD never lags the hit-test layout.
    const relayout = (): void => { lastLayout = currentLayout(); router.setLayout(lastLayout); hudKey = ""; drawHud(); placeSparButton(lastLayout); };
    matchCleanups.push(() => { placeSparButton(null); });
    // Opening Settings releases every held input; the arena keeps running (spec section 6).
    const onSettingsOpen = (): void => { router.releaseAll(); };
    const onSettingsChange = (): void => {
      router.sensitivity = settings.get().sensitivity;
      cam.setDistance(settings.get().cameraDistance);
      cam.reducedMotion = settings.get().reducedMotion;
      adaptive.setCeiling(tier(settings.get().quality));
      g.setQuality(adaptive.level);
      relayout();
    };
    settingsOpenHooks.add(onSettingsOpen);
    settingsChangeHooks.add(onSettingsChange);
    matchCleanups.push(() => { settingsOpenHooks.delete(onSettingsOpen); settingsChangeHooks.delete(onSettingsChange); settingsRef?.panel.close(); });
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", relayout);
    matchCleanups.push(() => { window.removeEventListener("resize", relayout); window.removeEventListener("orientationchange", relayout); });
    const canvas = canvasHost.querySelector("canvas") as HTMLCanvasElement;
    matchCleanups.push(attachPointerRouter(router, canvas, window, document));
    matchCleanups.push(attachKeyboardRouter(router, window, canvas));

    let telegraphs: AttackTelegraphs | null = null;
    const cam = new R.CameraRig(m.colliders);
    cam.setDistance(settings.get().cameraDistance);
    cam.reducedMotion = settings.get().reducedMotion;
    matchCleanups.push(R.registerPresentation(bus, {
      scene: g.scene, camera: g.camera, players, settings, localId: () => { const me = localOf(); return me ? String(me.entityId) : undefined; },
      surfaceHeight: (x, z, fromY) => surfaceBelow(m.colliders, x, z, fromY),
      effects: g.effects, fighters: (id) => g.viewFor(id), shake: (a, ms) => { cam.shake(a, ms); },
      serverTick: () => Math.floor(clock.serverTick(performance.now()) ?? ((r.state as { serverTick?: number }).serverTick ?? 0)),
      cover: (ox, oy, oz, fx, fz, max) => R.rayCoverLength(m.colliders, ox, oy, oz, fx, fz, max),
      onTelegraphs: (t) => { telegraphs = t; },
    }));
    const captureCam = new R.CaptureCam(cam);
    let capRaf = 0;
    const capFrame = (): void => {
      const me = localOf() as { action?: string; lifeId?: number; connected?: boolean } | undefined;
      captureCam.update({ action: me?.action, lifeId: me?.lifeId, connected: me !== undefined && me.connected !== false, menuOpen, reducedMotion: settings.get().reducedMotion });
      capRaf = requestAnimationFrame(capFrame);
    };
    capRaf = requestAnimationFrame(capFrame);
    matchCleanups.push(() => { cancelAnimationFrame(capRaf); captureCam.dispose(); });
    const loop = new R.GameLoop({
      scene: g, camera: cam, collide: kitHandle.collide, router, sampler, clock,
      readState: (): LoopState => ({ serverTick: (r.state as { serverTick?: number }).serverTick ?? 0, players: players().entries(), projectiles: (r.state as LoopState).projectiles ?? [], urns: (r.state as LoopState).urns ?? [] }),
      sendInput: (p) => { rc.send("input", p); },
      sendPing: (p) => { rc.send("ping", p); },
      onFrameTime: (ms) => { const q = adaptive.push(ms); if (q) g.setQuality(q); },
    });
    matchCleanups.push(() => loop.dispose());

    if (flow.mode === "practice") {
      const panel = new PracticePanel(document.body, (t) => { r.send("practice", t); });
      matchCleanups.push(() => panel.dispose());
      const panelTimer = window.setInterval(() => {
        const o = localOf()?.owner;
        panel.render({ step: o?.tutorialStep ?? 0, skillMask: o?.tutorialSkillMask ?? 0, dummyGuard: o?.dummyGuard ?? false, dummyRagdoll: o?.dummyRagdoll ?? false });
      }, 100);
      matchCleanups.push(() => window.clearInterval(panelTimer));
    }

    const drawHud = (): void => {
      const me = localOf();
      const stateTick = (r.state as { serverTick?: number }).serverTick ?? 0;
      const now = Math.floor(clock.serverTick(performance.now()) ?? stateTick);
      const ml = meterLabel(me?.kitId ?? opts.kitId, me?.meter100 ?? 0);
      const dead = me?.action === "Dead" && ko !== null;
      const pending = me?.owner?.pendingKit ?? "";
      const st = {
        name: me?.displayName ?? lobby.displayName, hp: (me?.hp100 ?? 10000) / 100, maxHp: 100, meter: ml.fraction, meterText: ml.text,
        facingLock: router.facingLock, portrait: window.innerHeight > window.innerWidth,
        skills: equippedSkillNames(me?.kitId ?? opts.kitId, me?.form ?? "Base"),
        blocked: blockNotice.active(performance.now()),
        cooldowns: [0, 1, 2, 3].map((i) => cooldownLabel(me?.cooldownEndTicks?.[i] ?? 0, now)),
        formText: me ? formTimerText(me.form, me.formEndTick, now) : "",
        stillpointText: stillpointText(me?.owner?.lethalCounterRemaining ?? 0),
        rejection: rejections.current(performance.now()),
        respawn: dead && ko ? { by: (ko as { by: string }).by, seconds: respawnSecondsLeft((ko as { tick: number }).tick, now) } : null,
        scoreboard: showBoard ? scoreboardRows([...players().values()].map((p) => ({ ...p, local: p.owner !== undefined }))) : null,
        menuOpen,
        kitMenu: kitMenu
          ? { kits: P0_KITS.map((k) => ({ id: k, label: KIT_LABEL[k] })), current: me?.kitId ?? opts.kitId, pending: pending ? (KIT_LABEL[pending as KitId] ?? pending) : "" }
          : null,
      };
      const key = JSON.stringify([st, lastLayout.s, window.innerWidth, window.innerHeight]);
      if (key === hudKey) return;
      hudKey = key;
      hud.render(lastLayout, st);
    };
    const hudTimer = window.setInterval(drawHud, 100);
    matchCleanups.push(() => window.clearInterval(hudTimer));
    drawHud();
    placeSparButton(lastLayout);

    r.send("ready", { kitId: kit, contentHash: rc.localContentHash });
    loop.start();

    if (opts.debug) {
      (window as unknown as { __eb: unknown }).__eb = {
        /** Test-only: sets the player-controlled camera yaw so both fighters can face each other. */
        setCameraYaw: (y: number) => { router.yaw = y; },
        /** Test-only: saturates the pooled particle buffer so telegraph retention can be checked. */
        floodFx: (n: number) => { for (let i = 0; i < n; i++) g.effects.spawn({ x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: 0, life: 30, size: 0.1, color: 0xffffff }); },
        snapshot: () => ({
          localEntityId: loop.localEntityId,
          serverTick: (r.state as { serverTick?: number }).serverTick ?? 0,
          projectiles: g.projectiles.snapshot(),
          urns: g.urns.snapshot(),
          reconciles: loop.reconcileCount,
          hitMoveIds: [...debugHitMoves],
          eventCounts: { ...debugEventCounts },
          render: glRenderer ? { geometries: glRenderer.info.memory.geometries, calls: glRenderer.info.render.calls, triangles: glRenderer.info.render.triangles, tier: adaptive.level } : null,
          telegraphs: telegraphs?.snapshot() ?? null,
          fx: { active: g.effects.activeCount, capacity: g.effects.capacity, flashing: [...players().keys()].filter((id) => g.viewFor(id)?.flashing), shaking: cam.shaking },
          corrections: { ...loop.correctionCounts },
          camera: (() => {
            const f = loop.framing;
            if (!f) return null;
            const markers = f.opponent ? R.fighterMarkers(f.opponent) : null;
            const aspect = g.camera.aspect;
            return { offset: cam.shoulderOffset, lift: cam.heightAssist, distance: cam.pose.distance, position: cam.pose.position, pivot: cam.pose.pivot, yaw: router.yaw, local: f.local, opponent: f.opponent, markers,
              visible: f.opponent ? R.framingOk(cam.pose, f.local, f.opponent, aspect) : null,
              screen: markers ? Object.fromEntries(Object.entries(markers).map(([k, v]) => {
                const q = R.projectPoint(cam.pose, v, aspect);
                return [k, { x: (q.x + 1) / 2 * window.innerWidth, y: (1 - q.y) / 2 * window.innerHeight, depth: q.depth }];
              })) : null };
          })(),
          predicted: loop.prediction ? { ...loop.prediction.pos } : null,
          players: [...players().values()].map((p) => ({
            entityId: p.entityId, name: p.displayName, kitId: p.kitId, hp100: p.hp100, action: p.action, moveId: p.moveId ?? "", ready: p.ready ?? false,
            x: p.x / 100, y: p.y / 100, z: p.z / 100, local: p.owner !== undefined,
            kills: p.kills, deaths: p.deaths, assists: p.assists, meter100: p.meter100 ?? 0, cooldownEndTicks: Array.from(p.cooldownEndTicks ?? []),
            form: p.form,
          })),
          practice: flow.mode === "practice"
            ? { step: localOf()?.owner?.tutorialStep ?? 0, skillMask: localOf()?.owner?.tutorialSkillMask ?? 0, dummyGuard: localOf()?.owner?.dummyGuard ?? false, dummyRagdoll: localOf()?.owner?.dummyRagdoll ?? false }
            : null,
        }),
      };
      matchCleanups.push(() => { delete (window as unknown as { __eb?: unknown }).__eb; });
    }
  }

  await flow.start();
  if (opts.auto && flow.state.screen === "welcome") {
    await flow.play();
    if ((flow.state.screen as string) === "lobby") flow.ready(lobby.kit);
  }
  return { scene: gs, dispose };
}

async function waitFor<T>(get: () => T | null, ms: number, what: string): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const v = get();
    if (v !== null) return v;
    if (performance.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Reads boot options from the URL. The invitation comes from the fragment only and is removed from the address bar. */
export function readBootOptions(loc: Location = location, hist: History = history): BootOptions {
  const q = new URLSearchParams(loc.search);
  const sparToken = consumeSparringFragment(loc, hist);
  const invite = consumeInviteFragment(loc, hist);
  const kit = q.get("kit");
  const name = (q.get("name") ?? "Arel").slice(0, 16);
  return {
    invite, sparToken, roomCode: q.get("room") ?? "play", displayName: name,
    kitId: kit === "td" ? "td" : "sv", debug: q.get("debug") === "1", auto: q.get("auto") === "1",
  };
}

const app = document.getElementById("app");
if (app) void boot(app);
void swRegistration();

/** Reads the invitation from the URL fragment and removes it before any request (spec section 20). */
export function consumeInviteFragment(loc: Location = location, hist: History = history): string | null {
  const m = /(?:^#|&)invite=([A-Za-z0-9_-]{8,128})/.exec(loc.hash);
  if (!m) return null;
  hist.replaceState(null, "", loc.pathname + loc.search);
  return m[1] ?? null;
}

export function createRoomClient(): RoomClient {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new RoomClient({
    httpBase: "",
    wsEndpoint: `${proto}://${location.host}`,
    storage: sessionStorage,
  });
}

/** Scoped bearer stays in memory; remove even malformed spar fragments before requests. */
export function consumeSparringFragment(loc: Location = location, hist: History = history): string | null {
  const params = new URLSearchParams(loc.hash.slice(1));
  if (!params.has("spar")) return null;
  const token = params.get("spar");
  hist.replaceState(null, "", loc.pathname + loc.search);
  return token ?? "";
}
