/**
 * Spec section 7 iPad touch layout. All values are D (local design choices), not measured
 * original coordinates. Pure module: no DOM access, so it can be fixture-tested.
 */
export interface SafeRect { x0: number; y0: number; W: number; H: number }

export type ControlId =
  | "joystick" | "attack" | "jump" | "dash" | "block" | "facing"
  | "skill1" | "skill2" | "skill3" | "skill4"
  | "awaken" | "menu" | "fighter" | "health" | "scoreboard";

export interface ControlRect {
  id: ControlId;
  shape: "circle" | "rect";
  /** Centre in viewport CSS pixels (safe rect origin already added). */
  cx: number;
  cy: number;
  /** Visual size. */
  vw: number;
  vh: number;
  /** Hit target size, at least MIN_TARGET_PX in each dimension. Display-only controls have 0. */
  hw: number;
  hh: number;
  interactive: boolean;
}

export interface Layout {
  safe: SafeRect;
  s: number;
  /** True when the safe rect is too small for combat (W<700 or H<420). */
  tooSmall: boolean;
  controls: Record<ControlId, ControlRect>;
}

export const MIN_TARGET_PX = 48;
export const MIN_GAP_PX = 8;
export const COMPACT_WIDTH = 900;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function layoutScale(W: number, H: number): number {
  return clamp(Math.min(W / 1024, H / 768), 0.78, 1.25);
}

/** Interactive controls hit-tested in this order (buttons first, joystick last; camera is the fallback). */
export const HIT_ORDER: readonly ControlId[] = [
  "attack", "jump", "dash", "block", "facing", "skill1", "skill2", "skill3", "skill4",
  "awaken", "menu", "fighter", "scoreboard", "joystick",
];

export function computeLayout(safe: SafeRect): Layout {
  const { x0, y0, W, H } = safe;
  const s = layoutScale(W, H);
  const mk = (
    id: ControlId, shape: "circle" | "rect", cx: number, cy: number, vw: number, vh: number, interactive = true,
  ): ControlRect => ({
    id, shape, cx: x0 + cx, cy: y0 + cy, vw, vh,
    hw: interactive ? Math.max(vw, MIN_TARGET_PX) : 0,
    hh: interactive ? Math.max(vh, MIN_TARGET_PX) : 0,
    interactive,
  });
  const skillW = 82 * s;
  // Spec: default pitch 90s; for W<900 the gap shrinks to 6s. The gap is floored at MIN_GAP_PX
  // because 6s at s=0.78 is 4.7 px, which would violate the 8 px separation rule (documented conflict).
  const pitch = W < COMPACT_WIDTH ? skillW + Math.max(6 * s, MIN_GAP_PX) : 90 * s;
  const skill = (i: 1 | 2 | 3 | 4) =>
    mk(`skill${i}`, "rect", W / 2 + (i - 2.5) * pitch, H - 64 * s, skillW, 60 * s);
  const controls: Record<ControlId, ControlRect> = {
    joystick: mk("joystick", "circle", 104 * s, H - 112 * s, 136 * s, 136 * s),
    attack: mk("attack", "circle", W - 92 * s, H - 190 * s, 76 * s, 76 * s),
    jump: mk("jump", "circle", W - 76 * s, H - 80 * s, 68 * s, 68 * s),
    dash: mk("dash", "circle", W - 180 * s, H - 110 * s, 64 * s, 64 * s),
    block: mk("block", "circle", W - 182 * s, H - 205 * s, 64 * s, 64 * s),
    facing: mk("facing", "circle", W - 78 * s, H - 286 * s, 48 * s, 48 * s),
    skill1: skill(1), skill2: skill(2), skill3: skill(3), skill4: skill(4),
    awaken: mk("awaken", "rect", W / 2, H - 126 * s, 320 * s, 44 * s),
    menu: mk("menu", "rect", 32 * s, 32 * s, 48 * s, 48 * s),
    fighter: mk("fighter", "rect", 92 * s, 32 * s, 48 * s, 48 * s),
    health: mk("health", "rect", W / 2, 32 * s, 240 * s, 32 * s, false),
    scoreboard: mk("scoreboard", "rect", W - 36 * s, 32 * s, 48 * s, 48 * s),
  };
  // At small s the 48 px hit floor makes the section 7 centres collide (menu/fighter, skill strip
  // vs awakening bar). Keep formula centres, but push the later control just far enough to keep
  // the 8 px separation (documented spec conflict; resolution is a local D choice).
  const menuR = controls.menu.cx + controls.menu.hw / 2;
  controls.fighter.cx = Math.max(controls.fighter.cx, menuR + MIN_GAP_PX + controls.fighter.hw / 2);
  const skillTop = controls.skill1.cy - controls.skill1.hh / 2;
  controls.awaken.cy = Math.min(controls.awaken.cy, skillTop - MIN_GAP_PX - controls.awaken.hh / 2);
  return { safe, s, tooSmall: W < 700 || H < 420, controls };
}

function inside(c: ControlRect, x: number, y: number): boolean {
  if (!c.interactive) return false;
  if (c.shape === "circle") {
    const r = c.hw / 2;
    return (x - c.cx) ** 2 + (y - c.cy) ** 2 <= r * r;
  }
  return Math.abs(x - c.cx) <= c.hw / 2 && Math.abs(y - c.cy) <= c.hh / 2;
}

/** Returns the control owning a new pointer at (x,y), or null for the camera surface. */
export function hitTest(layout: Layout, x: number, y: number): ControlId | null {
  for (const id of HIT_ORDER) if (inside(layout.controls[id], x, y)) return id;
  return null;
}

/** Clearance between two hit targets (negative means overlap). Circle shapes use true distance. */
export function clearance(a: ControlRect, b: ControlRect): number {
  const aw = a.interactive ? a.hw : a.vw, ah = a.interactive ? a.hh : a.vh;
  const bw = b.interactive ? b.hw : b.vw, bh = b.interactive ? b.hh : b.vh;
  if (a.shape === "circle" && b.shape === "circle") {
    return Math.hypot(a.cx - b.cx, a.cy - b.cy) - aw / 2 - bw / 2;
  }
  if (a.shape === "rect" && b.shape === "rect") {
    const dx = Math.abs(a.cx - b.cx) - (aw + bw) / 2;
    const dy = Math.abs(a.cy - b.cy) - (ah + bh) / 2;
    return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
  }
  const [c, r] = a.shape === "circle" ? [a, { cx: b.cx, cy: b.cy, w: bw, h: bh, rad: aw / 2 }] : [b, { cx: a.cx, cy: a.cy, w: aw, h: ah, rad: bw / 2 }];
  const nx = clamp(c.cx, r.cx - r.w / 2, r.cx + r.w / 2);
  const ny = clamp(c.cy, r.cy - r.h / 2, r.cy + r.h / 2);
  const d = Math.hypot(c.cx - nx, c.cy - ny);
  const insideRect = nx === c.cx && ny === c.cy;
  return insideRect ? -r.rad : d - r.rad;
}

export interface LayoutIssue { kind: "outside" | "overlap" | "small"; ids: ControlId[]; detail: number }

/** Rectangle collision test of section 7: within safe rect, >=48 px targets, >=8 px separation. */
export function validateLayout(layout: Layout): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const { x0, y0, W, H } = layout.safe;
  const list = Object.values(layout.controls);
  for (const c of list) {
    const w = c.interactive ? c.hw : c.vw, h = c.interactive ? c.hh : c.vh;
    const m = Math.min(c.cx - w / 2 - x0, c.cy - h / 2 - y0, x0 + W - (c.cx + w / 2), y0 + H - (c.cy + h / 2));
    if (m < -1e-6) issues.push({ kind: "outside", ids: [c.id], detail: m });
    if (c.interactive && (c.hw < MIN_TARGET_PX || c.hh < MIN_TARGET_PX)) issues.push({ kind: "small", ids: [c.id], detail: Math.min(c.hw, c.hh) });
  }
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const g = clearance(a, b);
      if (g < MIN_GAP_PX - 1e-6) issues.push({ kind: "overlap", ids: [a.id, b.id], detail: g });
    }
  }
  return issues;
}

export interface PlainRect { left: number; top: number; width: number; height: number }

/** Gap between two axis-aligned rectangles (negative = overlap depth). */
export function rectGap(a: PlainRect, b: PlainRect): number {
  const dx = Math.max(b.left - (a.left + a.width), a.left - (b.left + b.width));
  const dy = Math.max(b.top - (a.top + a.height), a.top - (b.top + b.height));
  return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
}

/**
 * Measured rectangle for the host's sparring button during a match. Scans the top row, then the second row, from the right
 * edge leftwards for the first spot at least MIN_GAP_PX from every control's hit target (circles use their bounding square,
 * which is conservative). Returns null if nothing fits, and the caller hides the button rather than overlap a control.
 */
export function placeSparringRect(layout: Layout, width = 150, height = MIN_TARGET_PX): PlainRect | null {
  const { x0, y0, W, H } = layout.safe;
  const targets: PlainRect[] = Object.values(layout.controls).map((c) => {
    const w = c.interactive ? c.hw : c.vw, h = c.interactive ? c.hh : c.vh;
    return { left: c.cx - w / 2, top: c.cy - h / 2, width: w, height: h };
  });
  for (const top of [y0 + MIN_GAP_PX, y0 + MIN_GAP_PX + height + MIN_GAP_PX]) {
    for (let left = x0 + W - width - MIN_GAP_PX; left >= x0 + MIN_GAP_PX; left -= 4) {
      const r = { left, top, width, height };
      if (top + height > y0 + H) continue;
      if (targets.every((t) => rectGap(r, t) >= MIN_GAP_PX)) return r;
    }
  }
  return null;
}
