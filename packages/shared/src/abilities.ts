import { z } from "zod";

/**
 * Ability data schema, defaults and registry validator (spec section 14). Pure and framework free.
 * Server configuration validation is strict: unknown properties fail. Every numeric value in a
 * definition is D (local design value) unless an evidence ID says otherwise; evidence lives in the
 * research ledger, never in these shipped labels.
 */
export const KIT_PREFIXES = ["sv", "td", "ea"] as const;
export type KitPrefix = (typeof KIT_PREFIXES)[number];
export type AbilityForm = "Base" | "Awakened";

const int = z.number().int().finite();
const nonNegInt = int.min(0);
const nonNeg = z.number().finite().min(0);

export const ShapeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("box"), w: nonNeg, h: nonNeg, d: nonNeg }),
  z.strictObject({ kind: z.literal("sphere"), r: nonNeg }),
  z.strictObject({ kind: z.literal("beam"), length: nonNeg, radius: nonNeg }),
]);
export type Shape = z.infer<typeof ShapeSchema>;

export const TARGET_STATES = ["standing", "air", "ragdoll"] as const;
export type TargetState = (typeof TARGET_STATES)[number];

const MOVE_ID_RE = /^(sv|td|ea)\.[a-z][a-z0-9]*$/;
const SLOT_ID_RE = /^(sv|td|ea)\.([ba])([1-4])$/;

export const AbilityDefSchema = z.strictObject({
  id: z.string().regex(MOVE_ID_RE),
  slot: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.null()]),
  form: z.enum(["Base", "Awakened"]),
  label: z.string().min(1).max(40),
  handler: z.string().min(1),
  startup: nonNegInt,
  active: nonNegInt,
  recovery: nonNegInt,
  cooldown: nonNegInt,
  hitOffsets: z.array(nonNegInt).min(1),
  damage100: z.array(nonNegInt).min(1),
  shape: ShapeSchema,
  range: nonNeg,
  block: z.enum(["B", "U"]),
  counterable: z.boolean(),
  armorBreak: z.boolean(),
  targetStates: z.array(z.enum(TARGET_STATES)).min(1),
  stunTicks: nonNegInt,
  ragdollTicks: nonNegInt,
  launch: z.strictObject({ forward: z.number().finite(), up: z.number().finite() }),
  armor: z.enum(["none", "startup", "onHit"]),
  input: z.enum(["press", "holdRelease", "recast", "context"]),
  moveScale: nonNeg,
  turnRate: nonNeg,
  oncePerForm: z.boolean(),
  consumesForm: z.boolean(),
  maxTargets: int.min(1),
  maxHitsPerTarget: int.min(1),
  animationId: z.string().min(1),
  vfxId: z.string().min(1),
  sfxId: z.string().min(1),
});
export type AbilityDef = z.infer<typeof AbilityDefSchema>;

/** Fields a definition author must state; everything else takes the section 14 default. */
export type AbilitySpec = Pick<AbilityDef, "id" | "label" | "handler" | "startup" | "active" | "recovery" | "cooldown"
  | "damage100" | "range" | "block"> & Partial<Omit<AbilityDef, "id" | "label" | "handler" | "startup" | "active"
  | "recovery" | "cooldown" | "damage100" | "range" | "block">>;

/** Slot and form follow the ID suffix: sv.b1 is Base slot 1, sv.a3 is Awakened slot 3, others are null. */
export function slotAndFormOf(id: string): { slot: 1 | 2 | 3 | 4 | null; form: AbilityForm } {
  const m = SLOT_ID_RE.exec(id);
  if (!m) return { slot: null, form: "Base" };
  return { slot: Number(m[3]) as 1 | 2 | 3 | 4, form: m[2] === "a" ? "Awakened" : "Base" };
}

/**
 * Applies the section 14 defaults. Default shape: box 2 m wide, 2 m high, depth = range. One hit at
 * offset 0, full listed damage. maxHitsPerTarget equals the hitOffsets length. Effect IDs are the move
 * ID plus .anim, .vfx or .sfx. Throws (strict runtime validation) on any invalid definition.
 */
export function defineAbility(spec: AbilitySpec): AbilityDef {
  const sf = slotAndFormOf(spec.id);
  const hitOffsets = spec.hitOffsets ?? [0];
  const def: AbilityDef = {
    slot: sf.slot, form: sf.form,
    hitOffsets,
    shape: { kind: "box", w: 2, h: 2, d: spec.range },
    targetStates: ["standing", "air"],
    stunTicks: 24, ragdollTicks: 0, launch: { forward: 0, up: 0 },
    armor: "none", input: "press", moveScale: 0, turnRate: 0,
    oncePerForm: false, consumesForm: false, counterable: true, armorBreak: false,
    maxTargets: 1, maxHitsPerTarget: hitOffsets.length,
    animationId: `${spec.id}.anim`, vfxId: `${spec.id}.vfx`, sfxId: `${spec.id}.sfx`,
    ...spec,
  };
  return validateAbility(def);
}

export function validateAbility(def: unknown): AbilityDef {
  const d = AbilityDefSchema.parse(def);
  const sf = slotAndFormOf(d.id);
  const fail = (m: string): never => { throw new Error(`ability ${d.id}: ${m}`); };
  if (SLOT_ID_RE.test(d.id) && (d.slot !== sf.slot || d.form !== sf.form)) fail("slot/form must follow the ID suffix");
  if (!SLOT_ID_RE.test(d.id) && d.slot !== null) fail("non-slotted moves must have slot null");
  if (d.hitOffsets.length !== d.damage100.length) fail("hitOffsets and damage100 must have equal length");
  for (let i = 1; i < d.hitOffsets.length; i++) {
    if (d.hitOffsets[i]! <= d.hitOffsets[i - 1]!) fail("hitOffsets must be strictly ascending");
  }
  if (d.maxHitsPerTarget < 1) fail("maxHitsPerTarget must be >= 1");
  if (d.consumesForm && d.form !== "Awakened") fail("consumesForm is only valid on Awakened moves");
  if (d.oncePerForm && d.form !== "Awakened") fail("oncePerForm is only valid on Awakened moves");
  if (d.stunTicks > 0 && d.ragdollTicks > 0 && d.ragdollTicks < d.stunTicks) fail("ragdollTicks must not be below stunTicks");
  return d;
}

export interface AbilityRegistry {
  readonly defs: readonly AbilityDef[];
  byId(id: string): AbilityDef | undefined;
  /** Slotted move for a kit prefix, form and slot, or undefined. */
  slotted(kit: string, form: AbilityForm, slot: 1 | 2 | 3 | 4): AbilityDef | undefined;
  forKit(kit: string): AbilityDef[];
}

/**
 * Registry validator: unique IDs, a known handler for every definition, at most one slotted move per
 * kit/form/slot, kit prefix is one of the three fighters. `handlerNames` is the set of implemented handlers.
 */
export function buildAbilityRegistry(defs: readonly unknown[], handlerNames: ReadonlySet<string>): AbilityRegistry {
  const out: AbilityDef[] = [];
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (const raw of defs) {
    const d = validateAbility(raw);
    if (ids.has(d.id)) throw new Error(`duplicate ability id ${d.id}`);
    ids.add(d.id);
    if (!handlerNames.has(d.handler)) throw new Error(`ability ${d.id}: unknown handler ${d.handler}`);
    if (d.slot !== null) {
      const key = `${d.id.slice(0, 2)}:${d.form}:${d.slot}`;
      if (slots.has(key)) throw new Error(`ability ${d.id}: slot ${key} already taken`);
      slots.add(key);
    }
    out.push(d);
  }
  const byId = new Map(out.map((d) => [d.id, d]));
  return {
    defs: out,
    byId: (id) => byId.get(id),
    slotted: (kit, form, slot) => out.find((d) => d.id.startsWith(`${kit}.`) && d.form === form && d.slot === slot),
    forKit: (kit) => out.filter((d) => d.id.startsWith(`${kit}.`)),
  };
}
