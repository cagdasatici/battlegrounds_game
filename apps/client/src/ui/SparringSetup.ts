import { P0_KITS, type KitId } from "@eb/shared/protocol";
import { KIT_CHOICE, KIT_LABEL, baseMoveLabels } from "./Lobby.js";
import type { FighterPreview } from "./FighterPreview.js";
import { adoptCss } from "./adoptCss.js";
import { DEFAULT_MAP_ID, MAP_REGISTRY } from "@eb/shared/config/maps";
import { TEAM_PLAY } from "@eb/shared/config/teamPlay";
import type { Difficulty, SparringSetupActions } from "@eb/shared/sparring";

const MAP_TAGLINES: Readonly<Record<string, string>> = {
  grove: "Bridges and floating islands",
  coast: "Open beach and rolling surf",
  frost: "Snowfield ringed by pines",
};

/** Standalone host controls. Callbacks own authentication, capacity and transport. */
export function mountSparringSetup(root: HTMLElement, actions: SparringSetupActions, preview?: FighterPreview, alreadyRunning = false): () => void {
  const doc = root.ownerDocument;
  const panel = doc.createElement("section");
  panel.dataset["ui"] = "sparring-setup";
  panel.style.cssText = "box-sizing:border-box;width:min(100%,560px);margin:auto;padding:20px;background:#0b1118;color:#fff;font:16px system-ui;border-radius:16px";
  const removeCss = adoptCss(doc, '[data-ui="sparring-setup"] [hidden]{display:none!important}[data-ui="sparring-setup"] button,[data-ui="sparring-setup"] select,[data-ui="sparring-setup"] input{box-sizing:border-box;min-height:48px;max-width:100%;font:inherit;padding:8px;border-radius:8px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff}[data-ui="sparring-setup"] button:disabled,[data-ui="sparring-setup"] select:disabled{opacity:.55}[data-ui="sparring-setup"] label{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:12px 0}');
  const eyebrow = doc.createElement("span"); eyebrow.className = "eb-eyebrow"; eyebrow.textContent = "Private arena"; panel.append(eyebrow);
  const title = doc.createElement("h1"); title.textContent = "Host sparring"; panel.append(title);
  const hint = doc.createElement("p");
  hint.textContent = "Pick your fighter and arena. Start with bots or leave their slots open for friends.";
  hint.className = "eb-sparring-intro";
  panel.append(hint);
  const controls = doc.createElement("fieldset");
  controls.style.cssText = "border:0;padding:0;margin:0;min-width:0";
  const columns = doc.createElement("div"); columns.className = "eb-sparring-columns"; controls.append(columns);
  const fighterPane = doc.createElement("section"); fighterPane.className = "eb-sparring-fighter"; columns.append(fighterPane);
  const heading = (text: string, parent: HTMLElement): void => {
    const h = doc.createElement("h2"); h.textContent = text; parent.append(h);
  };
  const button = (text: string, parent: HTMLElement): HTMLButtonElement => {
    const b = doc.createElement("button"); b.type = "button"; b.textContent = text; parent.append(b); return b;
  };
  heading("Your fighter", fighterPane);
  const stage = doc.createElement("div"); stage.className = "eb-sparring-stage"; fighterPane.append(stage);
  if (preview) {
    const loading = doc.createElement("span"); loading.textContent = "Loading fighter preview…";
    stage.append(loading, preview.el);
  } else stage.hidden = true;
  const stageName = doc.createElement("strong"); stageName.className = "eb-sparring-stagename"; stage.append(stageName);
  const fighters = doc.createElement("div"); fighters.className = "eb-sparring-kits"; fighterPane.append(fighters);
  fighters.setAttribute("role", "group"); fighters.setAttribute("aria-label", "Your fighter");
  let kit: KitId = "sv";
  const kitButtons = new Map<KitId, HTMLButtonElement>();
  for (const value of P0_KITS) {
    const card = button(KIT_LABEL[value], fighters); card.dataset["kit"] = value;
    kitButtons.set(value, card);
  }
  const role = doc.createElement("p"); role.className = "eb-sparring-role"; fighterPane.append(role);
  const moves = doc.createElement("ul"); moves.className = "eb-sparring-moves"; moves.setAttribute("aria-label", "Base moves"); fighterPane.append(moves);
  const chooseKit = (value: KitId): void => {
    kit = value;
    for (const [id, card] of kitButtons) card.setAttribute("aria-pressed", String(id === kit));
    role.textContent = KIT_CHOICE[kit].role;
    stageName.textContent = KIT_LABEL[kit];
    moves.replaceChildren(...baseMoveLabels(kit).map((label) => { const li = doc.createElement("li"); li.textContent = label; return li; }));
    preview?.show(kit);
  };
  chooseKit(kit);

  const settings = doc.createElement("section"); settings.className = "eb-sparring-settings"; columns.append(settings);
  heading("Arena", settings);
  const maps = doc.createElement("div"); maps.className = "eb-sparring-maps"; settings.append(maps);
  maps.setAttribute("role", "group"); maps.setAttribute("aria-label", "Map");
  let mapId = DEFAULT_MAP_ID;
  const mapButtons = new Map<string, HTMLButtonElement>();
  for (const def of Object.values(MAP_REGISTRY)) {
    const card = button("", maps); card.dataset["map"] = def.id;
    const art = doc.createElement("span"); art.className = "eb-sparring-map-art"; art.setAttribute("aria-hidden", "true");
    const name = doc.createElement("strong"); name.textContent = def.name;
    const caption = doc.createElement("span"); caption.className = "eb-sparring-map-caption"; caption.textContent = MAP_TAGLINES[def.id] ?? "";
    card.setAttribute("aria-label", def.name); card.append(art, name, caption);
    mapButtons.set(def.id, card);
  }
  const chooseMap = (id: string): void => {
    mapId = id;
    for (const [value, card] of mapButtons) card.setAttribute("aria-pressed", String(value === id));
  };
  chooseMap(mapId);
  heading("Match rules", settings);
  const rules = doc.createElement("div"); rules.className = "eb-sparring-rules"; settings.append(rules);
  const listedLabel = doc.createElement("label");
  const listedBox = doc.createElement("input"); listedBox.type = "checkbox"; listedBox.style.minHeight = "24px";
  listedLabel.append(listedBox, "List this match for other players");
  rules.append(listedLabel);
  const teamLabel = doc.createElement("label");
  const teamBox = doc.createElement("input"); teamBox.type = "checkbox"; teamBox.style.minHeight = "24px"; teamBox.dataset["teamPlay"] = "1";
  teamLabel.append(teamBox, "Team play");
  rules.append(teamLabel);
  const roundLabel = doc.createElement("label"); roundLabel.append("Round length");
  const roundSelect = doc.createElement("select"); roundSelect.dataset["roundTarget"] = "1";
  for (const [value, text] of [["0", "Endless"], ["5", "First to 5 KOs"], ["10", "First to 10 KOs"]] as const) {
    const option = doc.createElement("option"); option.value = value; option.textContent = text; roundSelect.append(option);
  }
  roundLabel.append(roundSelect); rules.append(roundLabel);
  heading("Opponents", settings);
  const teamHint = doc.createElement("p"); teamHint.className = "eb-sparring-team-note"; teamHint.hidden = true;
  teamHint.textContent = `Up to ${TEAM_PLAY.maxHumans} players work together. Start against ${TEAM_PLAY.startBots} Easy bots. The opposition grows to ${TEAM_PLAY.maxBots}.`;
  settings.append(teamHint);
  const roster = doc.createElement("div"); roster.className = "eb-sparring-roster"; settings.append(roster);
  const rows = doc.createElement("div"); roster.append(rows);
  const add = button("Add opponent", roster);
  panel.append(controls);
  const footer = doc.createElement("div"); footer.className = "eb-sparring-footer"; panel.append(footer);
  const status = doc.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); footer.append(status);
  const start = button("Start match", footer); start.className = "eb-primary"; start.setAttribute("aria-label", "Start match");
  const running = doc.createElement("div"); running.hidden = true;
  const copy = button("Copy guest link", running);
  const end = button("End match", running);
  panel.append(running);
  const fallbackLabel = doc.createElement("label"); fallbackLabel.textContent = "Guest link"; fallbackLabel.hidden = true;
  const fallback = doc.createElement("input"); fallback.type = "text"; fallback.readOnly = true; fallback.style.width = "100%";
  fallbackLabel.append(fallback); panel.append(fallbackLabel);
  let bots: Difficulty[] = ["medium"];
  let active = alreadyRunning;
  let pending = false;
  let disposed = false;
  const events = new AbortController();
  const listen = (el: HTMLElement, type: string, fn: () => void): void => { el.addEventListener(type, fn, { signal: events.signal }); };
  const refresh = (): void => {
    controls.disabled = pending || active;
    controls.hidden = active;
    add.disabled = bots.length >= 3;
    start.disabled = pending || active;
    start.hidden = active;
    start.textContent = pending && !active ? "Starting…" : "Start match";
    copy.disabled = pending || (!teamBox.checked && bots.length === 3);
    end.disabled = pending;
    roster.hidden = teamBox.checked;
    teamHint.hidden = !teamBox.checked;
    footer.classList.toggle("is-running", active);
    running.hidden = !active;
    title.textContent = active ? "Sparring controls" : "Host sparring";
    hint.hidden = active;
    panel.setAttribute("aria-busy", String(pending));
  };
  const renderRows = (): void => {
    rows.replaceChildren();
    bots.forEach((difficulty, index) => {
      const row = doc.createElement("div");
      row.className = "eb-sparring-bot";
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
    pending = true; status.textContent = kind === "start" ? "Preparing your arena…" : "Working…"; fallback.value = ""; fallbackLabel.hidden = true; refresh();
    try {
      if (kind === "start") {
        await actions.start({
          bots: teamBox.checked ? Array<Difficulty>(TEAM_PLAY.startBots).fill(TEAM_PLAY.startDifficulty) : [...bots],
          ...(teamBox.checked ? { teamPlay: true } : {}),
          ...(mapId !== DEFAULT_MAP_ID ? { mapId } : {}),
          ...(roundSelect.value === "5" ? { roundTarget: 5 as const } : roundSelect.value === "10" ? { roundTarget: 10 as const } : {}),
        }, kit, listedBox.checked);
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
  for (const [id, card] of kitButtons) listen(card, "click", () => chooseKit(id));
  for (const [id, card] of mapButtons) listen(card, "click", () => chooseMap(id));
  listen(teamBox, "change", refresh);
  listen(add, "click", () => { if (!pending && !active && !disposed && bots.length < 3) { bots.push("medium"); renderRows(); } });
  listen(start, "click", () => { if (!active) void run("start"); });
  listen(copy, "click", () => { if (active && (teamBox.checked || bots.length < 3)) void run("copy"); });
  listen(end, "click", () => { if (active) void run("end"); });
  if (alreadyRunning) status.textContent = "Match is running. Invite friends if a space remains.";
  renderRows(); root.append(panel);
  return () => {
    if (disposed) return;
    disposed = true; events.abort(); preview?.hide(); fallback.value = ""; removeCss(); panel.remove();
  };
}
