import { AudioBus, type AudioContextLike } from "../audio/AudioBus.js";
import {
  castKind, isMajorMove, loopKindFor, NEARBY_M, SUSTAIN_MIN_TICKS, PRIORITY_LOCAL_HIT, PRIORITY_MAJOR_NEARBY, PRIORITY_OTHER,
  type Priority, type SoundKind,
} from "../audio/synth.js";
import type { CombatBus } from "../app/CombatBus.js";
import type { CombatEvent } from "@eb/shared/protocol";
import type { PresentationDeps } from "./index.js";

interface Pos { x: number; z: number }

/** Entity positions are stored in centimetres on the replicated player record. */
function posOf(players: Map<string, unknown>, id: string | undefined): Pos | undefined {
  if (id === undefined) return undefined;
  const p = players.get(id) as { x?: number; z?: number } | undefined;
  if (!p || typeof p.x !== "number" || typeof p.z !== "number") return undefined;
  return { x: p.x / 100, z: p.z / 100 };
}

/** Pure mapping from a confirmed combat event to a sound, or null for none. */
export function soundFor(e: CombatEvent): SoundKind | null {
  switch (e.kind) {
    case "hit": return e.hitClass === "heavy" ? "hitHeavy" : "hitLight";
    case "block": return "block";
    case "counter": return "counter";
    case "heal": return "heal";
    case "ko": return "ko";
    case "cast": return castKind(e.moveId);
    default: return null;
  }
}

export function priorityFor(e: CombatEvent, localId: string | undefined, distM: number): Priority {
  if (localId !== undefined && e.targetId === localId && (e.kind === "hit" || e.kind === "block" || e.kind === "counter")) return PRIORITY_LOCAL_HIT;
  const major = e.kind === "cast" ? isMajorMove(e.moveId) : e.kind === "ko" || e.kind === "counter";
  return major && distM <= NEARBY_M ? PRIORITY_MAJOR_NEARBY : PRIORITY_OTHER;
}

interface SustainPlayer { action?: string; moveId?: string; x?: number; z?: number; actionStartTick?: number; actionEndTick?: number }

/**
 * QS01: pure scan. Starts a loop bed for each fighter in a long Active phase and stops the beds of fighters that left it
 * (active end, interruption, death, leave). The replicated tick bounds the phase; without a tick nothing sustains.
 */
export function scanSustainAudio(
  audio: Pick<AudioBus, "startLoop" | "stopLoop" | "hasLoop" | "setLoopDistance">,
  players: Map<string, unknown>, tick: number | undefined, localId: string | undefined, live: Set<string>,
): void {
  const me = posOf(players, localId);
  const seen = new Set<string>();
  for (const [id, v] of players) {
    const p = v as SustainPlayer;
    const kind = p.action === "Active" ? loopKindFor(p.moveId) : null;
    const start = p.actionStartTick ?? 0, end = p.actionEndTick ?? 0;
    if (kind === null || tick === undefined || tick >= end || end - start < SUSTAIN_MIN_TICKS) continue;
    const pos = posOf(players, id);
    const dist = me && pos ? Math.hypot(me.x - pos.x, me.z - pos.z) : 0;
    const key = `${id}:${start}`;
    seen.add(key);
    const major = dist <= NEARBY_M ? PRIORITY_MAJOR_NEARBY : PRIORITY_OTHER;
    if (audio.hasLoop(key)) audio.setLoopDistance(key, dist); else audio.startLoop(key, kind, id === localId ? PRIORITY_LOCAL_HIT : major, dist);
  }
  for (const key of [...live]) if (!seen.has(key)) { audio.stopLoop(key); live.delete(key); }
  for (const key of seen) live.add(key);
}

const GESTURES = ["pointerdown", "touchend", "keydown"] as const;

export const Sfx = {
  /** `makeCtx` is injectable for tests. Audio unlocks on the first user gesture (the Play press) and is silent before. */
  attach(bus: CombatBus, deps: PresentationDeps, makeCtx?: () => AudioContextLike): () => void {
    const factory = makeCtx ?? ((): AudioContextLike => {
      const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext;
      if (!Ctor) throw new Error("no AudioContext");
      return new Ctor();
    });
    const audio = new AudioBus(factory);
    const effects = (): number => {
      const s = deps.settings.get() as { effectsVolume?: number };
      return typeof s.effectsVolume === "number" ? s.effectsVolume : 0.8;
    };
    const target = typeof window !== "undefined" ? window : undefined;
    const unlock = (): void => {
      audio.unlock();
      if (audio.ensureRunning() && target) for (const g of GESTURES) target.removeEventListener(g, unlock);
    };
    if (target) for (const g of GESTURES) target.addEventListener(g, unlock);
    // The Play press happens before the match scene attaches; honour that earlier intentional interaction.
    if ((globalThis as { navigator?: { userActivation?: { hasBeenActive?: boolean } } }).navigator?.userActivation?.hasBeenActive) unlock();
    const heard = new Set<string>(); // defensive eventId dedupe on top of CombatBus
    const live = new Set<string>();
    const off = bus.on((e) => {
      if (heard.has(e.eventId)) return;
      heard.add(e.eventId);
      if (heard.size > 512) heard.delete(heard.values().next().value as string);
      const kind = soundFor(e);
      if (kind === null) return;
      audio.setEffectsVolume(effects());
      const players = deps.players();
      const localId = deps.localId();
      const me = posOf(players, localId);
      const src = (e.position ? { x: e.position.x, z: e.position.z } : undefined) ?? posOf(players, e.targetId ?? e.actorId);
      const dist = me && src ? Math.hypot(me.x - src.x, me.z - src.z) : 0;
      audio.play(kind, priorityFor(e, localId, dist), dist);
    });
    // Sustained beds follow replicated state once per frame; visibility and device interruption silence them.
    let raf = 0;
    const frame = (): void => {
      raf = requestAnimationFrame(frame);
      if (audio.isUnlocked && !audio.isSuspended) {
        audio.setEffectsVolume(effects());
        audio.setMusicVolume((deps.settings.get() as { musicVolume?: number }).musicVolume ?? 0);
        scanSustainAudio(audio, deps.players(), deps.serverTick?.(), deps.localId(), live);
      } else if (live.size > 0) { audio.stopAllLoops(); live.clear(); }
    };
    if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(frame);
    const doc = typeof document !== "undefined" ? document : undefined;
    const onVis = (): void => { if (doc?.hidden) { audio.suspend(); live.clear(); } else if (audio.isUnlocked) audio.resume(); };
    doc?.addEventListener("visibilitychange", onVis);
    target?.addEventListener("pagehide", onVis);
    // Debug probe for the browser spec only: read-only counts.
    (globalThis as { __ebAudio?: unknown }).__ebAudio = { audio };
    return () => {
      if (raf) cancelAnimationFrame(raf);
      doc?.removeEventListener("visibilitychange", onVis);
      target?.removeEventListener("pagehide", onVis);
      delete (globalThis as { __ebAudio?: unknown }).__ebAudio;
      off();
      if (target) for (const g of GESTURES) target.removeEventListener(g, unlock);
      audio.dispose();
    };
  },
};
