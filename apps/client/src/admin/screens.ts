import { DEFAULT_MAP_ID, MAP_REGISTRY } from "@eb/shared/config/maps";
import { AdminHttpError, type AdminApi } from "./api.js";

/** WEB5 admin screens: plain DOM. Each mount returns a dispose that removes listeners, timers and nodes. */
export type ScreenName = "status" | "invites" | "players" | "rooms" | "announcement";
export const SCREENS: readonly ScreenName[] = ["status", "invites", "players", "rooms", "announcement"];
export const STATUS_REFRESH_MS = 5000;
export type Mount = (root: HTMLElement, api: AdminApi) => () => void;

interface Frame { doc: Document; panel: HTMLElement; body: HTMLElement; note: HTMLElement; events: AbortController; busy(key: string, fn: () => Promise<void>): void; alive(): boolean; dispose(): void }

/** Shared screen shell: heading, status line, abortable listeners, and one in-flight action per key (double-click suppression). */
function frame(root: HTMLElement, title: string, screen: string): Frame {
  const doc = root.ownerDocument;
  const panel = doc.createElement("section"); panel.dataset["screen"] = screen;
  const h = doc.createElement("h2"); h.textContent = title;
  const note = doc.createElement("p"); note.setAttribute("role", "status"); note.setAttribute("aria-live", "polite");
  const body = doc.createElement("div");
  panel.append(h, note, body); root.append(panel);
  const events = new AbortController();
  const inflight = new Set<string>();
  let disposed = false;
  return {
    doc, panel, body, note, events,
    alive: () => !disposed,
    busy(key, fn) {
      if (inflight.has(key) || disposed) return;
      inflight.add(key);
      void fn().finally(() => inflight.delete(key));
    },
    dispose() { if (disposed) return; disposed = true; events.abort(); panel.remove(); },
  };
}
const el = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const e = doc.createElement(tag); if (text !== undefined) e.textContent = text; return e;
};
const button = (doc: Document, text: string, act: string, id?: string): HTMLButtonElement => {
  const b = el(doc, "button", text); b.type = "button"; b.dataset["act"] = act; if (id !== undefined) b.dataset["id"] = id; return b;
};
const when = (t: number): string => new Date(t).toLocaleString();
const fail = (f: Frame, what: string): void => { if (f.alive()) { f.note.textContent = `${what} failed. Try again.`; f.note.className = "err"; } };
const ok = (f: Frame, text = ""): void => { if (f.alive()) { f.note.textContent = text; f.note.className = ""; } };
/** Click delegation for buttons carrying data-act inside a container. */
function onAct(f: Frame, target: HTMLElement, handle: (act: string, id: string, b: HTMLButtonElement) => void): void {
  target.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (b && !b.disabled) handle(b.dataset["act"]!, b.dataset["id"] ?? "", b);
  }, { signal: f.events.signal });
}

export const mountLogin = (root: HTMLElement, onLogin: (password: string) => Promise<void>): (() => void) => {
  const f = frame(root, "Admin sign-in", "login");
  f.body.append(el(f.doc, "p", "First visit? Run pnpm admin:setup on the host and restart the game. Then sign in here with the password you chose."));
  const form = el(f.doc, "form");
  const label = el(f.doc, "label", "Password ");
  const input = el(f.doc, "input"); input.type = "password"; input.autocomplete = "current-password"; input.required = true; input.maxLength = 256; input.name = "password";
  label.append(input);
  const submit = el(f.doc, "button", "Sign in"); submit.type = "submit";
  form.append(label, submit); f.body.append(form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    f.busy("login", async () => {
      submit.disabled = true; ok(f, "Signing in…");
      const pw = input.value; input.value = "";
      try { await onLogin(pw); } catch (e) { if (e instanceof AdminHttpError && e.status === 404) ok(f, "Admin is not configured on this host. Run pnpm admin:setup there, then restart the game."); else fail(f, "Sign-in"); }
      if (f.alive()) submit.disabled = false;
    });
  }, { signal: f.events.signal });
  return () => f.dispose();
};

export const mountStatus: Mount = (root, api) => {
  const f = frame(root, "Server status", "status");
  const pre = el(f.doc, "pre"); const list = el(f.doc, "ul"); const summary = el(f.doc, "p");
  f.body.append(summary, list, pre);
  const win = f.doc.defaultView ?? window;
  const load = (): void => f.busy("load", async () => {
    try {
      const s = await api.status();
      if (!f.alive()) return;
      summary.textContent = `Build ${s.buildId}, protocol ${s.protocolVersion}, content ${s.contentHash.slice(0, 12)}, up ${s.uptimeSeconds} s, ${s.playerCount} players`;
      list.replaceChildren(...s.rooms.map((r) => el(f.doc, "li", `${r.roomCode} (${r.kind}): ${r.players} players, ${r.bots} bots`)));
      pre.textContent = s.logs.join("\n");
      ok(f);
    } catch { fail(f, "Loading status"); }
  });
  f.note.textContent = "Loading…";
  load();
  // Refresh only while the page is visible.
  const timer = win.setInterval(() => { if (f.doc.visibilityState !== "hidden") load(); }, STATUS_REFRESH_MS);
  return () => { win.clearInterval(timer); f.dispose(); };
};

export const mountInvites: Mount = (root, api) => {
  const f = frame(root, "Invitations", "invites");
  const form = el(f.doc, "form");
  const ttl = el(f.doc, "input"); ttl.type = "number"; ttl.min = "1"; ttl.max = "720"; ttl.value = "24"; ttl.name = "ttl";
  const uses = el(f.doc, "input"); uses.type = "number"; uses.min = "1"; uses.max = "100"; uses.value = "1"; uses.name = "uses";
  const l1 = el(f.doc, "label", "Valid for (hours) "); l1.append(ttl);
  const l2 = el(f.doc, "label", "Uses "); l2.append(uses);
  const create = el(f.doc, "button", "Create invitation"); create.type = "submit";
  const fresh = el(f.doc, "div"); const list = el(f.doc, "ul");
  form.append(l1, l2, create); f.body.append(form, fresh, list);
  const load = (): void => f.busy("load", async () => {
    try {
      const rows = await api.invites();
      if (!f.alive()) return;
      list.replaceChildren(...rows.map((r) => {
        const li = el(f.doc, "li");
        li.append(el(f.doc, "span", `Expires ${when(r.expiresAt)}, ${r.usesLeft} use${r.usesLeft === 1 ? "" : "s"} left`), button(f.doc, "Revoke", "revoke", r.id));
        return li;
      }));
      ok(f, rows.length === 0 ? "No active invitations." : "");
    } catch { fail(f, "Loading invitations"); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    f.busy("create", async () => {
      create.disabled = true;
      try {
        const made = await api.createInvite(Number(ttl.value), Number(uses.value));
        if (!f.alive()) return;
        // The link exists only in this node: shown once, never stored, removed by Done or on leaving the screen.
        const link = el(f.doc, "p", made.link); link.className = "link"; link.dataset["role"] = "invite-link";
        const copy = button(f.doc, "Copy link", "copy"); const done = button(f.doc, "Done", "done");
        fresh.replaceChildren(el(f.doc, "p", "Copy this link now. It will not be shown again."), link, copy, done);
        copy.addEventListener("click", () => {
          void (f.doc.defaultView?.navigator.clipboard?.writeText(made.link) ?? Promise.reject(new Error("no clipboard")))
            .then(() => ok(f, "Copied."), () => { ok(f, "Copy failed; select the link and copy it."); });
        }, { signal: f.events.signal });
        done.addEventListener("click", () => fresh.replaceChildren(), { signal: f.events.signal });
        await Promise.resolve(); load();
      } catch { fail(f, "Creating the invitation"); }
      if (f.alive()) create.disabled = false;
    });
  }, { signal: f.events.signal });
  onAct(f, list, (act, id) => { if (act === "revoke") f.busy(`revoke:${id}`, async () => { try { await api.revokeInvite(id); } catch { fail(f, "Revoking"); return; } load(); }); });
  f.note.textContent = "Loading…";
  load();
  return () => { fresh.replaceChildren(); f.dispose(); };
};

export const mountPlayers: Mount = (root, api) => {
  const f = frame(root, "Players", "players");
  const list = el(f.doc, "ul"); f.body.append(list);
  const load = (): void => f.busy("load", async () => {
    try {
      const rows = await api.sessions();
      if (!f.alive()) return;
      list.replaceChildren(...rows.map((r) => {
        const li = el(f.doc, "li");
        li.append(el(f.doc, "span", `${r.displayName}, joined ${when(r.createdAt)}, active ${when(r.lastActive)}`), button(f.doc, "Revoke", "revoke", r.id));
        return li;
      }));
      ok(f, rows.length === 0 ? "No signed-in players." : "");
    } catch { fail(f, "Loading players"); }
  });
  onAct(f, list, (act, id) => { if (act === "revoke") f.busy(`revoke:${id}`, async () => { try { await api.revokeSession(id); } catch { fail(f, "Revoking"); return; } load(); }); });
  f.note.textContent = "Loading…";
  load();
  return () => f.dispose();
};

export const mountRooms: Mount = (root, api) => {
  const f = frame(root, "Rooms", "rooms");
  const form = el(f.doc, "form");
  const name = el(f.doc, "input"); name.type = "text"; name.maxLength = 32; name.required = true; name.name = "name";
  const l = el(f.doc, "label", "Room name "); l.append(name);
  const create = el(f.doc, "button", "Create room"); create.type = "submit";
  const list = el(f.doc, "ul");
  const botLabel = el(f.doc, "label", "Bots ");
  const count = el(f.doc, "select"); count.name = "bots"; count.setAttribute("aria-label", "Bots");
  for (let n = 0; n <= 3; n++) { const o = el(f.doc, "option", String(n)); o.value = String(n); count.append(o); }
  botLabel.append(count);
  const difficultyLabel = el(f.doc, "label", "Bot difficulty ");
  const difficulty = el(f.doc, "select"); difficulty.name = "difficulty"; difficulty.setAttribute("aria-label", "Bot difficulty");
  for (const value of ["easy", "medium", "hard"]) { const o = el(f.doc, "option", value); o.value = value; difficulty.append(o); }
  difficultyLabel.append(difficulty);
  const targetLabel = el(f.doc, "label", "Rounds ");
  const target = el(f.doc, "select"); target.name = "roundTarget"; target.setAttribute("aria-label", "Rounds");
  for (const [value, text] of [["0", "Endless"], ["5", "First to 5"], ["10", "First to 10"]] as const) { const o = el(f.doc, "option", text); o.value = value; target.append(o); }
  targetLabel.append(target);
  // WORLD01: map for the new room (the grove is the default and is sent as "no choice").
  const mapLabel = el(f.doc, "label", "Map ");
  const mapSelect = el(f.doc, "select"); mapSelect.name = "mapId"; mapSelect.setAttribute("aria-label", "Map");
  for (const def of Object.values(MAP_REGISTRY)) { const o = el(f.doc, "option", def.name); o.value = def.id; mapSelect.append(o); }
  mapSelect.value = DEFAULT_MAP_ID;
  mapLabel.append(mapSelect);
  // Rounds need at least one bot (server also enforces this); nonzero choices are disabled and reset to endless without bots.
  const syncTarget = (): void => {
    const none = Number(count.value) === 0;
    for (const o of Array.from(target.options)) o.disabled = none && o.value !== "0";
    if (none) target.value = "0";
  };
  count.addEventListener("change", syncTarget, { signal: f.events.signal });
  syncTarget();
  form.append(l, botLabel, difficultyLabel, targetLabel, mapLabel, el(f.doc, "p", "Four fighters maximum, including bots. Close a room to change its opponents."), create); f.body.append(form, list);
  const load = (): void => f.busy("load", async () => {
    try {
      const rows = await api.rooms();
      if (!f.alive()) return;
      list.replaceChildren(...rows.map((r) => {
        const li = el(f.doc, "li");
        li.append(el(f.doc, "span", `${r.name} (${r.kind}): ${r.players} players, ${r.bots} bots, ${r.listed ? "listed" : "unlisted"}`),
          button(f.doc, r.listed ? "Unlist" : "List", r.listed ? "unlist" : "list", r.roomCode), button(f.doc, "Close", "close", r.roomCode));
        return li;
      }));
      ok(f, rows.length === 0 ? "No rooms." : "");
    } catch { fail(f, "Loading rooms"); }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    f.busy("create", async () => {
      create.disabled = true;
      try { await api.createRoom(name.value.trim(), Array.from({ length: Number(count.value) }, () => difficulty.value as "easy" | "medium" | "hard"), Number(count.value) === 0 ? 0 : Number(target.value) as 0 | 5 | 10, mapSelect.value === DEFAULT_MAP_ID ? undefined : mapSelect.value); name.value = ""; load(); } catch { fail(f, "Creating the room"); }
      if (f.alive()) create.disabled = false;
    });
  }, { signal: f.events.signal });
  onAct(f, list, (act, id) => f.busy(`${act}:${id}`, async () => {
    try {
      if (act === "close") await api.closeRoom(id); else await api.setListed(id, act === "list");
    } catch { fail(f, "Updating the room"); return; }
    load();
  }));
  f.note.textContent = "Loading…";
  load();
  return () => f.dispose();
};

export const mountAnnouncement: Mount = (root, api) => {
  const f = frame(root, "Announcement", "announcement");
  const form = el(f.doc, "form");
  const text = el(f.doc, "input"); text.type = "text"; text.maxLength = 200; text.name = "text";
  const l = el(f.doc, "label", "Message (max 200 characters) "); l.append(text);
  const save = el(f.doc, "button", "Publish"); save.type = "submit";
  const clear = button(f.doc, "Clear", "clear");
  form.append(l, save, clear); f.body.append(form);
  const put = (value: string, doneText: string): void => f.busy("save", async () => {
    save.disabled = clear.disabled = true;
    try { const a = await api.setAnnouncement(value); if (f.alive()) { text.value = a?.text ?? ""; ok(f, doneText); } } catch { fail(f, "Saving the announcement"); }
    if (f.alive()) save.disabled = clear.disabled = false;
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); put(text.value, text.value.trim() === "" ? "Cleared." : "Published."); }, { signal: f.events.signal });
  clear.addEventListener("click", () => put("", "Cleared."), { signal: f.events.signal });
  f.note.textContent = "Loading…";
  f.busy("load", async () => {
    try { const a = await api.announcement(); if (f.alive()) { if (text.value === "") text.value = a?.text ?? ""; ok(f); } } catch { fail(f, "Loading the announcement"); }
  });
  return () => f.dispose();
};

export const MOUNTS: Record<ScreenName, Mount> = { status: mountStatus, invites: mountInvites, players: mountPlayers, rooms: mountRooms, announcement: mountAnnouncement };
