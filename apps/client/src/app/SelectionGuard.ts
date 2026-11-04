// FB01: iPad Safari selects text / shows the blue select-all overlay and callouts when buttons are tapped quickly.
// CSS (base.css) does most of the work; this guard covers selectstart, contextmenu, dblclick and gesturestart,
// and clears any selection that still appears. Real text fields stay editable.

export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as { closest?: (s: string) => Element | null } | null;
  if (!el || typeof el.closest !== "function") return false;
  return el.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") !== null;
}

/** Returns a cleanup that removes every listener. */
export function attachSelectionGuard(doc: Document): () => void {
  const block = (e: Event): void => { if (!isEditableTarget(e.target)) e.preventDefault(); };
  const clear = (): void => {
    if (isEditableTarget(doc.activeElement)) return; // text inside a focused field is the user's
    const sel = doc.getSelection?.();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const a = sel.anchorNode;
    const host = a instanceof Element ? a : (a?.parentElement ?? null);
    if (isEditableTarget(host)) return;
    sel.removeAllRanges();
  };
  const types = ["selectstart", "contextmenu", "dblclick", "gesturestart"] as const;
  for (const t of types) doc.addEventListener(t, block, { passive: false });
  doc.addEventListener("selectionchange", clear);
  return () => {
    for (const t of types) doc.removeEventListener(t, block);
    doc.removeEventListener("selectionchange", clear);
  };
}
