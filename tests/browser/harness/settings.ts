// Test-only page: the real SettingsPanel, SettingsStore (localStorage) and Hud on the real layout code. Not shipped.
import { SettingsStore } from "../../../apps/client/src/app/SettingsStore.js";
import { computeLayout } from "../../../apps/client/src/input/ControlLayout.js";
import { resolveLayout, viewportClass } from "../../../apps/client/src/input/LayoutEdit.js";
import { Hud, readSafeRect } from "../../../apps/client/src/ui/Hud.js";
import { SettingsPanel } from "../../../apps/client/src/ui/Settings.js";

const probe = document.getElementById("probe") as HTMLElement;
const panelHost = document.createElement("div");
document.body.append(panelHost);

// Net listener count per event type on nodes inside the panel, so the test can prove dispose() leaves none behind.
const live = new Map<string, number>();
const add = EventTarget.prototype.addEventListener;
const rem = EventTarget.prototype.removeEventListener;
const inPanel = (t: EventTarget): boolean => t instanceof Node && panelHost.contains(t);
EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, fn: never, o?: never): void {
  if (inPanel(this)) live.set(type, (live.get(type) ?? 0) + 1);
  return add.call(this, type, fn, o);
};
EventTarget.prototype.removeEventListener = function (this: EventTarget, type: string, fn: never, o?: never): void {
  if (inPanel(this)) live.set(type, (live.get(type) ?? 0) - 1);
  return rem.call(this, type, fn, o);
};

const hud = new Hud(document.body);
const store = new SettingsStore(window.localStorage, "Arel");
let opened = 0, closed = 0;
const safe = () => readSafeRect(window, probe);
const paint = (): void => {
  const base = computeLayout(safe());
  const st = store.get();
  const { layout, fellBack } = resolveLayout(base, st.layouts[viewportClass(base.safe.W)], st.handedness);
  hud.render(layout, { name: "Fighter", hp: 100, maxHp: 100, meter: 0.5, facingLock: false, portrait: false });
  (window as unknown as { __fellBack: boolean }).__fellBack = fellBack;
};
store.subscribe(paint);
paint();
window.addEventListener("resize", paint);

const panel = new SettingsPanel(panelHost, store, {
  safeRect: safe, onOpen: () => { opened++; }, onClose: () => { closed++; }, inMatch: () => true,
});
document.getElementById("open")!.addEventListener("click", () => { panel.open(); });

(window as unknown as { __t27: unknown }).__t27 = {
  counts: () => ({ opened, closed }),
  liveListeners: () => Object.fromEntries([...live].filter(([, n]) => n !== 0)),
  dispose: () => { panel.dispose(); },
  panelPresent: () => document.querySelector('[data-ui="settings"]') !== null || document.querySelector('[data-ui="layout-editor"]') !== null,
};
