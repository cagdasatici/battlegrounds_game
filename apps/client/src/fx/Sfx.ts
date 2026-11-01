import { AudioBus, type AudioContextLike } from "../audio/AudioBus.js";
import {
  castKind, isMajorMove, NEARBY_M, PRIORITY_LOCAL_HIT, PRIORITY_MAJOR_NEARBY, PRIORITY_OTHER,
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
    const target = typeof window !== "undefined" ? window : undefined;
    const unlock = (): void => {
      audio.unlock();
      if (audio.isUnlocked && target) for (const g of GESTURES) target.removeEventListener(g, unlock);
    };
    if (target) for (const g of GESTURES) target.addEventListener(g, unlock);
    const off = bus.on((e) => {
      const kind = soundFor(e);
      if (kind === null) return;
      const s = deps.settings.get() as { effectsVolume?: number };
      audio.setEffectsVolume(typeof s.effectsVolume === "number" ? s.effectsVolume : 0.8);
      const players = deps.players();
      const localId = deps.localId();
      const me = posOf(players, localId);
      const src = (e.position ? { x: e.position.x, z: e.position.z } : undefined) ?? posOf(players, e.targetId ?? e.actorId);
      const dist = me && src ? Math.hypot(me.x - src.x, me.z - src.z) : 0;
      audio.play(kind, priorityFor(e, localId, dist), dist);
    });
    return () => {
      off();
      if (target) for (const g of GESTURES) target.removeEventListener(g, unlock);
      audio.dispose();
    };
  },
};
