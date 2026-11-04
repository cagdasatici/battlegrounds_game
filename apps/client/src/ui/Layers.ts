// GR11: one z-index scale for every in-match overlay. Presentation only; pointer ownership stays in the router.
export const LAYER = {
  world: 0,
  worldLabels: 10,
  damageCues: 20,
  hud: 30,
  practice: 35,
  modalBackdrop: 50,
  modalContent: 60,
  status: 70,
} as const;

/** Elements that must disappear while a modal owns input (world labels, transient combat callouts). */
export const MODAL_HIDDEN_ATTR = "data-modal-open";

/** Marks the document so CSS hides world labels and callouts without losing their state. */
export function setModalOpen(doc: Document, open: boolean): void {
  if (open) doc.documentElement.setAttribute(MODAL_HIDDEN_ATTR, "1");
  else doc.documentElement.removeAttribute(MODAL_HIDDEN_ATTR);
}
