// Test-only page: renders the real T07 Hud from the real computeLayout. Not shipped.
import "../../../apps/client/src/base.css";
import { attachSelectionGuard } from "../../../apps/client/src/app/SelectionGuard.js";
import { computeLayout, placeSparringRect, validateLayout } from "../../../apps/client/src/input/ControlLayout.js";
import { Hud, readSafeRect } from "../../../apps/client/src/ui/Hud.js";

const probe = document.getElementById("probe") as HTMLElement;
const hud = new Hud(document.body);
const layout = computeLayout(readSafeRect(window, probe));
const query = new URLSearchParams(location.search);
hud.render(layout, {
  name: "Fighter", hp: 100, maxHp: 100, meter: 0.5, facingLock: false, portrait: false,
  ...(query.get("qu01") ? { skills: ["Fault Strike", "Undertow Spiral", "Furnace Ray", "Quake"], cooldowns: ["", "3.2", "", "12"], blocked: query.get("qu01") === "blocked" } : {}),
});
// QU01: the host sparring button's measured rectangle, drawn as a real element so the spec can measure the DOM.
const spar = placeSparringRect(layout);
if (spar) {
  const b = document.createElement("button");
  b.dataset["spar"] = "1"; b.textContent = "Sparring controls";
  b.style.cssText = `position:fixed;left:${spar.left}px;top:${spar.top}px;width:${spar.width}px;height:${spar.height}px;box-sizing:border-box`;
  document.body.append(b);
}
(window as unknown as { __layout: unknown }).__layout = { layout, issues: validateLayout(layout) };
attachSelectionGuard(document);
if (new URLSearchParams(location.search).get("fb01")) {
  const i = document.createElement("input"); i.id = "fb01-input"; i.value = "Fighter name"; i.style.cssText = "position:fixed;left:8px;top:8px";
  document.body.append(i);
}
