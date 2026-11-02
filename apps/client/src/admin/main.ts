import "./admin.css";
import { createAdminApi } from "./api.js";
import { MOUNTS, SCREENS, mountLogin, type ScreenName } from "./screens.js";

/** WEB5 admin entry. Exactly one screen is mounted at a time; changing screen disposes the previous one. */
const host = document.getElementById("admin");
if (host) {
  const app = document.createElement("div"); app.className = "adm";
  const h1 = document.createElement("h1"); h1.textContent = "Battlegrounds admin";
  const nav = document.createElement("nav");
  const view = document.createElement("div");
  const back = document.createElement("a"); back.href = "/"; back.textContent = "← Back to game";
  app.append(back, h1, nav, view);
  host.replaceChildren(app);
  let dispose: (() => void) | null = null;
  let signedIn = false;
  const clear = (): void => { dispose?.(); dispose = null; view.replaceChildren(); };

  const showLogin = (): void => {
    signedIn = false; nav.replaceChildren(); clear();
    dispose = mountLogin(view, async (pw) => { await api.login(pw); signedIn = true; buildNav(); show("status"); });
  };
  const api = createAdminApi(() => { if (signedIn) showLogin(); });
  const show = (name: ScreenName): void => {
    clear();
    for (const b of nav.querySelectorAll("button")) {
      if (b.dataset["screen"] === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    dispose = MOUNTS[name](view, api);
  };
  const buildNav = (): void => {
    nav.replaceChildren(...SCREENS.map((s) => {
      const b = document.createElement("button"); b.type = "button"; b.dataset["screen"] = s; b.textContent = s[0]!.toUpperCase() + s.slice(1);
      b.addEventListener("click", () => show(s));
      return b;
    }));
    const out = document.createElement("button"); out.type = "button"; out.dataset["act"] = "logout"; out.textContent = "Sign out";
    out.addEventListener("click", () => { void api.logout().catch(() => undefined).finally(showLogin); });
    nav.append(out);
  };
  showLogin();
}
