// Test-only page: renders the real T07 Hud from the real computeLayout. Not shipped.
import { computeLayout, validateLayout } from "../../../apps/client/src/input/ControlLayout.js";
import { Hud, readSafeRect } from "../../../apps/client/src/ui/Hud.js";

const probe = document.getElementById("probe") as HTMLElement;
const hud = new Hud(document.body);
const layout = computeLayout(readSafeRect(window, probe));
hud.render(layout, { name: "Fighter", hp: 100, maxHp: 100, meter: 0.5, facingLock: false, portrait: false });
(window as unknown as { __layout: unknown }).__layout = { layout, issues: validateLayout(layout) };
