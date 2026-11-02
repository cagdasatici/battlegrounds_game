import { EA_DEFS, SV_DEFS, TD_DEFS } from "@eb/shared/config/kits/index";
import type { AbilityDef } from "@eb/shared/abilities";

/** Original descriptions of this project's shipped mechanics, not claims about another game. */
export const SKILL_INFO: Readonly<Record<string, { role: string; icon: string; description: string }>> = {
  "sv.b1": { role: "Strike + wave", icon: "↟", description: "Drive a heavy strike into a nearby rival. A narrow ground wave continues 8 m ahead. Face your target before committing." },
  "sv.b2": { role: "Combo", icon: "≋", description: "Hold your ground for six close-range strikes. You can turn slowly and move a little during the barrage." },
  "sv.b3": { role: "Reflect", icon: "◇", description: "A short palm strike that breaks guard and reflects an incoming projectile. Use it at close range or time it against an orb." },
  "sv.b4": { role: "Launcher", icon: "↑", description: "Launch a close rival upward with a rising strike. Move into reach first; it does not create a distant pillar." },
  "sv.a1": { role: "Counter", icon: "◈", description: "Spend your Awakening to prepare a lethal reversal. It waits for an eligible incoming attack; pressing the button alone does not hit anyone." },
  "sv.a2": { role: "Wide wave", icon: "↟", description: "A long windup warns of a huge ground wave, 20 m wide and 24 m ahead. Move sideways out of its footprint. Ends Awakening." },
  "sv.a3": { role: "Beam", icon: "➜", description: "Release a broad 32 m blast ahead. Solid cover stops the beam. Strongest nearby; ends Awakening." },
  "sv.a4": { role: "Grab", icon: "◎", description: "Catch a nearby rival for a cinematic finishing sequence. A miss still spends the move and ends Awakening." },
  "td.b1": { role: "Grab combo", icon: "◎", description: "Catch a close rival and hold them through a series of strikes. Breaks guard; get inside the short capture range." },
  "td.b2": { role: "Drag + slam", icon: "↻", description: "Catch a close rival, carry them through a turning drag, then slam. The opening can be blocked." },
  "td.b3": { role: "Throw", icon: "➜", description: "Grab and throw a nearby rival. Aim toward cover to make use of wall context. This is a close grab, not a projectile." },
  "td.b4": { role: "Counter", icon: "◈", description: "Take a brief counter stance. An eligible incoming attack triggers the response; it does nothing if the opponent waits." },
  "td.a1": { role: "Grab combo", icon: "◎", description: "A rapid close capture sequence with protection after the catch. Breaks guard and can be used again after its cooldown." },
  "td.a2": { role: "Grab + area", icon: "↓", description: "Catch a nearby rival for a heavy aerial slam. The confirmed landing also hits nearby fighters. One use per Awakening." },
  "td.a3": { role: "Double strike", icon: "≋", description: "Two forward strikes with a gap between them. The ground footprint stays dangerous through both hits." },
  "td.a4": { role: "Pursuit", icon: "➜", description: "Catch a rival nearby or rush forward to find one. Cover can stop the approach. A successful chain can catch a second distinct rival." },
  "ea.b1": { role: "Combo", icon: "≋", description: "A close barrage of six heated strikes. Turn slowly to keep rivals in the forward footprint; the final hit launches." },
  "ea.b2": { role: "Rush + blast", icon: "➜", description: "Surge forward, then blast in front and behind. Press again after the rush begins to stop early. The burst follows where you actually stop." },
  "ea.b3": { role: "Charge orb", icon: "●", description: "Hold to charge, release to launch a travelling orb. It splashes on impact and can be reflected. A full charge breaks guard." },
  "ea.b4": { role: "Landing area", icon: "↓", description: "Rise, dive forward, then detonate in a 4 m radius on ground contact. The moving ground ring shows your current projected landing footprint." },
  "ea.a1": { role: "Rush + area", icon: "➜", description: "Advance into a cinematic capture. If the approach misses, a delayed local blast follows. Its location depends on the actual stop." },
  "ea.a2": { role: "Dash grab", icon: "◎", description: "A fast forward capture followed by a blast around the caught rival. Terrain stops the dash; splash appears at the confirmed catch." },
  "ea.a3": { role: "Beam", icon: "➜", description: "Brace and channel repeated pulses along a 24 m beam. Aim turns slowly. Solid cover clips the beam; sidestep out of its lane." },
  "ea.a4": { role: "Wide beam", icon: "➜", description: "A long warning followed by a broad 36 m sustained beam. Breaks guard and turns slowly. Leave the lane; one use per Awakening." },
};
const KITS: Readonly<Record<string, readonly AbilityDef[]>> = { sv: SV_DEFS, td: TD_DEFS, ea: EA_DEFS };
export function skillDefinitions(kit: string, form: string): AbilityDef[] {
  return [...(KITS[kit] ?? [])].filter(d => d.slot !== null && d.form === (form === "Awakened" ? "Awakened" : "Base")).sort((a,b) => a.slot! - b.slot!);
}
export function skillRoles(kit: string, form: string): string[] { return skillDefinitions(kit, form).map(d => SKILL_INFO[d.id]?.role ?? ""); }
export function castDescription(move: string, phase: string): string {
  const def = Object.values(KITS).flat().find(d => d.id === move);
  const label = phase === "Windup" ? "Preparing" : phase === "Active" ? "Active" : phase === "Recovery" ? "Recovering" : "";
  return def && label ? `${def.label} · ${label}` : "";
}

export function skillReach(d: AbilityDef): string {
  if (d.id === "sv.b1") return "3 m strike · 8 m wave";
  if (d.projectile) return `${d.projectile.maxRange} m travel · ${d.projectile.splashRadius} m splash`;
  if (d.shape.kind === "sphere") return `${d.shape.r} m area radius`;
  if (d.shape.kind === "beam") return `${d.shape.length} m lane · ${d.shape.radius * 2} m wide`;
  return `${d.range} m reach`;
}
