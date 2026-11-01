import { roomIsFull, type RoomSummary } from "@eb/shared/rooms";

export interface RoomListActions {
  list(): Promise<RoomSummary[]>;
  join(room: RoomSummary): Promise<void>;
}

const REFRESH_MS = 10_000;

export function roomLabel(r: RoomSummary): string {
  const bots = r.bots > 0 ? `, ${r.bots} bot${r.bots === 1 ? "" : "s"}` : "";
  return `${r.name}: ${r.players} of ${r.capacity} players${bots}`;
}

/** Room list panel. One in-flight request at a time; the refresh timer, listeners and DOM are removed on dispose. */
export function mountRoomList(root: HTMLElement, actions: RoomListActions): () => void {
  const doc = root.ownerDocument;
  const win = doc.defaultView ?? window;
  const panel = doc.createElement("section");
  panel.dataset["ui"] = "room-list";
  panel.style.cssText = "box-sizing:border-box;width:min(100%,560px);margin:auto;padding:20px;background:#0b1118;color:#fff;font:16px system-ui;border-radius:16px";
  const title = doc.createElement("h1"); title.textContent = "Find a room"; panel.append(title);
  const refresh = doc.createElement("button"); refresh.type = "button"; refresh.textContent = "Refresh"; refresh.dataset["act"] = "refresh";
  const list = doc.createElement("ul"); list.style.cssText = "list-style:none;padding:0;margin:12px 0";
  const status = doc.createElement("p"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  panel.append(refresh, list, status);
  for (const b of [refresh]) b.style.cssText = "min-height:48px;font:inherit;padding:8px 16px;border-radius:8px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff";
  let pending = false;
  let disposed = false;
  let rooms: RoomSummary[] = [];
  const events = new AbortController();

  const paint = (): void => {
    list.replaceChildren();
    for (const r of rooms) {
      const li = doc.createElement("li");
      li.style.cssText = "display:flex;gap:12px;align-items:center;justify-content:space-between;margin:8px 0";
      const text = doc.createElement("span"); text.textContent = roomLabel(r);
      const join = doc.createElement("button");
      join.type = "button"; join.dataset["join"] = r.roomCode;
      const full = roomIsFull(r);
      join.textContent = full ? "Full" : "Join";
      join.disabled = full || pending;
      join.style.cssText = "min-height:48px;min-width:96px;font:inherit;border-radius:8px;border:2px solid #9fd3ff;background:#1d2b3a;color:#fff";
      li.append(text, join); list.append(li);
    }
    refresh.disabled = pending;
    panel.setAttribute("aria-busy", String(pending));
  };
  const load = async (): Promise<void> => {
    if (pending || disposed) return;
    pending = true; paint();
    try {
      const next = await actions.list();
      if (disposed) return;
      rooms = next;
      status.textContent = rooms.length === 0 ? "No rooms are open right now." : "";
    } catch {
      if (!disposed) status.textContent = "Could not load rooms. Check your invitation link and try again.";
    } finally {
      if (!disposed) { pending = false; paint(); }
    }
  };
  const join = async (code: string): Promise<void> => {
    const room = rooms.find((r) => r.roomCode === code);
    if (!room || pending || disposed) return;
    pending = true; status.textContent = "Joining…"; paint();
    try {
      await actions.join(room);
    } catch {
      if (!disposed) status.textContent = "Could not join that room. Try again.";
    } finally {
      if (!disposed) { pending = false; paint(); }
    }
  };
  refresh.addEventListener("click", () => { void load(); }, { signal: events.signal });
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-join]");
    if (b && !b.disabled) void join(b.dataset["join"]!);
  }, { signal: events.signal });
  const timer = win.setInterval(() => { void load(); }, REFRESH_MS);
  root.append(panel);
  void load();
  return () => {
    if (disposed) return;
    disposed = true; events.abort(); win.clearInterval(timer); panel.remove();
  };
}
