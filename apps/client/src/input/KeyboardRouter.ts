/**
 * Spec section 11 keyboard fallback: WASD, mouse attack, F guard, Q dash, Space jump, 1-4 abilities,
 * G awakening, Shift facing lock, Esc menu. It only feeds the same PointerRouter state as touch, so the
 * sampler, validation and rate limits are shared. Intent only; the server decides every outcome.
 * Double-W run is recognised from forward excursions by the fixed-tick IntentSampler.
 */
import type { ControlId } from "./ControlLayout.js";
import type { PointerRouter } from "./PointerRouter.js";

const HOLDS: Readonly<Record<string, ControlId>> = {
  KeyF: "block", Space: "jump", KeyQ: "dash", KeyG: "awaken",
  Digit1: "skill1", Digit2: "skill2", Digit3: "skill3", Digit4: "skill4",
};
const MOVE_KEYS: ReadonlySet<string> = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export class KeyboardRouter {
  private readonly down = new Set<string>();

  constructor(private readonly router: PointerRouter) {}

  private applyMove(): void {
    const d = (k: string) => (this.down.has(k) ? 1 : 0);
    const x = d("KeyD") - d("KeyA");
    const z = d("KeyW") - d("KeyS");
    const len = Math.hypot(x, z);
    this.router.setKeyboardMove(len > 0 ? x / len : 0, len > 0 ? z / len : 0);
  }

  keyDown(code: string): void {
    if (this.down.has(code)) return; // OS key repeat never repeats an edge
    if (MOVE_KEYS.has(code)) { this.down.add(code); this.applyMove(); return; }
    if (code === "Escape") {
      this.router.keyHold("menu", true);
      this.router.keyHold("menu", false);
      return;
    }
    if (code === "ShiftLeft" || code === "ShiftRight") {
      this.down.add(code);
      this.router.keyHold("facing", true);
      this.router.keyHold("facing", false);
      return;
    }
    const id = HOLDS[code];
    if (id === undefined) return;
    this.down.add(code);
    this.router.keyHold(id, true);
    // Space, Q and G are edges: the pseudo hold ends at once. Guard and skills stay held until keyup.
    if (id === "jump" || id === "dash" || id === "awaken") this.router.keyHold(id, false);
  }

  keyUp(code: string): void {
    if (!this.down.delete(code)) return;
    if (MOVE_KEYS.has(code)) { this.applyMove(); return; }
    const id = HOLDS[code];
    if (id === "block" || id === "skill1" || id === "skill2" || id === "skill3" || id === "skill4") this.router.keyHold(id, false);
  }

  /** Mouse button 0 is the attack hold. */
  mouseButton(button: number, on: boolean): void {
    if (button === 0) this.router.keyHold("attack", on);
  }

  releaseAll(): void {
    this.down.clear();
    this.router.releaseAll();
  }
}

/** Binds key and mouse listeners; returns cleanup that removes every listener and releases all holds. */
export function attachKeyboardRouter(router: PointerRouter, win: EventTarget, surface: EventTarget): () => void {
  const k = new KeyboardRouter(router);
  type KE = Event & { code: string };
  type ME = Event & { button: number };
  const onKeyDown = (e: Event) => {
    const code = (e as KE).code;
    k.keyDown(code);
    if (code in HOLDS || code === "Escape") e.preventDefault();
  };
  const onKeyUp = (e: Event) => k.keyUp((e as KE).code);
  const onMouseDown = (e: Event) => k.mouseButton((e as ME).button, true);
  const onMouseUp = (e: Event) => k.mouseButton((e as ME).button, false);
  const onAll = () => k.releaseAll();
  const pairs: [EventTarget, string, (e: Event) => void][] = [
    [win, "keydown", onKeyDown], [win, "keyup", onKeyUp], [win, "blur", onAll], [win, "pagehide", onAll],
    [surface, "mousedown", onMouseDown], [win, "mouseup", onMouseUp],
  ];
  for (const [t, n, f] of pairs) t.addEventListener(n, f);
  return () => {
    for (const [t, n, f] of pairs) t.removeEventListener(n, f);
    k.releaseAll();
  };
}
