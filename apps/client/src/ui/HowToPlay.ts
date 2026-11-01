import { baseMoveLabels, KIT_LABEL, lobbyKits } from "./Lobby.js";

/** Standalone instructions. No authentication, room connection or tutorial state. */
export function mountHowToPlay(root: HTMLElement, options: {
  sparringAvailable: boolean; onClose: () => void; onPractice: () => void;
}): () => void {
  const doc = root.ownerDocument;
  const view = doc.createElement("section");
  view.setAttribute("aria-label", "How to play");
  view.dataset["ui"] = "how-to-play";
  view.style.cssText = "position:fixed;inset:0;overflow:auto;box-sizing:border-box;background:#0b1118;color:#fff;font:17px/1.5 system-ui;padding:24px max(24px,env(safe-area-inset-left));";
  const style = doc.createElement("style");
  style.textContent = '[data-ui="how-to-play"] .guide-body{max-width:900px;margin:auto}[data-ui="how-to-play"] button{min-height:48px;padding:8px 20px;margin:4px;font:600 17px system-ui;color:#fff;background:#1d2b3a;border:2px solid #9fd3ff;border-radius:12px}[data-ui="how-to-play"] button[aria-pressed="true"]{border-color:#ffd479}[data-ui="how-to-play"] button:focus-visible{outline:3px solid #ffd479;outline-offset:3px}[data-ui="how-to-play"] li{margin:8px 0}';
  view.append(style);
  const body = doc.createElement("div");
  body.className = "guide-body";
  view.append(body);
  const add = (tag: string, text: string, parent: HTMLElement = body): HTMLElement => {
    const el = doc.createElement(tag); el.textContent = text; parent.append(el); return el;
  };
  add("h1", "How to play");
  add("p", "Knock out fighters to score. You return after a knockout.");
  add("h2", "Start playing");
  add("p", "Open your invitation link, choose your name and press Play. Choose a fighter, then press Ready.");
  const kits = add("ul", "");
  for (const kit of lobbyKits()) add("li", `${KIT_LABEL[kit]}: ${baseMoveLabels(kit).join(", ")}.`, kits);
  const modes = add("div", "");
  modes.setAttribute("role", "group"); modes.setAttribute("aria-label", "Input mode");
  const instructions = doc.createElement("div");
  instructions.id = "how-to-play-controls";
  const touch = [
    "Push the stick to move.", "Drag open space to look around.",
    "Hold Strike to string attacks together.", "Hold Guard to block.",
    "Tap Dash to dash in your movement direction.", "Tap Jump to jump.",
    "Use skills 1–4 for your fighter’s moves.", "Tap Awaken when the meter is ready.",
    "Tap Facing lock to toggle facing lock.", "Tap Menu to open the menu.",
  ];
  const keyboard = [
    "WASD: move.", "Left mouse: hold to Strike.", "F: hold Guard to block.",
    "Q: Dash in your movement direction.", "Space: Jump.", "1–4: use skills.",
    "G: Awaken when the meter is ready.", "Shift: toggle facing lock.", "Esc: open the menu.",
  ];
  const buttons: HTMLButtonElement[] = [];
  const select = (mode: string): void => {
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.textContent === mode));
    instructions.replaceChildren();
    add("h2", `${mode} controls`, instructions);
    const list = add("ul", "", instructions);
    for (const line of mode === "Touch" ? touch : keyboard) add("li", line, list);
  };
  for (const mode of ["Touch", "Keyboard"]) {
    const b = add("button", mode, modes) as HTMLButtonElement;
    b.type = "button"; b.dataset["mode"] = mode;
    b.setAttribute("aria-controls", instructions.id); buttons.push(b);
  }
  body.append(instructions); select("Touch");
  add("h2", "Learn at your pace");
  add("p", "Practice uses a stationary dummy. Try Guard or Ragdoll while you learn.");
  if (options.sparringAvailable) add("p", "Host sparring to fight bots. Choose Easy, Medium or Hard for each bot before Start. Copy a guest link if a human seat is free.");
  for (const [action, label] of [["practice", "Try practice"], ["back", "Back"]]) {
    const b = add("button", label!) as HTMLButtonElement;
    b.type = "button"; b.dataset["action"] = action;
  }
  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const b = target.closest("button");
    if (!b || !view.contains(b)) return;
    const mode = b.dataset["mode"];
    if (mode) select(mode);
    else if (b.dataset["action"] === "practice") options.onPractice();
    else if (b.dataset["action"] === "back") options.onClose();
  };
  view.addEventListener("click", onClick);
  root.append(view); buttons[0]!.focus();
  return () => { view.removeEventListener("click", onClick); view.remove(); };
}
