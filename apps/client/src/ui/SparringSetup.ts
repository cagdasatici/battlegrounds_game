import { P0_KITS, type KitId } from "@eb/shared/protocol";
import { KIT_LABEL } from "./Lobby.js";
import { adoptCss } from "./adoptCss.js";
import { DEFAULT_MAP_ID, MAP_REGISTRY } from "@eb/shared/config/maps";
import type { Difficulty, SparringSetupActions } from "@eb/shared/sparring";

/** Standalone host controls. Callbacks own authentication, capacity and transport. */
export function mountSparringSetup(root: HTMLElement, actions: SparringSetupActions): () => void {
  const doc = root.ownerDocument;
  const panel = doc.createElement("section");
  panel.dataset["ui"] = "sparring-setup";
  panel.style.cssText = "box-sizing:border-box;width:min(100%,560px);margin:auto;padding:20px;background:#0b1118;color:#fff;font:16px system-ui;border-radius:16px";
  const removeCss = adoptCss(doc, '[data-ui="sparring-setup"] [hidden]{display:none!important}[data-ui="sparring-setup"] button,[data-ui="sparring-setup"] select,[data-ui="sparring-setup"] input{box-sizing:border-box;min-height:48px;max-width:100%;font:inherit;padding:8px;border-radius:8px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff}[data-ui="sparring-setup"] button:disabled,[data-ui="sparring-setup"] select:disabled{opacity:.55}[data-ui="sparring-setup"] label{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}');
  const title = doc.createElement("h1"); title.textContent = "Host sparring"; panel.append(title);
  const hint = doc.createElement("p");
  hint.textContent = "Choose up to three opponents. Start with no bots to play with friends. To change opponents, end the match first.";
  panel.append(hint);
  const controls = doc.createElement("fieldset");
  controls.style.cssText = "border:0;padding:0;margin:0;min-width:0";
  const legend = doc.createElement("legend"); legend.textContent = "Match setup"; controls.append(legend);
  const fighterLabel = doc.createElement("label"); fighterLabel.append("Your fighter");
  const fighter = doc.createElement("select");
  for (const value of P0_KITS) {
    const text = KIT_LABEL[value];
    const option = doc.createElement("option"); option.value = value!; option.textContent = text!; fighter.append(option);
  }
  fighterLabel.append(fighter); controls.append(fighterLabel);
  const listedLabel = doc.createElement("label");
  const listedBox = doc.createElement("input"); listedBox.type = "checkbox"; listedBox.style.minHeight = "24px";
  listedLabel.append(listedBox, "List this match for other players");
  controls.append(listedLabel);
  const teamLabel = doc.createElement("label");
  const teamBox = doc.createElement("input"); teamBox.type = "checkbox"; teamBox.style.minHeight = "24px"; teamBox.dataset["teamPlay"] = "1";
  teamLabel.append(teamBox, "Team play: up to 3 players vs bots (2 easy bots, growing to 5)");
  controls.append(teamLabel);
  const roundLabel = doc.createElement("label"); roundLabel.append("Round length");
  const roundSelect = doc.createElement("select"); roundSelect.dataset["roundTarget"] = "1";
  for (const [value, text] of [["0", "Endless"], ["5", "First to 5 KOs"], ["10", "First to 10 KOs"]] as const) {
    const option = doc.createElement("option"); option.value = value; option.textContent = text; roundSelect.append(option);
  }
  roundLabel.append(roundSelect); controls.append(roundLabel);
  // WORLD01: map picker, one option per registry entry. The host's choice travels in the create request (validated server side).
  const mapLabel = doc.createElement("label"); mapLabel.append("Map");
  const mapSelect = doc.createElement("select"); mapSelect.dataset["mapId"] = "1";
  for (const def of Object.values(MAP_REGISTRY)) {
    const option = doc.createElement("option"); option.value = def.id; option.textContent = def.name; mapSelect.append(option);
  }
  mapSelect.value = DEFAULT_MAP_ID;
  mapLabel.append(mapSelect); controls.append(mapLabel);
  const rows = doc.createElement("div"); controls.append(rows);
  const button = (text: string, parent: HTMLElement): HTMLButtonElement => {
    const b = doc.createElement("button"); b.type = "button"; b.textContent = text; parent.append(b); return b;
  };
  const add = button("Add opponent", controls);
  const start = button("Start match", controls);
  start.className = "eb-primary";
  panel.append(controls);
  const running = doc.createElement("div"); running.hidden = true;
  const copy = button("Copy guest link", running);
  const end = button("End match", running);
  panel.append(running);
  const fallbackLabel = doc.createElement("label"); fallbackLabel.textContent = "Guest link"; fallbackLabel.hidden = true;
  const fallback = doc.createElement("input"); fallback.type = "text"; fallback.readOnly = true; fallback.style.width = "100%";
  fallbackLabel.append(fallback); panel.append(fallbackLabel);
  const status = doc.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); panel.append(status);
  let bots: Difficulty[] = ["medium"];
  let active = false;
  let pending = false;
  let disposed = false;
  const events = new AbortController();
  const listen = (el: HTMLElement, type: string, fn: () => void): void => { el.addEventListener(type, fn, { signal: events.signal }); };
  const refresh = (): void => {
    controls.disabled = pending || active;
    add.disabled = bots.length >= 3;
    copy.disabled = pending || bots.length === 3;
    end.disabled = pending;
    running.hidden = !active;
    panel.setAttribute("aria-busy", String(pending));
  };
  const renderRows = (): void => {
    rows.replaceChildren();
    bots.forEach((difficulty, index) => {
      const row = doc.createElement("div");
      const label = doc.createElement("label"); label.append(`Bot ${index + 1} difficulty`);
      const select = doc.createElement("select");
      for (const value of ["easy", "medium", "hard"] as const) {
        const option = doc.createElement("option"); option.value = value; option.textContent = value[0]!.toUpperCase() + value.slice(1); select.append(option);
      }
      select.value = difficulty;
      // Removed rows carry no listeners: changes/clicks are delegated below.
      select.dataset["bot"] = String(index);
      label.append(select); row.append(label);
      const remove = button(`Remove Bot ${index + 1}`, row); remove.dataset["remove"] = String(index);
      rows.append(row);
    });
    refresh();
  };
  const change = (event: Event): void => {
    if (pending || active || disposed) return;
    const target = event.target as HTMLSelectElement;
    const index = target.dataset["bot"];
    if (index !== undefined && ["easy", "medium", "hard"].includes(target.value)) bots[Number(index)] = target.value as Difficulty;
  };
  const remove = (event: Event): void => {
    if (pending || active || disposed) return;
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-remove]");
    if (!target) return;
    bots.splice(Number(target.dataset["remove"]), 1); renderRows();
  };
  rows.addEventListener("change", change, { signal: events.signal });
  rows.addEventListener("click", remove, { signal: events.signal });
  const run = async (kind: "start" | "copy" | "end"): Promise<void> => {
    if (pending || disposed) return;
    pending = true; status.textContent = "Working…"; fallback.value = ""; fallbackLabel.hidden = true; refresh();
    try {
      if (kind === "start") {
        await actions.start({ bots: [...bots], ...(teamBox.checked ? { teamPlay: true } : {}), ...(mapSelect.value !== DEFAULT_MAP_ID && Object.hasOwn(MAP_REGISTRY, mapSelect.value) ? { mapId: mapSelect.value } : {}), ...(roundSelect.value === "5" ? { roundTarget: 5 as const } : roundSelect.value === "10" ? { roundTarget: 10 as const } : {}) }, P0_KITS.includes(fighter.value as KitId) ? fighter.value as KitId : "sv", listedBox.checked);
        if (disposed) return;
        active = true; status.textContent = "Match started. Invite friends if a space remains.";
      } else if (kind === "end") {
        await actions.end();
        if (disposed) return;
        active = false; status.textContent = "Match ended. You can set up another match.";
      } else {
        const url = await actions.copyLink();
        if (disposed) return;
        try {
          const clipboard = doc.defaultView?.navigator.clipboard;
          if (!clipboard) throw new Error("Clipboard unavailable");
          await clipboard.writeText(url);
          if (disposed) return;
          status.textContent = "Guest link copied.";
        } catch {
          if (disposed) return;
          fallback.value = url; fallbackLabel.hidden = false; fallback.focus(); fallback.select();
          status.textContent = "Copy the selected guest link to invite a friend.";
        }
      }
    } catch {
      if (!disposed) status.textContent = kind === "start" ? "Could not start the match. Try again." : kind === "end" ? "Could not end the match. Try again." : "Could not create a guest link. Try again.";
    } finally {
      if (!disposed) { pending = false; refresh(); }
    }
  };
  listen(add, "click", () => { if (!pending && !active && !disposed && bots.length < 3) { bots.push("medium"); renderRows(); } });
  listen(start, "click", () => { if (!active) void run("start"); });
  listen(copy, "click", () => { if (active && bots.length < 3) void run("copy"); });
  listen(end, "click", () => { if (active) void run("end"); });
  renderRows(); root.append(panel);
  return () => {
    if (disposed) return;
    disposed = true; events.abort(); fallback.value = ""; removeCss(); panel.remove();
  };
}
