import "./base.css";
import { mountMoveGuide } from "./ui/MoveGuide.js";
import { castDescription, skillDefinitions, skillRoles } from "./ui/SkillInfo.js";
import type { WebGLRenderer } from "three";
import type { Room } from "@colyseus/sdk";
import { meterFraction } from "@eb/shared/awakening";
import { COMBAT } from "@eb/shared/config/combat";
import { surfaceBelow, parseArenaMap, type ArenaMap } from "@eb/shared/config/arena";
import {
  MAX_CLIENTS, P0_KITS, PRACTICE_ROOM_CODE, RoundOverMessageSchema, ServerMessage,
  type ActionResult, type CombatEvent, type KitId, type PongMessage, type WelcomeMessage,
} from "@eb/shared/protocol";
import islandsUrl from "../../../assets/maps/islands.v1.json?url";
import { mountRoomList } from "./ui/RoomList.js";
import { mountSparringSetup } from "./ui/SparringSetup.js";
import { swRegistration } from "./app/registerSw.js";
import { UpdateWatcher, browserUpdateDeps } from "./app/UpdateWatcher.js";
import { AppFlow } from "./app/AppFlow.js";
import { ConnectionLifecycle, phaseText, type ConnectionPhase, type LifecycleRoom } from "./app/ConnectionLifecycle.js";
import { CombatBus } from "./app/CombatBus.js";
import type { AttackTelegraphs } from "./fx/AttackTelegraphs.js";
import { AdaptiveQuality } from "./app/AdaptiveQuality.js";
import type { LoopPlayer, LoopState } from "./app/GameLoop.js";
import { SettingsStore } from "./app/SettingsStore.js";
import { computeLayout, placeSparringRect, type Layout } from "./input/ControlLayout.js";
import { resolveLayout, viewportClass } from "./input/LayoutEdit.js";
import { attachKeyboardRouter } from "./input/KeyboardRouter.js";
import { IntentSampler } from "./input/IntentSampler.js";
import { InputGate } from "./input/InputGate.js";
import { PointerRouter, attachPointerRouter } from "./input/PointerRouter.js";
import { ClockSync } from "./net/ClockSync.js";
import { RoomClient } from "./net/RoomClient.js";
import { hasWebGL2 } from "./scene/webgl.js";
import type { GameScene, Quality } from "./scene/GameScene.js";
import { Hud, readSafeRect } from "./ui/Hud.js";
import { Nameplates, plateLayout } from "./ui/Nameplates.js";
import { DamageCues, cueAngle } from "./ui/DamageCues.js";
import { RoundResults } from "./ui/RoundResults.js";
import {
  BlockNotice, RejectionNotice, cooldownFraction, cooldownLabel, dashStatus, equippedSkillNames, formTimerText, skillAvailability, meterLabel, respawnSecondsLeft, scoreboardRows, stillpointText,
} from "./ui/HudFormat.js";
import { mountHowToPlay } from "./ui/HowToPlay.js";
import { KIT_LABEL, Lobby, type LobbyView } from "./ui/Lobby.js";
import { PracticePanel } from "./ui/PracticePanel.js";
import { SettingsPanel } from "./ui/Settings.js";

const SPARRING_GUIDE_AVAILABLE = true;

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

/** GR03: handlers the current match installs so connection events reach its loop, clock and sampler. */
interface MatchHooks { drop?: () => void; welcome?: (w: WelcomeMessage) => void }

/** Player record as read from room.state (HUD fields on top of the loop's). */
interface HudPlayer extends LoopPlayer {
  form: string; formEndTick: number; kills: number; deaths: number; assists: number;
  cooldownEndTicks: ArrayLike<number>;
  awakenedUsedMask?: number; actionStartTick?: number;
  owner?: {
    evasiveEndTick?: number; chargeStartTick?: number;
    ackInputTick: number; epoch: number; pendingKit?: string; lethalCounterRemaining?: number;
    tutorialStep?: number; tutorialSkillMask?: number; dummyGuard?: boolean; dummyRagdoll?: boolean; practiceBotCount?: number; practiceBotDifficulty?: string;
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
  let lifecycle: ConnectionLifecycle | null = null;
  const matchHooks: MatchHooks = {};
  let paintConnection: (phase: ConnectionPhase) => void = () => undefined;
  let rafId = 0;
  const rc = createRoomClient();
  let sparToken = opts.sparToken ?? null;
  opts.sparToken = null;
  let sparRoom: string | null = null;
  let hostRoom: string | null = null;
  let authenticated = false;
  let openName: string | null = null;
  let openAvailable = true;
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
    moves: () => { openMoves(); },
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

  let disposeMoves: (() => void) | null = null;
  /** GR05: the active match installs these; single top overlay means opening one closes the others. */
  let syncGate: () => void = () => undefined;
  let closeMatchPanels: () => void = () => undefined;
  const closeMoves = (): void => { disposeMoves?.(); disposeMoves = null; syncGate(); };
  const closeOtherOverlays = (keep: "settings" | "moves" | "sparring"): void => {
    if (keep !== "moves") closeMoves();
    if (keep !== "settings") settingsRef?.panel.close();
    if (keep !== "sparring") sparControls.style.display = "none";
    closeMatchPanels();
  };
  const openMoves = (): void => {
    if (disposeMoves) return;
    closeOtherOverlays("moves");
    const me = localOf(); disposeMoves = mountMoveGuide(document.body, me && P0_KITS.includes(me.kitId as KitId) ? me.kitId as KitId : lobby.kit, me?.form ?? "Base", closeMoves);
    syncGate();
  };
  cleanups.push(closeMoves);

  // T27 settings: one store and panel per local profile name (Arel/Nora); rebuilt if the label changes.
  const safeProbe = document.createElement("div");
  safeProbe.style.cssText = "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(safeProbe);
  cleanups.push(() => safeProbe.remove());
  let settingsRef: { name: string; store: SettingsStore; panel: SettingsPanel; unsub: () => void } | null = null;
  const settingsHooks = {
    onOpen: () => { closeOtherOverlays("settings"); for (const f of settingsOpenHooks) f(); syncGate(); },
    onClose: () => { syncGate(); },
    inMatch: () => matchCleanups.length > 0,
    safeRect: () => readSafeRect(window, safeProbe),
    qualityStatus: () => gs ? `Rendering: ${gs.qualityLevel}${softwareGl ? " · software rendering limits this device to Low" : " · adapts to keep combat smooth"}` : "Your choice applies when you enter the arena.",
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
  const openSettings = (): void => { activeSettings(); settingsRef?.panel.open(); syncGate(); };
  cleanups.push(() => { settingsRef?.unsub(); settingsRef?.panel.dispose(); settingsRef = null; });

  const guestLabel = document.createElement("label");
  guestLabel.textContent = "Guest display name ";
  guestLabel.style.cssText = "position:fixed;bottom:16px;left:16px;z-index:10;color:white;font:16px Inter,system-ui,sans-serif";
  const guestName = document.createElement("input");
  guestName.value = opts.displayName; guestName.maxLength = 16;
  guestName.style.cssText = "min-height:48px;font:inherit;max-width:180px";
  guestLabel.append(guestName); app.append(guestLabel);
  cleanups.push(() => guestLabel.remove());

  /**
   * GR03: one lifecycle per joined room. It owns every SDK subscription (kept together, removed on dispose) and
   * decides when gameplay input may flow. Terminal closes always dispose the match and show an error route.
   */
  function watchRoom(joined: Room, mode: "play" | "practice" | "sparring", code: string): void {
    lifecycle?.dispose();
    const lc = new ConnectionLifecycle({
      readLocal: () => { const me = localOf(); const o = me?.owner; return me && o ? { epoch: o.epoch, ready: me.ready === true } : null; },
      onPhase: (ph) => { paintConnection(ph); },
      onDrop: () => { matchHooks.drop?.(); },
      onWelcome: (w) => { matchHooks.welcome?.(w); },
      onClosed: (kind) => {
        if (room !== joined || disposed) return;
        if (mode === "sparring") { hostRoom = null; sparRoom = null; }
        void leaveRoom().finally(() => { flow.connectionClosed(kind); });
      },
    });
    lifecycle = lc;
    lc.attach(joined as unknown as LifecycleRoom);
    if (rc.welcome) lc.noteWelcome(rc.welcome);
    rc.setResumeMeta({ roomCode: code, mode, host: hostRoom !== null });
    matchCleanups.push(() => { lc.explicitLeave(); lc.dispose(); if (lifecycle === lc) lifecycle = null; });
  }

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
    needsLogin: () => openAvailable && !opts.invite && openName !== lobby.displayName,
    login: async () => {
      if (sparToken !== null) {
        sparRoom = await rc.redeemSparring(sparToken, guestName.value || lobby.displayName);
        sparToken = null;
      } else if (!sparRoom && !authenticated) {
        if (opts.invite) { await rc.login(opts.invite, lobby.displayName); authenticated = true; }
        // Cookie-only adult reload is authenticated by the CSRF endpoint when creating/joining.
        else authenticated = true;
      }
      // Open join: the server session carries the display name, so a changed Arel/Nora pick needs a fresh session.
      if (!sparRoom && sparToken === null && !opts.invite && openName !== lobby.displayName) {
        openAvailable = await rc.openLogin(lobby.displayName);
        if (openAvailable) openName = lobby.displayName;
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
      const code = mode === "sparring" ? sparRoom! : mode === "practice" ? PRACTICE_ROOM_CODE : picked ?? opts.roomCode;
      room = await rc.joinWithRetry(code, opts.auto ? 4 : 1);
      await waitFor(() => rc.welcome, 5000, "welcome");
      clock = new ClockSync();
      watchRoom(room, mode, code);
    },
    canResume: () => rc.resumeMeta() !== null,
    resume: async () => {
      const meta = rc.resumeMeta();
      if (!meta) { rc.clearResume(); return null; }
      const resumed = await rc.tryResume(); // exactly one attempt; a rejection discards the stored metadata
      if (!resumed) return null;
      room = resumed;
      try { await waitFor(() => rc.welcome, 5000, "welcome"); } catch { await leaveRoom(); return null; }
      clock = new ClockSync();
      if (meta.mode === "sparring") { sparRoom = meta.roomCode; if (meta.host) hostRoom = meta.roomCode; }
      watchRoom(resumed, meta.mode, meta.roomCode);
      return meta.mode;
    },
    enterResumed: () => { const me = localOf(); enterMatch(me && P0_KITS.includes(me.kitId as KitId) ? me.kitId as KitId : lobby.kit, true); },
    sendReady: (kit) => { if (map && gs && room) enterMatch(kit, false); },
    leave: leaveRoom,
    sleep: (ms) => new Promise((r) => { const t = window.setTimeout(r, ms); cleanups.push(() => window.clearTimeout(t)); }),
  });
  flowRef.current = flow;

  const lobbyView = (): LobbyView =>
    ({ updateVisible: updater.state.visible, seated: players().size, capacity: MAX_CLIENTS, connection: room ? "online" : "offline", mode: flow.mode === "practice" ? "practice" : "play" });
  let setupPending = false;
  const sparControls = document.createElement("div");
  sparControls.className = "eb-overlay";
  sparControls.style.cssText = "position:fixed;inset:0;z-index:20;overflow:auto;background:#0b1118;display:none;padding:16px;box-sizing:border-box";
  const closeSetup = document.createElement("button");
  closeSetup.className = "eb-overlay-close";
  closeSetup.textContent = "Back to game";
  closeSetup.style.cssText = "min-height:48px;font:inherit";
  closeSetup.onclick = () => { sparControls.style.display = "none"; syncGate(); };
  sparControls.append(closeSetup);
  const sparButton = document.createElement("button");
  sparButton.className = "eb-launcher";
  sparButton.textContent = "Host sparring";
  sparButton.style.cssText = "position:fixed;right:16px;top:16px;z-index:21;min-height:48px;font:600 17px Inter,system-ui,sans-serif";
  sparButton.onclick = () => {
    if (setupPending) return;
    if (!hostRoom) { disposeSetup(); disposeSetup = mountSparringSetup(sparControls, setupActions); }
    closeOtherOverlays("sparring");
    sparControls.style.display = "block";
    syncGate();
  };
  app.append(sparControls, sparButton);
  // WEB3: room list. The panel exists only while open; its timer and listeners go with it.
  const roomsHost = document.createElement("div");
  roomsHost.className = "eb-overlay";
  roomsHost.style.cssText = "position:fixed;inset:0;z-index:20;overflow:auto;background:#0b1118;display:none;padding:16px;box-sizing:border-box";
  const closeRooms = document.createElement("button");
  closeRooms.className = "eb-overlay-close";
  closeRooms.textContent = "Back to game";
  closeRooms.style.cssText = "min-height:48px;font:inherit";
  let disposeRooms: (() => void) | null = null;
  const hideRooms = (): void => { disposeRooms?.(); disposeRooms = null; roomsHost.style.display = "none"; };
  closeRooms.onclick = hideRooms;
  roomsHost.append(closeRooms);
  const roomsButton = document.createElement("button");
  roomsButton.className = "eb-launcher";
  roomsButton.textContent = "Find a room";
  roomsButton.style.cssText = "position:fixed;right:16px;top:76px;z-index:21;min-height:48px;font:600 17px Inter,system-ui,sans-serif";
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
        syncGate();
      } finally { setupPending = false; }
    },
    copyLink: async () => {
      if (!hostRoom) throw new Error("No hosted match");
      return rc.copySparringLink(hostRoom, location.origin);
    },
    end: async () => { await flow.back(); sparControls.style.display = "none"; syncGate(); },
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

  /** `suspend` = lifecycle suspension (pagehide): the seat stays reserved and the token survives for reload/BFCache. */
  const teardown = (suspend: boolean): void => {
    if (disposed) return;
    disposed = true;
    flow.dispose();
    cancelAnimationFrame(rafId);
    if (suspend) rc.suspend(); // close without consent BEFORE cleanups so nothing treats it as Leave
    runAll(matchCleanups);
    if (!suspend) void rc.leave().catch(() => undefined);
    runAll(cleanups);
    gs?.dispose();
    gs = null;
  };
  const dispose = (): void => { teardown(false); };
  // Only a ready fighter in a match is worth keeping a seat for; a lobby visitor simply leaves (no ghost seat for 20 s).
  const onPageHide = (): void => { teardown(flow.state.screen === "match"); };
  window.addEventListener("pagehide", onPageHide, { once: true });
  cleanups.push(() => window.removeEventListener("pagehide", onPageHide));

  function enterMatch(kit: KitId, resumed: boolean): void {
    const g = gs as GameScene, m = map as ArenaMap, r = room as Room, R = rt as Runtime;
    const kitHandle = R.createRapierCollide(m);
    matchCleanups.push(() => kitHandle.dispose());
    const welcome = rc.welcome as WelcomeMessage;
    let showBoard = false, menuOpen = false, kitMenu = false;
    let ko: { tick: number; by: string; actorId: string | null } | null = null;
    const blockNotice = new BlockNotice();
    const settings = activeSettings();
    const tier = (q: Quality): Quality => (softwareGl ? "low" : q);
    const adaptive = new AdaptiveQuality(tier(settings.get().quality));
    g.setQuality(adaptive.level);
    const gate = new InputGate();
    matchCleanups.push(() => { gate.dispose(); syncGate = () => undefined; closeMatchPanels = () => undefined; });
    const router = new PointerRouter(computeLayout({ x0: 0, y0: 0, W: window.innerWidth, H: window.innerHeight }), {
      onFacingLockChange: on => { settings.update({ facingLock: on }); },
      isChargeSlot: (slot) => { const me = localOf(); return me?.kitId === "ea" && me.form === "Base" && slot === 3; },
      awakeningReady: () => { const me = localOf(); return me !== undefined && meterFraction(me.kitId, me.meter100 ?? 0) >= 1; },
      onMenu: () => {
        // Escape closes the top overlay first; only with none open does it toggle the pause menu.
        if (disposeMoves) closeMoves();
        else if (settingsRef?.panel.isVisible) settingsRef.panel.close();
        else if (sparControls.style.display !== "none") sparControls.style.display = "none";
        else if (kitMenu) kitMenu = false;
        else menuOpen = !menuOpen;
        syncGate();
      },
      onScoreboard: () => { showBoard = !showBoard; if (showBoard) router.releaseAll(); }, // opening clears holds once; it is not a gate reason
      onFighter: () => { kitMenu = !kitMenu; if (kitMenu) menuOpen = false; syncGate(); },
      gate,
    });
    const sampler = new IntentSampler(router, welcome.epoch);
    const unsubs = [
      r.onMessage(ServerMessage.pong, (x: PongMessage) => { clock.onPong(x, performance.now()); }),
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
      else if (e.kind === "ko") ko = { tick: e.tick, by: e.actorId === e.targetId ? "the arena" : players().get(e.actorId)?.displayName ?? "a rival", actorId: e.actorId === e.targetId ? null : e.actorId };
      else if (e.kind === "respawn") ko = null;
      else if (e.kind === "hit" && e.actorId !== undefined && e.actorId !== e.targetId) {
        const atk = players().get(e.actorId);
        if (atk) {
          const q = R.projectPoint(cam.pose, { x: atk.x / 100, y: atk.y / 100, z: atk.z / 100 }, g.camera.aspect);
          cues.hit(cueAngle(q), e.hitClass === "heavy", performance.now());
        }
      }
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
    const hud = new Hud(document.body, document, (k) => { r.send("changeKit", { kitId: k }); kitMenu = false; syncGate(); }, () => { void flow.back(); }, () => { menuOpen = false; openSettings(); }, () => { menuOpen = false; openMoves(); }, () => { closeOtherOverlays("settings"); menuOpen = false; kitMenu = true; syncGate(); });
    matchCleanups.push(() => { hud.dispose(); probe.remove(); });
    let plateOrigin = { x: 0, y: 0 };
    const plates = new Nameplates(document.body, document, () => plateOrigin);
    matchCleanups.push(() => plates.dispose());
    const cues = new DamageCues(document.body, document);
    const roundResults = new RoundResults(document.body, document);
    matchCleanups.push(() => roundResults.dispose());
    const unsubRound = r.onMessage(ServerMessage.roundOver, (m: unknown) => {
      const parsed = RoundOverMessageSchema.safeParse(m);
      if (parsed.success) roundResults.show(parsed.data, Math.floor(clock.serverTick(performance.now()) ?? ((r.state as { serverTick?: number }).serverTick ?? 0)));
    });
    matchCleanups.push(() => unsubRound());
    matchCleanups.push(() => cues.dispose());
    let hudKey = "";
    const currentLayout = (): Layout => {
      const base = computeLayout(readSafeRect(window, probe));
      const st = settings.get();
      return resolveLayout(base, st.layouts[viewportClass(base.safe.W)], st.handedness).layout;
    };
    let lastLayout = currentLayout();
    router.setLayout(lastLayout);
    router.facingLock = settings.get().facingLock;
    router.autoRun = settings.get().autoRun; router.quickUse = settings.get().quickUse;
    router.sensitivity = settings.get().sensitivity;
    // Repaint now rather than on the next HUD interval tick, so the visible HUD never lags the hit-test layout.
    const relayout = (): void => { lastLayout = currentLayout(); router.setLayout(lastLayout); syncGate(); hudKey = ""; drawHud(); placeSparButton(lastLayout); };
    matchCleanups.push(() => { placeSparButton(null); });
    // Opening Settings releases every held input; the arena keeps running (spec section 6).
    const onSettingsOpen = (): void => { router.releaseAll(); };
    closeMatchPanels = () => { menuOpen = false; kitMenu = false; };
    const sendNeutralNow = (): void => {
      const tick = Math.floor(clock.serverTick(performance.now()) ?? ((r.state as { serverTick?: number }).serverTick ?? 0));
      const p = sampler.neutral(tick);
      if (p && lifecycle?.phase === "active") rc.send("input", p);
    };
    // Entering the gated state: release keyboard and pointer owners, drop queued edges, then one neutral packet now.
    matchCleanups.push(gate.onClose(() => { router.releaseAll(); router.takeEdges(); sampler.reset(); sendNeutralNow(); }));
    syncGate = (): void => {
      gate.set("menu", menuOpen);
      gate.set("fighter", kitMenu);
      gate.set("moves", disposeMoves !== null);
      gate.set("settings", settingsRef?.panel.isVisible === true);
      gate.set("sparring", sparControls.style.display !== "none");
      gate.set("orientation", lastLayout.tooSmall);
      gate.set("connection", !(lifecycle?.inputEnabled ?? false));
    };
    let lastSettings = settings.get();
    const onSettingsChange = (): void => {
      const nextSettings = settings.get();
      const layoutChanged = nextSettings.handedness !== lastSettings.handedness || JSON.stringify(nextSettings.layouts) !== JSON.stringify(lastSettings.layouts);
      if (nextSettings.facingLock !== lastSettings.facingLock) router.facingLock = nextSettings.facingLock;
      router.autoRun = nextSettings.autoRun; router.quickUse = nextSettings.quickUse;
      router.sensitivity = settings.get().sensitivity;
      cam.setDistance(settings.get().cameraDistance);
      cam.reducedMotion = settings.get().reducedMotion;
      if (nextSettings.quality !== lastSettings.quality) { adaptive.setCeiling(tier(nextSettings.quality)); g.setQuality(adaptive.level); }
      lastSettings = nextSettings;
      if (layoutChanged) relayout();
      settingsRef?.panel.refreshRuntime();
    };
    settingsOpenHooks.add(onSettingsOpen);
    settingsChangeHooks.add(onSettingsChange);
    matchCleanups.push(() => { settingsOpenHooks.delete(onSettingsOpen); settingsChangeHooks.delete(onSettingsChange); settingsRef?.panel.close(); closeMoves(); });
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
      captureCam.update({ action: me?.action, lifeId: me?.lifeId, connected: me !== undefined && me.connected !== false, menuOpen: menuOpen || gate.closed, reducedMotion: settings.get().reducedMotion });
      const rect = readSafeRect(window, probe);
      plateOrigin = { x: rect.x0, y: rect.y0 };
      plates.update(plateLayout([...players().values()].map((p) => ({
        id: String(p.entityId), name: p.displayName, hpFrac: (p.hp100 ?? 0) / 10000,
        pos: { x: p.x / 100, y: p.y / 100, z: p.z / 100 }, local: p.owner !== undefined,
        alive: p.action !== "Dead" && p.ready !== false, kitId: p.kitId,
      })), (v) => R.projectPoint(cam.pose, v, g.camera.aspect), rect.W, rect.H));
      cues.frame(performance.now(), (me as { hp100?: number } | undefined)?.hp100 !== undefined ? (me as { hp100: number }).hp100 / 10000 : 1, settings.get().reducedMotion);
      capRaf = requestAnimationFrame(capFrame);
    };
    capRaf = requestAnimationFrame(capFrame);
    matchCleanups.push(() => { cancelAnimationFrame(capRaf); captureCam.dispose(); });
    const loop = new R.GameLoop({
      scene: g, camera: cam, collide: kitHandle.collide, router, sampler, clock,
      inputEnabled: () => (lifecycle?.inputEnabled ?? false) && !gate.closed,
      readState: (): LoopState => ({ serverTick: (r.state as { serverTick?: number }).serverTick ?? 0, players: players().entries(), projectiles: (r.state as LoopState).projectiles ?? [], urns: (r.state as LoopState).urns ?? [] }),
      sendInput: (p) => { if (lifecycle?.phase === "active") rc.send("input", p); },
      sendPing: (p) => { if (lifecycle?.phase === "active" || lifecycle?.phase === "connecting") rc.send("ping", p); },
      onFrameTime: (ms) => { const q = adaptive.push(ms); if (q) { g.setQuality(q); settingsRef?.panel.refreshRuntime(); } },
    });
    matchCleanups.push(() => loop.dispose());

    // GR03: connection events reach this match. A drop clears every hold, edge, prediction and interpolation
    // buffer; a new welcome additionally resets the clock and sampler epoch. Nothing is replayed after either.
    const clearLocalIntent = (): void => { router.releaseAll(); router.takeEdges(); sampler.setEpoch(sampler.epoch); };
    matchHooks.drop = () => { clearLocalIntent(); clock.reset(); loop.resetEpoch(); };
    matchHooks.welcome = (w) => { clearLocalIntent(); sampler.setEpoch(w.epoch); clock.reset(); loop.resetEpoch(); };
    matchCleanups.push(() => { delete matchHooks.drop; delete matchHooks.welcome; });
    const banner = document.createElement("div");
    banner.setAttribute("role", "status"); banner.setAttribute("aria-live", "polite"); banner.dataset["ui"] = "connection-status";
    banner.style.cssText = "position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:70;max-width:min(520px,90vw);padding:10px 16px;border-radius:12px;background:#0b1118e6;color:#fff;font:600 16px Inter,system-ui,sans-serif;text-align:center;pointer-events:none";
    banner.hidden = true;
    document.body.append(banner);
    paintConnection = (ph) => { const t = phaseText(ph); banner.hidden = t === null; banner.textContent = t ?? ""; syncGate(); };
    matchCleanups.push(() => { paintConnection = () => undefined; banner.remove(); });
    lifecycle?.setRequireReady(true);
    paintConnection(lifecycle?.phase ?? "connecting");
    if (flow.mode === "practice") {
      const panel = new PracticePanel(document.body, (t) => { r.send("practice", t); }, document, openMoves);
      matchCleanups.push(() => panel.dispose());
      const panelTimer = window.setInterval(() => {
        const o = localOf()?.owner;
        panel.render({ step: o?.tutorialStep ?? 0, skillMask: o?.tutorialSkillMask ?? 0, dummyGuard: o?.dummyGuard ?? false, dummyRagdoll: o?.dummyRagdoll ?? false, botCount: o?.practiceBotCount ?? 0, botDifficulty: o?.practiceBotDifficulty ?? "easy" });
      }, 100);
      matchCleanups.push(() => window.clearInterval(panelTimer));
    }

    const koCard = (k: { tick: number; by: string; actorId: string | null }, now: number) => {
      const killer = k.actorId === null ? undefined : players().get(k.actorId);
      return {
        by: k.by, byKit: killer ? KIT_LABEL[killer.kitId as KitId] ?? killer.kitId : "", byHpFrac: killer ? (killer.hp100 ?? 0) / 10000 : null,
        seconds: respawnSecondsLeft(k.tick, now), frac: Math.min(1, Math.max(0, (k.tick + COMBAT.respawnTicks - now) / COMBAT.respawnTicks)),
      };
    };
    const drawHud = (): void => {
      syncGate();
      const me = localOf();
      const stateTick = (r.state as { serverTick?: number }).serverTick ?? 0;
      const now = Math.floor(clock.serverTick(performance.now()) ?? stateTick);
      roundResults.update((r.state as { phase?: string }).phase ?? "playing", now);
      const ml = meterLabel(me?.kitId ?? opts.kitId, me?.meter100 ?? 0);
      const dead = me?.action === "Dead" && ko !== null;
      const pending = me?.owner?.pendingKit ?? "";
      const st = {
        name: me?.displayName ?? lobby.displayName, hp: (me?.hp100 ?? 10000) / 100, maxHp: 100, meter: ml.fraction, meterText: ml.text,
        facingLock: router.facingLock, portrait: window.innerHeight > window.innerWidth,
        castText: castDescription(me?.moveId ?? "", me?.action ?? ""),
        skillRoles: skillRoles(me?.kitId ?? opts.kitId, me?.form ?? "Base"),
        skills: equippedSkillNames(me?.kitId ?? opts.kitId, me?.form ?? "Base"),
        blocked: blockNotice.active(performance.now()),
        cooldowns: [0, 1, 2, 3].map((i) => cooldownLabel(me?.cooldownEndTicks?.[i] ?? 0, now)),
        skillStates: skillDefinitions(me?.kitId ?? opts.kitId, me?.form ?? "Base").map((d, i) => skillAvailability(d, {
          usedMask: me?.awakenedUsedMask ?? 0, cooldownEndTick: me?.cooldownEndTicks?.[i] ?? 0, activeMove: me?.moveId ?? "", chargeStartTick: me?.owner?.chargeStartTick ?? 0,
        }, now)),
        skillKeys: skillDefinitions(me?.kitId ?? opts.kitId, me?.form ?? "Base").map((d) => d.id),
        dash: me ? dashStatus(me.action, me.actionStartTick ?? 0, me.owner?.evasiveEndTick ?? 0, now) : null,
        cooldownFracs: skillDefinitions(me?.kitId ?? opts.kitId, me?.form ?? "Base").map((d, i) => cooldownFraction(me?.cooldownEndTicks?.[i] ?? 0, now, d.cooldown)),
        reducedMotion: settings.get().reducedMotion,
        formText: me ? formTimerText(me.form, me.formEndTick, now, me.kitId) : "",
        stillpointText: stillpointText(me?.owner?.lethalCounterRemaining ?? 0),
        rejection: rejections.current(performance.now()),
        respawn: dead && ko ? koCard(ko as { tick: number; by: string; actorId: string | null }, now) : null,
        scoreboard: showBoard ? scoreboardRows([...players().values()].map((p) => ({ ...p, local: p.owner !== undefined }))) : null,
        menuOpen,
        kitMenu: kitMenu
          ? { kits: P0_KITS.map((k) => ({ id: k, label: KIT_LABEL[k] })), current: me?.kitId ?? opts.kitId, pending: pending ? (KIT_LABEL[pending as KitId] ?? pending) : "" }
          : null,
      };
      const key = JSON.stringify([st, lastLayout.s, window.innerWidth, window.innerHeight]);
      if (key === hudKey) return;
      hudKey = key;
      hud.setOpacity(settings.get().layouts[viewportClass(lastLayout.safe.W)].opacity);
      hud.render(lastLayout, st);
    };
    const hudTimer = window.setInterval(drawHud, 50);
    matchCleanups.push(() => window.clearInterval(hudTimer));
    drawHud();
    placeSparButton(lastLayout);

    // A resumed fighter is already ready on the server: never send Ready again.
    if (!resumed) r.send("ready", { kitId: kit, contentHash: rc.localContentHash });
    loop.start();

    if (opts.debug) {
      (window as unknown as { __eb: unknown }).__eb = {
        /** Test-only: sets the player-controlled camera yaw so both fighters can face each other. */
        setCameraYaw: (y: number) => { router.yaw = y; },
        /** Test-only: saturates the pooled particle buffer so telegraph retention can be checked. */
        floodFx: (n: number) => { for (let i = 0; i < n; i++) g.effects.spawn({ x: 0, y: 3, z: 0, vx: 0, vy: 0, vz: 0, life: 30, size: 0.1, color: 0xffffff, essential: true }); },
        snapshot: () => ({
          localEntityId: loop.localEntityId,
          serverTick: (r.state as { serverTick?: number }).serverTick ?? 0,
          projectiles: g.projectiles.snapshot(),
          urns: g.urns.snapshot(),
          reconciles: loop.reconcileCount,
          hitMoveIds: [...debugHitMoves],
          eventCounts: { ...debugEventCounts },
          preferences: { autoRun: router.autoRun, quickUse: router.quickUse, facingLock: router.facingLock },
          render: glRenderer ? { geometries: glRenderer.info.memory.geometries, calls: glRenderer.info.render.calls, triangles: glRenderer.info.render.triangles, tier: adaptive.level } : null,
          telegraphs: telegraphs?.snapshot() ?? null,
          fx: { active: g.effects.activeCount, capacity: g.effects.capacity, shed: g.effects.shedCount, flashing: [...players().keys()].filter((id) => g.viewFor(id)?.flashing), shaking: cam.shaking },
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
            form: p.form, awakenedUsedMask: p.awakenedUsedMask ?? 0, actionStartTick: p.actionStartTick ?? 0,
            chargeStartTick: p.owner?.chargeStartTick ?? 0, evasiveEndTick: p.owner?.evasiveEndTick ?? 0, formEndTick: p.formEndTick,
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
// GR03: pagehide suspends the session (seat and token kept). A BFCache restore (pageshow.persisted) rebuilds it
// through the ordinary boot, which tries the stored token once. Rebuilds are serialized so only one session lives.
let current: Promise<Session | null> | null = null;
let bootOpts: BootOptions | null = null;
if (app) { bootOpts = readBootOptions(); current = boot(app, bootOpts).catch(() => null); }
window.addEventListener("pageshow", (e: PageTransitionEvent) => {
  if (!e.persisted || !app || !bootOpts) return;
  const prev = current;
  const next = { ...bootOpts, invite: null, sparToken: null }; // an invitation or guest token is never reused
  current = (async () => { (await prev)?.dispose(); return boot(app, next).catch(() => null); })();
});
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
