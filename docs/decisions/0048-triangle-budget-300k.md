# 0048 Triangle budget raised to 300,000

Status: accepted (interim), owner request.

- The medium visible-triangle cap moves from 150,000 to 300,000 (spec section 24, all browser and unit budget assertions).
- Draw-call cap (120), particle pool caps, asset size and every other budget are unchanged.
- Reason: the dense east-facing view with four fighters measured 151,960 to 162,992 triangles. On iPad the bottleneck is expected to be fill rate, overdraw and draw calls, not triangle count, so cutting scenery geometry traded visual quality for little speed.
- This is interim. Physical iPad fps diagnostics are NOT RUN; the owner will run them. If they show geometry cost, tighten this cap again.
- Scenery simplification from the earlier committed work stays. Uncommitted extra reductions (tree simplify ratio 0.62, cloud/fx primitive cuts) were not kept.
- New test: UX08 four fighters in the dense east satellite view (tests/browser/environment-polish.spec.ts), asserting the new cap.
