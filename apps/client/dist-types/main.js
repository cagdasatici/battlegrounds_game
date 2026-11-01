import { RoomClient } from "./net/RoomClient.js";
const app = document.getElementById("app");
if (app)
    app.textContent = "Preparing arena…";
/** Reads the invitation from the URL fragment and removes it before any request (spec section 20). */
export function consumeInviteFragment(loc = location, hist = history) {
    const m = /(?:^#|&)invite=([A-Za-z0-9_-]{8,128})/.exec(loc.hash);
    if (!m)
        return null;
    hist.replaceState(null, "", loc.pathname + loc.search);
    return m[1] ?? null;
}
export function createRoomClient() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return new RoomClient({
        httpBase: "",
        wsEndpoint: `${proto}://${location.host}`,
        storage: sessionStorage,
    });
}
