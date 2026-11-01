/**
 * Practice panel (T18d, spec section 6): tutorial checklist and two dummy toggles. Display and intent only:
 * the checklist shows the server's replicated tutorialStep and the toggles send a strict `practice` message whose
 * effect is read back from the replicated owner record. One delegated click listener, removed in dispose().
 */
import { tutorialView } from "./PracticeFormat.js";

export interface PracticeState { step: number; skillMask: number; dummyGuard: boolean; dummyRagdoll: boolean }

export class PracticePanel {
  private readonly root: HTMLElement;
  private readonly onClick: (e: Event) => void;
  private key = "";
  private cur: PracticeState = { step: 0, skillMask: 0, dummyGuard: false, dummyRagdoll: false };
  /** Toggles as last requested by this person; rapid clicks build on each other until the server's value arrives. */
  private intent = { guard: false, ragdoll: false };

  constructor(
    parent: HTMLElement, private readonly setToggles: (t: { guard: boolean; ragdoll: boolean }) => void,
    private readonly doc: Document = document,
  ) {
    this.root = doc.createElement("div");
    this.root.dataset["ui"] = "practice";
    // Top centre, below the safe-area inset; the touch controls sit at the screen sides and bottom.
    this.root.style.cssText = "position:fixed;top:calc(max(8px,env(safe-area-inset-top)) + 46px);left:50%;transform:translateX(-50%);z-index:20;"
      + "width:min(300px,34vw);max-height:48vh;overflow:auto;padding:8px 10px;border-radius:12px;box-sizing:border-box;"
      + "background:#0b1118d9;color:#fff;font:13px system-ui;pointer-events:auto";
    this.onClick = (e: Event): void => {
      const b = (e.target as HTMLElement | null)?.closest?.("button[data-toggle]") as HTMLElement | null;
      const t = b?.dataset["toggle"];
      if (t === "guard") this.intent = { ...this.intent, guard: !this.intent.guard };
      else if (t === "ragdoll") this.intent = { ...this.intent, ragdoll: !this.intent.ragdoll };
      else return;
      this.setToggles({ ...this.intent });
    };
    this.root.addEventListener("click", this.onClick);
    parent.append(this.root);
    this.render(this.cur);
  }

  render(st: PracticeState): void {
    const key = JSON.stringify(st);
    if (key === this.key) return;
    this.key = key;
    this.cur = st;
    this.intent = { guard: st.dummyGuard, ragdoll: st.dummyRagdoll };
    const v = tutorialView(st.step, st.skillMask);
    this.root.replaceChildren();
    const title = this.doc.createElement("div");
    title.textContent = "Practice";
    title.style.cssText = "font:700 15px system-ui;margin-bottom:4px";
    this.root.append(title);
    const list = this.doc.createElement("ol");
    list.style.cssText = "margin:0;padding-left:20px";
    for (const r of v.rows) {
      const li = this.doc.createElement("li");
      li.dataset["step"] = r.id;
      li.dataset["status"] = r.status;
      li.textContent = `${r.label}${r.detail ? ` (${r.detail})` : ""}${r.status === "done" ? " - done" : ""}`;
      li.style.cssText = `opacity:${r.status === "todo" ? 0.6 : 1};font-weight:${r.status === "current" ? 700 : 400}`;
      list.append(li);
    }
    this.root.append(list);
    const hint = this.doc.createElement("p");
    hint.dataset["ui"] = "practice-hint";
    hint.textContent = v.hint;
    hint.style.cssText = "margin:6px 0";
    this.root.append(hint);
    const row = this.doc.createElement("div");
    row.style.cssText = "display:flex;gap:6px";
    for (const [id, label, on] of [["guard", "Dummy guards", st.dummyGuard], ["ragdoll", "Dummy ragdoll", st.dummyRagdoll]] as const) {
      const b = this.doc.createElement("button");
      b.dataset["toggle"] = id;
      b.textContent = `${label}: ${on ? "on" : "off"}`;
      b.setAttribute("aria-pressed", String(on));
      b.style.cssText = `flex:1;min-height:44px;font:600 12px system-ui;border-radius:10px;color:#fff;background:#1d2b3a;border:2px solid ${on ? "#ffd479" : "#9fd3ff55"}`;
      row.append(b);
    }
    this.root.append(row);
  }

  dispose(): void {
    this.root.removeEventListener("click", this.onClick);
    this.root.remove();
  }
}
