import { KIT_LABEL } from "./Lobby.js";
import type { KitId } from "@eb/shared/protocol";
import { skillDefinitions, skillReach, SKILL_INFO } from "./SkillInfo.js";

/** Local reference overlay. Reads definitions only; never casts a move or changes the fighter. */
export function mountMoveGuide(parent: HTMLElement, kit: KitId, initialForm: string, onClose: () => void): () => void {
  const doc = parent.ownerDocument, events = new AbortController(), previous = doc.activeElement as HTMLElement | null;
  const root = doc.createElement("section"); root.className = "eb-move-guide"; root.dataset["ui"] = "move-guide";
  root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Moves & ranges");
  const shell = doc.createElement("div"); shell.className = "eb-settings-shell"; root.append(shell);
  const header = doc.createElement("header"); header.className = "eb-settings-header";
  const title = doc.createElement("h2"); title.textContent = `${KIT_LABEL[kit]} · Move guide`;
  const close = doc.createElement("button"); close.textContent = "Back to game"; close.type = "button";
  close.addEventListener("click", onClose, { signal: events.signal }); header.append(title, close); shell.append(header);
  const note = doc.createElement("p"); note.textContent = "Learn the shape before you cast. Ground outlines warn of danger; leave the footprint to evade. The arena continues while this guide is open."; shell.append(note);
  const tabs = doc.createElement("div"); tabs.className = "eb-segment"; tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "Move form"); shell.append(tabs);
  const cards = doc.createElement("div"); cards.className = "eb-move-cards"; shell.append(cards);
  const render = (form: string): void => {
    for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset["form"] === form));
    cards.replaceChildren();
    for (const d of skillDefinitions(kit, form)) {
      const info = SKILL_INFO[d.id]!;
      const card = doc.createElement("article"); card.className = "eb-settings-card"; card.dataset["move"] = d.id;
      const number = doc.createElement("span"); number.className = "eb-move-number"; number.textContent = `${d.slot} ${info.icon}`;
      const h = doc.createElement("h3"); h.textContent = d.label;
      const role = doc.createElement("span"); role.className = "eb-eyebrow"; role.textContent = info.role;
      const description = doc.createElement("p"); description.textContent = info.description;
      const stats = doc.createElement("p"); stats.className = "eb-move-stats";
      stats.textContent = [d.input === "holdRelease" ? "Hold → release" : d.input === "recast" ? "Tap → tap again" : "Tap to cast", skillReach(d), d.block === "U" ? "Bypasses guard" : "Blockable", d.oncePerForm ? "Once per form" : `${d.cooldown / 60} s cooldown`, d.consumesForm ? "Ends Awakening" : ""].filter(Boolean).join(" · ");
      card.append(number, h, role, description, stats); cards.append(card);
    }
  };
  for (const form of ["Base", "Awakened"]) {
    const b = doc.createElement("button"); b.textContent = form; b.dataset["form"] = form;
    b.addEventListener("click", () => render(form), { signal: events.signal }); tabs.append(b);
  }
  root.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    if (e.key === "Tab") {
      const buttons = [...root.querySelectorAll("button")];
      if (e.shiftKey && doc.activeElement === buttons[0]) { e.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!e.shiftKey && doc.activeElement === buttons.at(-1)) { e.preventDefault(); buttons[0]?.focus(); }
    }
  }, { signal: events.signal });
  root.addEventListener("keyup", e => e.stopPropagation(), { signal: events.signal });
  render(initialForm === "Awakened" ? "Awakened" : "Base"); parent.append(root); close.focus();
  return () => { events.abort(); root.remove(); if (previous?.isConnected) previous.focus(); };
}
