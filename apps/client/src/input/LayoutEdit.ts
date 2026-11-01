/**
 * Custom touch layout (T27, spec section 7): normalized positions, 0.85 to 1.30 size, opacity, left hand mirror.
 * Pure module, no DOM. The default layout from computeLayout is the source of truth; edits are applied on top
 * and every result is checked with validateLayout. Unsafe edits are rejected; unsafe stored profiles fall back.
 */
import {
  COMPACT_WIDTH, MIN_TARGET_PX, validateLayout, type ControlId, type ControlRect, type Layout, type LayoutIssue,
} from "./ControlLayout.js";
import {
  EDITABLE_CONTROLS, RANGES, type ControlEdit, type Handedness, type LayoutProfile, type ViewportClass,
} from "../app/SettingsStore.js";

export type EditedLayout = Layout & { opacity: number };

/** Wide landscape from 900 CSS px of safe width, otherwise compact landscape. */
export const viewportClass = (W: number): ViewportClass => (W >= COMPACT_WIDTH ? "wide" : "compact");

/** Side clusters swap sides for left hand play; the centre strip, awakening bar and health bar stay put. */
const MIRRORED: ReadonlySet<ControlId> = new Set<ControlId>([
  "joystick", "attack", "jump", "dash", "block", "facing", "menu", "fighter", "scoreboard",
]);

function place(c: ControlRect, cx: number, cy: number, size: number, scale = 1): ControlRect {
  const vw = c.vw * scale * size, vh = c.vh * scale * size;
  return { ...c, cx, cy, vw, vh, hw: c.interactive ? Math.max(vw, MIN_TARGET_PX) : 0, hh: c.interactive ? Math.max(vh, MIN_TARGET_PX) : 0 };
}

/** Default layout, mirrored for left hand, with no per-control edits. */
function mirrored(base: Layout, hand: Handedness): Layout {
  if (hand === "right") return base;
  const { x0, W } = base.safe;
  const controls = { ...base.controls };
  for (const id of MIRRORED) {
    const c = base.controls[id];
    controls[id] = { ...c, cx: 2 * x0 + W - c.cx };
  }
  return { ...base, controls };
}

/** Applies a profile to the default layout. Does not validate; see resolveLayout. */
export function applyProfile(base: Layout, profile: LayoutProfile, hand: Handedness): EditedLayout {
  const m = mirrored(base, hand);
  const { x0, y0, W, H } = base.safe;
  const controls = { ...m.controls };
  for (const [id, e] of Object.entries(profile.controls) as [ControlId, ControlEdit][]) {
    controls[id] = place(m.controls[id], x0 + e.nx * W, y0 + e.ny * H, e.size);
  }
  return { ...m, controls, opacity: profile.opacity };
}

/**
 * The layout to use right now. A profile that is unsafe at this viewport (rotation, split view, import from another
 * device) falls back to the default arrangement, still honouring handedness and opacity. If the mirrored default is
 * itself unsafe the unmirrored default is used.
 */
export function resolveLayout(base: Layout, profile: LayoutProfile, hand: Handedness): { layout: EditedLayout; fellBack: boolean } {
  const edited = applyProfile(base, profile, hand);
  if (validateLayout(edited).length === 0) return { layout: edited, fellBack: false };
  const plain = applyProfile(base, { opacity: profile.opacity, controls: {} }, hand);
  if (validateLayout(plain).length === 0) return { layout: plain, fellBack: true };
  return { layout: { ...base, opacity: profile.opacity }, fellBack: true };
}

export type EditResult = { ok: true; profile: LayoutProfile } | { ok: false; issues: LayoutIssue[] };

/** Proposes one control edit. Never mutates `profile`. Rejects bad ranges, overlaps and unsafe positions. */
export function editControl(base: Layout, profile: LayoutProfile, hand: Handedness, id: ControlId, edit: ControlEdit): EditResult {
  const [smin, smax] = RANGES.size;
  const inRange = (v: number, lo: number, hi: number): boolean => Number.isFinite(v) && v >= lo && v <= hi;
  if (!EDITABLE_CONTROLS.includes(id) || !inRange(edit.size, smin, smax) || !inRange(edit.nx, 0, 1) || !inRange(edit.ny, 0, 1)) {
    return { ok: false, issues: [{ kind: "outside", ids: [id], detail: Number.NaN }] };
  }
  const next: LayoutProfile = { ...profile, controls: { ...profile.controls, [id]: { ...edit } } };
  const issues = validateLayout(applyProfile(base, next, hand));
  return issues.length === 0 ? { ok: true, profile: next } : { ok: false, issues };
}

export function resetControl(profile: LayoutProfile, id: ControlId): LayoutProfile {
  const controls = { ...profile.controls };
  delete controls[id];
  return { ...profile, controls };
}

/** Current normalized edit for a control, derived from the effective layout when it has no stored edit. */
export function currentEdit(base: Layout, profile: LayoutProfile, hand: Handedness, id: ControlId): ControlEdit {
  const stored = profile.controls[id];
  if (stored) return stored;
  const c = applyProfile(base, { opacity: profile.opacity, controls: {} }, hand).controls[id];
  const { x0, y0, W, H } = base.safe;
  return { nx: Math.min(1, Math.max(0, (c.cx - x0) / W)), ny: Math.min(1, Math.max(0, (c.cy - y0) / H)), size: 1 };
}
