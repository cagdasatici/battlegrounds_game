import { Vector3, type Camera } from "three";
import type { CombatEvent } from "@eb/shared/protocol";
import type { CombatBus } from "../app/CombatBus.js";
import type { PresentationDeps } from "./index.js";
import { textSettingsOf, textsFor, type TextSpec } from "./CombatTextFormat.js";

const MAX_ACTIVE = 24;
const MAX_FEED = 4;
const HEAD_M = 2.0;
const RISE_M = 0.6;
const EDGE_ARC_MS = 500;

interface Item {
  el: HTMLElement;
  born: number;
  life: number;
  anchor: string | undefined;
  /** World position (metres) used when the anchor entity is unknown. */
  fallback: Vector3 | undefined;
  rise: boolean;
  /** Not positioned by projection (KO feed, bottom-centre cast, edge arc). */
  fixed: boolean;
  arc: boolean;
}

type P = { x: number; y: number; z: number; displayName?: string };

/**
 * Combat text overlay (FX2, decision 0025): pooled DOM elements, at most 24 active, positioned each frame by projecting
 * world to screen. Created only from bus events (confirmed server events); predicted casts never reach it. Presentation
 * only: timing uses wall clock and never feeds the simulation. The returned disposer removes every element and the
 * pending animation frame.
 */
export const CombatText = {
  attach(bus: CombatBus, deps: PresentationDeps): () => void {
    if (typeof document === "undefined") return () => {};
    const root = document.createElement("div");
    root.dataset["ui"] = "combat-text";
    root.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:20;font:700 18px system-ui;text-shadow:0 1px 3px #000c";
    const feed = document.createElement("div");
    feed.dataset["ui"] = "ko-feed";
    feed.style.cssText = "position:absolute;top:8px;right:8px;display:flex;flex-direction:column;align-items:flex-end;gap:4px";
    const selfCast = document.createElement("div");
    selfCast.style.cssText = "position:absolute;left:0;right:0;bottom:22%;display:flex;justify-content:center";
    root.append(feed, selfCast);
    document.body.append(root);

    const items: Item[] = [];
    const pool: HTMLElement[] = [];
    const v = new Vector3();
    let raf = 0;
    let disposed = false;

    const players = (): Map<string, P> => deps.players() as Map<string, P>;
    const worldOf = (it: Item): Vector3 | undefined => {
      const p = it.anchor !== undefined ? players().get(it.anchor) : undefined;
      if (p) return v.set(p.x / 100, p.y / 100 + HEAD_M, p.z / 100);
      return it.fallback ? v.copy(it.fallback).setY(it.fallback.y + HEAD_M) : undefined;
    };
    const project = (cam: Camera, w: Vector3): { x: number; y: number; behind: boolean } => {
      cam.updateMatrixWorld();
      w.project(cam);
      return { x: (w.x * 0.5 + 0.5) * window.innerWidth, y: (-w.y * 0.5 + 0.5) * window.innerHeight, behind: w.z > 1 };
    };

    const take = (): HTMLElement => {
      const el = pool.pop() ?? document.createElement("div");
      el.style.cssText = "";
      el.className = "";
      el.textContent = "";
      return el;
    };
    const release = (it: Item): void => { it.el.remove(); pool.push(it.el); };
    const evict = (): void => {
      while (items.length >= MAX_ACTIVE) { const old = items.shift(); if (old) release(old); }
    };

    const frame = (): void => {
      raf = 0;
      if (disposed) return;
      const now = performance.now();
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i]!;
        const t = (now - it.born) / it.life;
        if (t >= 1) { release(it); items.splice(i, 1); continue; }
        it.el.style.opacity = String(it.arc ? 0.4 * (1 - t) : 1 - t * t);
        if (it.fixed) continue;
        const w = worldOf(it);
        if (!w) { it.el.style.display = "none"; continue; }
        const s = project(deps.camera, w);
        if (s.behind) { it.el.style.display = "none"; continue; }
        const lift = it.rise ? t * RISE_M * (window.innerHeight / 6) : 0;
        it.el.style.display = "";
        it.el.style.transform = `translate(${s.x}px,${s.y - lift}px) translate(-50%,-100%)`;
      }
      if (items.length > 0) raf = requestAnimationFrame(frame);
    };
    const kick = (): void => { if (raf === 0 && !disposed) raf = requestAnimationFrame(frame); };

    const spawn = (spec: TextSpec, e: CombatEvent): void => {
      const isFeed = spec.kind === "ko";
      const isSelf = spec.kind === "castSelf";
      if (isFeed) {
        while (items.filter((i) => i.el.dataset["ct"] === "ko").length >= MAX_FEED) {
          const idx = items.findIndex((i) => i.el.dataset["ct"] === "ko");
          release(items.splice(idx, 1)[0]!);
        }
      }
      if (isSelf) {
        for (let i = items.length - 1; i >= 0; i--) if (items[i]!.el.dataset["ct"] === "castSelf") release(items.splice(i, 1)[0]!);
      }
      evict();
      const el = take();
      el.dataset["ct"] = spec.kind;
      el.textContent = spec.text;
      let css = `font-size:${Math.round(18 * spec.scale)}px;font-weight:${spec.bold ? 800 : 600};color:${spec.pill && spec.kind !== "ko" ? "#fff" : spec.color};white-space:nowrap;`;
      if (spec.pill) css += `padding:3px 10px;border-radius:999px;background:${spec.kind === "ko" ? "#000000b3" : spec.color};`;
      if (!isFeed && !isSelf) css += "position:absolute;left:0;top:0;display:none;";
      el.style.cssText = css;
      if (isFeed) feed.append(el);
      else if (isSelf) selfCast.append(el);
      else root.append(el);
      const pos = e.position;
      items.push({
        el, born: performance.now(), life: spec.lifeMs, anchor: spec.anchorId, rise: spec.rise, fixed: isFeed || isSelf, arc: false,
        fallback: pos ? new Vector3(pos.x, pos.y, pos.z) : undefined,
      });
      kick();
    };

    /** Red edge arc toward an attacker that is off screen or behind the camera. */
    const edgeArc = (e: CombatEvent): void => {
      const local = deps.localId();
      if (local === undefined || e.targetId !== local || e.actorId === local) return;
      const a = players().get(e.actorId);
      if (!a) return;
      const s = project(deps.camera, v.set(a.x / 100, a.y / 100 + 1, a.z / 100));
      const W = window.innerWidth, H = window.innerHeight;
      if (!s.behind && s.x >= 0 && s.x <= W && s.y >= 0 && s.y <= H) return;
      let dx = s.x - W / 2, dy = s.y - H / 2;
      if (s.behind) { dx = -dx; dy = -dy; }
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      const k = Math.min((W / 2) / Math.max(Math.abs(dx), 1e-6), (H / 2) / Math.max(Math.abs(dy), 1e-6));
      evict();
      const el = take();
      el.dataset["ct"] = "edge";
      el.style.cssText = `position:absolute;left:${W / 2 + dx * k - 90}px;top:${H / 2 + dy * k - 90}px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,#ff4d4d 0%,#ff4d4d00 70%)`;
      root.append(el);
      items.push({ el, born: performance.now(), life: EDGE_ARC_MS, anchor: undefined, fallback: undefined, rise: false, fixed: true, arc: true });
      kick();
    };

    const off = bus.on((e) => {
      const s = textSettingsOf(deps.settings.get());
      const nameOf = (id: string): string => players().get(id)?.displayName ?? "a rival";
      for (const spec of textsFor(e, s, deps.localId(), nameOf)) spawn(spec, e);
      if (e.kind === "hit" && s.combatText !== "off") edgeArc(e);
    });

    return () => {
      disposed = true;
      off();
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      items.length = 0;
      pool.length = 0;
      root.remove();
    };
  },
};
