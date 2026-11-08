// Test-only page: renders the real T07 Hud from the real computeLayout. Not shipped.
import "../../../apps/client/src/base.css";
import { AdaptiveQuality, DROP_WINDOWS, WINDOW_FRAMES } from "../../../apps/client/src/app/AdaptiveQuality.js";
import { attachSelectionGuard } from "../../../apps/client/src/app/SelectionGuard.js";
import { computeLayout, placeSparringRect, validateLayout } from "../../../apps/client/src/input/ControlLayout.js";
import { resolveLayout } from "../../../apps/client/src/input/LayoutEdit.js";
import { Hud, readSafeRect } from "../../../apps/client/src/ui/Hud.js";

const probe = document.getElementById("probe") as HTMLElement;
const hud = new Hud(document.body);
const query = new URLSearchParams(location.search);
const responsive = query.has("rp01");
if (responsive) {
  await import("../../../apps/client/src/ui/experience.css");
  probe.style.padding = "8px 41px 21px 47px";
}
const base = computeLayout(readSafeRect(window, probe));
const layout = query.has("left") ? resolveLayout(base, { opacity: 0.8, controls: {
  awaken: { nx: 0.5, ny: (base.controls.awaken.cy - base.safe.y0 + 8) / base.safe.H, size: 1 },
} }, "left").layout : base;
hud.render(layout, {
  name: "Fighter", hp: 100, maxHp: 100, meter: 0.5, facingLock: false, portrait: layout.safe.H > layout.safe.W,
  ...(query.get("qu01") || responsive ? { skills: ["Fault Strike", "Undertow Spiral", "Furnace Ray", "Quake"], cooldowns: ["", "3.2", "", "12"], blocked: query.get("qu01") === "blocked" } : {}),
  ...(responsive ? { objective: "First to 5 · You 2 · Leader 3", castText: "Fault Strike · Windup" } : {}),
});
// QU01: the host sparring button's measured rectangle, drawn as a real element so the spec can measure the DOM.
const spar = placeSparringRect(layout);
if (spar) {
  const b = document.createElement("button");
  b.dataset["spar"] = "1"; b.textContent = "Sparring controls";
  b.style.cssText = `position:fixed;left:${spar.left}px;top:${spar.top}px;width:${spar.width}px;height:${spar.height}px;box-sizing:border-box`;
  document.body.append(b);
}
const quality = new AdaptiveQuality("high");
const frameMs = query.get("frames") === "slow" ? 34 : 16;
for (let i = 0; i < DROP_WINDOWS * WINDOW_FRAMES; i++) quality.push(frameMs);
(window as unknown as { __layout: unknown }).__layout = { layout, issues: validateLayout(layout), quality: quality.level };
attachSelectionGuard(document);
if (new URLSearchParams(location.search).get("fb01")) {
  const i = document.createElement("input"); i.id = "fb01-input"; i.value = "Fighter name"; i.style.cssText = "position:fixed;left:8px;top:8px";
  document.body.append(i);
}
